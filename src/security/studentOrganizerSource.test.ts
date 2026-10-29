import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { RecoveryStore, saveBackup } from '../sync/backupStore';
import { createStudentOrganizerMigrationSource, type StudentOrganizerWorkingBundle } from './studentOrganizerSource';
import { DurableDexieGate } from './durableDexieGate';
import { answerEnrollmentChallenge, EncryptedWorkspaceSession, WorkspaceMigration, type EncryptedCheckpoint } from './encryptedWorkspace';
import { generateMasterKey, generateRecoveryCode, wrapMasterKey } from '../../shared/encryption';
const databases: any[] = [];
afterEach(async () => { clearActiveTeacherId(); for (const db of databases.splice(0)) await db.delete(); });
async function fixture() {
  const db = new OntarioTeacherDB('encrypted-source-' + crypto.randomUUID()), recovery = new RecoveryStore('encrypted-recovery-' + crypto.randomUUID()); databases.push(db, recovery);
  await seedDatabase(db); await selectActingTeacher(db, 'user-tyler');
  const student = await db.students.toCollection().first(); const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nnsAAAAASUVORK5CYII=';
  await db.students.update(student!.id, { photoUrl: photo });
  await saveBackup(db, 'user-tyler', 'manual', recovery); await recovery.state.put({ id: 'sync', lastRemoteId: 'synthetic-remote' });
  const applicationStorage: Record<string, string> = { 'ota.comment-bank.v1.user-tyler': JSON.stringify(['Fictional retained feedback']), ontario_teacher_device_id: 'fictional-device', 'student-organizer-appearance': 'dark' };
  // Test construction uses the existing schema. Production startup must construct disabled-cache memory stores from the outset.
  (db as any)._options.cache = 'disabled'; (recovery as any)._options.cache = 'disabled';
  const gate = new DurableDexieGate(async (_snapshots, assertCurrent) => { assertCurrent(); }, () => { const epoch = getIdentityEpoch(); return () => { if (epoch !== getIdentityEpoch()) throw new Error('Teacher changed'); }; });
  gate.register(db); gate.register(recovery);
  const source = createStudentOrganizerMigrationSource({ gate, database: db, recovery, userId: 'user-tyler', captureApplicationStorage: () => structuredClone(applicationStorage) });
  return { db, recovery, gate, source, applicationStorage, photo };
}
function validate(value: unknown): asserts value is StudentOrganizerWorkingBundle { if (!value || (value as StudentOrganizerWorkingBundle).format !== 'student-organizer-working') throw Error('Invalid test bundle'); }
describe('complete authorized Student Organizer source collection', () => {
  it('retains every primary table, photo bytes, recovery versions/base and local private state through encrypted migration', async () => {
    const f = await fixture(), before = await f.source.withReadLock(async bundle => bundle);
    expect(Object.keys(before.primary.tables).sort()).toEqual(f.db.tables.map(table => table.name).sort());
    for (const table of ['devices', 'userPreferences', 'syncMutations', 'syncCursors']) expect(before.primary.tables).toHaveProperty(table);
    expect(before.primary.tables.students[0].photoUrl).toBe(f.photo); expect(before.recovery.backups.length).toBe(1); expect(before.recovery.state[0].lastRemoteId).toBe('synthetic-remote');
    const key = generateMasterKey(), code = await generateRecoveryCode(), scope = { appId: 'student-organizer', vaultId: 'source-synthetic', keyVersion: 1 };
    const wrapped = await wrapMasterKey(key, code, scope.appId, scope.vaultId); let saved: EncryptedCheckpoint | null = null;
    const target = { read: async () => structuredClone(saved), commit: async (expected: number | null, next: EncryptedCheckpoint) => { if ((saved?.revision ?? null) !== expected) throw Error('CAS mismatch'); saved = structuredClone(next); } };
    const migration = await WorkspaceMigration.prepare(f.source, scope, key, wrapped, 'device-a', validate); await migration.verifyRecovery(code); const challenge = await migration.createDeviceChallenge('device-b'); await migration.verifyDeviceResponse('device-b', await answerEnrollmentChallenge(key, challenge)); await migration.convert(f.source, target);
    const session = await EncryptedWorkspaceSession.open(target, scope, key, validate); expect(session.read()).toEqual(before);
    expect(await f.source.withReadLock(async bundle => bundle)).toEqual(before); expect(saved!.ciphertext).not.toContain('Fictional retained feedback');
  });
  it('applies retained foreign-teacher ownership and rejects archived-author bypass', async () => {
    const f = await fixture(); const existing = await f.db.users.get('user-tyler'); await f.db.users.put({ ...existing!, id: 'foreign-retained', email: 'fictional-foreign@example.invalid', authSubject: 'fictional-foreign', deletedAt: new Date().toISOString() });
    let exposed = false; await expect(f.source.withReadLock(async () => { exposed = true; })).rejects.toThrow(/sole-teacher|administrator/); expect(exposed).toBe(false);
  });
  it.each(['backup', 'base'])('rejects foreign retained content present only in a recovery %s', async location => {
    const f = await fixture(); const backup = await f.recovery.backups.toCollection().first(); const historical = JSON.parse(backup!.json); const teacher = historical.tables.users[0]; historical.tables.users.push({ ...teacher, id: 'historical-foreign', email: 'historical@example.invalid', authSubject: 'historical', deletedAt: new Date().toISOString() });
    if (location === 'backup') await f.recovery.backups.update(backup!.id, { json: JSON.stringify(historical) }); else await f.recovery.state.put({ id: 'sync', lastRemoteId: 'historical', base: historical });
    let exposed = false; await expect(f.source.withReadLock(async () => { exposed = true; })).rejects.toThrow(/sole-teacher|administrator/); expect(exposed).toBe(false); expect(await f.recovery.backups.count()).toBe(1);
  });
  it('rechecks teacher epoch after storage capture and rejects unknown or malformed private storage', async () => {
    const f = await fixture(); const wrong = createStudentOrganizerMigrationSource({ gate: f.gate, database: f.db, recovery: f.recovery, userId: 'user-tyler', captureApplicationStorage: () => { clearActiveTeacherId(); return {}; } });
    await expect(wrong.withReadLock(async () => {})).rejects.toThrow(/teacher changed/);
    await selectActingTeacher(f.db, 'user-tyler');
    const unexpected = createStudentOrganizerMigrationSource({ gate: f.gate, database: f.db, recovery: f.recovery, userId: 'user-tyler', captureApplicationStorage: () => ({ 'unrelated-secret': 'must not capture' }) });
    await expect(unexpected.withReadLock(async () => {})).rejects.toThrow(/Unsupported/);
    const malformed = createStudentOrganizerMigrationSource({ gate: f.gate, database: f.db, recovery: f.recovery, userId: 'user-tyler', captureApplicationStorage: () => ({ 'ota.comment-bank.v1.user-tyler': '[42]' }) });
    await expect(malformed.withReadLock(async () => {})).rejects.toThrow(/nonempty/);
  });
});
