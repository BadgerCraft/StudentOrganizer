import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { BACKUP_TABLE_NAMES, validateBackupDataWithTables, validateBackupJSONWithTables } from '../services/backupValidation';
import { assertMainFullWorkspaceAuthority, assertMainWorkingBundle, createMainBundleValidationCache, validateMainBundleIntegrity } from './mainBundleValidation';
import { assertWorkspaceAccess } from '../sync/snapshot';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { createPastedDocument } from '../marking/importDocuments';
import { MarkingService } from '../marking/markingService';
const dbs: OntarioTeacherDB[] = [];
afterEach(async () => { clearActiveTeacherId(); for (const db of dbs.splice(0)) await db.delete(); });
async function fixture() {
  const db = new OntarioTeacherDB('main-validation-' + crypto.randomUUID()); dbs.push(db); await seedDatabase(db); await selectActingTeacher(db, 'user-tyler');
  const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
  const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [{ id: 'dated', createdAt: new Date().toISOString(), reason: 'manual', json: JSON.stringify(primary) }], options: [{ id: 'options', automatic: true, intervalHours: 24, retain: 7 }], state: [{ id: 'sync', lastRemoteId: 'fictional', base: structuredClone(primary) }] }, applicationStorage: { 'ota.comment-bank.v1.user-tyler': '["Fictional feedback"]' } };
  return { db, bundle, primary };
}
describe('native canonical workspace validation', () => {
  it('keeps trusted native table metadata and canonical service validation in parity', async () => {
    const { db, primary, bundle } = await fixture();
    expect([...BACKUP_TABLE_NAMES].sort()).toEqual(db.tables.map(t => t.name).sort());
    expect(validateBackupJSONWithTables(JSON.stringify(primary), BACKUP_TABLE_NAMES.map(name => ({ name })))).toEqual(new PortabilityService(db).validateBackupJSON(JSON.stringify(primary)));
    expect(await validateMainBundleIntegrity(bundle)).toEqual(bundle);
    for (const mutate of [(p: any) => delete p.tables.students, (p: any) => p.tables.untrusted = [], (p: any) => p.tables.students[0].organizationId = 'missing', (p: any) => p.tables.students.push(p.tables.students[0])]) {
      const changed = structuredClone(primary); mutate(changed);
      expect(() => new PortabilityService(db).validateBackupJSON(JSON.stringify(changed))).toThrow();
      expect(() => assertMainWorkingBundle({ ...bundle, primary: changed })).toThrow();
    }
  });
  it('validates owned snapshots without serializing the aggregate workspace and preserves JSON-path parity', async () => {
    const { bundle, primary } = await fixture();
    const expected = validateBackupJSONWithTables(JSON.stringify(primary), BACKUP_TABLE_NAMES.map(name => ({ name })));
    expect(validateBackupDataWithTables(structuredClone(primary), BACKUP_TABLE_NAMES.map(name => ({ name })))).toEqual(expected);
    const stringify = JSON.stringify; let aggregateCalls = 0;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((value: any, ...args: any[]) => { if (value === bundle || value === primary) { aggregateCalls++; throw Error('must not materialize aggregate JSON'); } return (stringify as any)(value, ...args); }) as any);
    try { expect(() => assertMainWorkingBundle(bundle)).not.toThrow(); expect(aggregateCalls).toBe(0); } finally { spy.mockRestore(); }
  });
  it.each(['backup', 'base'])('validates every retained %s and rejects malformed private state', async location => {
    const { bundle } = await fixture(); const altered = structuredClone(bundle);
    const invalid = structuredClone(bundle.primary); invalid.tables.students[0].localStudentNumber = null;
    if (location === 'backup') altered.recovery.backups[0].json = JSON.stringify(invalid); else altered.recovery.state[0].base = invalid;
    expect(() => assertMainWorkingBundle(altered)).toThrow();
    expect(() => assertMainWorkingBundle({ ...bundle, actorAuthorized: true })).toThrow();
    expect(() => assertMainWorkingBundle({ ...bundle, applicationStorage: { ontario_active_user_id: 'user-tyler' } })).toThrow();
    expect(() => assertMainWorkingBundle({ ...bundle, applicationStorage: { 'ota.comment-bank.v1.user-tyler': '[42]' } })).toThrow();
  });
  it('uses a detached verified copy and rejects retained document-byte tampering', async () => {
    const { db } = await fixture(); const identity = await selectActingTeacher(db, 'user-tyler');
    const assessment = await db.assessments.get('assess-eng-essay'); const service = new MarkingService(db);
    const rubric = await service.saveRubric(assessment!.id, { title: 'Fictional', levels: ['1','2','3','4'], criteria: [{ id: 'criterion', name: 'Knowledge', categoryCode: 'K', descriptors: { 1: 'Limited', 2: 'Some', 3: 'Considerable', 4: 'Thorough' } }] }, { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() });
    const enrollment = await db.classEnrollments.where('classSectionId').equals(assessment!.classSectionId).first();
    await service.importAttempt(assessment!.id, rubric.id, [await createPastedDocument('Fictional essay', 'Fictional retained text')], enrollment!.id, null, { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() });
    const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
    const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [], options: [], state: [] }, applicationStorage: {} };
    const verified = await validateMainBundleIntegrity(bundle); bundle.primary.tables.students[0].firstName = 'Later mutation'; expect(verified.primary.tables.students[0].firstName).not.toBe('Later mutation');
    bundle.primary.tables.markingAttempts[0].documents[0].hash = '0'.repeat(64);
    expect(() => assertMainWorkingBundle(bundle)).not.toThrow(); await expect(validateMainBundleIntegrity(bundle)).rejects.toThrow();
    const cache = createMainBundleValidationCache(); const baseline = await cache.initialize(verified);
    const replacement = structuredClone(baseline.primary.tables.markingAttempts[0]); replacement.documents[0].hash = '0'.repeat(64);
    await expect(cache.validateCandidate({ ...baseline, primary: { ...baseline.primary, tables: { ...baseline.primary.tables, markingAttempts: [replacement] } } })).rejects.toThrow();
    for (const location of ['backup', 'base']) {
      const historical = structuredClone(verified); const bad = structuredClone(verified.primary); bad.tables.markingAttempts[0].documents[0].hash = '0'.repeat(64);
      if (location === 'backup') historical.recovery.backups.push({ id: 'corrupt-history', createdAt: new Date().toISOString(), reason: 'manual', json: JSON.stringify(bad) });
      else historical.recovery.state.push({ id: 'sync', lastRemoteId: 'fictional', base: bad });
      expect(() => assertMainWorkingBundle(historical)).not.toThrow(); await expect(validateMainBundleIntegrity(historical)).rejects.toThrow();
    }
  });
  it('reuses only exact verified immutable histories and rechecks changed links and replacements', async () => {
    const { bundle } = await fixture(); const cache = createMainBundleValidationCache();
    await expect(cache.validateCandidate(bundle)).rejects.toThrow(); const baseline = await cache.initialize(bundle);
    expect(Object.isFrozen(baseline.recovery.backups[0])).toBe(true); expect(Object.isFrozen(baseline.primary.tables.students[0])).toBe(true);
    const changed = { ...baseline, primary: { ...baseline.primary, tables: { ...baseline.primary.tables, students: baseline.primary.tables.students.map((student: any, index: number) => index ? student : { ...student, firstName: 'Fictional changed' }) } } };
    const parse = JSON.parse; const spy = vi.spyOn(JSON, 'parse').mockImplementation(((raw: string, ...args: any[]) => { if (raw === baseline.recovery.backups[0].json) throw Error('retained history must not reparse'); return (parse as any)(raw, ...args); }) as any);
    try { expect(await cache.validateCandidate(changed)).toBe(changed); } finally { spy.mockRestore(); }
    const bad = { ...changed, primary: { ...changed.primary, tables: { ...changed.primary.tables, students: changed.primary.tables.students.map((student: any, index: number) => index ? student : { ...student, organizationId: 'missing' }) } } };
    await expect(cache.validateCandidate(bad)).rejects.toThrow();
    const replacedHistory = { ...changed, recovery: { ...changed.recovery, backups: [{ ...baseline.recovery.backups[0], json: '{"invalid":"replacement same id"}' }] } };
    await expect(cache.validateCandidate(replacedHistory)).rejects.toThrow(); cache.clear(); await expect(cache.validateCandidate(changed)).rejects.toThrow();
  });
  it('does not resurrect the cache when a lock clears an in-flight validation', async () => {
    const { bundle } = await fixture(); const cache = createMainBundleValidationCache();
    const initializing = cache.initialize(bundle); cache.clear(); await expect(initializing).rejects.toThrow(); await expect(cache.validateCandidate(bundle)).rejects.toThrow();
    const baseline = await cache.initialize(bundle); const candidate = { ...baseline, applicationStorage: {} };
    const validating = cache.validateCandidate(candidate); cache.clear(); await expect(validating).rejects.toThrow(); await expect(cache.validateCandidate(candidate)).rejects.toThrow();
  });
  it.each(['current', 'backup', 'base'])('preserves full-workspace ownership for %s retained identities', async location => {
    const { db, bundle } = await fixture();
    await expect(assertWorkspaceAccess(db, 'user-tyler', getIdentityEpoch())).resolves.toBeUndefined();
    await expect(assertMainFullWorkspaceAuthority(bundle, 'user-tyler')).resolves.toBeUndefined();
    const altered = structuredClone(bundle); const target = location === 'current' ? altered.primary : location === 'backup' ? JSON.parse(altered.recovery.backups[0].json) : altered.recovery.state[0].base;
    target.tables.users.push({ ...target.tables.users[0], id: 'archived-foreign', authSubject: 'foreign-auth', email: 'foreign@example.invalid', deletedAt: new Date().toISOString() });
    if (location === 'backup') altered.recovery.backups[0].json = JSON.stringify(target);
    await expect(validateMainBundleIntegrity(altered)).resolves.toBeDefined();
    await expect(assertMainFullWorkspaceAuthority(altered, 'user-tyler')).rejects.toThrow();
    if (location === 'current') { await db.users.put(target.tables.users.at(-1)); await expect(assertWorkspaceAccess(db, 'user-tyler', getIdentityEpoch())).rejects.toThrow(); }
  });
  it.each(['suspended', 'read_only', 'department_head', 'board_admin'])('matches database policy for %s access', async scenario => {
    const { db } = await fixture();
    if (scenario === 'suspended') await db.organizationMemberships.toCollection().modify({ status: 'suspended' });
    if (scenario === 'read_only') await db.classSectionStaff.toCollection().modify({ role: 'read_only' });
    if (scenario === 'department_head') await db.organizationMemberships.toCollection().modify({ role: 'department_head' });
    if (scenario === 'board_admin') {
      const root = await db.organizations.filter(o => o.parentOrganizationId === null).first();
      const membership = await db.organizationMemberships.toCollection().first();
      await db.organizationMemberships.update(membership!.id, { role: 'admin', organizationId: root!.id });
      const user = await db.users.get('user-tyler'); await db.users.put({ ...user!, id: 'foreign-admin-case', authSubject: 'foreign-admin-case', email: 'foreign-admin-case@example.invalid' });
    }
    const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
    const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [], options: [], state: [] }, applicationStorage: {} };
    const allowed = await assertWorkspaceAccess(db, 'user-tyler', getIdentityEpoch()).then(() => true, () => false);
    expect(await assertMainFullWorkspaceAuthority(bundle, 'user-tyler').then(() => true, () => false)).toBe(allowed);
    expect(allowed).toBe(['department_head', 'board_admin'].includes(scenario));
  });
  it('does not infer operator authority from stored fields or cached actor hints', async () => {
    const { bundle } = await fixture(); await expect(assertMainFullWorkspaceAuthority(bundle, '')).rejects.toThrow(); await expect(assertMainFullWorkspaceAuthority(bundle, 'fictional-missing-user')).rejects.toThrow();
  });
});
