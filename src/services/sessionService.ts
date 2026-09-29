import type { OntarioTeacherDB } from '../db/database';
import type { ClassSession, UUID } from '../types/schema';
import { ValidationError } from './markbookService';
import { getSchoolLocalDate, buildTorontoTimestamp } from '../utils/dateUtils';

export interface CreateSessionOptions {
  startsAt?: string;
  now?: Date;
  title?: string;
  sessionType?: ClassSession['sessionType'];
  durationMinutes?: number;
}

export class ClassSessionService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Atomically and idempotently finds or creates a ClassSession
   * for the given classSectionId and localSchoolDate.
   *
   * Enforces:
   * - ClassSection existence and active state.
   * - Serialized read-write transaction preventing concurrent duplicate creation.
   * - Strict specification of all required schema properties.
   * - Validates that session startsAt resolves to schoolDate in America/Toronto.
   * - Keeps createdAt and updatedAt as the actual database insertion instant.
   */
  async getOrCreateSession(
    classSectionId: UUID,
    schoolDate: string,
    options?: CreateSessionOptions
  ): Promise<ClassSession> {
    return await this.db.transaction('rw', [this.db.classSections, this.db.classSessions], async () => {
      // 1. Validate class section
      const section = await this.db.classSections.get(classSectionId);
      if (!section || section.deletedAt !== null) {
        throw new ValidationError(`Class section ${classSectionId} not found or has been deleted.`);
      }

      // 2. Find existing non-deleted session for this class and date
      const existing = await this.db.classSessions
        .where('classSectionId')
        .equals(classSectionId)
        .filter(s => s.localSchoolDate === schoolDate && s.deletedAt === null)
        .first();

      if (existing) {
        return existing;
      }

      // 3. Determine aligned startsAt
      let startsAt: string;
      if (options?.startsAt) {
        startsAt = options.startsAt;
      } else if (options?.now) {
        startsAt = options.now.toISOString();
      } else if (schoolDate === getSchoolLocalDate()) {
        startsAt = new Date().toISOString();
      } else {
        // Historical date without explicit startsAt: default to aligned 09:00 AM Toronto slot
        startsAt = buildTorontoTimestamp(schoolDate, '09:00');
      }

      // Validate startsAt resolves to schoolDate in America/Toronto
      try {
        const occDate = new Date(startsAt);
        if (isNaN(occDate.getTime())) {
          throw new Error('Invalid timestamp');
        }
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Toronto',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const torontoDate = formatter.format(occDate);
        if (torontoDate !== schoolDate) {
          throw new ValidationError(
            `Session startsAt (${startsAt}) resolves to date ${torontoDate} in America/Toronto, but schoolDate is ${schoolDate}.`
          );
        }
      } catch (err: any) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(`Failed to validate session startsAt date alignment: ${err?.message}`);
      }

      const duration = options?.durationMinutes ?? 75;
      const endsAt = new Date(new Date(startsAt).getTime() + duration * 60 * 1000).toISOString();
      const actualNow = new Date().toISOString();

      const newSession: ClassSession = {
        id: crypto.randomUUID(),
        classSectionId,
        startsAt,
        endsAt,
        localSchoolDate: schoolDate,
        timezone: 'America/Toronto',
        title: options?.title ?? `${section.period || 'Period'} Class Session`,
        sessionType: options?.sessionType ?? 'regular',
        createdAt: actualNow,
        updatedAt: actualNow,
        deletedAt: null,
        version: 1
      };

      await this.db.classSessions.add(newSession);
      return newSession;
    });
  }
}
