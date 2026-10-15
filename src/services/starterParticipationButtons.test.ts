import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ParticipationEventTypeService } from './eventTypeService';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from './identityService';

describe('deliberate starter participation buttons', () => {
  let db: OntarioTeacherDB;
  let service: ParticipationEventTypeService;
  let sectionId: string;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`starter-buttons-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new ParticipationEventTypeService(db);
    sectionId = (await db.classSections.toCollection().first())!.id;
    setActiveTeacherId('user-tyler');
    await db.devices.put({ id: 'device-test', userId: 'user-tyler', installationId: 'fictional-test',
      name: 'Fictional test device', lastSeenAt: new Date().toISOString() });
  });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });

  it('atomically creates all classifications once under concurrent requests, preserving existing history and formal grades', async () => {
    await db.participationEventTypes.clear(); // isolated fictional empty configuration fixture
    const events = await db.participationEvents.toArray();
    const grades = await db.categoryResults.toArray();
    const results = await Promise.all([service.addStarterButtons(sectionId, 'user-tyler', 'device-test'),
      service.addStarterButtons(sectionId, 'user-tyler', 'device-test')]);
    expect(results.map(r => r.length).sort()).toEqual([0, 4]);
    const buttons = await service.listEventTypesForSection(sectionId);
    expect(buttons.map(b => b.classification)).toEqual(['positive', 'neutral', 'neutral', 'needs_followup']);
    expect(buttons.find(b => b.recordingMode === 'level_1_4')!.defaultPoints).toBe(0);
    const ids = buttons.map(b => b.id);
    const audits = await db.auditEntries.filter(a => ids.includes(a.entityId)).toArray();
    const sync = await db.syncMutations.filter(m => ids.includes(m.entityId)).toArray();
    expect(audits).toHaveLength(4); expect(sync).toHaveLength(4);
    expect(audits.every(a => a.userId === 'user-tyler')).toBe(true);
    expect(await db.participationEvents.toArray()).toEqual(events);
    expect(await db.categoryResults.toArray()).toEqual(grades);
  });

  it('does not seed over existing custom, archived or global configuration', async () => {
    const before = await db.participationEventTypes.toArray();
    expect(await service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).toEqual([]);
    expect(await db.participationEventTypes.toArray()).toEqual(before);
    await db.participationEventTypes.clear();
    await db.participationEventTypes.add({ ...before[0], isArchived: true });
    expect(await service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).toEqual([]);
    await db.participationEventTypes.clear();
    await db.participationEventTypes.add({ ...before[0], organizationId: null });
    expect(await service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).toEqual([]);
    expect(await db.participationEventTypes.count()).toBe(1);
  });

  it('rejects unauthorized setup and rolls back all starter writes if attribution recording fails', async () => {
    await db.participationEventTypes.clear();
    await expect(service.addStarterButtons(sectionId, 'missing-teacher', 'device-test')).rejects.toThrow();
    expect(await db.participationEventTypes.count()).toBe(0);
    const auditBefore = await db.auditEntries.count();
    const syncBefore = await db.syncMutations.count();
    const originalAdd = db.auditEntries.add.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'add').mockImplementationOnce(originalAdd).mockRejectedValueOnce(new Error('fictional audit failure'));
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow('fictional audit failure');
    expect(await db.participationEventTypes.count()).toBe(0);
    expect(await db.auditEntries.count()).toBe(auditBefore);
    expect(await db.syncMutations.count()).toBe(syncBefore);
  });

  it('requires the explicitly active teacher and a device belonging to that teacher', async () => {
    await db.participationEventTypes.clear();
    clearActiveTeacherId();
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow();
    const epoch = getIdentityEpoch();
    setActiveTeacherId('user-chen');
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow();
    setActiveTeacherId('user-tyler');
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test', epoch)).rejects.toThrow();
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'missing-device')).rejects.toThrow();
    await db.devices.update('device-test', { userId: 'user-chen' });
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow();
    expect(await db.participationEventTypes.count()).toBe(0);
  });

  it('rolls back buttons, audit and sync if the teacher switches away and back during an awaited write', async () => {
    await db.participationEventTypes.clear();
    const auditBefore = await db.auditEntries.count();
    const syncBefore = await db.syncMutations.count();
    const originalAdd = db.auditEntries.add.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'add').mockImplementationOnce((...args) => originalAdd(...args).then(result => {
      setActiveTeacherId('user-chen');
      setActiveTeacherId('user-tyler');
      return result;
    }));
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow();
    expect(await db.participationEventTypes.count()).toBe(0);
    expect(await db.auditEntries.count()).toBe(auditBefore);
    expect(await db.syncMutations.count()).toBe(syncBefore);
  });

  it.each(['unassigned', 'read_only', 'guest', 'suspended', 'deleted-section'])(
    'rejects a selected teacher with %s class authorization before any attributed write', async denial => {
      await db.participationEventTypes.clear();
      const auditBefore = await db.auditEntries.count();
      const syncBefore = await db.syncMutations.count();
      const assignment = (await db.classSectionStaff.where('classSectionId').equals(sectionId).first())!;
      if (denial === 'unassigned') await db.classSectionStaff.update(assignment.id, { deletedAt: new Date().toISOString() });
      if (denial === 'read_only') await db.classSectionStaff.update(assignment.id, { role: 'read_only' });
      if (denial === 'guest') await db.organizationMemberships.update(assignment.organizationMembershipId, { role: 'guest' });
      if (denial === 'suspended') await db.organizationMemberships.update(assignment.organizationMembershipId, { status: 'suspended' });
      if (denial === 'deleted-section') await db.classSections.update(sectionId, { deletedAt: new Date().toISOString() });
      await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow();
      expect(await db.participationEventTypes.count()).toBe(0);
      expect(await db.auditEntries.count()).toBe(auditBefore);
      expect(await db.syncMutations.count()).toBe(syncBefore);
    });

  it('rolls back the complete setup when its sync recording fails', async () => {
    await db.participationEventTypes.clear();
    const auditBefore = await db.auditEntries.count();
    const syncBefore = await db.syncMutations.count();
    vi.spyOn(db.syncMutations, 'add').mockRejectedValueOnce(new Error('fictional sync failure'));
    await expect(service.addStarterButtons(sectionId, 'user-tyler', 'device-test')).rejects.toThrow('fictional sync failure');
    expect(await db.participationEventTypes.count()).toBe(0);
    expect(await db.auditEntries.count()).toBe(auditBefore);
    expect(await db.syncMutations.count()).toBe(syncBefore);
  });
});
