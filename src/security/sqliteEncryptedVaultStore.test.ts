import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { encryptBytes, parseEnvelope } from '../../shared/encryption';
const require = createRequire(import.meta.url), exec = promisify(execFile);
const { createSqliteEncryptedVaultStore, inspectSqliteVaultDescriptor } = require('../../electron/sqliteEncryptedVaultStore.cjs');
const { DatabaseSync } = require('node:sqlite');
const directories: string[] = [];
const scope = { appId: 'student-organizer', vaultId: 'synthetic-sqlite-vault', keyVersion: 1 };
const key = new Uint8Array(32).fill(13);
beforeAll(() => execFileSync(process.execPath, ['scripts/buildEncryptionNative.cjs']));
async function cipher(revision: number, patch = {}) { return { revision, ciphertext: await encryptBytes(key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision, ...patch }, new TextEncoder().encode('FICTIONAL_PLAINTEXT_CANARY')) }; }
async function fixture(options = {}) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-sqlite-vault-')); directories.push(directory); return { directory, store: createSqliteEncryptedVaultStore({ directory, scope, parseEnvelope, ...options }) }; }
afterEach(async () => { for (const d of directories.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
describe('ciphertext-only SQLite CAS provider prototype', () => {
  it('reopens committed revisions with WAL/FULL and never stores the plaintext canary', async () => {
    const { directory, store } = await fixture(); expect(await store.read()).toBeNull(); const first = await cipher(1); await store.commit(null, first); expect(await store.read()).toEqual(first); await store.commit(1, await cipher(2)); expect((await store.read()).revision).toBe(2);
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite')); expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    for (const filename of await fs.readdir(directory)) expect((await fs.readFile(path.join(directory, filename))).includes(Buffer.from('FICTIONAL_PLAINTEXT_CANARY'))).toBe(false); db.close();
  });
  it('uses a bounded exclusive transaction so independent processes cannot both commit the same expected revision', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await cipher(1)); const next = await cipher(2), modulePath = path.resolve('electron/sqliteEncryptedVaultStore.cjs');
    const script = "const{createSqliteEncryptedVaultStore}=require(process.argv[1]);const d=JSON.parse(process.argv[2]);createSqliteEncryptedVaultStore({directory:d.directory,scope:d.scope}).commit(1,d.next).then(()=>console.log('COMMITTED')).catch(e=>console.log(e.code));";
    const args = ['-e', script, modulePath, JSON.stringify({ directory, scope, next })];
    const result = await Promise.all([exec(process.execPath, args), exec(process.execPath, args)]); expect(result.filter(r => r.stdout.includes('COMMITTED'))).toHaveLength(1); expect((await store.read()).revision).toBe(2);
  });
  it('rolls back a failure before COMMIT and acknowledges no write', async () => {
    const { directory, store } = await fixture(); const first = await cipher(1); await store.commit(null, first);
    const failed = createSqliteEncryptedVaultStore({ directory, scope, parseEnvelope, hooks: { beforeCommit: () => { throw new Error('PRIVATE_FAILED_WRITE'); } } }); await expect(failed.commit(1, await cipher(2))).rejects.toThrow(); expect(await store.read()).toEqual(first);
  });
  it('retains a valid empty provider after an interrupted initial checkpoint and permits a deliberate fresh migration', async () => {
    const { directory, store } = await fixture();
    const failed = createSqliteEncryptedVaultStore({ directory, scope, parseEnvelope, hooks: { beforeCommit: () => { throw new Error('INITIAL_WRITE_INTERRUPTED'); } } });
    await expect(failed.commit(null, await cipher(1))).rejects.toThrow(); expect(await store.read()).toBeNull();
    await store.commit(null, await cipher(1)); expect((await store.read()).revision).toBe(1);
  });
  it('reports a committed write with a lost acknowledgement as uncertain and requires reopening actual revision', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await cipher(1));
    const failed = createSqliteEncryptedVaultStore({ directory, scope, parseEnvelope, hooks: { afterCommit: () => { throw new Error('PRIVATE_LOST_REPLY'); } } }); await expect(failed.commit(1, await cipher(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' }); expect((await store.read()).revision).toBe(2); await expect(store.commit(1, await cipher(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_STALE' });
  });
  it('rejects a mode that cannot establish WAL/FULL before mutating checkpoint data', async () => {
    const { directory, store } = await fixture(); const first = await cipher(1); await store.commit(null, first); const db = new DatabaseSync(path.join(directory, 'workspace.sqlite')); db.exec('PRAGMA journal_mode=DELETE'); db.close(); await expect(store.read()).rejects.toThrow(); await expect(store.commit(1, await cipher(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_DURABILITY_UNAVAILABLE' });
  });
  it('rejects wrong scope, revision, unsupported labels and plaintext without creating storage', async () => {
    const { directory, store } = await fixture();
    for (const patch of [{ appId: 'servetrack' }, { vaultId: 'other' }, { keyVersion: 2 }, { purpose: 'backup' }, { recordId: 'other' }]) await expect(store.commit(null, await cipher(1, patch))).rejects.toThrow();
    for (const next of [{ revision: 1, ciphertext: 'FICTIONAL_PLAINTEXT_CANARY' }, await cipher(2), { ...await cipher(1), revision: '1' }]) await expect(store.commit(null, next)).rejects.toThrow(); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('rejects oversized rows and malformed schema or corrupt database files', async () => {
    const { directory, store } = await fixture({ maxBytes: 1024 }); await store.commit(null, await cipher(1));
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite')); db.prepare('UPDATE checkpoint SET ciphertext=?').run('x'.repeat(1025)); db.close(); await expect(store.read()).rejects.toThrow();
    await fs.writeFile(path.join(directory, 'workspace.sqlite'), 'CORRUPT_DATABASE'); await expect(store.read()).rejects.toThrow();
  });
  it('rejects extra SQL schema rather than executing triggers on write', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await cipher(1)); const db = new DatabaseSync(path.join(directory, 'workspace.sqlite')); db.exec('CREATE TABLE unexpected(value TEXT)'); db.close(); await expect(store.commit(1, await cipher(2))).rejects.toThrow();
  });
  it.skipIf(process.platform === 'win32')('rejects symlink database/sidecars and weak directory permissions', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await cipher(1)); await fs.chmod(directory, 0o755); await expect(store.read()).rejects.toThrow(); await fs.chmod(directory, 0o700);
    const file = path.join(directory, 'workspace.sqlite'); await fs.rename(file, file + '.old'); await fs.symlink(file + '.old', file); await expect(store.read()).rejects.toThrow(); await fs.unlink(file); await fs.rename(file + '.old', file);
    await fs.symlink(file, file + '-wal'); await expect(store.read()).rejects.toThrow();
  });
  it('durably enrolls a discoverable public scope before any working-data commit, without treating metadata as authentication', async () => {
    const { directory, store } = await fixture(); await store.initialize(); expect(await store.read()).toBeNull();
    expect(inspectSqliteVaultDescriptor({ directory, expectedAppId: scope.appId })).toEqual({ ...scope, deviceId: 'unbound-device' });
    expect(() => inspectSqliteVaultDescriptor({ directory, expectedAppId: 'servetrack' })).toThrow();
  });
  it('atomically retains an encrypted safety snapshot with a restore, or rolls back both', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await cipher(1));
    const safety = { id: 'synthetic-safety', revision: 1, ciphertext: await encryptBytes(key, { ...scope, purpose: 'backup', recordId: 'safety/synthetic-safety', revision: 1 }, new TextEncoder().encode('FICTIONAL_PLAINTEXT_CANARY')) };
    const failed = createSqliteEncryptedVaultStore({ directory, scope, parseEnvelope, hooks: { beforeCommit: () => { throw new Error('INTERRUPTED_RESTORE'); } } });
    await expect(failed.commitWithSafety(1, await cipher(2), safety)).rejects.toThrow(); expect(await store.listSafety()).toEqual([]); expect((await store.read()).revision).toBe(1);
    await store.commitWithSafety(1, await cipher(2), safety); expect(await store.listSafety()).toEqual([{ id: safety.id, revision: 1 }]); expect((await store.read()).revision).toBe(2);
    await expect(store.commitWithSafety(2, await cipher(3), { ...safety, revision: 2 })).rejects.toThrow(); expect((await store.read()).revision).toBe(2);
    for (const filename of await fs.readdir(directory)) expect((await fs.readFile(path.join(directory, filename))).includes(Buffer.from('FICTIONAL_PLAINTEXT_CANARY'))).toBe(false);
  });
  it('keeps exact immutable encrypted candidates inactive until a matching-base publication', async () => {
    const { store } = await fixture(); const id = randomUUID(), first = await cipher(1); await store.stage(id, first); expect(await store.read()).toBeNull(); expect(await store.readStaged(id)).toEqual(first);
    await expect(store.stage(id, await cipher(1))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_STAGED_CONFLICT' }); await store.publish(id, null, first); expect(await store.current()).toEqual(first);
    const second = await cipher(2), nextId = randomUUID(); await store.stage(nextId, second);
    await expect(store.publish(nextId, { revision: 1, hash: '0'.repeat(64) }, second)).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_STALE' });
    await store.publish(nextId, { revision: 1, hash: createHash('sha256').update(first.ciphertext).digest('hex') }, second); expect(await store.read()).toEqual(second);
  });
  it('reconciles exact staged SQLite bytes against an independent protected ledger and rejects application-file rollback', async () => {
    const { createSqliteProtectedKeyStore } = require('../../electron/sqliteProtectedKeyStore.cjs'), { createProtectedRevisionLedger } = require('../../electron/protectedRevisionLedger.cjs'), { createPendingEncryptedCommit } = require('../../electron/pendingEncryptedCommit.cjs');
    const { directory, store } = await fixture(); const profile = createSqliteProtectedKeyStore({ directory, scope }); let protectedState: Buffer | null = null;
    const ledger = createProtectedRevisionLedger({ scope, platform: 'win32', assertProfileLease: profile.assertProfileLease, loadWindowsBinding: () => ({ read: () => protectedState && Buffer.from(protectedState), write: (_name: string, bytes: Buffer) => { protectedState = Buffer.from(bytes); } }) });
    const coordinator = createPendingEncryptedCommit({ scope, ledger, candidates: store, withExclusiveProfileLock: profile.withExclusiveProfileLock });
    const first = await coordinator.commit(null, await cipher(1)); expect(first.status).toBe('durable');
    const originalFile = await fs.readFile(path.join(directory, 'workspace.sqlite'));
    expect((await coordinator.commit(first.head, await cipher(2))).status).toBe('durable');
    await fs.writeFile(path.join(directory, 'workspace.sqlite'), originalFile); expect((await store.read()).revision).toBe(1); expect((await coordinator.reconcile()).status).toBe('uncertain');
  });
  it('persists only context-bound existing recovery wrappers and opaque enrollment responses', async () => {
    const { store } = await fixture(); const wrapper = await encryptBytes(key, { ...scope, purpose: 'recovery-key', recordId: 'master-key', revision: 0 }, key);
    await store.saveAux('recovery-wrapper', wrapper); expect(await store.readAux('recovery-wrapper')).toBe(wrapper);
    const response = { deviceId: 'unbound-device', ciphertext: await encryptBytes(key, { ...scope, purpose: 'transfer', recordId: 'enrollment/unbound-device/' + randomUUID() + '/response', revision: 0 }, new Uint8Array(32)) };
    await store.saveAux('enrollment-response', JSON.stringify(response)); expect(JSON.parse(await store.readAux('enrollment-response'))).toEqual(response);
    await expect(store.saveAux('recovery-wrapper', 'RECOVERY_CODE_OR_PLAINTEXT')).rejects.toThrow(); await expect(store.saveAux('unknown', wrapper)).rejects.toThrow();
  });
  it('fails closed when a native SQLite binding is unavailable', async () => {
    const directory = path.join(os.tmpdir(), 'fictional-uncreated-sqlite-vault'); expect(() => createSqliteEncryptedVaultStore({ directory, scope, DatabaseSync: {}, parseEnvelope })).toThrow();
  });
});
