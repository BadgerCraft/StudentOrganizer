import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { RosterEnrollmentService } from './rosterEnrollmentService';
import { PortabilityService } from './portabilityService';
import { parseRosterText } from './rosterParser';
import { SeatingDomainService } from './seatingService';

describe('Roster removal preserves historical identity', () => {
  let db: OntarioTeacherDB;
  let service: RosterEnrollmentService;
  beforeEach(async () => { db = new OntarioTeacherDB(`fictional-roster-removal-${crypto.randomUUID()}`); await seedDatabase(db); service = new RosterEnrollmentService(db); });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
  const params = (enrollment: { id: string; version: number }, userId = 'user-tyler') => ({ enrollmentId: enrollment.id, expectedVersion: enrollment.version, userId, deviceId: 'fictional-device' });
  async function snapshot(): Promise<Record<string, any[]>> {
    const tables = ['students', 'classEnrollments', 'seatPositions', 'studentAssessments', 'categoryResults', 'attendanceRecords', 'studentNotes', 'participationEvents', 'auditEntries', 'syncMutations'];
    return Object.fromEntries(await Promise.all(tables.map(async table => [table, await db.table(table).toArray()])));
  }
  it('drops roster membership and seating with grouped audit, retaining students and exact saved academic/attendance records', async () => {
    const enrollment = (await db.classEnrollments.toCollection().first())!;
    const before = await snapshot();
    expect(before.studentAssessments.length).toBeGreaterThan(0);
    expect(before.categoryResults.length).toBeGreaterThan(0);
    expect(before.attendanceRecords.length).toBeGreaterThan(0);
    const updated = await service.removeFromClass(params(enrollment));
    expect(updated).toMatchObject({ id: enrollment.id, enrollmentStatus: 'dropped', deletedAt: null, version: enrollment.version + 1 });
    expect(updated.droppedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const after = await snapshot();
    for (const table of ['students', 'studentAssessments', 'categoryResults', 'attendanceRecords', 'studentNotes', 'participationEvents']) expect(after[table]).toEqual(before[table]);
    const seats = after.seatPositions.filter(s => s.classEnrollmentId === enrollment.id);
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.every(s => s.deletedAt !== null)).toBe(true);
    expect(after.seatPositions.filter(s => s.classEnrollmentId !== enrollment.id)).toEqual(before.seatPositions.filter(s => s.classEnrollmentId !== enrollment.id));
    const audits = after.auditEntries.filter(a => !before.auditEntries.some(old => old.id === a.id));
    expect(audits).toHaveLength(seats.length + 1);
    expect(audits.every(a => a.userId === 'user-tyler' && a.previousStateJson && a.newStateJson)).toBe(true);
    expect(new Set(audits.map(a => a.transactionId)).size).toBe(1);
    const mutations = after.syncMutations.filter(m => m.transactionId === audits[0].transactionId);
    expect(mutations.map(m => m.sequenceNumber).sort()).toEqual(Array.from({ length: seats.length + 1 }, (_, i) => i + 1));
    expect(mutations.every(m => m.transactionSize === mutations.length && m.operation === 'UPDATE')).toBe(true);
    await expect(service.removeFromClass(params(updated))).rejects.toThrow('already outside');
    expect(await snapshot()).toEqual(after);
  });
  it('re-enrolls with the same historical ID and repopulates the retired seat without unique-index collisions', async () => {
    const enrollment = (await db.classEnrollments.toCollection().first())!;
    const student = (await db.students.get(enrollment.studentId))!;
    const seat = (await db.seatPositions.where('classEnrollmentId').equals(enrollment.id).first())!;
    const marks = await db.categoryResults.toArray();
    await service.removeFromClass(params(enrollment));
    const portability = new PortabilityService(db);
    const rows = parseRosterText(`${student.lastName}, ${student.firstName}\t${student.localStudentNumber}`).rows;
    const candidates = await portability.validateRosterCandidates(enrollment.classSectionId, rows);
    await portability.importRosterBatch({ classSectionId: enrollment.classSectionId, rows: candidates, userId: 'user-tyler', deviceId: 'fictional-device' });
    expect(await db.classEnrollments.get(enrollment.id)).toMatchObject({ enrollmentStatus: 'active', droppedDate: null });
    await db.seatingLayouts.update(seat.seatingLayoutId, { isLocked: false });
    await new SeatingDomainService(db).populateEmptySeats(seat.seatingLayoutId, 'user-tyler', 'fictional-device');
    expect(await db.seatPositions.where('classEnrollmentId').equals(enrollment.id).filter(s => s.deletedAt === null).count()).toBe(1);
    expect(await db.categoryResults.toArray()).toEqual(marks);
  });
  it('rejects unauthorized or stale actors/versions before any record changes', async () => {
    const enrollment = (await db.classEnrollments.toCollection().first())!;
    const before = await snapshot();
    await expect(service.removeFromClass(params(enrollment, 'fictional-outsider'))).rejects.toThrow();
    await expect(service.removeFromClass({ ...params(enrollment), expectedVersion: enrollment.version + 1 })).rejects.toThrow('Roster changed');
    expect(await snapshot()).toEqual(before);
    const staff = (await db.classSectionStaff.where('classSectionId').equals(enrollment.classSectionId).first())!;
    await db.classSectionStaff.update(staff.id, { role: 'read_only' });
    const readOnlyBefore = await snapshot();
    await expect(service.removeFromClass(params(enrollment))).rejects.toThrow('Read-only');
    expect(await snapshot()).toEqual(readOnlyBefore);
  });
  it('rolls enrollment, seats, audit and outbox back when audit or outbox fails after roster writes', async () => {
    const enrollment = (await db.classEnrollments.toCollection().first())!;
    const before = await snapshot();
    vi.spyOn(db.auditEntries, 'add').mockRejectedValueOnce(new Error('Fictional audit failure'));
    await expect(service.removeFromClass(params(enrollment))).rejects.toThrow('audit failure');
    expect(await snapshot()).toEqual(before);
    vi.restoreAllMocks();
    vi.spyOn(db.syncMutations, 'add').mockRejectedValueOnce(new Error('Fictional outbox failure'));
    await expect(service.removeFromClass(params(enrollment))).rejects.toThrow('outbox failure');
    expect(await snapshot()).toEqual(before);
  });
});
