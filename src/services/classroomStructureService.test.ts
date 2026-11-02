import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import type { ClassSection, SeatingLayout } from '../types/schema';
import { ClassroomStructureService } from './classroomStructureService';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from './identityService';
import { SeatingDomainService } from './seatingService';
import { listAccessibleClassSections } from './authHelper';

const actor = { userId: 'user-tyler', deviceId: 'fictional-structure-device' };
const operations = ['archive', 'edit', 'create'] as const;
describe('classroom structure writes retain atomic authority and attribution', () => {
  let db: OntarioTeacherDB, service: ClassroomStructureService, layout: SeatingLayout, section: ClassSection, empty: ClassSection;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  const run = (operation: typeof operations[number], override = actor) => operation === 'archive'
    ? service.archiveClass(section.id, section.version, override)
    : operation === 'edit' ? service.updateLayout(layout.id, layout.version, { isLocked: !layout.isLocked }, override)
      : service.createDefaultLayout(empty.id, override);
  beforeEach(async () => {
    db = new OntarioTeacherDB(`structure-${crypto.randomUUID()}`); await seedDatabase(db);
    setActiveTeacherId(actor.userId);
    await db.devices.add({ id: actor.deviceId, userId: actor.userId, installationId: actor.deviceId, name: 'Fictional device', lastSeenAt: new Date().toISOString() });
    layout = (await db.seatingLayouts.toCollection().first())!;
    section = (await db.classSections.get(layout.classSectionId))!;
    empty = { ...section, id: 'fictional-empty-class', sectionNumber: '99' }; await db.classSections.add(empty);
    const staff = (await db.classSectionStaff.where('classSectionId').equals(section.id).first())!;
    await db.classSectionStaff.add({ ...staff, id: 'fictional-empty-staff', classSectionId: empty.id });
    service = new ClassroomStructureService(db);
  });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });

  it.each(operations)('permits %s with exact before/after audit and matching outbox version', async operation => {
    const seats = await db.seatPositions.toArray();
    await run(operation);
    const id = operation === 'archive' ? section.id : operation === 'edit' ? layout.id : `layout-${empty.id}`;
    const audit = (await db.auditEntries.where('entityId').equals(id).last())!;
    const next = operation === 'archive' ? await db.classSections.get(id) : await db.seatingLayouts.get(id);
    const old = operation === 'archive' ? section : operation === 'edit' ? layout : null;
    expect(audit.userId).toBe(actor.userId);
    expect(JSON.parse(audit.newStateJson!)).toEqual(next);
    expect(audit.previousStateJson ? JSON.parse(audit.previousStateJson) : null).toEqual(old);
    expect(next!.version).toBe((old?.version ?? 0) + 1);
    expect(await db.syncMutations.where('transactionId').equals(audit.transactionId).toArray()).toEqual([
      expect.objectContaining({ entityId: id, deviceId: actor.deviceId, baseVersion: old?.version ?? 0, sequenceNumber: 1, transactionSize: 1, payloadJson: JSON.stringify(next) })
    ]);
    expect(await db.seatPositions.toArray()).toEqual(seats);
    const after = await snapshot();
    await expect(run(operation)).rejects.toThrow();
    expect(await snapshot()).toEqual(after);
  });

  it.each(['read_only', 'unassigned', 'guest', 'suspended', 'unselected', 'other-teacher', 'wrong-device'] as const)
    ('denies all structure changes for %s without data/audit/outbox writes', async denial => {
      const staff = await db.classSectionStaff.toArray();
      if (denial === 'read_only' || denial === 'unassigned') for (const s of staff)
        await db.classSectionStaff.update(s.id, denial === 'read_only' ? { role: 'read_only' } : { deletedAt: new Date().toISOString() });
      const membership = (await db.organizationMemberships.where('userId').equals(actor.userId).first())!;
      if (denial === 'guest') await db.organizationMemberships.update(membership.id, { role: 'guest' });
      if (denial === 'suspended') await db.organizationMemberships.update(membership.id, { status: 'suspended' });
      if (denial === 'unselected') clearActiveTeacherId();
      if (denial === 'other-teacher') setActiveTeacherId('fictional-other-teacher');
      if (denial === 'wrong-device') await db.devices.update(actor.deviceId, { userId: 'fictional-other-teacher' });
      const before = await snapshot();
      for (const operation of operations) await expect(run(operation)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });

  it('rejects captured actors after switching away and back', async () => {
    const captured = { ...actor, identityEpoch: getIdentityEpoch() };
    clearActiveTeacherId(); setActiveTeacherId(actor.userId);
    const before = await snapshot();
    for (const operation of operations) await expect(run(operation, captured)).rejects.toThrow('changed');
    expect(await snapshot()).toEqual(before);
  });

  it.each(operations)('rolls back %s when identity changes after its audit write', async operation => {
    const before = await snapshot(), add = db.auditEntries.add.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'add').mockImplementationOnce((...args) => add(...args).then(result => {
      clearActiveTeacherId(); setActiveTeacherId(actor.userId); return result;
    }));
    await expect(run(operation)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });

  it.each(operations)('rolls back %s on failed audit/outbox persistence', async operation => {
    for (const table of [db.auditEntries, db.syncMutations]) {
      const before = await snapshot();
      vi.spyOn(table, 'add').mockRejectedValueOnce(new Error('Fictional persistence failure'));
      await expect(run(operation)).rejects.toThrow('Fictional persistence failure');
      expect(await snapshot()).toEqual(before); vi.restoreAllMocks();
    }
  });

  it.each(['rows', 'cols'] as const)('rejects shrinking an occupied %s edge without any writes', async axis => {
    await db.seatPositions.clear();
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    await db.seatingLayouts.update(layout.id, { rows: 3, cols: 3, isLocked: false });
    layout = (await db.seatingLayouts.get(layout.id))!;
    await new SeatingDomainService(db).assignSeat(layout.id, axis === 'rows' ? 2 : 0, axis === 'cols' ? 2 : 0, enrollment.id, actor.userId, actor.deviceId);
    const before = await snapshot();
    await expect(service.updateLayout(layout.id, layout.version, { [axis]: 2 }, actor)).rejects.toThrow(/Move.*first/);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['rows', 'cols'] as const)('allows empty %s edge removal and ignores tombstones without deleting them', async axis => {
    await db.seatPositions.clear();
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    const now = new Date().toISOString();
    await db.seatPositions.add({ id: 'old-deleted-seat', seatingLayoutId: layout.id, classEnrollmentId: enrollment.id,
      row: layout.rows - 1, col: layout.cols - 1, createdAt: now, updatedAt: now, deletedAt: now, version: 1 });
    const seats = await db.seatPositions.toArray();
    const next = await service.updateLayout(layout.id, layout.version, { [axis]: layout[axis] - 1 }, actor);
    expect(next[axis]).toBe(layout[axis] - 1);
    expect(next.version).toBe(layout.version + 1);
    expect(await db.seatPositions.toArray()).toEqual(seats);
    expect(await db.auditEntries.where('entityId').equals(layout.id).count()).toBe(1);
    expect(await db.syncMutations.where('entityId').equals(layout.id).count()).toBe(1);
  });

  it.each([['rows', 'seat-first'], ['rows', 'resize-first'], ['cols', 'seat-first'], ['cols', 'resize-first']] as const)('serializes concurrent %s edge seating and shrinking: %s', async (axis, order) => {
    await db.seatPositions.clear();
    await db.seatingLayouts.update(layout.id, { rows: 3, cols: 3, isLocked: false });
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    const seat = () => new SeatingDomainService(db).assignSeat(layout.id, axis === 'rows' ? 2 : 0, axis === 'cols' ? 2 : 0, enrollment.id, actor.userId, actor.deviceId);
    const resize = () => service.updateLayout(layout.id, layout.version, { [axis]: 2 }, actor);
    const results = await Promise.allSettled(order === 'seat-first' ? [seat(), resize()] : [resize(), seat()]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    const current = (await db.seatingLayouts.get(layout.id))!;
    const seats = await db.seatPositions.toArray();
    expect(seats.every(s => s.row < current.rows && s.col < current.cols)).toBe(true);
    expect(seats.length).toBe(order === 'seat-first' ? 1 : 0);
    expect(current[axis]).toBe(order === 'seat-first' ? 3 : 2);
  });

  it('denies read-only resizing even when the edge is empty', async () => {
    await db.seatPositions.clear();
    await db.classSectionStaff.toCollection().modify({ role: 'read_only' });
    const before = await snapshot();
    await expect(service.updateLayout(layout.id, layout.version, { rows: 2 }, actor)).rejects.toThrow(/Read-only/);
    expect(await snapshot()).toEqual(before);
  });

  it('projects only layout controls and preserves seats on expansion', async () => {
    const seats = await db.seatPositions.toArray();
    const changed = await service.updateLayout(layout.id, layout.version, { rows: 20, cols: 20, cardSize: 'compact', id: 'injected', classSectionId: empty.id, deletedAt: 'injected' } as any, actor);
    expect(changed).toMatchObject({ id: layout.id, classSectionId: section.id, rows: 20, cols: 20, cardSize: 'compact', deletedAt: null, version: layout.version + 1 });
    expect(await db.seatPositions.toArray()).toEqual(seats);
  });

  it.each(['missing-direct', 'deleted-direct', 'missing-parent', 'deleted-parent', 'cycle', 'depth'])
    ('fails closed for %s organization ancestry even with admin membership', async broken => {
      const course = (await db.courses.get(section.courseId))!;
      const direct = (await db.organizations.get(course.organizationId))!;
      const membership = (await db.organizationMemberships.where('userId').equals(actor.userId).first())!;
      await db.organizationMemberships.update(membership.id, { role: 'admin' });
      if (broken === 'missing-direct') await db.organizations.delete(direct.id);
      if (broken === 'deleted-direct') await db.organizations.update(direct.id, { deletedAt: new Date().toISOString() });
      if (broken === 'missing-parent') await db.organizations.delete(direct.parentOrganizationId!);
      if (broken === 'deleted-parent') await db.organizations.update(direct.parentOrganizationId!, { deletedAt: new Date().toISOString() });
      if (broken === 'cycle') await db.organizations.update(direct.parentOrganizationId!, { parentOrganizationId: direct.id });
      if (broken === 'depth') {
        for (let i = 0; i < 10; i++) await db.organizations.add({ ...direct, id: `fictional-org-${i}`, name: `Fictional ${i}`, code: `F${i}`, parentScopeKey: i === 9 ? 'ROOT' : `fictional-org-${i+1}`, parentOrganizationId: i === 9 ? null : `fictional-org-${i+1}` });
        await db.organizations.update(direct.id, { parentOrganizationId: 'fictional-org-0' });
      }
      const before = await snapshot();
      for (const operation of operations) await expect(run(operation)).rejects.toThrow(/hierarchy/);
      expect(await listAccessibleClassSections(db, actor.userId)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: section.id })]));
      expect(await snapshot()).toEqual(before);
    });
});
