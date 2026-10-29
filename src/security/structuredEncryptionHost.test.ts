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
const dirs: string[] = [], dbs: OntarioTeacherDB[] = [], hosts: { lock(): void }[] = [];
// Each workflow uses real WAL/FULL SQLite publication and actual recovery-code
// derivation. Windows CI virtual-disk fsync and parallel suites need a bounded
// allowance beyond Vitest's ordinary 30-second UI/unit-test window.
const NATIVE_WORKFLOW_TIMEOUT = 120000, ARCHIVE_WORKFLOW_TIMEOUT = 180000;
beforeAll(() => { execFileSync(process.execPath, ['scripts/buildEncryptionNative.cjs']); ({ createStructuredEncryptionHost } = require('../../electron/structuredEncryptionHost.cjs')); ({ createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs')); });
afterEach(async () => {
  for (const host of hosts.splice(0)) host.lock();
  for (const db of dbs.splice(0)) await db.delete();
  // Retry only removal of this test's generated temporary directory, never an
  // uncertain encrypted write. Exhausted cleanup still fails the test.
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function focusedHostSnapshot(full: any) {
  // Host protocol coverage needs a valid owner graph, a changed student, an
  // unchanged student and retained history. Encrypting the entire classroom
  // demo here caused hundreds of unrelated WAL/FULL fsyncs per fixture on CI.
  // Keep every canonical table and real validators; large payload/graph tests
  // remain in the structured-workspace and archive suites.
  const students=full.tables.students.slice(0,2),user=full.tables.users.find((row:any)=>row.id==='user-tyler');
  expect(students).toHaveLength(2);expect(user).toBeDefined();
  const memberships=full.tables.organizationMemberships.filter((row:any)=>row.userId===user.id&&students.some((student:any)=>student.organizationId===row.organizationId));
  expect(memberships).toHaveLength(1);
  const organizationIds=new Set<string>(students.map((row:any)=>row.organizationId));
  for(const membership of memberships)organizationIds.add(membership.organizationId);
  for(const id of organizationIds){const organization=full.tables.organizations.find((row:any)=>row.id===id);expect(organization).toBeDefined();if(organization.parentOrganizationId)organizationIds.add(organization.parentOrganizationId);}
  const tables:Record<string,any[]>=Object.fromEntries(Object.keys(full.tables).map(name=>[name,[]]));
  tables.organizations=full.tables.organizations.filter((row:any)=>organizationIds.has(row.id));tables.users=[user];tables.organizationMemberships=memberships;tables.students=students;
  return{...full,tables};
}
async function fixture(gate = () => true, deviceId = 'fictional-computer-A', extraOptions: any = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-structured-host-')); dirs.push(directory);
  const db = new OntarioTeacherDB('fictional-structured-host-' + crypto.randomUUID()); dbs.push(db); await seedDatabase(db);
  const primary = focusedHostSnapshot(JSON.parse(await new PortabilityService(db).createFullBackupJSON()));
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
    withFreshEnrollment: async (guard: () => void, action: () => Promise<unknown>) => { guard(); if (!gate()) throw Error('disabled'); artifactOrder.push('protected-intent-marker'); fresh = true; try { const result = await action(); guard(); return result; } finally { fresh = false; } }, ...extraOptions };
  const host = createStructuredEncryptionHost(options);
  hosts.push(host);
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
    expect(f.stages()).toBeLessThanOrEqual(24); // Bound synthetic setup work, not production fsync durability.
    const before = f.stages(), row = { ...f.bundle.primary.tables.students[0], firstName: 'Fictional corrected name' };
    expect(await f.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: row.id, value: row }])).toEqual({ revision: 2 });
    expect(f.stages() - before).toBeLessThanOrEqual(2); expect((await f.host.read()).snapshot.primary.tables.students.find((s: any) => s.id === row.id).firstName).toBe(row.firstName);
    expect((await f.host.read()).snapshot.primary.tables.students[1]).toEqual(f.bundle.primary.tables.students[1]);
    f.host.lock(); await f.host.unlock(); expect((await f.host.read()).revision).toBe(2); expect(f.commits()).toBe(2);
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('preserves the original input and refuses stale source, missing proof, wrong revision and invalid records', async () => {
    const f = await fixture(); await expect(f.host.completeMigration(f.bundle)).rejects.toThrow(); await f.prepare();
    const changed = structuredClone(f.bundle); changed.primary.tables.students[0].firstName = 'Changed during setup'; await expect(f.host.completeMigration(changed)).rejects.toThrow(); expect(f.commits()).toBe(0);
    f.host.lock(); await f.prepare(); await f.host.completeMigration(f.bundle);
    await expect(f.host.commitDelta(0, [])).rejects.toThrow();
    await expect(f.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: 'missing', value: { id: 'wrong' } }])).rejects.toThrow(); expect(f.commits()).toBe(1);
    expect(f.bundle.primary.tables.students[0].firstName).not.toBe('Changed during setup');
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('keeps OS access and writes disabled through the default activation gate, including existing vaults', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); f.host.lock();
    const disabled = createStructuredEncryptionHost({ ...f.options, activationGate: undefined });
    await expect(disabled.unlock()).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(f.commits()).toBe(1);
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('locks uncertain commits and reopens actual durable bytes instead of replaying', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); f.lose();
    await expect(f.host.commitDelta(1, [{ namespace: 'storage', key: 'student-organizer-appearance', value: 'dark' }])).rejects.toThrow(); expect(f.host.status().state).toBe('locked'); expect(f.commits()).toBe(2);
    f.found(); await f.host.unlock(); expect((await f.host.read()).snapshot.applicationStorage).toEqual({ 'student-organizer-appearance': 'dark' }); expect(f.commits()).toBe(2);
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('authenticates the recovery wrapper against the encrypted root and cannot revive transfer tickets', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); const ticket = f.host.captureTransferContext();
    f.host.invalidateTransferContext(); await expect(f.host.assertTransferContext(ticket)).rejects.toThrow(); f.host.lock();
    f.aux.set('recovery-wrapper', 'corrupt-wrapper'); await expect(f.host.unlock()).rejects.toThrow(); expect(f.host.status().state).toBe('locked');
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('rejects oversized conversion before any native marker or key artifact', async () => {
    const f = await fixture(() => true, 'fictional-computer-A', { startupLimits: { maxAllBytes: 1 } }); await f.prepare();
    await expect(f.host.completeMigration(f.bundle)).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' }); expect(f.commits()).toBe(0); expect(f.artifactOrder).toEqual([]); expect(f.saved()).toBeNull();
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('rejects oversized edits, snapshots and safety restores before replacing a readable root', async () => {
    const f = await fixture(); await f.prepare(); await f.host.completeMigration(f.bundle); f.host.lock();
    const { recordsFromBundle } = require('../../electron/studentOrganizerRecords.cjs'), { preflightStartupRecords } = require('../../electron/startupBudget.cjs');
    const selected = [...recordsFromBundle(f.bundle)].filter((row: any) => row.table !== 'backup-content'), budget = preflightStartupRecords(selected), limits = { maxAllBytes: budget + 500 };
    const limited = createStructuredEncryptionHost({ ...f.options, startupLimits: limits }); hosts.push(limited); await limited.unlock(); const original = await limited.read(), stages = f.stages();
    await expect(limited.commitDelta(1, [{ namespace: 'storage', key: 'ota.bug-report-draft.v1', value: 'Fictional private draft '.repeat(100) }])).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' });
    await expect(limited.createBackup('manual', 1)).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' });
    await expect(limited.restoreBundle(1, original.snapshot, { preserveHistory: true })).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' });
    expect(f.stages()).toBe(stages);
    const archive: Uint8Array[] = []; await limited.exportArchive(async (part: Uint8Array) => archive.push(new Uint8Array(part)), 'user-tyler'); const bytes = Buffer.concat(archive);
    async function* read() { for (let at = 0; at < bytes.length; at += 65536) yield bytes.subarray(at, at + 65536); }
    const reviewed = await limited.previewArchive(read(), 'user-tyler', false), afterPreview = f.stages(); await expect(limited.applyArchive(reviewed.handle, 1, 'user-tyler')).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' });
    // Archive preview may authenticate/stage duplicate ciphertext; no current
    // root or new changed-row object is published by any rejected action.
    expect(f.commits()).toBe(1); expect(f.stages()).toBe(afterPreview); expect((await limited.read()).snapshot).toEqual(original.snapshot);
    const currentRoot = structuredClone(f.saved()); await expect(limited.restoreCheckpoint(1, currentRoot, 'user-tyler')).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' });
    await limited.unlock(); expect((await limited.read()).revision).toBe(1); expect(f.commits()).toBe(1);
  }, ARCHIVE_WORKFLOW_TIMEOUT);
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
    expect(await f.host.restoreCheckpoint(3, preview.historicalCheckpoint, 'user-tyler')).toEqual({ revision: 4 });
    expect((await f.host.read()).snapshot.primary.tables.students).toEqual(beforeRestore.snapshot.primary.tables.students);
    f.host.lock(); await f.host.unlock(); expect((await f.host.read()).revision).toBe(4); expect((await f.host.listBackups()).filter((item: any) => !item.id.startsWith('workspace/'))).toHaveLength(2);
  }, NATIVE_WORKFLOW_TIMEOUT);
  it('exports the complete pinned-root graph and imports a verified first copy without adopting the source local clock', async () => {
    const a = await fixture(), b = await fixture(() => true, 'fictional-computer-B'); const recovery = await a.prepare();
    const challenge = await a.host.createDeviceChallenge('fictional-computer-B'), response = await b.host.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, challenge); await a.host.verifyDeviceResponse(response.deviceId, response.ciphertext); await a.host.completeMigration(a.bundle);
    const row = { ...a.bundle.primary.tables.students[0], firstName: 'Fictional source computer edit' }; await a.host.commitDelta(1, [{ namespace: 'primary', table: 'students', key: row.id, value: row }]); await a.host.createBackup('manual', 2);
    const frames: Uint8Array[] = []; expect(await a.host.exportArchive(async (bytes: Uint8Array) => { frames.push(new Uint8Array(bytes)); }, 'user-tyler')).toMatchObject({ revision: 3 });
    const archive = Buffer.concat(frames); expect(archive.toString()).not.toContain('Fictional source computer edit');
    async function* read() { for (let at = 0; at < archive.length; at += 65536) yield archive.subarray(at, at + 65536); }
    const { prepareOfflineRecovery, offlineProofDetails, copyOfflineRecoveryGraph } = require('../../electron/offlineRecovery.cjs');
    const proof = await prepareOfflineRecovery({ code: recovery.recoveryCode, read: read(), assertCurrent: () => {}, createPrivateChunkStore: (scope: any, verifyManifest: any, beforeCommit: any) => createCipherChunkStore({ directory: path.join(b.options.directory, 'private-proof'), scope, verifyManifest, hooks: { beforeCommit } }) });
    for (const actor of [undefined, null, '', 'user-tyler', 'wrong-owner']) { expect(() => proof.assertAuthorized(actor)).toThrow(); expect(() => offlineProofDetails(proof, actor)).toThrow(); }
    let copied = false; await expect(copyOfflineRecoveryGraph(proof, undefined, { createChunkStore: () => { copied = true; }, assertCurrent: () => {} })).rejects.toThrow(); expect(copied).toBe(false);
    await proof.authorize('user-tyler'); expect(() => proof.assertAuthorized('user-tyler')).not.toThrow(); for (const actor of [undefined, null, '', 'wrong-owner']) expect(() => proof.assertAuthorized(actor)).toThrow();
    const tiny = createStructuredEncryptionHost({ ...b.options, startupLimits: { maxAllBytes: 1 } }); hosts.push(tiny); const artifacts = b.artifactOrder.length;
    await expect(tiny.applyOfflineRecovery(proof, 'user-tyler')).rejects.toMatchObject({ code: 'ENCRYPTION_CAPACITY_LIMIT' }); expect(b.commits()).toBe(0); expect(b.artifactOrder.length).toBe(artifacts);
    proof.close(); expect(() => proof.assertAuthorized('user-tyler')).toThrow();
    const preview = await b.host.previewArchive(read(), undefined, true); expect(preview.operators.some((user: any) => user.id === 'user-tyler')).toBe(true); expect(b.commits()).toBe(0);
    await expect(b.host.applyArchive(preview.handle, null, 'user-tyler')).rejects.toThrow(); // operator choice is separate
    await b.host.authorizeArchive(preview.handle, 'user-tyler'); expect(await b.host.applyArchive(preview.handle, null, 'user-tyler')).toEqual({ revision: 1 });
    expect((await b.host.read()).snapshot.primary.tables.students.find((s: any) => s.id === row.id).firstName).toBe(row.firstName); expect((await b.host.listBackups()).length).toBe(2);
    b.host.lock(); await b.host.unlock(); expect((await b.host.read()).revision).toBe(1); expect(b.bundle.primary.tables.students[0].firstName).not.toBe(row.firstName);
  }, ARCHIVE_WORKFLOW_TIMEOUT);
});
