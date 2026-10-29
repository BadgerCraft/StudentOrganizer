import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from './portabilityService';
import { ParticipationDomainService, type RecordParticipationParams } from './participationService';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from './identityService';

const userId = 'user-tyler', deviceId = 'fictional-record-identity-device';
describe('participation record pins local actor and includes session creation atomically', () => {
  let db: OntarioTeacherDB, service: ParticipationDomainService, params: RecordParticipationParams;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  beforeEach(async () => {
    db = new OntarioTeacherDB(`participation-identity-${crypto.randomUUID()}`); await seedDatabase(db); setActiveTeacherId(userId);
    await db.devices.add({ id: deviceId, userId, installationId: deviceId, name: 'Fictional identity device', lastSeenAt: new Date().toISOString() });
    const section = (await db.classSections.toCollection().first())!;
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    params = { userId, deviceId, identityEpoch: getIdentityEpoch(), classSectionId: section.id, classEnrollmentIds: [enrollment.id],
      eventTypeId: 'pet-risk', localSchoolDate: '2020-02-03', occurredAt: '2020-02-03T15:00:00.000Z', ensureClassSession: true };
    service = new ParticipationDomainService(db);
  });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });
  it('retains the latest event timestamp when an earlier observation arrives later and through restore', async () => {
    const grades = await db.categoryResults.toArray();
    await service.recordParticipation({ ...params, occurredAt: '2020-02-03T16:00:00.000Z' });
    await service.recordParticipation(params);
    const summary = await db.participationDailySummaries.where({ classEnrollmentId: params.classEnrollmentIds[0], localSchoolDate: params.localSchoolDate }).first();
    expect(summary?.lastEventAt).toBe('2020-02-03T16:00:00.000Z');
    const events = await db.participationEvents.toArray();
    const portability = new PortabilityService(db);
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect(await db.participationDailySummaries.get(summary!.id)).toEqual(summary);
    expect(await db.participationEvents.toArray()).toEqual(events);
    expect(await db.categoryResults.toArray()).toEqual(grades);
  });
  it('creates one linked session with the event, and reuses it for a later observation', async () => {
    const before = await db.classSessions.count();
    const [first] = await service.recordParticipation(params), [second] = await service.recordParticipation(params);
    expect(first.classSessionId).toBeTruthy(); expect(second.classSessionId).toBe(first.classSessionId);
    expect(await db.classSessions.count()).toBe(before + 1);
    expect(first.createdByUserId).toBe(userId);
  });
  it.each(['after-session', 'after-events', 'after-outbox'] as const)('rolls back every table on identity change %s', async phase => {
    const before = await snapshot();
    if (phase === 'after-session') {
      const add = db.classSessions.add.bind(db.classSessions);
      vi.spyOn(db.classSessions, 'add').mockImplementationOnce((...args) => add(...args).then(value => { clearActiveTeacherId(); return value; }));
    } else {
      const table = phase === 'after-events' ? db.participationEvents : db.syncMutations;
      const add = table.bulkAdd.bind(table);
      vi.spyOn(table, 'bulkAdd').mockImplementationOnce((...args: any[]) => (add as any)(...args).then((value: unknown) => { clearActiveTeacherId(); return value; }));
    }
    await expect(service.recordParticipation(params)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });
  it.each(['changed-epoch', 'wrong-device', 'read-only'] as const)('rejects %s before creating a session or event', async denial => {
    if (denial === 'changed-epoch') { clearActiveTeacherId(); setActiveTeacherId(userId); }
    if (denial === 'wrong-device') await db.devices.update(deviceId, { userId: 'fictional-other-teacher' });
    if (denial === 'read-only') for (const staff of await db.classSectionStaff.toArray()) await db.classSectionStaff.update(staff.id, { role: 'read_only' });
    const before = await snapshot(); await expect(service.recordParticipation(params)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });
  it('rolls back the newly created session if event persistence fails', async () => {
    const before = await snapshot(); vi.spyOn(db.participationEvents, 'bulkAdd').mockRejectedValueOnce(new Error('Fictional storage failure'));
    await expect(service.recordParticipation(params)).rejects.toThrow('Fictional storage failure'); expect(await snapshot()).toEqual(before);
  });
});
