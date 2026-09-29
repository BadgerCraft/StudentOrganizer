import type { OntarioTeacherDB } from '../db/database';
import type { AttendanceRecord, AttendanceStatus, SyncMutation, AuditEntry, UUID } from '../types/schema';
import { ClassSessionService } from './sessionService';
import { ValidationError } from './markbookService';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import { getAppIdentity } from './identityService';
import { getSchoolLocalDate } from '../utils/dateUtils';

export class AttendanceService {
  constructor(
    private db: OntarioTeacherDB,
    private sessionService: ClassSessionService = new ClassSessionService(db)
  ) {}

  /**
   * Transactional attendance lookup and toggle with full authorization, audit, and sync logging.
   * Enforces:
   * - In-transaction class-section authorization for userId.
   * - Enrollment belongs to supplied classSectionId and is not deleted.
   * - ClassSession lookup/creation scoped to the active class and target school date.
   * - Existing record query matching the database compound index &[classEnrollmentId+classSessionId].
   * - Toggle semantics: unrecorded or non-absent -> 'absent'; absent -> 'present'.
   * - Populates complete AuditEntry diffs and SyncMutation outbox items with explicit sequence and versions.
   */
  async toggleAttendance(
    classSectionId: UUID,
    enrollmentId: UUID,
    targetDate?: string,
    userId?: UUID,
    deviceId?: UUID
  ): Promise<AttendanceRecord> {
    const schoolDate = targetDate ?? getSchoolLocalDate();
    const effectiveIdentity = (userId && deviceId) ? { userId, deviceId } : await getAppIdentity(this.db);
    const activeUserId = effectiveIdentity.userId;
    const activeDeviceId = effectiveIdentity.deviceId;

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.classEnrollments,
        this.db.classSessions,
        this.db.attendanceRecords,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        // 1. Authorize teacher write access for this class section
        const auth = await assertClassSectionWriteAccess(this.db, activeUserId, classSectionId);
        const derivedOrgId = auth.organizationId;

        // 2. Validate enrollment and class section relationship
        const enrollment = await this.db.classEnrollments.get(enrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Enrollment ${enrollmentId} not found or has been deleted.`);
        }
        if (enrollment.classSectionId !== classSectionId) {
          throw new ValidationError(
            `Enrollment ${enrollmentId} does not belong to class section ${classSectionId}.`
          );
        }

        // 3. Resolve session for active class and target date (historical dates align startsAt)
        const session = await this.sessionService.getOrCreateSession(classSectionId, schoolDate);

        // 4. Find existing record by compound unique key &[classEnrollmentId+classSessionId]
        const existing = await this.db.attendanceRecords
          .where({ classEnrollmentId: enrollmentId, classSessionId: session.id })
          .first();

        const actualNow = new Date().toISOString();
        const txId = crypto.randomUUID();

        if (existing && existing.deletedAt === null) {
          const nextStatus: AttendanceStatus = existing.status === 'absent' ? 'present' : 'absent';
          const updated: AttendanceRecord = {
            ...existing,
            status: nextStatus,
            updatedAt: actualNow,
            version: existing.version + 1
          };

          const audit: AuditEntry = {
            id: crypto.randomUUID(),
            entityName: 'attendanceRecords',
            entityId: existing.id,
            action: 'UPDATE',
            transactionId: txId,
            previousStateJson: JSON.stringify(existing),
            newStateJson: JSON.stringify(updated),
            diffJson: JSON.stringify({ status: { old: existing.status, new: nextStatus } }),
            userId: activeUserId,
            timestamp: actualNow,
            clientVersion: '1.0.0'
          };

          const sync: SyncMutation = {
            id: crypto.randomUUID(),
            deviceId: activeDeviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: 1,
            transactionSize: 1,
            entityName: 'attendanceRecords',
            entityId: existing.id,
            operation: 'UPDATE',
            payloadJson: JSON.stringify(updated),
            baseVersion: existing.version,
            status: 'pending',
            createdAt: actualNow,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          };

          await Promise.all([
            this.db.attendanceRecords.put(updated),
            this.db.auditEntries.add(audit),
            this.db.syncMutations.add(sync)
          ]);

          return updated;
        }

        // First toggle on an unrecorded or previously cleared entry sets 'absent'
        const isReactivating = !!existing;
        const newRecord: AttendanceRecord = {
          id: existing ? existing.id : crypto.randomUUID(),
          classEnrollmentId: enrollmentId,
          classSessionId: session.id,
          localSchoolDate: schoolDate,
          status: 'absent',
          reason: null,
          createdAt: existing ? existing.createdAt : actualNow,
          updatedAt: actualNow,
          deletedAt: null,
          version: existing ? existing.version + 1 : 1
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'attendanceRecords',
          entityId: newRecord.id,
          action: isReactivating ? 'UPDATE' : 'INSERT',
          transactionId: txId,
          previousStateJson: existing ? JSON.stringify(existing) : null,
          newStateJson: JSON.stringify(newRecord),
          diffJson: JSON.stringify({
            status: { old: existing?.status ?? null, new: 'absent' },
            deletedAt: { old: existing?.deletedAt ?? null, new: null }
          }),
          userId: activeUserId,
          timestamp: actualNow,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: activeDeviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'attendanceRecords',
          entityId: newRecord.id,
          operation: isReactivating ? 'UPDATE' : 'INSERT',
          payloadJson: JSON.stringify(newRecord),
          baseVersion: existing ? existing.version : 0,
          status: 'pending',
          createdAt: actualNow,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.attendanceRecords.put(newRecord),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return newRecord;
      }
    );
  }
}
