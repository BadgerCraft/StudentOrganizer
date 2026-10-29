import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encryptBytes, generateMasterKey } from '../../shared/encryption/index';
const require = createRequire(import.meta.url), { createNativeEncryptionRuntime } = require('../../electron/encryptionNativeRuntime.cjs');
const { createSqliteEncryptedVaultStore } = require('../../electron/sqliteEncryptedVaultStore.cjs');
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
async function fixture(initialGate = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-native-assembly-')); dirs.push(directory);
  let gate = initialGate, calls = 0, options: any, holding: any = null, markerUnreadable = false, markerWriteUncertain = false; const keys = new Map<string, Uint8Array>(), receipts = new Map<string, number[]>();
  const createProvider = ({ withExclusiveProfileLock }: any) => ({ available: async () => true,
    load: (scope: any) => withExclusiveProfileLock(async () => { calls++; const key = keys.get(JSON.stringify(scope)); return key ? new Uint8Array(key) : null; }),
    save: (scope: any, key: Uint8Array) => withExclusiveProfileLock(async () => { calls++; const id = JSON.stringify(scope); if (keys.has(id)) throw Error('exists'); keys.set(id, new Uint8Array(key)); }) });
  class AsyncEntry { id: string; constructor(service: string, account: string) { this.id = service + '/' + account; } async getSecret() { if (markerUnreadable && this.id.startsWith('TeacherVaultApplicationProtectionV1/')) throw Error('SYNTHETIC_OS_UNAVAILABLE'); const r = receipts.get(this.id); return r ? [...r] : null; } async setSecret(bytes: Uint8Array) { receipts.set(this.id, [...bytes]); if (markerWriteUncertain && this.id.startsWith('TeacherVaultApplicationProtectionV1/')) { markerWriteUncertain = false; throw Error('SYNTHETIC_MARKER_REPLY_LOST'); } } }
  const config = { directory, platform: 'darwin', activationGate: () => gate,
    createStore: (input: any) => { const raw = createSqliteEncryptedVaultStore(input); return { ...raw, read: async () => { const value = await raw.read(); if (holding) { const wait = holding; holding = null; wait.entered(); await wait.gate; } return value; } }; },
    profileOptions: { createProvider }, loadMacBinding: () => ({ AsyncEntry }),
    createHost: (o: any) => { options = o; return { lock() {}, status: () => ({ state: 'locked' }) }; } };
  const runtime = await createNativeEncryptionRuntime(config);
  return { directory, runtime, config, receipts, failMarkerRead: () => { markerUnreadable = true; }, failMarkerWrite: () => { markerWriteUncertain = true; }, holdNextRead: () => { let entered!: () => void, release!: () => void; const enteredPromise = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; }); holding = { entered, gate }; return { entered: enteredPromise, release }; }, options: () => options, calls: () => calls, setGate: (v: boolean) => { gate = v; } };
}
describe('native profile and protected-storage assembly', () => {
  it('keeps fresh legacy preparation free from persistent artifacts and native key queries', async () => {
    const f = await fixture(); expect(f.runtime.status().mode).toBe('legacy'); expect(f.runtime.status().activationReady).toBe(false);
    expect(f.runtime.getHost(false)).toBeNull(); f.runtime.getHost(); expect(await f.options().workspaceStore.read()).toBeNull();
    expect(await fs.readdir(f.directory)).toEqual([]); expect(f.calls()).toBe(0); f.runtime.close();
  });
  it('requires the activation gate before enrolling even under a synthetic preparation capability', async () => {
    const f = await fixture(); f.runtime.getHost();
    await expect(f.options().withFreshEnrollment(() => {}, async () => {})).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' });
    expect(await fs.readdir(f.directory)).toEqual([]); f.runtime.close();
  });
  it('commits real ciphertext through SQLite candidates and an independent synthetic OS head, then reopens', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options(), scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    const cipher = await encryptBytes(key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision: 1 }, new TextEncoder().encode('SYNTHETIC_PRIVATE_CANARY'));
    await o.withFreshEnrollment(() => {}, async () => { await o.keyStore.save(scope, key); await o.workspaceStore.initialize(); await o.workspaceStore.commit(null, { revision: 1, ciphertext: cipher }); });
    expect((await f.runtime.refreshMode()).mode).toBe('encrypted'); f.runtime.getHost(); expect((await f.options().workspaceStore.read()).ciphertext).toBe(cipher);
    f.runtime.close(); const reopened = await createNativeEncryptionRuntime(f.config); expect(reopened.status().mode).toBe('encrypted'); reopened.getHost(); expect((await f.options().workspaceStore.read()).revision).toBe(1); f.receipts.clear(); await expect(f.options().workspaceStore.read()).rejects.toThrow(); expect(reopened.status().mode).toBe('encrypted'); reopened.close(); key.fill(0);
    for (const sub of ['device-keys', 'working']) for (const file of await fs.readdir(path.join(f.directory, sub))) expect((await fs.readFile(path.join(f.directory, sub, file))).includes(Buffer.from('SYNTHETIC_PRIVATE_CANARY'))).toBe(false);
  });
  it('locks corrupt protected artifacts instead of selecting the legacy workspace', async () => {
    const f = await fixture(); await fs.mkdir(path.join(f.directory, 'working'), { mode: 0o700 }); await fs.writeFile(path.join(f.directory, 'working', 'workspace.sqlite'), 'SYNTHETIC_CORRUPT', { mode: 0o600 });
    const status = await f.runtime.refreshMode(); expect(status.mode).toBe('encrypted'); expect(status.activationReady).toBe(false); expect(status.lockedReason).toBeTruthy(); expect(() => f.runtime.getHost()).toThrow(); f.runtime.close();
  });
  it('revokes a fresh-commit capability immediately when native lock is requested', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options();
    const scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    const ciphertext = await encryptBytes(key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision: 1 }, new Uint8Array([1, 2, 3]));
    await expect(o.withFreshEnrollment(() => {}, async () => { await o.workspaceStore.initialize(); f.runtime.lockNow(); await o.workspaceStore.commit(null, { revision: 1, ciphertext }); })).rejects.toThrow();
    expect(await o.rawStore.read()).toBeNull(); key.fill(0);
    f.runtime.close();
  });
  it('keeps initialized enrollment metadata pending until a verified checkpoint is published', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options(), scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    await o.withFreshEnrollment(() => {}, async () => { await o.keyStore.save(scope, key); await o.workspaceStore.initialize(); });
    expect((await f.runtime.refreshMode()).mode).toBe('enrollment-pending'); f.runtime.getHost(); await expect(f.options().workspaceStore.read()).rejects.toThrow();
    await f.runtime.cancelEnrollment(); expect(f.runtime.status().mode).toBe('legacy'); expect((await f.runtime.refreshMode()).mode).toBe('legacy');
    f.runtime.close(); const reopened = await createNativeEncryptionRuntime(f.config); expect(reopened.status().mode).toBe('enrollment-pending'); reopened.close(); key.fill(0);
  });

  it('cannot switch to legacy when a native lock occurs during cancellation inspection', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options(), scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    await o.withFreshEnrollment(() => {}, async () => { await o.keyStore.save(scope, key); await o.workspaceStore.initialize(); });
    expect((await f.runtime.refreshMode()).mode).toBe('enrollment-pending');
    const held = f.holdNextRead(), cancel = f.runtime.cancelEnrollment(); await held.entered; f.runtime.lockNow(); held.release();
    await expect(cancel).rejects.toThrow(); expect(f.runtime.status().mode).toBe('enrollment-pending'); expect((await f.runtime.refreshMode()).mode).toBe('enrollment-pending'); key.fill(0); f.runtime.close();
  });
  it.each([['chunks', 'chunks.sqlite'], ['chunks', 'chunks.sqlite-wal'], ['chunks', 'chunks.sqlite-shm'], ['chunks', 'chunks.sqlite-journal'], ['device-keys', 'profile-keys.sqlite-wal'], ['device-keys', 'profile-keys.sqlite-shm'], ['device-keys', 'profile-keys.sqlite-journal']])('locks orphaned protected marker %s/%s without choosing a new scope', async (folder, name) => {
    const f = await fixture(); await fs.mkdir(path.join(f.directory, folder), { mode: 0o700 }); await fs.writeFile(path.join(f.directory, folder, name), 'SYNTHETIC_ORPHAN', { mode: 0o600 });
    const status = await f.runtime.refreshMode(); expect(status.mode).toBe('encrypted'); expect(status.activationReady).toBe(false); expect(status.lockedReason).toBe('ENCRYPTION_CONTEXT_MISSING'); expect(() => f.runtime.getHost()).toThrow(); expect(f.calls()).toBe(0); f.runtime.close();
  });

  it('uses an independent per-app OS marker to keep startup locked after every app file is lost', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options();
    await o.withFreshEnrollment(() => {}, async () => {});
    expect([...f.receipts.keys()].some(id => id.startsWith('TeacherVaultApplicationProtectionV1/'))).toBe(true);
    await fs.rm(f.directory, { recursive: true, force: true });
    const status = await f.runtime.refreshMode(); expect(status.mode).toBe('encrypted'); expect(status.activationReady).toBe(false); expect(status.lockedReason).toBe('ENCRYPTION_CONTEXT_MISSING'); expect(() => f.runtime.getHost()).toThrow(); f.runtime.close();
  });
  it('fails configured startup closed when independent OS marker discovery is unavailable', async () => {
    const f = await fixture(true); f.failMarkerRead(); const status = await f.runtime.refreshMode();
    expect(status.mode).toBe('encrypted'); expect(status.activationReady).toBe(false); expect(status.lockedReason).toBe('APPLICATION_PROTECTION_UNCERTAIN'); expect(await fs.readdir(f.directory)).toEqual([]); f.runtime.close();
  });

  it('blocks the first protected artifact when the app marker write acknowledgement is uncertain', async () => {
    const f = await fixture(true); f.runtime.getHost(); f.failMarkerWrite(); let proceeded = false;
    await expect(f.options().withFreshEnrollment(() => {}, async () => { proceeded = true; await f.options().workspaceStore.initialize(); })).rejects.toThrow();
    expect(proceeded).toBe(false); expect(await fs.readdir(f.directory)).toEqual([]);
    expect((await f.runtime.refreshMode()).mode).toBe('encrypted'); expect(f.runtime.status().activationReady).toBe(false); f.runtime.close();
  });

  it('does not interpret an unavailable trusted activation policy as disabled legacy mode', async () => {
    const f = await fixture(); f.runtime.close();
    const unavailable = await createNativeEncryptionRuntime({ ...f.config, activationGate: () => { throw Error('SYNTHETIC_POLICY_UNAVAILABLE'); } });
    expect(unavailable.status().mode).toBe('encrypted'); expect(unavailable.status().activationReady).toBe(false); expect(unavailable.status().lockedReason).toBeTruthy(); expect(f.calls()).toBe(0); expect(await fs.readdir(f.directory)).toEqual([]); unavailable.close();
  });

});
