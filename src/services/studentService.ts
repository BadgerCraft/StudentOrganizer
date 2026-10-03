import { isLocalPhoto, MAX_PHOTO_BYTES } from '../utils/localPhoto';
import type { OntarioTeacherDB } from '../db/database';
import type { AuditEntry, Student, StudentNote, SyncMutation, UUID } from '../types/schema';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';
import { assertClassSectionWriteAccess, AUTH_TABLES, AuthorizationError } from './authHelper';

export interface UpdateStudentProfileParams {
  studentId: UUID;
  expectedVersion: number;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  pronouns: string | null;
  photoUrl: string | null;
  userId: UUID;
  deviceId: UUID;
}

export interface CreateStudentNoteParams {
  classEnrollmentId: UUID;
  content: string;
  isConfidential?: boolean;
  userId: UUID;
  deviceId: UUID;
}

export class StudentDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Updates student profile information (names, pronouns, local photo).
   * Enforces:
   * - Trimmed non-empty firstName and lastName (1-100 chars).
   * - Forbids external http/https photo URLs (local data URLs only).
   * - Enforces 64 KB storage limit on photoUrl.
   * - Optimistic concurrency validation against expectedVersion.
   * - Redacts raw photo data URL in AuditEntry.diffJson to prevent DB bloat.
   * - Transactional update with AuditEntry and SyncMutation.
   */
  async updateStudentProfile(params: UpdateStudentProfileParams): Promise<Student> {
    const trimmedFirst = params.firstName?.trim() ?? '';
    const trimmedLast = params.lastName?.trim() ?? '';

    if (!trimmedFirst || trimmedFirst.length > 100) {
      throw new ValidationError('First name is required and must be at most 100 characters.');
    }
    if (!trimmedLast || trimmedLast.length > 100) {
      throw new ValidationError('Last name is required and must be at most 100 characters.');
    }

    const normPreferred = params.preferredName?.trim() ? params.preferredName.trim() : null;
    if (normPreferred && normPreferred.length > 100) {
      throw new ValidationError('Preferred name must be at most 100 characters.');
    }

    const normPronouns = params.pronouns?.trim() ? params.pronouns.trim() : null;
    if (normPronouns && normPronouns.length > 50) {
      throw new ValidationError('Pronouns must be at most 50 characters.');
    }

    let normPhoto = params.photoUrl?.trim() ? params.photoUrl.trim() : null;
    if (normPhoto) {
      if (/^https?:\/\//i.test(normPhoto)) throw new ValidationError('External photo URLs are not permitted. Please upload a local image.');
      if (normPhoto.length > MAX_PHOTO_BYTES) throw new ValidationError('Photo exceeds the maximum allowed size of 64 KB.');
      if (!isLocalPhoto(normPhoto)) {
        throw new ValidationError('External photo URLs or invalid/oversized photos are not permitted. Upload a local JPEG, PNG or WebP image of at most 64 KB.');
      }
    }

    return await this.db.transaction(
      'rw',
      [...AUTH_TABLES(this.db), this.db.classEnrollments, this.db.students, this.db.auditEntries, this.db.syncMutations],
      async () => {
        const current = await this.db.students.get(params.studentId);
        if (!current || current.deletedAt !== null) {
          throw new ValidationError(`Student ${params.studentId} not found or deleted.`);
        }

        // Profiles are shared across classes. One active, authorized enrollment
        // in the student's organization is required; the selector is attribution.
        const enrollments = await this.db.classEnrollments.where('studentId').equals(current.id)
          .filter(e => e.deletedAt === null && e.enrollmentStatus === 'active').toArray();
        let authorized = false;
        for (const enrollment of enrollments) {
          try {
            const auth = await assertClassSectionWriteAccess(this.db, params.userId, enrollment.classSectionId);
            if (auth.organizationId === current.organizationId) { authorized = true; break; }
          } catch (error) {
            if (!(error instanceof AuthorizationError)) throw error;
          }
        }
        if (!authorized) throw new AuthorizationError('Teacher cannot edit this student profile.');

        if (current.version !== params.expectedVersion) {
          throw new ConcurrencyError(
            `Concurrency conflict: student version is ${current.version}, expected ${params.expectedVersion}.`
          );
        }

        const now = new Date().toISOString();
        const updated: Student = {
          ...current,
          firstName: trimmedFirst,
          lastName: trimmedLast,
          preferredName: normPreferred,
          pronouns: normPronouns,
          photoUrl: normPhoto,
          updatedAt: now,
          version: current.version + 1
        };

        const txId = crypto.randomUUID();

        // Audit diff with redacted photoUrl
        const diff: Record<string, { old: any; new: any; changed?: boolean }> = {};
        if (current.firstName !== updated.firstName) {
          diff.firstName = { old: current.firstName, new: updated.firstName };
        }
        if (current.lastName !== updated.lastName) {
          diff.lastName = { old: current.lastName, new: updated.lastName };
        }
        if (current.preferredName !== updated.preferredName) {
          diff.preferredName = { old: current.preferredName, new: updated.preferredName };
        }
        if (current.pronouns !== updated.pronouns) {
          diff.pronouns = { old: current.pronouns, new: updated.pronouns };
        }
        diff.photoUrl = {
          old: current.photoUrl ? 'SET' : 'NONE',
          new: updated.photoUrl ? 'SET' : 'NONE',
          changed: current.photoUrl !== updated.photoUrl
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'students',
          entityId: current.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify({
            ...current,
            photoUrl: current.photoUrl ? '[REDACTED]' : null
          }),
          newStateJson: JSON.stringify({
            ...updated,
            photoUrl: updated.photoUrl ? '[REDACTED]' : null
          }),
          diffJson: JSON.stringify(diff),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        // Omit photoUrl completely from relational sync payload so local photos are never overwritten with null
        const { photoUrl: _, ...syncStudentPayload } = updated;

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: current.organizationId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'students',
          entityId: current.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(syncStudentPayload),
          baseVersion: current.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.students.put(updated),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return updated;
      }
    );
  }

  /**
   * Creates a student note with in-transaction authorization check, structured audit entry, and sync mutation.
   */
  async createStudentNote(params: CreateStudentNoteParams): Promise<StudentNote> {
    const trimmedContent = params.content?.trim();
    if (!trimmedContent) {
      throw new ValidationError('Note content is required.');
    }
    if (trimmedContent.length > 5000) {
      throw new ValidationError('Note content exceeds maximum allowed length of 5000 characters.');
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.studentNotes,
        this.db.classEnrollments,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const enrollment = await this.db.classEnrollments.get(params.classEnrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Class enrollment ${params.classEnrollmentId} not found or deleted.`);
        }

        // In-transaction authorization check on the class section
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, enrollment.classSectionId);
        const derivedOrgId = auth.organizationId;

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const note: StudentNote = {
          id: crypto.randomUUID(),
          classEnrollmentId: params.classEnrollmentId,
          authorUserId: params.userId,
          content: trimmedContent,
          isConfidential: params.isConfidential ?? true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };

        await this.db.studentNotes.add(note);

        // Audit entry
        const auditEntry: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'studentNotes',
          entityId: note.id,
          action: 'INSERT',
          transactionId: txId,
          previousStateJson: null,
          newStateJson: JSON.stringify(note),
          diffJson: JSON.stringify({ content: trimmedContent }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };
        await this.db.auditEntries.add(auditEntry);

        // Sync mutation
        const syncMutation: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'studentNotes',
          entityId: note.id,
          operation: 'INSERT',
          payloadJson: JSON.stringify(note),
          baseVersion: 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };
        await this.db.syncMutations.add(syncMutation);

        return note;
      }
    );
  }
}
