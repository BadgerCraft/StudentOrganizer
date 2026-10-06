import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { SeatingDomainService } from './seatingService';
import type { SeatPosition } from '../types/schema';

describe('Imported roster seating and randomization', () => {
  let db: OntarioTeacherDB;
  let service: SeatingDomainService;
  let source: SeatPosition;
  let destination: SeatPosition;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`fictional-seat-swap-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new SeatingDomainService(db);
    const layout = await db.seatingLayouts.toCollection().first();
    if (!layout) throw new Error('Expected fictional seed layout');
    await db.seatingLayouts.update(layout.id, { isLocked: false });
    const seats = await db.seatPositions.where('seatingLayoutId').equals(layout.id).toArray();
    [source, destination] = seats;
    expect(source).toBeDefined();
    expect(destination).toBeDefined();
  });

  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

  it('populates empty desks without moving or recreating existing seats or enrollment records', async () => {
    await db.seatPositions.delete(destination.id);
    const existing = await db.seatPositions.toArray();
    const enrollments = await db.classEnrollments.toArray();
    const students = await db.students.toArray();
    await service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device');
    for (const seat of existing) expect(await db.seatPositions.get(seat.id)).toEqual(seat);
    expect(await db.classEnrollments.toArray()).toEqual(enrollments);
    expect(await db.students.toArray()).toEqual(students);
    const seats = await db.seatPositions.where('seatingLayoutId').equals(source.seatingLayoutId).toArray();
    expect(seats.filter(s => s.classEnrollmentId === destination.classEnrollmentId)).toHaveLength(1);
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(1);
    const audit = await db.auditEntries.where('entityName').equals('seatPositions').first();
    expect(audit?.userId).toBe('user-tyler');
    await service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device');
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(1);
  });

  it('populates a restored deleted desk while retiring both coordinate and out-of-grid enrollment tombstones', async () => {
    const layout = (await db.seatingLayouts.get(source.seatingLayoutId))!;
    const deletedAt = '2026-10-01T12:00:00.000Z';
    await db.seatPositions.update(source.id, { row: layout.rows + 1, deletedAt });
    await db.seatPositions.update(destination.id, { row: source.row, col: source.col, deletedAt });
    await db.classEnrollments.update(destination.classEnrollmentId, { enrollmentStatus: 'dropped' });
    const before = await db.seatPositions.toArray();
    const enrollments = await db.classEnrollments.toArray();
    const students = await db.students.toArray();
    await service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device');
    const live = await db.seatPositions.filter(s => s.deletedAt === null).toArray();
    const populated = live.filter(s => s.classEnrollmentId === source.classEnrollmentId);
    expect(populated).toHaveLength(1);
    expect(populated[0]).toMatchObject({ row: source.row, col: source.col, deletedAt: null });
    for (const seat of before.filter(s => s.deletedAt === null)) expect(await db.seatPositions.get(seat.id)).toEqual(seat);
    expect(await db.classEnrollments.toArray()).toEqual(enrollments);
    expect(await db.students.toArray()).toEqual(students);
    const audits = await db.auditEntries.where('entityName').equals('seatPositions').toArray();
    const deletes = audits.filter(a => a.action === 'DELETE');
    expect(deletes).toHaveLength(2);
    for (const tombstone of before.filter(s => s.deletedAt !== null)) {
      expect(await db.seatPositions.get(tombstone.id)).toBeUndefined();
      expect(JSON.parse(deletes.find(a => a.entityId === tombstone.id)!.previousStateJson!)).toEqual(tombstone);
    }
    expect(audits.every(a => a.userId === 'user-tyler')).toBe(true);
    expect(new Set(deletes.map(a => a.transactionId)).size).toBe(1);
    const outbox = (await db.syncMutations.toArray()).filter(m => m.transactionId === deletes[0].transactionId);
    expect(outbox.map(m => m.sequenceNumber).sort()).toEqual([1, 2]);
    expect(outbox.every(m => m.transactionSize === 2 && m.operation === 'DELETE')).toBe(true);
    await service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device');
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(audits.length);
  });

  it('restores deleted-seat rows, audits and outbox when population later fails', async () => {
    await db.seatPositions.update(source.id, { deletedAt: '2026-10-01T12:00:00.000Z' });
    await db.seatPositions.update(destination.id, { deletedAt: '2026-10-01T12:00:00.000Z' });
    const seats = await db.seatPositions.toArray();
    const audits = await db.auditEntries.toArray();
    const outbox = await db.syncMutations.toArray();
    const original = service.assignSeat.bind(service);
    let assignments = 0;
    vi.spyOn(service, 'assignSeat').mockImplementation(async (...args) => {
      if (++assignments === 2) throw new Error('Fictional assignment after tombstone cleanup');
      return original(...args);
    });
    await expect(service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('after tombstone cleanup');
    expect(await db.seatPositions.toArray()).toEqual(seats);
    expect(await db.auditEntries.toArray()).toEqual(audits);
    expect(await db.syncMutations.toArray()).toEqual(outbox);
  });

  it('rejects insufficient capacity before assigning anyone', async () => {
    await db.seatPositions.where('seatingLayoutId').equals(source.seatingLayoutId).delete();
    await db.seatingLayouts.update(source.seatingLayoutId, { rows: 1, cols: 1 });
    const before = await db.syncMutations.toArray();
    await expect(service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('Not enough empty desks');
    expect(await db.seatPositions.count()).toBe(0);
    expect(await db.syncMutations.toArray()).toEqual(before);
  });

  it('rolls back all population when a later assignment fails', async () => {
    await db.seatPositions.where('seatingLayoutId').equals(source.seatingLayoutId).delete();
    const before = await db.syncMutations.toArray();
    const original = service.assignSeat.bind(service);
    let writes = 0;
    vi.spyOn(service, 'assignSeat').mockImplementation(async (...args) => {
      if (++writes === 2) throw new Error('Fictional second desk failure');
      return original(...args);
    });
    await expect(service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('second desk failure');
    expect(await db.seatPositions.count()).toBe(0);
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(0);
    expect(await db.syncMutations.toArray()).toEqual(before);
  });

  it('shuffles unique enrollment indexes atomically, retaining seat IDs, records and actor audit', async () => {
    const original = await db.seatPositions.toArray();
    const enrollments = await db.classEnrollments.toArray();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await service.randomizeSeats(source.seatingLayoutId, 'user-tyler', 'fictional-device');
    const current = await db.seatPositions.toArray();
    expect(current.map(s => s.id).sort()).toEqual(original.map(s => s.id).sort());
    expect(current.map(s => s.classEnrollmentId).sort()).toEqual(original.map(s => s.classEnrollmentId).sort());
    expect(current.some(s => s.classEnrollmentId !== original.find(o => o.id === s.id)!.classEnrollmentId)).toBe(true);
    expect(await db.classEnrollments.toArray()).toEqual(enrollments);
    const audit = await db.auditEntries.where('entityName').equals('seatPositions').toArray();
    expect(audit).toHaveLength(original.length);
    expect(audit.every(a => a.userId === 'user-tyler')).toBe(true);
    expect(new Set(audit.map(a => a.transactionId)).size).toBe(1);
  });

  it('restores the original shuffle if audit recording fails', async () => {
    const original = await db.seatPositions.toArray();
    const outbox = await db.syncMutations.toArray();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(db.auditEntries, 'bulkAdd').mockRejectedValueOnce(new Error('Fictional audit failure'));
    await expect(service.randomizeSeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('audit failure');
    expect(await db.seatPositions.toArray()).toEqual(original);
    expect(await db.syncMutations.toArray()).toEqual(outbox);
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(0);
  });

  it('keeps locked and unauthorized population and shuffle read-only', async () => {
    const original = await db.seatPositions.toArray();
    await expect(service.populateEmptySeats(source.seatingLayoutId, 'fictional-outsider', 'fictional-device')).rejects.toThrow();
    await expect(service.randomizeSeats(source.seatingLayoutId, 'fictional-outsider', 'fictional-device')).rejects.toThrow();
    await db.seatingLayouts.update(source.seatingLayoutId, { isLocked: true });
    await expect(service.populateEmptySeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('locked');
    await expect(service.randomizeSeats(source.seatingLayoutId, 'user-tyler', 'fictional-device')).rejects.toThrow('locked');
    expect(await db.seatPositions.toArray()).toEqual(original);
  });
});
