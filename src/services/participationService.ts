import type { OntarioTeacherDB } from '../db/database';
import type {
  AchievementCategoryCode,
  EventClassification,
  ParticipationEvent,
  ParticipationDailySummary,
  SyncMutation,
  UUID
} from '../types/schema';
import { ValidationError } from './markbookService';

export interface RecordParticipationParams {
  classEnrollmentIds: UUID[];
  classSectionId: UUID;
  classSessionId?: UUID | null;
  eventTypeId?: UUID | null;
  name: string;
  classification: EventClassification;
  points: number;
  note?: string | null;
  categoryCode?: AchievementCategoryCode | null;
  studentAssessmentId?: UUID | null;
  occurredAt?: string;
  localSchoolDate: string; // YYYY-MM-DD
  timezone?: string;
  userId: UUID;
  deviceId: UUID;
}

export interface UndoBatchResult {
  undoneCount: number;
  batchId: UUID;
}

export class ParticipationDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Records a participation event for one or multiple students atomically.
   * Snapshots event attributes and updates the daily summary projection.
   */
  async recordParticipation(params: RecordParticipationParams): Promise<ParticipationEvent[]> {
    if (params.classEnrollmentIds.length === 0) {
      throw new ValidationError('At least one student must be selected.');
    }

    return await this.db.transaction(
      'rw',
      [
        this.db.classEnrollments,
        this.db.classSections,
        this.db.participationEvents,
        this.db.participationDailySummaries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const batchId = crypto.randomUUID();
        const txId = crypto.randomUUID();
        const occurredAt = params.occurredAt ?? now;
        const timezone = params.timezone ?? 'America/Toronto';

        const events: ParticipationEvent[] = [];
        const syncMutations: SyncMutation[] = [];

        for (let i = 0; i < params.classEnrollmentIds.length; i++) {
          const enrollmentId = params.classEnrollmentIds[i];
          const enrollment = await this.db.classEnrollments.get(enrollmentId);
          if (!enrollment || enrollment.deletedAt !== null) {
            throw new ValidationError(`Enrollment ${enrollmentId} not found or deleted.`);
          }
          if (enrollment.classSectionId !== params.classSectionId) {
            throw new ValidationError(`Enrollment ${enrollmentId} does not belong to section ${params.classSectionId}.`);
          }

          const event: ParticipationEvent = {
            id: crypto.randomUUID(),
            classEnrollmentId: enrollmentId,
            classSectionId: params.classSectionId,
            classSessionId: params.classSessionId ?? null,
            batchId,
            eventTypeId: params.eventTypeId ?? null,
            snapshottedName: params.name,
            snapshottedClassification: params.classification,
            snapshottedPoints: params.points,
            occurredAt,
            localSchoolDate: params.localSchoolDate,
            timezone,
            note: params.note ?? null,
            categoryCode: params.categoryCode ?? null,
            studentAssessmentId: params.studentAssessmentId ?? null,
            createdByUserId: params.userId,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };

          events.push(event);

          // Update rebuildable daily summary projection
          const summary = await this.db.participationDailySummaries
            .where({
              classEnrollmentId: enrollmentId,
              localSchoolDate: params.localSchoolDate
            })
            .first();

          if (summary) {
            const updated: ParticipationDailySummary = {
              ...summary,
              positiveCount: params.classification === 'positive' ? summary.positiveCount + 1 : summary.positiveCount,
              needsFollowupCount: params.classification === 'needs_followup' ? summary.needsFollowupCount + 1 : summary.needsFollowupCount,
              totalPoints: summary.totalPoints + params.points,
              lastEventAt: occurredAt
            };
            await this.db.participationDailySummaries.put(updated);
          } else {
            const newSummary: ParticipationDailySummary = {
              id: crypto.randomUUID(),
              classEnrollmentId: enrollmentId,
              localSchoolDate: params.localSchoolDate,
              positiveCount: params.classification === 'positive' ? 1 : 0,
              needsFollowupCount: params.classification === 'needs_followup' ? 1 : 0,
              totalPoints: params.points,
              lastEventAt: occurredAt
            };
            await this.db.participationDailySummaries.add(newSummary);
          }

          syncMutations.push({
            id: crypto.randomUUID(),
            deviceId: params.deviceId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: i + 1,
            transactionSize: params.classEnrollmentIds.length,
            entityName: 'participationEvents',
            entityId: event.id,
            operation: 'INSERT',
            payloadJson: JSON.stringify(event),
            baseVersion: 0,
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });
        }

        await this.db.participationEvents.bulkAdd(events);
        await this.db.syncMutations.bulkAdd(syncMutations);

        return events;
      }
    );
  }

  /**
   * Atomic undo for a single event or multi-student batch.
   */
  async undoBatch(batchId: UUID, userId: UUID, deviceId: UUID): Promise<UndoBatchResult> {
    return await this.db.transaction(
      'rw',
      [
        this.db.participationEvents,
        this.db.participationDailySummaries,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const events = await this.db.participationEvents
          .where('batchId')
          .equals(batchId)
          .toArray();

        const activeEvents = events.filter(e => e.deletedAt === null);
        if (activeEvents.length === 0) {
          return { undoneCount: 0, batchId };
        }

        for (let i = 0; i < activeEvents.length; i++) {
          const ev = activeEvents[i];
          const updatedEv: ParticipationEvent = {
            ...ev,
            deletedAt: now,
            updatedAt: now,
            version: ev.version + 1
          };
          await this.db.participationEvents.put(updatedEv);

          // Decrement daily summary projection
          const summary = await this.db.participationDailySummaries
            .where({
              classEnrollmentId: ev.classEnrollmentId,
              localSchoolDate: ev.localSchoolDate
            })
            .first();

          if (summary) {
            await this.db.participationDailySummaries.put({
              ...summary,
              positiveCount: ev.snapshottedClassification === 'positive' ? Math.max(0, summary.positiveCount - 1) : summary.positiveCount,
              needsFollowupCount: ev.snapshottedClassification === 'needs_followup' ? Math.max(0, summary.needsFollowupCount - 1) : summary.needsFollowupCount,
              totalPoints: summary.totalPoints - ev.snapshottedPoints
            });
          }

          // Structured Audit for deletion
          await this.db.auditEntries.add({
            id: crypto.randomUUID(),
            entityName: 'participationEvents',
            entityId: ev.id,
            action: 'DELETE',
            transactionId: txId,
            previousStateJson: JSON.stringify(ev),
            newStateJson: JSON.stringify(updatedEv),
            diffJson: JSON.stringify({ deletedAt: { old: null, new: now } }),
            userId,
            timestamp: now,
            clientVersion: '1.0.0'
          });

          await this.db.syncMutations.add({
            id: crypto.randomUUID(),
            deviceId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: i + 1,
            transactionSize: activeEvents.length,
            entityName: 'participationEvents',
            entityId: ev.id,
            operation: 'UPDATE',
            payloadJson: JSON.stringify(updatedEv),
            baseVersion: ev.version,
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });
        }

        return { undoneCount: activeEvents.length, batchId };
      }
    );
  }
}
