import type { OntarioTeacherDB } from '../db/database';
import type { SeatPosition, SyncMutation, UUID } from '../types/schema';
import { ValidationError } from './markbookService';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';

export class SeatingDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Assigns a student enrollment to a seat coordinate (row, col).
   * Enforces:
   * - In-transaction authorization.
   * - Layout bounds.
   * - Occupied-only storage (empty seats are deleted rows).
   * - One seat per enrollment per layout.
   * - Transactional audit entries and sync mutations.
   */
  async assignSeat(
    seatingLayoutId: UUID,
    row: number,
    col: number,
    classEnrollmentId: UUID | null,
    userId: UUID,
    deviceId: UUID
  ): Promise<SeatPosition | null> {
    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.seatingLayouts,
        this.db.classEnrollments,
        this.db.seatPositions,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) {
          throw new ValidationError(`Seating layout ${seatingLayoutId} not found or deleted.`);
        }

        if (layout.isLocked) {
          throw new ValidationError(`Seating layout "${layout.name}" is locked.`);
        }

        // Authorization check
        const auth = await assertClassSectionWriteAccess(this.db, userId, layout.classSectionId);
        const derivedOrgId = auth.organizationId;

        if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) {
          throw new ValidationError(`Coordinates (${row}, ${col}) are outside layout dimensions (${layout.rows}x${layout.cols}).`);
        }

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // Check occupant at target coordinate
        const existingAtCoord = await this.db.seatPositions
          .where({ seatingLayoutId, row, col })
          .first();

        // If unassigning (clearing the seat)
        if (classEnrollmentId === null) {
          if (existingAtCoord) {
            await this.db.seatPositions.delete(existingAtCoord.id);

            await this.db.auditEntries.add({
              id: crypto.randomUUID(),
              entityName: 'seatPositions',
              entityId: existingAtCoord.id,
              action: 'DELETE',
              transactionId: txId,
              previousStateJson: JSON.stringify(existingAtCoord),
              newStateJson: null,
              diffJson: null,
              userId,
              timestamp: now,
              clientVersion: '1.0.0'
            });

            await this.db.syncMutations.add({
              id: crypto.randomUUID(),
              deviceId,
              organizationId: derivedOrgId,
              mutationId: crypto.randomUUID(),
              transactionId: txId,
              sequenceNumber: 1,
              transactionSize: 1,
              entityName: 'seatPositions',
              entityId: existingAtCoord.id,
              operation: 'DELETE',
              payloadJson: JSON.stringify(existingAtCoord),
              baseVersion: existingAtCoord.version,
              status: 'pending',
              createdAt: now,
              attemptCount: 0,
              lastAttemptAt: null,
              lastError: null,
              acknowledgedAt: null
            });
          }
          return null;
        }

        // Validate enrollment belongs to this class section
        const enrollment = await this.db.classEnrollments.get(classEnrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Class enrollment ${classEnrollmentId} not found or deleted.`);
        }
        if (enrollment.classSectionId !== layout.classSectionId) {
          throw new ValidationError(`Enrollment does not belong to section ${layout.classSectionId}.`);
        }

        // Check if student is already seated elsewhere in this layout
        const existingStudentSeat = await this.db.seatPositions
          .where({ seatingLayoutId, classEnrollmentId })
          .first();

        if (existingStudentSeat) {
          if (existingStudentSeat.row === row && existingStudentSeat.col === col) {
            return existingStudentSeat; // Already in target seat
          }

          const updatedPosition: SeatPosition = {
            ...existingStudentSeat,
            row,
            col,
            updatedAt: now,
            version: existingStudentSeat.version + 1
          };
          const changes: { previous: SeatPosition; next: SeatPosition }[] = [
            { previous: existingStudentSeat, next: updatedPosition }
          ];
          if (existingAtCoord) {
            changes.push({
              previous: existingAtCoord,
              next: {
                ...existingAtCoord,
                row: existingStudentSeat.row,
                col: existingStudentSeat.col,
                updatedAt: now,
                version: existingAtCoord.version + 1
              }
            });
          }

          // Unique seat-coordinate indexes cannot temporarily contain both occupants
          // at the source coordinate. Remove the old rows, then insert both updated
          // rows inside this same transaction: failure restores the original seats.
          await this.db.seatPositions.bulkDelete(changes.map(change => change.previous.id));
          await this.db.seatPositions.bulkPut(changes.map(change => change.next));

          await this.db.auditEntries.bulkAdd(changes.map(({ previous, next }) => ({
            id: crypto.randomUUID(),
            entityName: 'seatPositions',
            entityId: next.id,
            action: 'UPDATE' as const,
            transactionId: txId,
            previousStateJson: JSON.stringify(previous),
            newStateJson: JSON.stringify(next),
            diffJson: JSON.stringify({ row: { old: previous.row, new: next.row }, col: { old: previous.col, new: next.col } }),
            userId,
            timestamp: now,
            clientVersion: '1.0.0'
          })));

          await this.db.syncMutations.bulkAdd(changes.map(({ previous, next }, index) => ({
            id: crypto.randomUUID(),
            deviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: index + 1,
            transactionSize: changes.length,
            entityName: 'seatPositions',
            entityId: next.id,
            operation: 'UPDATE' as const,
            payloadJson: JSON.stringify(next),
            baseVersion: previous.version,
            status: 'pending' as const,
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          })));

          return updatedPosition;
        }

        // Student was not previously seated
        if (existingAtCoord) {
          const updated: SeatPosition = {
            ...existingAtCoord,
            classEnrollmentId,
            updatedAt: now,
            version: existingAtCoord.version + 1
          };
          await this.db.seatPositions.put(updated);

          await this.db.auditEntries.add({
            id: crypto.randomUUID(),
            entityName: 'seatPositions',
            entityId: updated.id,
            action: 'UPDATE',
            transactionId: txId,
            previousStateJson: JSON.stringify(existingAtCoord),
            newStateJson: JSON.stringify(updated),
            diffJson: JSON.stringify({ classEnrollmentId: { old: existingAtCoord.classEnrollmentId, new: classEnrollmentId } }),
            userId,
            timestamp: now,
            clientVersion: '1.0.0'
          });

          await this.db.syncMutations.add({
            id: crypto.randomUUID(),
            deviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: 1,
            transactionSize: 1,
            entityName: 'seatPositions',
            entityId: updated.id,
            operation: 'UPDATE',
            payloadJson: JSON.stringify(updated),
            baseVersion: existingAtCoord.version,
            status: 'pending',
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });

          return updated;
        }

        const newPosition: SeatPosition = {
          id: crypto.randomUUID(),
          seatingLayoutId,
          row,
          col,
          classEnrollmentId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.seatPositions.add(newPosition);

        await this.db.auditEntries.add({
          id: crypto.randomUUID(),
          entityName: 'seatPositions',
          entityId: newPosition.id,
          action: 'INSERT',
          transactionId: txId,
          previousStateJson: null,
          newStateJson: JSON.stringify(newPosition),
          diffJson: null,
          userId,
          timestamp: now,
          clientVersion: '1.0.0'
        });

        await this.db.syncMutations.add({
          id: crypto.randomUUID(),
          deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'seatPositions',
          entityId: newPosition.id,
          operation: 'INSERT',
          payloadJson: JSON.stringify(newPosition),
          baseVersion: 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        });

        return newPosition;
      }
    );
  }

  /** Fill empty desks only; existing assignments and roster records remain intact. */
  async populateEmptySeats(seatingLayoutId: UUID, userId: UUID, deviceId: UUID): Promise<void> {
    await this.db.transaction('rw', [
      ...AUTH_TABLES(this.db), this.db.seatingLayouts, this.db.classEnrollments,
      this.db.students, this.db.seatPositions, this.db.auditEntries, this.db.syncMutations
    ], async () => {
      const layout = await this.db.seatingLayouts.get(seatingLayoutId);
      if (!layout || layout.deletedAt !== null) throw new ValidationError('Layout not found.');
      if (layout.isLocked) throw new ValidationError('Layout is locked. Unlock seating before populating.');
      const auth = await assertClassSectionWriteAccess(this.db, userId, layout.classSectionId);
      const seats = await this.db.seatPositions.where('seatingLayoutId').equals(seatingLayoutId).toArray();
      const seated = new Set(seats.filter(s => s.deletedAt === null).map(s => s.classEnrollmentId));
      const enrollments = (await this.db.classEnrollments.where('classSectionId').equals(layout.classSectionId).toArray())
        .filter(e => e.deletedAt === null && e.enrollmentStatus === 'active' && !seated.has(e.id));
      const students = await this.db.students.bulkGet(enrollments.map(e => e.studentId));
      const unseated = enrollments.map((enrollment, i) => ({ enrollment, student: students[i] }))
        .filter(p => p.student && p.student.deletedAt === null)
        .sort((a, b) => a.student!.lastName.localeCompare(b.student!.lastName) || a.student!.firstName.localeCompare(b.student!.firstName));
      const empty: { row: number; col: number }[] = [];
      for (let row = 0; row < layout.rows; row++) {
        for (let col = 0; col < layout.cols; col++) {
          if (!seats.some(s => s.deletedAt === null && s.row === row && s.col === col)) empty.push({ row, col });
        }
      }
      if (unseated.length > empty.length) throw new ValidationError(`Not enough empty desks (${empty.length}) for unassigned students (${unseated.length}). Add rows or columns, then populate seating.`);
      // Restored tombstones still occupy both unique indexes. Retire only rows
      // blocking this population, retaining their previous state in the audit.
      // Do this after capacity checks and before any assignment, in this transaction.
      const targetCoordinates = new Set(empty.slice(0, unseated.length).map(p => `${p.row}:${p.col}`));
      const targetEnrollments = new Set(unseated.map(p => p.enrollment.id));
      const blockers = seats.filter(s => s.deletedAt !== null &&
        (targetCoordinates.has(`${s.row}:${s.col}`) || targetEnrollments.has(s.classEnrollmentId)));
      if (blockers.length) {
        const timestamp = new Date().toISOString(), transactionId = crypto.randomUUID();
        await this.db.seatPositions.bulkDelete(blockers.map(s => s.id));
        await this.db.auditEntries.bulkAdd(blockers.map(previous => ({
          id: crypto.randomUUID(), entityName: 'seatPositions', entityId: previous.id,
          action: 'DELETE' as const, transactionId, previousStateJson: JSON.stringify(previous),
          newStateJson: null, diffJson: null, userId, timestamp, clientVersion: '1.0.0'
        })));
        await this.db.syncMutations.bulkAdd(blockers.map((previous, index) => ({
          id: crypto.randomUUID(), deviceId, organizationId: auth.organizationId,
          mutationId: crypto.randomUUID(), transactionId, sequenceNumber: index + 1,
          transactionSize: blockers.length, entityName: 'seatPositions', entityId: previous.id,
          operation: 'DELETE' as const, payloadJson: JSON.stringify(previous), baseVersion: previous.version,
          status: 'pending' as const, createdAt: timestamp, attemptCount: 0,
          lastAttemptAt: null, lastError: null, acknowledgedAt: null
        })));
      }
      for (let i = 0; i < unseated.length; i++) {
        await this.assignSeat(seatingLayoutId, empty[i].row, empty[i].col, unseated[i].enrollment.id, userId, deviceId);
      }
    });
  }

  /**
   * Arranges active students in the class alphabetically by last name into the layout.
   * Pre-validates capacity so active students are NEVER silently dropped.
   */
  async arrangeAlphabetically(seatingLayoutId: UUID, userId: UUID, deviceId: UUID): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.seatingLayouts,
        this.db.classEnrollments,
        this.db.students,
        this.db.seatPositions,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) throw new ValidationError('Layout not found.');
        if (layout.isLocked) throw new ValidationError('Layout is locked.');

        const auth = await assertClassSectionWriteAccess(this.db, userId, layout.classSectionId);
        const derivedOrgId = auth.organizationId;

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // Get active enrollments for this class
        const enrollments = await this.db.classEnrollments
          .where('classSectionId')
          .equals(layout.classSectionId)
          .toArray();

        const activeEnrollments = enrollments.filter(e => e.deletedAt === null && e.enrollmentStatus === 'active');
        const students = await this.db.students.bulkGet(activeEnrollments.map(e => e.studentId));

        const paired = activeEnrollments.map((enr, i) => ({
          enr,
          student: students[i]
        })).filter(p => p.student && p.student.deletedAt === null);

        // Capacity check before removing existing seats!
        const capacity = layout.rows * layout.cols;
        if (paired.length > capacity) {
          throw new ValidationError(`Layout capacity (${capacity} seats) is insufficient for active enrollment (${paired.length} students).`);
        }

        paired.sort((a, b) => {
          const lCompare = (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? '');
          if (lCompare !== 0) return lCompare;
          return (a.student?.firstName ?? '').localeCompare(b.student?.firstName ?? '');
        });

        // Clear current positions
        await this.db.seatPositions.where('seatingLayoutId').equals(seatingLayoutId).delete();

        // Fill grid row by row
        const newPositions: SeatPosition[] = [];
        const syncMutations: SyncMutation[] = [];
        let pIdx = 0;
        for (let r = 0; r < layout.rows; r++) {
          for (let c = 0; c < layout.cols; c++) {
            if (pIdx < paired.length) {
              const pos: SeatPosition = {
                id: crypto.randomUUID(),
                seatingLayoutId,
                row: r,
                col: c,
                classEnrollmentId: paired[pIdx].enr.id,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 1
              };
              newPositions.push(pos);

              syncMutations.push({
                id: crypto.randomUUID(),
                deviceId,
                organizationId: derivedOrgId,
                mutationId: crypto.randomUUID(),
                transactionId: txId,
                sequenceNumber: pIdx + 1,
                transactionSize: paired.length,
                entityName: 'seatPositions',
                entityId: pos.id,
                operation: 'INSERT',
                payloadJson: JSON.stringify(pos),
                baseVersion: 0,
                status: 'pending',
                createdAt: now,
                attemptCount: 0,
                lastAttemptAt: null,
                lastError: null,
                acknowledgedAt: null
              });

              pIdx++;
            }
          }
        }
        await this.db.seatPositions.bulkAdd(newPositions);
        await this.db.syncMutations.bulkAdd(syncMutations);
      }
    );
  }

  /**
   * Randomly reshuffles students across occupied positions.
   */
  async randomizeSeats(seatingLayoutId: UUID, userId: UUID, deviceId: UUID): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.seatingLayouts,
        this.db.seatPositions,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) throw new ValidationError('Layout not found.');
        if (layout.isLocked) throw new ValidationError('Layout is locked.');

        const auth = await assertClassSectionWriteAccess(this.db, userId, layout.classSectionId);
        const derivedOrgId = auth.organizationId;

        const existingSeats = await this.db.seatPositions
          .where('seatingLayoutId')
          .equals(seatingLayoutId)
          .filter(s => s.deletedAt === null)
          .toArray();

        if (existingSeats.length < 2) return;

        const enrollmentIds = existingSeats.map(s => s.classEnrollmentId);

        // Fisher-Yates shuffle
        for (let i = enrollmentIds.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [enrollmentIds[i], enrollmentIds[j]] = [enrollmentIds[j], enrollmentIds[i]];
        }

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updated = existingSeats.map((s, idx) => ({
          ...s,
          classEnrollmentId: enrollmentIds[idx],
          updatedAt: now,
          version: s.version + 1
        }));

        const syncMutations: SyncMutation[] = updated.map((u, idx) => ({
          id: crypto.randomUUID(),
          deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: idx + 1,
          transactionSize: updated.length,
          entityName: 'seatPositions',
          entityId: u.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(u),
          baseVersion: existingSeats[idx].version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        }));

        // Enrollment uniqueness forbids overwriting a shuffled occupant while its
        // old seat still exists. Replace within this transaction, retaining seat IDs.
        await this.db.seatPositions.bulkDelete(existingSeats.map(s => s.id));
        await this.db.seatPositions.bulkPut(updated);
        await this.db.auditEntries.bulkAdd(updated.map((seat, index) => ({
          id: crypto.randomUUID(), entityName: 'seatPositions', entityId: seat.id,
          action: 'UPDATE' as const, transactionId: txId,
          previousStateJson: JSON.stringify(existingSeats[index]), newStateJson: JSON.stringify(seat),
          diffJson: null, userId, timestamp: now, clientVersion: '1.0.0'
        })));
        await this.db.syncMutations.bulkAdd(syncMutations);
      }
    );
  }
}
