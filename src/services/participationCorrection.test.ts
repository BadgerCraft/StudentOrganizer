import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ParticipationDomainService } from './participationService';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from './identityService';
import { buildTorontoTimestamp, getSchoolLocalDate, shiftSchoolDate } from '../utils/dateUtils';
import type { ParticipationEvent } from '../types/schema';

const userId = 'user-tyler', deviceId = 'fictional-correction-device';
describe('undo one participation correction without replaying feedback', () => {
  let db: OntarioTeacherDB, service: ParticipationDomainService, original: ParticipationEvent, sibling: ParticipationEvent;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  beforeEach(async () => {
    db = new OntarioTeacherDB(`correction-${crypto.randomUUID()}`); await seedDatabase(db);
    setActiveTeacherId(userId);
    await db.devices.add({ id: deviceId, userId, installationId: deviceId, name: 'Fictional correction device', lastSeenAt: new Date().toISOString() });
    service = new ParticipationDomainService(db);
    const section = (await db.classSections.toCollection().first())!;
    const enrollments = await db.classEnrollments.where('classSectionId').equals(section.id).toArray();
    const date = shiftSchoolDate(getSchoolLocalDate(), -1);
    [original, sibling] = await service.recordParticipation({ classEnrollmentIds: enrollments.slice(0, 2).map(e => e.id), classSectionId: section.id,
      eventTypeId: 'pet-risk', localSchoolDate: date, occurredAt: buildTorontoTimestamp(date, '10:00'), note: 'Fictional original note', userId, deviceId });
    await service.retractEvent(original.id, original.version, userId, deviceId);
  });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });
  const restore = (version = 2, epoch?: number) => service.restoreRetractedEvent(original.id, version, userId, deviceId, epoch);

  it('restores only the original snapshot and version, retains batch sibling and writes exact audit/outbox', async () => {
    await db.participationEventTypes.update(original.eventTypeId!, { name: 'Changed later', defaultPoints: 99, isArchived: true });
    const deleted = (await db.participationEvents.get(original.id))!;
    const restored = await restore();
    expect(restored).toEqual({ ...original, version: 3, updatedAt: restored.updatedAt });
    expect(await db.participationEvents.get(sibling.id)).toEqual(sibling);
    const audits = await db.auditEntries.where('entityId').equals(original.id).toArray();
    const audit = audits.find(row => row.action === 'UPDATE')!;
    expect(JSON.parse(audit.previousStateJson!)).toEqual(deleted);
    expect(JSON.parse(audit.newStateJson!)).toEqual(restored);
    expect(await db.syncMutations.where('transactionId').equals(audit.transactionId).toArray()).toEqual([
      expect.objectContaining({ operation: 'UPDATE', entityId: original.id, baseVersion: 2, payloadJson: JSON.stringify(restored), deviceId })
    ]);
    const summary = (await db.participationDailySummaries.where('[classEnrollmentId+localSchoolDate]').equals([original.classEnrollmentId, original.localSchoolDate]).first())!;
    expect(summary).toMatchObject({ positiveCount: 1, totalPoints: original.snapshottedPoints, lastEventAt: original.occurredAt });
    const beforeReplay = await snapshot(); await expect(restore(3)).rejects.toThrow('already active'); expect(await snapshot()).toEqual(beforeReplay);
  });
  it('rejects a stale deleted-record version without writes', async () => {
    const before = await snapshot(); await expect(restore(1)).rejects.toThrow('Stale event version'); expect(await snapshot()).toEqual(before);
  });
  it.each(['read_only', 'unassigned', 'unselected', 'wrong-device', 'changed-epoch'] as const)('rejects %s without writes', async mode => {
    const epoch = getIdentityEpoch();
    if (mode === 'read_only' || mode === 'unassigned') for (const staff of await db.classSectionStaff.toArray())
      await db.classSectionStaff.update(staff.id, mode === 'read_only' ? { role: 'read_only' } : { deletedAt: new Date().toISOString() });
    if (mode === 'unselected') clearActiveTeacherId();
    if (mode === 'wrong-device') await db.devices.update(deviceId, { userId: 'another-teacher' });
    if (mode === 'changed-epoch') { clearActiveTeacherId(); setActiveTeacherId(userId); }
    const before = await snapshot(); await expect(restore(2, epoch)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });
  it('rolls back if identity changes after persistence starts', async () => {
    const before = await snapshot(), add = db.auditEntries.add.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'add').mockImplementationOnce((...args) => add(...args).then(result => { clearActiveTeacherId(); return result; }));
    await expect(restore()).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  });
  it('guards a chooser retraction against a teacher switch during its transaction', async () => {
    const active = await restore();
    const epoch = getIdentityEpoch(), before = await snapshot(), add = db.auditEntries.add.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'add').mockImplementationOnce((...args) => add(...args).then(result => { clearActiveTeacherId(); return result; }));
    await expect(service.retractEvent(active.id, active.version, userId, deviceId, 'Correct today feedback', epoch)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back a keyboard batch undo when the actor changes after its audit write', async () => {
    const epoch = getIdentityEpoch(), before = await snapshot(), add = db.auditEntries.bulkAdd.bind(db.auditEntries);
    vi.spyOn(db.auditEntries, 'bulkAdd').mockImplementationOnce((...args: any[]) => (add as any)(...args).then((result: unknown) => {
      clearActiveTeacherId(); return result;
    }));
    await expect(service.undoBatch(sibling.batchId, userId, deviceId, epoch)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('rejects a captured batch-undo actor after switching away and back', async () => {
    const epoch = getIdentityEpoch(); clearActiveTeacherId(); setActiveTeacherId(userId);
    const before = await snapshot();
    await expect(service.undoBatch(sibling.batchId, userId, deviceId, epoch)).rejects.toThrow('changed');
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back the event, projection and audit if outbox persistence fails', async () => {
    const before = await snapshot(); vi.spyOn(db.syncMutations, 'add').mockRejectedValueOnce(new Error('Fictional storage failure'));
    await expect(restore()).rejects.toThrow('Fictional storage failure'); expect(await snapshot()).toEqual(before);
  });
});
