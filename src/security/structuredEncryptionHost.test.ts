import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { answerEnrollmentChallenge } from './encryptedWorkspace';
import { recoverMasterKey } from '../../shared/encryption';
const require = createRequire(import.meta.url);
let createStructuredEncryptionHost: any, createCipherChunkStore: any;
const dirs: string[] = [], dbs: OntarioTeacherDB[] = [];
beforeAll(() => { execFileSync(process.execPath, ['scripts/buildEncryptionNative.cjs']); ({ createStructuredEncryptionHost } = require('../../electron/structuredEncryptionHost.cjs')); ({ createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs')); });
afterEach(async () => { for (const db of dbs.splice(0)) await db.delete(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function fixture(gate = () => true, deviceId = 'fictional-computer-A') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-structured-host-')); dirs.push(directory);
  const db = new OntarioTeacherDB('fictional-structured-host-' + crypto.randomUUID()); dbs.push(db); await seedDatabase(db);
  const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
  const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [{ id: 'dated-1', createdAt: '2026-10-29T00:00:00Z', reason: 'manual', json: JSON.stringify(primary) }], options: [], state: [] }, applicationStorage: {} };
  const scope = { appId: 'student-organizer', vaultId: 'fictional-host-vault', keyVersion: 1 };
  let key: Uint8Array | null = null, saved: any = null, commits = 0, stages = 0, fresh = false, failReply = false;
  const aux = new Map<string, string>(), artifactOrder: string[] = [];
  const store = { initialize: async () => { artifactOrder.push('database'); }, read: async () => structuredClone(saved), saveAux: async (kind: string, value: string) => { artifactOrder.push('auxiliary'); aux.set(kind, value); }, readAux: async (kind: string) => aux.get(kind) ?? null,
    getTrustedHead: () => saved && ({ revision: saved.revision, hash: createHash('sha256').update(saved.ciphertext).digest('hex') }),
    commit: async (expected: number | null, next: any) => { if ((saved?.revision ?? null) !== expected || expected === null && !fresh) throw Error('synthetic guard'); saved = structuredClone(next); commits++; if (failReply) throw Error('PRIVATE_LOST_REPLY'); } };
  const keyStore = { load: async () => key && new Uint8Array(key), save: async (_scope: unknown, bytes: Uint8Array) => { if (key) throw Error('no overwrite'); artifactOrder.push('protected-key'); key = new Uint8Array(bytes); } };
  const createChunkStore = (verifyManifest: any, beforeCommit: () => void) => {
    const store = createCipherChunkStore({ directory, scope, verifyManifest, hooks: { beforeCommit } });
    return { ...store, stage: async (...args: any[]) => { stages++; return store.stage(...args); } };
  };
  const options = { directory, ...scope, deviceId, keyStore, workspaceStore: store, rawStore: store, activationGate: gate, createChunkStore,
    withFreshEnrollment: async (guard: () => void, action: () => Promise<unknown>) => { guard(); if (!gate()) throw Error('disabled'); artifactOrder.push('protected-intent-marker'); fresh = true; try { const result = await action(); guard(); return result; } finally { fresh = false; } } };
  const host = createStructuredEncryptionHost(options);
  async function prepare() {
    const recovery = await host.prepareMigration(bundle); await host.verifyRecovery(recovery.recoveryCode);
    const challenge = await host.createDeviceChallenge('fictional-computer-B');
    const master = await recoverMasterKey(recovery.recoveryCode, recovery.wrappedKey, scope.appId, scope.vaultId, 1);
    try { await host.verifyDeviceResponse(challenge.deviceId, await answerEnrollmentChallenge(master, challenge)); } finally { master.fill(0); }
    return recovery;
  }
  return { host, bundle, options, store, aux, artifactOrder, prepare, commits: () => commits, stages: () => stages, saved: () => saved, lose: () => { failReply = true; }, found: () => { failReply = false; } };
}
describe('structured native host', () => {
  it('performs the real proof ceremony, stores immutable objects and saves only changed rows', async () => {
    const f = await fixture(); await f.prepare(); expect(await f.host.completeMigration(f.bundle)).toEqual({ revision: 1 });
    expect(f.artifactOrder[0]).toBe('protected-intent-marker'); expect(f.artifactOrder).toContain('protected-key');
    expect((await f.host.read()).snapshot).toEqual({ ...f.bundle, recovery: { ...f.bundle.recovery, backups: [] } }); expect(await f.host.listBackups()).toEqual(f.bundle.recovery.backups.map(({ json: _json, ...meta }) => meta)); expect(f.saved().ciphertext).not.toContain(f.bundle.primary.tables.students[0].firstName);
    const before = f.stages(), row = { ...f.bundle.primary.tables.students[0], firstName: 'Fictional corrected name' };
    expect(await f.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: row.id, value: row }])).toEqual({ revision: 2 });
    expect(f.stages() - before).toBeLessThanOrEqual(2); expect((await f.host.read()).snapshot.primary.tables.students.find((s: any) => s.id === row.id).firstName).toBe(row.firstName);
    f.host.lock(); await f.host.unlock(); expect((await f.host.read()).revision).toBe(2); expect(f.commits()).toBe(2);
  }, 30000);
  it('preserves the original input and refuses stale source, missing proof, wrong revision and invalid records', async () => {
    const f = await fixture(); await expect(f.host.completeMigration(f.bundle)).rejects.toThrow(); await f.prepare();
    const changed = structuredClone(f.bundle); changed.primary.tables.students[0].firstName = 'Changed during setup'; await expect(f.host.completeMigration(changed)).rejects.toThrow(); expect(f.commits()).toBe(0);
    f.host.lock(); await f.prepare(); await f.host.completeMigration(f.bundle);
    await expect(f.host.commitDelta(0, [])).rejects.toThrow();
    await expect(f.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: 'missing', value: { id: 'wrong' } }])).rejects.toThrow(); expect(f.commits()).toBe(1);
    expect(f.bundle.primary.tables.students[0].firstName).not.toBe('Changed during setup');
  }, 30000);
  it('keeps OS access and writes disabled through the default activation gate, including existing vaults', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); f.host.lock();
    const disabled = createStructuredEncryptionHost({ ...f.options, activationGate: undefined });
    await expect(disabled.unlock()).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(f.commits()).toBe(1);
  }, 30000);
  it('locks uncertain commits and reopens actual durable bytes instead of replaying', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); f.lose();
    await expect(f.host.commitDelta(1, [{ namespace: 'storage', key: 'student-organizer-appearance', value: 'dark' }])).rejects.toThrow(); expect(f.host.status().state).toBe('locked'); expect(f.commits()).toBe(2);
    f.found(); await f.host.unlock(); expect((await f.host.read()).snapshot.applicationStorage).toEqual({ 'student-organizer-appearance': 'dark' }); expect(f.commits()).toBe(2);
  }, 30000);
  it('authenticates the recovery wrapper against the encrypted root and cannot revive transfer tickets', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); const ticket = f.host.captureTransferContext();
    f.host.invalidateTransferContext(); await expect(f.host.assertTransferContext(ticket)).rejects.toThrow(); f.host.lock();
    f.aux.set('recovery-wrapper', 'corrupt-wrapper'); await expect(f.host.unlock()).rejects.toThrow(); expect(f.host.status().state).toBe('locked');
  }, 30000);
  it('keeps backup bodies out of startup views and restores with a reversible whole-workspace safety root', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle);
    expect((await f.host.read()).snapshot.recovery.backups).toEqual([]);
    const created = await f.host.createBackup('manual', 1); expect(created.revision).toBe(2); expect(created.backup.reason).toBe('manual');
    expect((await f.host.listBackups()).length).toBe(2); const skipped = await f.host.createBackup('automatic', 2); expect(skipped).toEqual({ revision: 2, backup: null });
    const beforeRestore = await f.host.read(), row = { ...beforeRestore.snapshot.primary.tables.students[0], firstName: 'Fictional restore target' };
    const replacement = structuredClone(beforeRestore.snapshot); replacement.primary.tables.students[0] = row;
    await expect(f.host.commitDelta(2, [{ namespace: 'metadata', key: 'internal-safety/forged', value: {} }])).rejects.toThrow();
    expect(await f.host.restoreBundle(2, replacement, { preserveHistory: true })).toEqual({ revision: 3 });
    const safety = (await f.host.listBackups()).find((item: any) => item.id.startsWith('workspace/')); expect(safety.reason).toBe('before-restore');
    const preview = await f.host.previewStoredBackup(safety.id, 'user-tyler'); expect(preview.snapshot.primary.tables.students).toEqual(beforeRestore.snapshot.primary.tables.students);
    expect(await f.host.restoreCheckpoint(3, preview.historicalCheckpoint)).toEqual({ revision: 4 });
    expect((await f.host.read()).snapshot.primary.tables.students).toEqual(beforeRestore.snapshot.primary.tables.students);
    f.host.lock(); await f.host.unlock(); expect((await f.host.read()).revision).toBe(4); expect((await f.host.listBackups()).filter((item: any) => !item.id.startsWith('workspace/'))).toHaveLength(2);
  }, 30000);
  it('exports the complete pinned-root graph and imports a verified first copy without adopting the source local clock', async () => {
    const a = await fixture(), b = await fixture(() => true, 'fictional-computer-B'); const recovery = await a.prepare();
    const challenge = await a.host.createDeviceChallenge('fictional-computer-B'), response = await b.host.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, challenge); await a.host.verifyDeviceResponse(response.deviceId, response.ciphertext); await a.host.completeMigration(a.bundle);
    const row = { ...a.bundle.primary.tables.students[0], firstName: 'Fictional source computer edit' }; await a.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: row.id, value: row }]); await a.host.createBackup('manual', 2);
    const frames: Uint8Array[] = []; expect(await a.host.exportArchive(async (bytes: Uint8Array) => { frames.push(new Uint8Array(bytes)); }, 'user-tyler')).toMatchObject({ revision: 3 });
    const archive = Buffer.concat(frames); expect(archive.toString()).not.toContain('Fictional source computer edit');
    async function* read() { for (let at = 0; at < archive.length; at += 65536) yield archive.subarray(at, at + 65536); }
    const preview = await b.host.previewArchive(read(), undefined, true); expect(preview.operators.some((user: any) => user.id === 'user-tyler')).toBe(true); expect(b.commits()).toBe(0);
    await expect(b.host.applyArchive(preview.handle, null, 'user-tyler')).rejects.toThrow(); // operator choice is separate
    await b.host.authorizeArchive(preview.handle, 'user-tyler'); expect(await b.host.applyArchive(preview.handle, null, 'user-tyler')).toEqual({ revision: 1 });
    expect((await b.host.read()).snapshot.primary.tables.students.find((s: any) => s.id === row.id).firstName).toBe(row.firstName); expect((await b.host.listBackups()).length).toBe(2);
    b.host.lock(); await b.host.unlock(); expect((await b.host.read()).revision).toBe(1); expect(b.bundle.primary.tables.students[0].firstName).not.toBe(row.firstName);
  }, 60000);
});
