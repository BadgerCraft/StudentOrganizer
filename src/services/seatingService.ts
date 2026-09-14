import type { OntarioTeacherDB } from '../db/database';
import type { SeatPosition, UUID } from '../types/schema';
import { ValidationError } from './markbookService';

export class SeatingDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Assigns a student enrollment to a seat coordinate (row, col).
   * Enforces:
   * - Layout bounds.
   * - Occupied-only storage (empty seats are deleted rows).
   * - One seat per enrollment per layout.
   */
  async assignSeat(
    seatingLayoutId: UUID,
    row: number,
    col: number,
    classEnrollmentId: UUID | null
  ): Promise<SeatPosition | null> {
    return await this.db.transaction(
      'rw',
      [this.db.seatingLayouts, this.db.classEnrollments, this.db.seatPositions],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) {
          throw new ValidationError(`Seating layout ${seatingLayoutId} not found or deleted.`);
        }

        if (layout.isLocked) {
          throw new ValidationError(`Seating layout "${layout.name}" is locked.`);
        }

        if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) {
          throw new ValidationError(`Coordinates (${row}, ${col}) are outside layout dimensions (${layout.rows}x${layout.cols}).`);
        }

        const now = new Date().toISOString();

        // Check if there is already an existing seat occupant at this coordinate
        const existingAtCoord = await this.db.seatPositions
          .where({ seatingLayoutId, row, col })
          .first();

        // If unassigning (clearing the seat)
        if (classEnrollmentId === null) {
          if (existingAtCoord) {
            await this.db.seatPositions.delete(existingAtCoord.id);
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

        // Check if this student is already seated elsewhere in this layout
        const existingStudentSeat = await this.db.seatPositions
          .where({ seatingLayoutId, classEnrollmentId })
          .first();

        if (existingStudentSeat) {
          if (existingStudentSeat.row === row && existingStudentSeat.col === col) {
            return existingStudentSeat; // Already in target seat
          }

          // If target coordinate has another student, swap them!
          if (existingAtCoord) {
            await this.db.seatPositions.put({
              ...existingAtCoord,
              row: existingStudentSeat.row,
              col: existingStudentSeat.col,
              updatedAt: now,
              version: existingAtCoord.version + 1
            });
          } else {
            // Delete old position
            await this.db.seatPositions.delete(existingStudentSeat.id);
          }

          const updatedPosition: SeatPosition = {
            ...existingStudentSeat,
            row,
            col,
            updatedAt: now,
            version: existingStudentSeat.version + 1
          };
          await this.db.seatPositions.put(updatedPosition);
          return updatedPosition;
        }

        // If student was not previously seated:
        if (existingAtCoord) {
          // Replace occupant
          const updated: SeatPosition = {
            ...existingAtCoord,
            classEnrollmentId,
            updatedAt: now,
            version: existingAtCoord.version + 1
          };
          await this.db.seatPositions.put(updated);
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
        return newPosition;
      }
    );
  }

  /**
   * Arranges active students in the class alphabetically by last name into the layout.
   */
  async arrangeAlphabetically(seatingLayoutId: UUID): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.seatingLayouts, this.db.classEnrollments, this.db.students, this.db.seatPositions],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) throw new ValidationError('Layout not found.');
        if (layout.isLocked) throw new ValidationError('Layout is locked.');

        const now = new Date().toISOString();

        // Get enrollments for this class
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

        paired.sort((a, b) => {
          const lCompare = (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? '');
          if (lCompare !== 0) return lCompare;
          return (a.student?.firstName ?? '').localeCompare(b.student?.firstName ?? '');
        });

        // Clear current positions
        await this.db.seatPositions.where('seatingLayoutId').equals(seatingLayoutId).delete();

        // Fill grid row by row
        const newPositions: SeatPosition[] = [];
        let pIdx = 0;
        for (let r = 0; r < layout.rows; r++) {
          for (let c = 0; c < layout.cols; c++) {
            if (pIdx < paired.length) {
              newPositions.push({
                id: crypto.randomUUID(),
                seatingLayoutId,
                row: r,
                col: c,
                classEnrollmentId: paired[pIdx].enr.id,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 1
              });
              pIdx++;
            }
          }
        }
        await this.db.seatPositions.bulkAdd(newPositions);
      }
    );
  }

  /**
   * Randomly reshuffles students across occupied positions.
   */
  async randomizeSeats(seatingLayoutId: UUID): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.seatingLayouts, this.db.seatPositions],
      async () => {
        const layout = await this.db.seatingLayouts.get(seatingLayoutId);
        if (!layout || layout.deletedAt !== null) throw new ValidationError('Layout not found.');
        if (layout.isLocked) throw new ValidationError('Layout is locked.');

        const existingSeats = await this.db.seatPositions
          .where('seatingLayoutId')
          .equals(seatingLayoutId)
          .toArray();

        if (existingSeats.length < 2) return;

        const enrollmentIds = existingSeats.map(s => s.classEnrollmentId);

        // Fisher-Yates shuffle
        for (let i = enrollmentIds.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [enrollmentIds[i], enrollmentIds[j]] = [enrollmentIds[j], enrollmentIds[i]];
        }

        const now = new Date().toISOString();
        const updated = existingSeats.map((s, idx) => ({
          ...s,
          classEnrollmentId: enrollmentIds[idx],
          updatedAt: now,
          version: s.version + 1
        }));

        await this.db.seatPositions.bulkPut(updated);
      }
    );
  }
}
