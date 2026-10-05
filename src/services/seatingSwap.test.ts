import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { SeatingDomainService } from './seatingService';
import type { SeatPosition } from '../types/schema';

describe('Occupied seat swaps', () => {
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

  it('swaps occupied unique coordinates, preserves IDs/occupants, and records both changes together', async () => {
    const original = await db.seatPositions.toArray();
    const result = await service.assignSeat(source.seatingLayoutId, destination.row, destination.col, source.classEnrollmentId, 'user-tyler', 'fictional-device');
    const moved = await db.seatPositions.get(source.id);
    const swapped = await db.seatPositions.get(destination.id);
    expect(result?.id).toBe(source.id);
    expect(moved).toMatchObject({ id: source.id, classEnrollmentId: source.classEnrollmentId, row: destination.row, col: destination.col, version: source.version + 1 });
    expect(swapped).toMatchObject({ id: destination.id, classEnrollmentId: destination.classEnrollmentId, row: source.row, col: source.col, version: destination.version + 1 });
    const current = await db.seatPositions.toArray();
    expect(current.length).toBe(original.length);
    expect(current.map(seat => seat.classEnrollmentId).sort()).toEqual(original.map(seat => seat.classEnrollmentId).sort());
    const audit = await db.auditEntries.where('entityName').equals('seatPositions').toArray();
    expect(audit).toHaveLength(2);
    expect(new Set(audit.map(entry => entry.transactionId)).size).toBe(1);
    expect(audit.map(entry => entry.entityId).sort()).toEqual([source.id, destination.id].sort());
    expect(audit.every(entry => entry.userId === 'user-tyler' && entry.action === 'UPDATE')).toBe(true);
    for (const entry of audit) {
      const before = JSON.parse(entry.previousStateJson!);
      const after = JSON.parse(entry.newStateJson!);
      expect(after.id).toBe(before.id);
      expect(after.classEnrollmentId).toBe(before.classEnrollmentId);
      expect(after.version).toBe(before.version + 1);
    }
    const outbox = (await db.syncMutations.toArray()).filter(entry => entry.transactionId === audit[0].transactionId);
    expect(outbox).toHaveLength(2);
    expect(outbox.map(entry => entry.sequenceNumber).sort()).toEqual([1, 2]);
    expect(outbox.every(entry => entry.transactionSize === 2 && entry.deviceId === 'fictional-device')).toBe(true);
    // Repeating the same destination is a no-op, not a second swap.
    await service.assignSeat(source.seatingLayoutId, destination.row, destination.col, source.classEnrollmentId, 'user-tyler', 'fictional-device');
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(2);
  });

  it('restores both seats and leaves no audit/outbox writes if recording the swap fails', async () => {
    const original = await db.seatPositions.toArray();
    const auditBefore = await db.auditEntries.toArray();
    const outboxBefore = await db.syncMutations.toArray();
    vi.spyOn(db.auditEntries, 'bulkAdd').mockRejectedValueOnce(new Error('Fictional audit write failure'));
    await expect(service.assignSeat(source.seatingLayoutId, destination.row, destination.col, source.classEnrollmentId, 'user-tyler', 'fictional-device')).rejects.toThrow('Fictional audit write failure');
    expect(await db.seatPositions.toArray()).toEqual(original);
    expect(await db.auditEntries.toArray()).toEqual(auditBefore);
    expect(await db.syncMutations.toArray()).toEqual(outboxBefore);
  });

  it('rejects a swap by an unauthorized actor without changing either occupied seat', async () => {
    const original = await db.seatPositions.toArray();
    await expect(service.assignSeat(source.seatingLayoutId, destination.row, destination.col, source.classEnrollmentId, 'fictional-outsider', 'fictional-device')).rejects.toThrow();
    expect(await db.seatPositions.toArray()).toEqual(original);
    expect(await db.auditEntries.where('entityName').equals('seatPositions').count()).toBe(0);
  });
});
