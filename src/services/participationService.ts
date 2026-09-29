import type { OntarioTeacherDB } from '../db/database';
import type {
  AchievementCategoryCode,
  AchievementLevel,
  ParticipationEvent,
  ParticipationDailySummary,
  SyncMutation,
  UUID
} from '../types/schema';
import { ValidationError } from './markbookService';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface RecordParticipationParams {
  classEnrollmentIds: UUID[];
  classSectionId: UUID;
  classSessionId?: UUID | null;
  eventTypeId: UUID; // Required for all new recordings
  achievementLevel?: AchievementLevel; // Required for level_1_4; forbidden for quick_tally
  categoryOverride?: AchievementCategoryCode | null | 'DEFAULT'; // 'DEFAULT' applies button default; null forces no category; code overrides
  note?: string | null;
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
   * Enforces in-transaction authorization, strict relationship validations,
   * snapshots event attributes, and maintains the daily summary projection.
   */
  async recordParticipation(params: RecordParticipationParams): Promise<ParticipationEvent[]> {
    if (!params.classEnrollmentIds || params.classEnrollmentIds.length === 0) {
      throw new ValidationError('At least one student must be selected.');
    }

    // Check duplicate enrollments in batch
    const uniqueEnrollmentIds = new Set(params.classEnrollmentIds);
    if (uniqueEnrollmentIds.size !== params.classEnrollmentIds.length) {
      throw new ValidationError('Duplicate student enrollment IDs in participation batch.');
    }

    // Validate localSchoolDate format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.localSchoolDate)) {
      throw new ValidationError(`Invalid localSchoolDate format "${params.localSchoolDate}". Expected YYYY-MM-DD.`);
    }

    const timezone = params.timezone ?? 'America/Toronto';
    const now = new Date().toISOString();
    const occurredAt = params.occurredAt ?? now;

    // Validate occurredAt matches localSchoolDate in specified timezone
    try {
      const occDate = new Date(occurredAt);
      if (isNaN(occDate.getTime())) {
        throw new Error('Invalid date');
      }
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const localDateFromOcc = formatter.format(occDate);
      if (localDateFromOcc !== params.localSchoolDate) {
        throw new ValidationError(`occurredAt (${occurredAt}) resolves to date ${localDateFromOcc} in timezone ${timezone}, but localSchoolDate is ${params.localSchoolDate}.`);
      }
    } catch (err: any) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`Failed to validate date/timezone alignment: ${err?.message}`);
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.classEnrollments,
        this.db.classSessions,
        this.db.participationEventTypes,
        this.db.studentAssessments,
        this.db.participationEvents,
        this.db.participationDailySummaries,
        this.db.syncMutations,
        this.db.auditEntries
      ],
      async () => {
        // 1. Authorization check
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const derivedOrgId = auth.organizationId;

        // 2. Validate Class Section
        const section = await this.db.classSections.get(params.classSectionId);
        if (!section || section.deletedAt !== null) {
          throw new ValidationError(`Class section ${params.classSectionId} not found or deleted.`);
        }

        // 3. Validate Session (if provided)
        if (params.classSessionId) {
          const session = await this.db.classSessions.get(params.classSessionId);
          if (!session || session.deletedAt !== null) {
            throw new ValidationError(`Class session ${params.classSessionId} not found or deleted.`);
          }
          if (session.classSectionId !== params.classSectionId) {
            throw new ValidationError(`Class session ${params.classSessionId} does not belong to section ${params.classSectionId}.`);
          }
          if (session.localSchoolDate !== params.localSchoolDate) {
            throw new ValidationError(`Class session date (${session.localSchoolDate}) does not match participation date (${params.localSchoolDate}).`);
          }
        }

        // 4. Validate Event Type (Authoritative derivation)
        if (!params.eventTypeId) {
          throw new ValidationError('eventTypeId is required for recording participation.');
        }
        const eventType = await this.db.participationEventTypes.get(params.eventTypeId);
        if (!eventType || eventType.deletedAt !== null) {
          throw new ValidationError(`Event type ${params.eventTypeId} not found or deleted.`);
        }
        if (eventType.isArchived) {
          throw new ValidationError(`Event type "${eventType.name}" is archived.`);
        }
        if (eventType.organizationId !== null && eventType.organizationId !== derivedOrgId) {
          throw new ValidationError(`Event type "${eventType.name}" belongs to a different organization.`);
        }

        const snapshottedName = eventType.name;
        const snapshottedClassification = eventType.classification;
        const snapshottedRecordingMode = eventType.recordingMode;
        let snapshottedPoints = 0.0;
        let achievementLevel: AchievementLevel | null = null;

        if (eventType.recordingMode === 'quick_tally') {
          if (params.achievementLevel !== undefined && params.achievementLevel !== null) {
            throw new ValidationError('Achievement level cannot be recorded for a Quick Tally event.');
          }
          snapshottedPoints = eventType.defaultPoints;
          achievementLevel = null;
        } else if (eventType.recordingMode === 'level_1_4') {
          if (!params.achievementLevel || ![1, 2, 3, 4].includes(params.achievementLevel)) {
            throw new ValidationError('Level 1-4 event requires an integer level of 1, 2, 3, or 4.');
          }
          snapshottedPoints = 0.0;
          achievementLevel = params.achievementLevel;
        }

        // Category resolution: DEFAULT applies button default, null forces no category, explicit code overrides
        let effectiveCategory: AchievementCategoryCode | null = null;
        if (params.categoryOverride === undefined || params.categoryOverride === 'DEFAULT') {
          effectiveCategory = eventType.defaultCategoryCode;
        } else if (params.categoryOverride === null) {
          effectiveCategory = null;
        } else if (['K', 'T', 'C', 'A'].includes(params.categoryOverride)) {
          effectiveCategory = params.categoryOverride;
        } else {
          throw new ValidationError('Invalid category override.');
        }

        // 5. Validate Student Assessment (if provided, must be single student and match enrollment)
        if (params.studentAssessmentId) {
          if (params.classEnrollmentIds.length !== 1) {
            throw new ValidationError('Linking a student assessment is only supported for single-student participation logging.');
          }
          const sa = await this.db.studentAssessments.get(params.studentAssessmentId);
          if (!sa || sa.deletedAt !== null) {
            throw new ValidationError(`Student assessment ${params.studentAssessmentId} not found or deleted.`);
          }
          if (sa.classEnrollmentId !== params.classEnrollmentIds[0]) {
            throw new ValidationError('Student assessment does not match the target student enrollment.');
          }
        }

        const batchId = crypto.randomUUID();
        const txId = crypto.randomUUID();
        const events: ParticipationEvent[] = [];
        const syncMutations: SyncMutation[] = [];

        // 6. Validate Enrollments and Construct Events
        for (let i = 0; i < params.classEnrollmentIds.length; i++) {
          const enrollmentId = params.classEnrollmentIds[i];
          const enrollment = await this.db.classEnrollments.get(enrollmentId);
          if (!enrollment || enrollment.deletedAt !== null) {
            throw new ValidationError(`Enrollment ${enrollmentId} not found or deleted.`);
          }
          if (enrollment.enrollmentStatus !== 'active') {
            throw new ValidationError(`Cannot record participation for inactive enrollment ${enrollmentId} (${enrollment.enrollmentStatus}).`);
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
            eventTypeId: params.eventTypeId,
            snapshottedName,
            snapshottedClassification,
            snapshottedPoints,
            snapshottedRecordingMode,
            achievementLevel,
            occurredAt,
            localSchoolDate: params.localSchoolDate,
            timezone,
            note: params.note ?? null,
            categoryCode: effectiveCategory,
            studentAssessmentId: params.studentAssessmentId ?? null,
            createdByUserId: params.userId,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };

          events.push(event);

          // Update rebuildable daily summary projection using authoritative values
          const summary = await this.db.participationDailySummaries
            .where({
              classEnrollmentId: enrollmentId,
              localSchoolDate: params.localSchoolDate
            })
            .first();

          if (summary) {
            const updated: ParticipationDailySummary = {
              ...summary,
              positiveCount: snapshottedClassification === 'positive' ? summary.positiveCount + 1 : summary.positiveCount,
              needsFollowupCount: snapshottedClassification === 'needs_followup' ? summary.needsFollowupCount + 1 : summary.needsFollowupCount,
              neutralCount: snapshottedClassification === 'neutral' ? (summary.neutralCount || 0) + 1 : (summary.neutralCount || 0),
              totalPoints: summary.totalPoints + snapshottedPoints,
              lastEventAt: occurredAt
            };
            await this.db.participationDailySummaries.put(updated);
          } else {
            const newSummary: ParticipationDailySummary = {
              id: crypto.randomUUID(),
              classEnrollmentId: enrollmentId,
              localSchoolDate: params.localSchoolDate,
              positiveCount: snapshottedClassification === 'positive' ? 1 : 0,
              needsFollowupCount: snapshottedClassification === 'needs_followup' ? 1 : 0,
              neutralCount: snapshottedClassification === 'neutral' ? 1 : 0,
              totalPoints: snapshottedPoints,
              lastEventAt: occurredAt
            };
            await this.db.participationDailySummaries.add(newSummary);
          }

          syncMutations.push({
            id: crypto.randomUUID(),
            deviceId: params.deviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: i + 1,
            transactionSize: params.classEnrollmentIds.length,
            entityName: 'participationEvents',
            entityId: event.id,
            operation: 'INSERT',
            payloadJson: JSON.stringify(event),
            baseVersion: 0,
            status: 'pending',
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
   * Recalculates entire daily summary projection from remaining active events,
   * guaranteeing accurate counts, total points, and lastEventAt without drift.
   */
  async undoBatch(batchId: UUID, userId: UUID, deviceId: UUID): Promise<UndoBatchResult> {
    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
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

        // Validate write authorization against the classSection of the undone events
        const sampleSectionId = activeEvents[0].classSectionId;
        const auth = await assertClassSectionWriteAccess(this.db, userId, sampleSectionId);
        const derivedOrgId = auth.organizationId;

        // Group affected student-days to avoid per-event queries
        const affectedStudentDays = new Map<string, { classEnrollmentId: UUID; localSchoolDate: string }>();

        const updatedEvents: ParticipationEvent[] = [];
        const auditEntries: any[] = [];
        const syncMutations: SyncMutation[] = [];

        for (let i = 0; i < activeEvents.length; i++) {
          const ev = activeEvents[i];
          const updatedEv: ParticipationEvent = {
            ...ev,
            deletedAt: now,
            updatedAt: now,
            version: ev.version + 1
          };
          updatedEvents.push(updatedEv);

          const key = `${ev.classEnrollmentId}_${ev.localSchoolDate}`;
          if (!affectedStudentDays.has(key)) {
            affectedStudentDays.set(key, {
              classEnrollmentId: ev.classEnrollmentId,
              localSchoolDate: ev.localSchoolDate
            });
          }

          auditEntries.push({
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

          syncMutations.push({
            id: crypto.randomUUID(),
            deviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: i + 1,
            transactionSize: activeEvents.length,
            entityName: 'participationEvents',
            entityId: ev.id,
            operation: 'UPDATE',
            payloadJson: JSON.stringify(updatedEv),
            baseVersion: ev.version,
            status: 'pending',
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });
        }

        await Promise.all([
          this.db.participationEvents.bulkPut(updatedEvents),
          this.db.auditEntries.bulkAdd(auditEntries),
          this.db.syncMutations.bulkAdd(syncMutations)
        ]);

        // Parallel recalculate daily summary projections for all affected student-days using compound index
        await Promise.all(Array.from(affectedStudentDays.values()).map(async ({ classEnrollmentId, localSchoolDate }) => {
          const [remainingEvents, existingSummary] = await Promise.all([
            this.db.participationEvents
              .where('[classEnrollmentId+localSchoolDate]')
              .equals([classEnrollmentId, localSchoolDate])
              .filter(e => e.deletedAt === null)
              .toArray(),
            this.db.participationDailySummaries
              .where('[classEnrollmentId+localSchoolDate]')
              .equals([classEnrollmentId, localSchoolDate])
              .first()
          ]);

          if (remainingEvents.length === 0) {
            if (existingSummary) {
              await this.db.participationDailySummaries.delete(existingSummary.id);
            }
          } else {
            let posCount = 0;
            let needsCount = 0;
            let neutCount = 0;
            let pts = 0;
            let latestOccurredAt: string | null = null;

            for (const rem of remainingEvents) {
              if (rem.snapshottedClassification === 'positive') posCount++;
              if (rem.snapshottedClassification === 'needs_followup') needsCount++;
              if (rem.snapshottedClassification === 'neutral') neutCount++;
              pts += rem.snapshottedPoints;
              if (!latestOccurredAt || rem.occurredAt.localeCompare(latestOccurredAt) > 0) {
                latestOccurredAt = rem.occurredAt;
              }
            }

            if (posCount === 0 && needsCount === 0 && neutCount === 0) {
              if (existingSummary) {
                await this.db.participationDailySummaries.delete(existingSummary.id);
              }
            } else {
              if (existingSummary) {
                await this.db.participationDailySummaries.put({
                  ...existingSummary,
                  positiveCount: posCount,
                  needsFollowupCount: needsCount,
                  neutralCount: neutCount,
                  totalPoints: pts,
                  lastEventAt: latestOccurredAt
                });
              } else {
                await this.db.participationDailySummaries.add({
                  id: crypto.randomUUID(),
                  classEnrollmentId,
                  localSchoolDate,
                  positiveCount: posCount,
                  needsFollowupCount: needsCount,
                  neutralCount: neutCount,
                  totalPoints: pts,
                  lastEventAt: latestOccurredAt
                });
              }
            }
          }
        }));

        return { undoneCount: activeEvents.length, batchId };
      }
    );
  }

  /**
   * Transactional historical event retraction with optimistic concurrency.
   * Enforces:
   * - Expected version match (throws ConcurrencyError on mismatch).
   * - Retraction idempotence check (throws ValidationError if already retracted).
   * - In-transaction write authorization for userId.
   * - Soft-delete with AuditEntry diff and SyncMutation outbox.
   * - Atomic daily summary recalculation for affected student-day.
   */
  async retractEvent(
    eventId: UUID,
    expectedVersion: number,
    userId: UUID,
    deviceId: UUID,
    reason?: string
  ): Promise<void> {
    if (reason && reason.length > 500) {
      throw new ValidationError('Retraction reason exceeds maximum length of 500 characters.');
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEvents,
        this.db.participationDailySummaries,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const ev = await this.db.participationEvents.get(eventId);
        if (!ev) {
          throw new ValidationError(`Participation event ${eventId} not found.`);
        }
        if (ev.deletedAt !== null) {
          throw new ValidationError('Participation event has already been retracted.');
        }
        if (ev.version !== expectedVersion) {
          throw new ConcurrencyError(
            `Stale event version for ${eventId}. Expected ${expectedVersion}, found ${ev.version}.`
          );
        }

        const auth = await assertClassSectionWriteAccess(this.db, userId, ev.classSectionId);
        const derivedOrgId = auth.organizationId;

        const actualNow = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updatedEv: ParticipationEvent = {
          ...ev,
          deletedAt: actualNow,
          updatedAt: actualNow,
          version: ev.version + 1
        };

        const audit: any = {
          id: crypto.randomUUID(),
          entityName: 'participationEvents',
          entityId: ev.id,
          action: 'DELETE',
          transactionId: txId,
          previousStateJson: JSON.stringify(ev),
          newStateJson: JSON.stringify(updatedEv),
          diffJson: JSON.stringify({
            deletedAt: { old: null, new: actualNow },
            reason: reason?.trim() || null
          }),
          userId,
          timestamp: actualNow,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEvents',
          entityId: ev.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updatedEv),
          baseVersion: ev.version,
          status: 'pending',
          createdAt: actualNow,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEvents.put(updatedEv),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        // Recalculate daily summary for affected student and date
        const [remainingEvents, existingSummary] = await Promise.all([
          this.db.participationEvents
            .where('[classEnrollmentId+localSchoolDate]')
            .equals([ev.classEnrollmentId, ev.localSchoolDate])
            .filter(e => e.deletedAt === null)
            .toArray(),
          this.db.participationDailySummaries
            .where('[classEnrollmentId+localSchoolDate]')
            .equals([ev.classEnrollmentId, ev.localSchoolDate])
            .first()
        ]);

        if (remainingEvents.length === 0) {
          if (existingSummary) {
            await this.db.participationDailySummaries.delete(existingSummary.id);
          }
        } else {
          let posCount = 0;
          let needsCount = 0;
          let neutCount = 0;
          let pts = 0;
          let latestOccurredAt: string | null = null;

          for (const rem of remainingEvents) {
            if (rem.snapshottedClassification === 'positive') posCount++;
            if (rem.snapshottedClassification === 'needs_followup') needsCount++;
            if (rem.snapshottedClassification === 'neutral') neutCount++;
            pts += rem.snapshottedPoints;
            if (!latestOccurredAt || rem.occurredAt.localeCompare(latestOccurredAt) > 0) {
              latestOccurredAt = rem.occurredAt;
            }
          }

          if (posCount === 0 && needsCount === 0 && neutCount === 0) {
            if (existingSummary) {
              await this.db.participationDailySummaries.delete(existingSummary.id);
            }
          } else if (existingSummary) {
            await this.db.participationDailySummaries.put({
              ...existingSummary,
              positiveCount: posCount,
              needsFollowupCount: needsCount,
              neutralCount: neutCount,
              totalPoints: pts,
              lastEventAt: latestOccurredAt
            });
          } else {
            await this.db.participationDailySummaries.add({
              id: crypto.randomUUID(),
              classEnrollmentId: ev.classEnrollmentId,
              localSchoolDate: ev.localSchoolDate,
              positiveCount: posCount,
              needsFollowupCount: needsCount,
              neutralCount: neutCount,
              totalPoints: pts,
              lastEventAt: latestOccurredAt
            });
          }
        }
      }
    );
  }

  /**
   * Transactional observation note update with optimistic concurrency.
   * Enforces:
   * - Expected version match (throws ConcurrencyError on mismatch).
   * - Active event state (throws ValidationError if missing or deleted).
   * - Note text normalization and 1000 char maximum.
   * - No-op check: returns existing event if normalized text is identical without version increment.
   * - In-transaction write authorization for userId.
   * - AuditEntry diff logging and SyncMutation outbox queuing.
   */
  async updateEventNote(
    eventId: UUID,
    expectedVersion: number,
    newNote: string | null,
    userId: UUID,
    deviceId: UUID
  ): Promise<ParticipationEvent> {
    if (newNote && newNote.length > 1000) {
      throw new ValidationError('Observation note exceeds maximum length of 1000 characters.');
    }
    const normalized = newNote?.trim() ? newNote.trim() : null;

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEvents,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const ev = await this.db.participationEvents.get(eventId);
        if (!ev || ev.deletedAt !== null) {
          throw new ValidationError(`Participation event ${eventId} not found or has been deleted.`);
        }
        if (ev.version !== expectedVersion) {
          throw new ConcurrencyError(
            `Stale event version for ${eventId}. Expected ${expectedVersion}, found ${ev.version}.`
          );
        }

        // No-op check: if note is unchanged, return without incrementing version or creating audit noise
        if ((ev.note || null) === normalized) {
          return ev;
        }

        const auth = await assertClassSectionWriteAccess(this.db, userId, ev.classSectionId);
        const derivedOrgId = auth.organizationId;

        const actualNow = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updatedEv: ParticipationEvent = {
          ...ev,
          note: normalized,
          updatedAt: actualNow,
          version: ev.version + 1
        };

        const audit: any = {
          id: crypto.randomUUID(),
          entityName: 'participationEvents',
          entityId: ev.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(ev),
          newStateJson: JSON.stringify(updatedEv),
          diffJson: JSON.stringify({ note: { old: ev.note, new: normalized } }),
          userId,
          timestamp: actualNow,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEvents',
          entityId: ev.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updatedEv),
          baseVersion: ev.version,
          status: 'pending',
          createdAt: actualNow,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEvents.put(updatedEv),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return updatedEv;
      }
    );
  }
}
