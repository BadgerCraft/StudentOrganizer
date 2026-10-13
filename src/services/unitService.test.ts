import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { UnitService } from './unitService';
import type { Unit } from '../types/schema';

const actor = { userId: 'user-tyler', deviceId: 'fictional-unit-device' };
describe('Unit management preserves linked records and atomic attribution', () => {
  let db: OntarioTeacherDB;
  let service: UnitService;
  let unit: Unit;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  beforeEach(async () => {
    db = new OntarioTeacherDB(`units-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new UnitService(db);
    unit = (await db.units.toCollection().first())!;
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

  it('creates and renames units with stable identity, untouched assessments and grouped actor attribution', async () => {
    const linkedBefore = await db.assessments.toArray();
    const created = await service.createUnit(unit.classSectionId,
      { code: ' u99 ', title: ' Fictional Oral Unit ', sortOrder: 99, startsOn: '2026-10-14', endsOn: '2026-10-20' }, actor);
    expect(created.code).toBe('U99');
    expect(created.title).toBe('Fictional Oral Unit');
    const injectedDetails = { ...unit, id: 'untrusted-extra-id', classSectionId: 'untrusted-extra-class',
      deletedAt: '2026-10-14T00:00:00Z', title: 'Fictional renamed unit', code: 'RENAMED', sortOrder: 3 };
    const renamed = await service.updateUnit(unit.id, unit.version, injectedDetails, actor);
    expect(renamed.id).toBe(unit.id);
    expect(renamed.classSectionId).toBe(unit.classSectionId);
    expect(renamed.createdAt).toBe(unit.createdAt);
    expect(renamed.deletedAt).toBeNull();
    expect(renamed.version).toBe(unit.version + 1);
    expect(await db.assessments.toArray()).toEqual(linkedBefore);
    const audit = (await db.auditEntries.where('entityId').equals(unit.id).last())!;
    expect(JSON.parse(audit.previousStateJson!)).toEqual(unit);
    expect(JSON.parse(audit.newStateJson!)).toEqual(renamed);
    expect(audit.userId).toBe(actor.userId);
    const mutations = await db.syncMutations.where('transactionId').equals(audit.transactionId).toArray();
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ entityName: 'units', entityId: unit.id, deviceId: actor.deviceId,
      baseVersion: unit.version, sequenceNumber: 1, transactionSize: 1 });
  });

  it('denies revoked or read-only teachers and stale edits without any data/audit/outbox changes', async () => {
    const staff = (await db.classSectionStaff.where('classSectionId').equals(unit.classSectionId).first())!;
    await db.classSectionStaff.update(staff.id, { role: 'read_only' });
    let before = await snapshot();
    await expect(service.updateUnit(unit.id, unit.version, { ...unit, title: 'Denied' }, actor)).rejects.toThrow('Read-only');
    expect(await snapshot()).toEqual(before);
    await db.classSectionStaff.update(staff.id, { deletedAt: new Date().toISOString() });
    before = await snapshot();
    await expect(service.createUnit(unit.classSectionId, { ...unit, code: 'NEW' }, actor)).rejects.toThrow('not assigned');
    expect(await snapshot()).toEqual(before);
    await db.classSectionStaff.update(staff.id, { role: 'primary_teacher', deletedAt: null });
    before = await snapshot();
    await expect(service.updateUnit(unit.id, unit.version + 1, { ...unit, title: 'Stale' }, actor)).rejects.toThrow('changed');
    expect(await snapshot()).toEqual(before);
  });

  it('retains tombstones and rejects their reserved codes as well as case-insensitive duplicates', async () => {
    await db.units.update(unit.id, { deletedAt: new Date().toISOString() });
    const before = await snapshot();
    await expect(service.createUnit(unit.classSectionId, { ...unit, code: unit.code.toLowerCase() }, actor)).rejects.toThrow('already exists');
    await expect(service.updateUnit(unit.id, unit.version, unit, actor)).rejects.toThrow('unavailable');
    expect(await snapshot()).toEqual(before);
  });

  it.each(['create-audit', 'create-outbox', 'edit-audit', 'edit-outbox'])('rolls back the whole database on %s failure', async operation => {
    const before = await snapshot();
    vi.spyOn(operation.endsWith('audit') ? db.auditEntries : db.syncMutations, 'add').mockRejectedValueOnce(new Error('Fictional recording failure'));
    const change = operation.startsWith('create')
      ? service.createUnit(unit.classSectionId, { ...unit, code: 'NEW' }, actor)
      : service.updateUnit(unit.id, unit.version, { ...unit, title: 'Fictional edit' }, actor);
    await expect(change).rejects.toThrow('Fictional recording failure');
    expect(await snapshot()).toEqual(before);
  });

  it.each([{ title: '' }, { sortOrder: -1 }, { startsOn: '2026-02-30' }, { startsOn: '2026-10-20', endsOn: '2026-10-01' }])
    ('rejects invalid unit metadata %j before any write', async changes => {
      const before = await snapshot();
      await expect(service.updateUnit(unit.id, unit.version, { ...unit, ...changes }, actor)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
});
