import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { SeatingDomainService } from './seatingService';
import type { SeatPosition } from '../types/schema';

describe('Manual seating after class removal and re-enrollment', () => {
  let db: OntarioTeacherDB;
  let service: SeatingDomainService;
  let seat: SeatPosition;
  let other: SeatPosition;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`fictional-manual-seat-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new SeatingDomainService(db);
    [seat, other] = await db.seatPositions.toArray();
    await db.seatingLayouts.update(seat.seatingLayoutId, { isLocked: false });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

  it('reactivates the same tombstoned seat with original identity and actor-linked evidence', async () => {
    await db.seatPositions.update(seat.id, { deletedAt: '2026-10-13T12:00:00Z' });
    const old = await db.seatPositions.get(seat.id);
    const before = await db.classEnrollments.toArray();
    const result = await service.assignSeat(seat.seatingLayoutId, seat.row, seat.col, seat.classEnrollmentId, 'user-tyler', 'fictional-device');
    expect(result).toMatchObject({ id: seat.id, classEnrollmentId: seat.classEnrollmentId, deletedAt: null, version: seat.version + 1 });
    expect(await db.classEnrollments.toArray()).toEqual(before);
    const audit = (await db.auditEntries.where('entityName').equals('seatPositions').toArray()).at(-1)!;
    expect(JSON.parse(audit.previousStateJson!)).toEqual(old);
    expect(audit.userId).toBe('user-tyler');
    const mutations = await db.syncMutations.where('transactionId').equals(audit.transactionId).toArray();
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(mutations[0].payloadJson).deletedAt).toBeNull();
  });

  it('reactivates a removed coordinate for an unseated active student without altering academic records', async () => {
    await db.seatPositions.delete(other.id);
    await db.seatPositions.update(seat.id, { deletedAt: '2026-10-13T12:00:00Z' });
    const results = await db.categoryResults.toArray();
    const result = await service.assignSeat(seat.seatingLayoutId, seat.row, seat.col, other.classEnrollmentId, 'user-tyler', 'fictional-device');
    expect(result).toMatchObject({ id: seat.id, classEnrollmentId: other.classEnrollmentId, deletedAt: null });
    expect(await db.categoryResults.toArray()).toEqual(results);
  });

  it('rejects a dropped enrollment and rolls back reactivation when audit fails', async () => {
    await db.classEnrollments.update(seat.classEnrollmentId, { enrollmentStatus: 'dropped' });
    await db.seatPositions.update(seat.id, { deletedAt: '2026-10-13T12:00:00Z' });
    const before = await db.seatPositions.toArray();
    await expect(service.assignSeat(seat.seatingLayoutId, seat.row, seat.col, seat.classEnrollmentId, 'user-tyler', 'fictional-device')).rejects.toThrow('not active');
    expect(await db.seatPositions.toArray()).toEqual(before);
    await db.classEnrollments.update(seat.classEnrollmentId, { enrollmentStatus: 'active' });
    const audits = await db.auditEntries.toArray(), mutations = await db.syncMutations.toArray();
    vi.spyOn(db.auditEntries, 'bulkAdd').mockImplementation(() => { throw new Error('Fictional audit failure'); });
    await expect(service.assignSeat(seat.seatingLayoutId, seat.row, seat.col, seat.classEnrollmentId, 'user-tyler', 'fictional-device')).rejects.toThrow('audit failure');
    expect(await db.seatPositions.toArray()).toEqual(before);
    expect(await db.auditEntries.toArray()).toEqual(audits);
    expect(await db.syncMutations.toArray()).toEqual(mutations);
  });
});
