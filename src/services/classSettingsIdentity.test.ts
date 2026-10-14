import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ClassSettingsService } from './classSettingsService';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from './identityService';

describe('UI assessment and policy write identity', () => {
  let db: OntarioTeacherDB;
  let service: ClassSettingsService;
  let actor: { userId: string; deviceId: string; identityEpoch: number };
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async t => [t.name, await t.toArray()])));
  beforeEach(async () => {
    clearActiveTeacherId(); db = new OntarioTeacherDB(`fictional-ui-identity-${crypto.randomUUID()}`);
    await seedDatabase(db); service = new ClassSettingsService(db);
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { userId: identity.userId, deviceId: identity.deviceId, identityEpoch: getIdentityEpoch() };
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  const methods = ['create', 'archive', 'duplicate', 'policy'] as const;
  async function operation(method: typeof methods[number], credentials = actor) {
    const assessment = (await db.assessments.get('assess-eng-essay'))!;
    if (method === 'create') return service.createAssessment({ ...credentials, classSectionId: assessment.classSectionId,
      unitId: assessment.unitId, title: 'Fictional actor QA', dueAt: assessment.dueAt, assessmentType: 'formative',
      categories: [{ categoryCode: 'T', maxScore: 100, evidenceWeight: 1 }] });
    if (method === 'archive') return service.archiveAssessment(assessment.id, assessment.version, credentials);
    if (method === 'duplicate') return service.duplicateAssessment(assessment.id, assessment.version, credentials);
    const policy = (await db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).first())!;
    return service.updateGradingPolicy(policy.id, policy.version, policy, credentials);
  }
  it.each(methods)('rejects %s after a teacher switch away and back with no writes', async method => {
    setActiveTeacherId('fictional-other'); setActiveTeacherId(actor.userId);
    const before = await snapshot();
    await expect(operation(method)).rejects.toThrow('Acting teacher changed');
    expect(await snapshot()).toEqual(before);
  });
  it.each(methods)('rejects %s without a matching local device', async method => {
    const before = await snapshot();
    await expect(operation(method, { ...actor, deviceId: 'missing-device' })).rejects.toThrow('matching local device');
    expect(await snapshot()).toEqual(before);
  });
  it.each(methods)('rolls back %s if identity is revoked during an audit write', async method => {
    const before = await snapshot();
    const revoke = () => { setActiveTeacherId('fictional-other'); setActiveTeacherId(actor.userId); };
    db.auditEntries.hook('creating', revoke);
    try { await expect(operation(method)).rejects.toThrow(); }
    finally { db.auditEntries.hook('creating').unsubscribe(revoke); }
    expect(await snapshot()).toEqual(before);
  });
});
