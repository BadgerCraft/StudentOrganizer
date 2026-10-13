import type { OntarioTeacherDB } from '../db/database';
import type { ClassEnrollment, SeatPosition, UUID } from '../types/schema';
import { AUTH_TABLES, assertClassSectionWriteAccess } from './authHelper';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';
import { getSchoolLocalDate } from '../utils/dateUtils';

/** Remove only active roster membership. Academic and attendance records retain their enrollment ID. */
export class RosterEnrollmentService {
  constructor(private db: OntarioTeacherDB) {}

  async removeFromClass(params: { enrollmentId: UUID; expectedVersion: number; userId: UUID; deviceId: UUID }): Promise<ClassEnrollment> {
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.classEnrollments,
      this.db.seatPositions, this.db.auditEntries, this.db.syncMutations], async () => {
      const current = await this.db.classEnrollments.get(params.enrollmentId);
      if (!current || current.deletedAt !== null) throw new ValidationError('Class enrollment no longer exists.');
      const auth = await assertClassSectionWriteAccess(this.db, params.userId, current.classSectionId);
      if (current.version !== params.expectedVersion) throw new ConcurrencyError('Roster changed. Reopen the student profile before removing them.');
      if (current.enrollmentStatus !== 'active') throw new ValidationError('This student is already outside the active roster.');
      const now = new Date().toISOString();
      const updated: ClassEnrollment = { ...current, enrollmentStatus: 'dropped', droppedDate: getSchoolLocalDate(new Date(now)),
        updatedAt: now, version: current.version + 1 };
      const seats = await this.db.seatPositions.where('classEnrollmentId').equals(current.id).filter(s => s.deletedAt === null).toArray();
      const changes: Array<{ name: 'classEnrollments' | 'seatPositions'; before: ClassEnrollment | SeatPosition; after: ClassEnrollment | SeatPosition }> = [
        { name: 'classEnrollments', before: current, after: updated },
        ...seats.map(s => ({ name: 'seatPositions' as const, before: s, after: { ...s, deletedAt: now, updatedAt: now, version: s.version + 1 } }))
      ];
      const transactionId = crypto.randomUUID();
      await this.db.classEnrollments.put(updated);
      if (seats.length) await this.db.seatPositions.bulkPut(changes.slice(1).map(c => c.after as SeatPosition));
      for (const [index, change] of changes.entries()) {
        await this.db.auditEntries.add({ id: crypto.randomUUID(), entityName: change.name, entityId: change.before.id,
          action: 'UPDATE', transactionId, previousStateJson: JSON.stringify(change.before), newStateJson: JSON.stringify(change.after),
          diffJson: JSON.stringify({ reason: 'Removed from active class roster; historical records retained' }),
          userId: params.userId, timestamp: now, clientVersion: '1.0.0' });
        await this.db.syncMutations.add({ id: crypto.randomUUID(), deviceId: params.deviceId, organizationId: auth.organizationId,
          mutationId: crypto.randomUUID(), transactionId, sequenceNumber: index + 1, transactionSize: changes.length,
          entityName: change.name, entityId: change.before.id, operation: 'UPDATE', payloadJson: JSON.stringify(change.after),
          baseVersion: change.before.version, status: 'pending', createdAt: now, attemptCount: 0,
          lastAttemptAt: null, lastError: null, acknowledgedAt: null });
      }
      return updated;
    });
  }
}
