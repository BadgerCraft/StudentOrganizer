import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { answerEnrollmentChallenge } from './encryptedWorkspace';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encryptBytes, generateMasterKey, recoverMasterKey, generateRecoveryCode, wrapMasterKey } from '../../shared/encryption/index';
const require = createRequire(import.meta.url), { createNativeEncryptionRuntime } = require('../../electron/encryptionNativeRuntime.cjs');
const { createSqliteEncryptedVaultStore } = require('../../electron/sqliteEncryptedVaultStore.cjs');
const dirs: string[] = [];
// This suite must work alone on a clean checkout; never depend on another suite's build side effect.
beforeAll(() => { execFileSync(process.execPath, ['scripts/buildEncryptionNative.cjs'], { timeout: 30_000 }); }, 35_000);
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
async function fixture(initialGate = false, overrides: any = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-native-assembly-')); dirs.push(directory);
  let gate = initialGate, calls = 0, options: any, holding: any = null, markerUnreadable = false, markerWriteUncertain = false; const keys = new Map<string, Uint8Array>(), receipts = new Map<string, number[]>();
  const createProvider = ({ withExclusiveProfileLock }: any) => ({ available: async () => true,
    load: (scope: any) => withExclusiveProfileLock(async () => { calls++; const key = keys.get(JSON.stringify(scope)); return key ? new Uint8Array(key) : null; }),
    save: (scope: any, key: Uint8Array) => withExclusiveProfileLock(async () => { calls++; const id = JSON.stringify(scope); if (keys.has(id)) throw Error('exists'); keys.set(id, new Uint8Array(key)); }) });
  class AsyncEntry { id: string; constructor(service: string, account: string) { this.id = service + '/' + account; } async getSecret() { if (markerUnreadable && this.id.startsWith('TeacherVaultApplicationProtectionV1/')) throw Error('SYNTHETIC_OS_UNAVAILABLE'); const r = receipts.get(this.id); return r ? [...r] : null; } async setSecret(bytes: Uint8Array) { receipts.set(this.id, [...bytes]); if (markerWriteUncertain && this.id.startsWith('TeacherVaultApplicationProtectionV1/')) { markerWriteUncertain = false; throw Error('SYNTHETIC_MARKER_REPLY_LOST'); } } }
  const config = { directory, platform: 'darwin', activationGate: () => gate,
    createStore: (input: any) => { const raw = createSqliteEncryptedVaultStore(input); return { ...raw, read: async () => { const value = await raw.read(); if (holding) { const wait = holding; holding = null; wait.entered(); await wait.gate; } return value; } }; },
    profileOptions: { createProvider }, loadMacBinding: () => ({ AsyncEntry }),
    ...overrides, createHost: (o: any) => { options = o; return overrides.hostFactory ? overrides.hostFactory(o) : { lock() {}, status: () => ({ state: 'locked' }) }; } };
  const runtime = await createNativeEncryptionRuntime(config);
  return { directory, runtime, config, receipts, failMarkerRead: () => { markerUnreadable = true; }, failMarkerWrite: () => { markerWriteUncertain = true; }, holdNextRead: () => { let entered!: () => void, release!: () => void; const enteredPromise = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; }); holding = { entered, gate }; return { entered: enteredPromise, release }; }, options: () => options, calls: () => calls, setGate: (v: boolean) => { gate = v; } };
}
describe('native profile and protected-storage assembly', () => {
  it('keeps fresh legacy preparation free from persistent artifacts and native key queries', async () => {
    const f = await fixture(); expect(f.runtime.status().mode).toBe('legacy'); expect(f.runtime.status().activationReady).toBe(false);
    expect(f.runtime.getHost(false)).toBeNull(); f.runtime.getHost(); expect(await f.options().workspaceStore.read()).toBeNull(); expect(await f.options().workspaceStore.readForPreparation()).toEqual({ kind: 'fresh', checkpoint: null });
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

  it('enrolls an independent empty OS receipt before setup and uses it for explicit pending preparation', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options(), scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    await o.withFreshEnrollment(() => {}, async () => {
      const receipt = [...f.receipts].find(([id]) => id.startsWith('TeacherVaultLedgerV1/'));
      expect(receipt).toBeTruthy(); expect(JSON.parse(Buffer.from(receipt![1]).toString())).toMatchObject({ ...scope, head: null, pending: null }); expect(f.calls()).toBe(0);
      await o.keyStore.save(scope, key); await o.workspaceStore.initialize();
    });
    expect((await f.runtime.refreshMode()).mode).toBe('enrollment-pending');
    await expect(f.runtime.getHost() && f.options().workspaceStore.readForPreparation()).rejects.toThrow();
    await f.runtime.cancelEnrollment(); expect((await f.runtime.refreshMode()).mode).toBe('legacy'); f.runtime.getHost();
    expect(await f.options().workspaceStore.readForPreparation()).toEqual({ kind: 'pending', checkpoint: null });
    key.fill(0); f.runtime.close();
  });
  it('does not recreate a missing receipt after prior protected intent even if all files disappear mid-setup', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options();
    await o.withFreshEnrollment(() => {}, async () => {});
    await fs.rm(path.join(f.directory, 'device-keys'), { recursive: true, force: true });
    for (const id of f.receipts.keys()) if (id.startsWith('TeacherVaultLedgerV1/')) f.receipts.delete(id);
    let action = false; await expect(o.withFreshEnrollment(() => {}, async () => { action = true; })).rejects.toThrow();
    expect(action).toBe(false); expect([...f.receipts.keys()].some(id => id.startsWith('TeacherVaultLedgerV1/'))).toBe(false); expect(f.calls()).toBe(0); f.runtime.close();
  });
  it('does not treat missing OS receipt metadata as an empty resumable enrollment', async () => {
    const f = await fixture(true); f.runtime.getHost(); const o = f.options(), scope = { appId: 'student-organizer', vaultId: o.vaultId, keyVersion: o.keyVersion }, key = generateMasterKey();
    await o.withFreshEnrollment(() => {}, async () => { await o.keyStore.save(scope, key); await o.workspaceStore.initialize(); });
    for (const id of f.receipts.keys()) if (id.startsWith('TeacherVaultLedgerV1/')) f.receipts.delete(id);
    const status = await f.runtime.refreshMode(); expect(status.mode).toBe('encrypted'); expect(status.activationReady).toBe(false); expect(status.lockedReason).toBeTruthy();
    await expect(f.runtime.cancelEnrollment()).rejects.toThrow(); expect(() => f.runtime.getHost()).toThrow(); key.fill(0); f.runtime.close();
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

function offlineProofs() {
  const scope = Object.freeze({ appId: 'student-organizer', vaultId: 'fictional-offline-vault', keyVersion: 1 });
  const proofs: any[] = [];
  const prepareOfflineRecovery = async ({ code, read, assertCurrent }: any) => {
    if (code !== 'FICTIONAL-CODE') throw Error('synthetic invalid recovery code');
    for await (const frame of read) { assertCurrent(); if (frame[0] !== 1) throw Error('synthetic tamper'); }
    let closed = false, actor: string | null = null;
    const guard = () => { assertCurrent(); if (closed) throw Error('proof closed'); };
    const publicReview = () => { guard(); return { metadata: { exportedAt: '2026-10-29T00:00:00Z', tableCount: 1, totalRecords: 1 }, operators: [{ id: 'fictional-owner', name: 'Fictional Owner' }] }; };
    const proof = Object.freeze({ scope, publicReview, authorize: async (id: string) => { guard(); if (id !== 'fictional-owner') throw Error('operator'); actor = id; return publicReview(); },
      assertAuthorized: (id: string) => { guard(); if (actor !== id) throw Error('not authorized'); }, close: () => { closed = true; } });
    proofs.push({ proof, closed: () => closed }); return proof;
  };
  return { scope, prepareOfflineRecovery, proofs };
}
async function* fictionalArchive(value = 1) { yield new Uint8Array([value]); }
describe('fresh offline recovery runtime capability', () => {
  it('authenticates before scope adoption or key writes and revokes canceled/repeated/restarted proofs', async () => {
    const p = offlineProofs(), f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery });
    const originalVault = f.runtime.status().vaultId;
    await expect(f.runtime.prepareRecoveryFile('wrong', fictionalArchive())).rejects.toThrow();
    await expect(f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive(2))).rejects.toThrow();
    expect(f.calls()).toBe(0); expect(f.runtime.status().vaultId).toBe(originalVault);
    expect((await fs.readdir(f.directory)).filter(x => x !== 'recovery-staging')).toEqual([]);
    const first = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive());
    expect(first.operators[0].id).toBe('fictional-owner'); expect(first).not.toHaveProperty('key'); expect(f.runtime.status().vaultId).toBe(originalVault);
    await expect(f.runtime.applyOfflineRecovery(first.handle, 'fictional-owner')).rejects.toThrow(); // owner choice is a distinct step
    const second = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive());
    expect(p.proofs[0].closed()).toBe(true); await expect(f.runtime.authorizeOfflineRecovery(first.handle, 'fictional-owner')).rejects.toThrow();
    await f.runtime.authorizeOfflineRecovery(second.handle, 'fictional-owner'); f.runtime.cancelOfflineRecovery();
    expect(p.proofs[1].closed()).toBe(true); await expect(f.runtime.applyOfflineRecovery(second.handle, 'fictional-owner')).rejects.toThrow();
    const third = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive());
    await f.runtime.authorizeOfflineRecovery(third.handle, 'fictional-owner'); await f.runtime.refreshMode();
    expect(p.proofs[2].closed()).toBe(true); await expect(f.runtime.applyOfflineRecovery(third.handle, 'fictional-owner')).rejects.toThrow();
    expect(f.calls()).toBe(0); expect((await f.runtime.refreshMode()).mode).toBe('legacy'); f.runtime.close();
  });
  it('binds explicit owner confirmation to the private proof and publishes local revision one', async () => {
    const p = offlineProofs(), key = generateMasterKey();
    const f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery, hostFactory: (o: any) => ({ lock() {}, status: () => ({ state: 'locked' }),
      applyOfflineRecovery: async (proof: any, actor: string) => {
        const current = () => proof.assertAuthorized(actor); current();
        await o.withFreshEnrollment(current, async () => { await o.keyStore.save(p.scope, key); current(); await o.workspaceStore.initialize(); current();
          const ciphertext = await encryptBytes(key, { ...p.scope, purpose: 'working-data', recordId: 'workspace', revision: 1 }, new Uint8Array([8, 9])); current();
          await o.workspaceStore.commit(null, { revision: 1, ciphertext }); current(); }); return { revision: 1 };
      } }) });
    const preview = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive());
    await expect(f.runtime.authorizeOfflineRecovery(preview.handle, 'other-owner')).rejects.toThrow();
    await f.runtime.authorizeOfflineRecovery(preview.handle, 'fictional-owner');
    expect(await f.runtime.applyOfflineRecovery(preview.handle, 'fictional-owner')).toEqual({ revision: 1 });
    expect(f.runtime.status().mode).toBe('encrypted'); expect(f.runtime.status().vaultId).toBe(p.scope.vaultId); expect(p.proofs[0].closed()).toBe(true);
    expect((await f.runtime.refreshMode()).mode).toBe('encrypted'); f.runtime.getHost(); expect((await f.options().workspaceStore.read()).revision).toBe(1);
    await expect(f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive())).rejects.toThrow();
    f.runtime.close(); key.fill(0);
  });
  it('rejects an independent preexisting scope head even with a new folder and never overwrites it', async () => {
    const p = offlineProofs(), f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery });
    const preview = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive()); await f.runtime.authorizeOfflineRecovery(preview.handle, 'fictional-owner');
    const { createProtectedRevisionLedger } = require('../../electron/protectedRevisionLedger.cjs');
    const fakeRegistry = { assertProfileLease: () => undefined };
    const windows = new Map<string, Buffer>(); // Derive the real domain target through an isolated synthetic provider.
    const ledger = createProtectedRevisionLedger({ scope: p.scope, platform: 'win32', ...fakeRegistry, loadWindowsBinding: () => ({ read: (id: string) => windows.get(id) ?? null, write: (id: string, value: Buffer) => windows.set(id, Buffer.from(value)) }) });
    await ledger.compareAndSwap(null, { head: null, pending: null });
    // macOS uses the same domain digest with a service/account pair.
    const [target, bytes] = [...windows][0]; f.receipts.set('TeacherVaultLedgerV1/scope-' + target.slice('TeacherVaultLedgerV1-'.length), [...bytes]);
    const before = JSON.stringify([...f.receipts]);
    await expect(f.runtime.applyOfflineRecovery(preview.handle, 'fictional-owner')).rejects.toMatchObject({ code: 'ENCRYPTION_FRESH_DEVICE_REQUIRED' });
    expect(f.runtime.status().mode).toBe('encrypted'); expect(f.calls()).toBe(0); expect(p.proofs[0].closed()).toBe(true);
    expect(JSON.stringify([...f.receipts].filter(([id]) => !id.startsWith('TeacherVaultApplicationProtectionV1/')))).toBe(before);
    f.runtime.close();
  });
  it('prevents repeated apply and revokes an in-flight apply on lock without opening legacy', async () => {
    const p = offlineProofs(); let entered!: () => void, release!: () => void;
    const arrived = new Promise<void>(r => { entered = r; }), wait = new Promise<void>(r => { release = r; });
    const f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery, hostFactory: () => ({ lock() {}, status: () => ({ state: 'locked' }),
      applyOfflineRecovery: async (proof: any, actor: string) => { entered(); await wait; proof.assertAuthorized(actor); return { revision: 1 }; } }) });
    const preview = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive()); await f.runtime.authorizeOfflineRecovery(preview.handle, 'fictional-owner');
    const pending = f.runtime.applyOfflineRecovery(preview.handle, 'fictional-owner'); await arrived;
    await expect(f.runtime.applyOfflineRecovery(preview.handle, 'fictional-owner')).rejects.toMatchObject({ code: 'ENCRYPTION_BUSY' });
    await expect(f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive())).rejects.toMatchObject({ code: 'ENCRYPTION_BUSY' });
    f.runtime.lockNow(); release(); await expect(pending).rejects.toThrow(); expect(p.proofs[0].closed()).toBe(true); expect(f.calls()).toBe(0);
    expect(f.runtime.status().mode).toBe('encrypted'); expect(await fs.stat(path.join(f.directory, 'working')).catch(() => null)).toBeNull(); f.runtime.close();
  });
  it('keeps an uncertain first apply marker locked and refuses to relabel it fresh', async () => {
    const p = offlineProofs(), f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery });
    const preview = await f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive()); await f.runtime.authorizeOfflineRecovery(preview.handle, 'fictional-owner'); f.failMarkerWrite();
    await expect(f.runtime.applyOfflineRecovery(preview.handle, 'fictional-owner')).rejects.toThrow();
    expect(f.runtime.status().mode).toBe('encrypted'); expect(f.runtime.status().activationReady).toBe(false); expect(f.calls()).toBe(0);
    await expect(f.runtime.prepareRecoveryFile('FICTIONAL-CODE', fictionalArchive())).rejects.toThrow();
    expect((await f.runtime.refreshMode()).mode).toBe('encrypted'); f.runtime.close();
  });
  it('revokes a held preview on lock before any key or working metadata is created', async () => {
    const p = offlineProofs(), f = await fixture(true, { prepareOfflineRecovery: p.prepareOfflineRecovery });
    let entered!: () => void, release!: () => void; const arrived = new Promise<void>(r => { entered = r; }), wait = new Promise<void>(r => { release = r; });
    async function* held() { entered(); await wait; yield new Uint8Array([1]); }
    const pending = f.runtime.prepareRecoveryFile('FICTIONAL-CODE', held()); await arrived; f.runtime.lockNow(); release();
    await expect(pending).rejects.toThrow(); expect(f.calls()).toBe(0); expect((await fs.readdir(f.directory)).filter(x => x !== 'recovery-staging')).toEqual([]); f.runtime.close();
  });
});

describe('offline recovery with complete real encrypted archives', () => {
  it('verifies code, full archive and operator before recovering source revision three as local revision one', async () => {
    const { createStructuredEncryptionHost } = require('../../electron/structuredEncryptionHost.cjs');
    const db = new OntarioTeacherDB('fictional-offline-runtime-' + crypto.randomUUID());
    let a: any, b: any, c: any, releaseHeld = () => {};
    const started = performance.now();
    const phase = (name: string, details = '') => console.info(`[offline-archive] ${name} elapsedMs=${Math.round(performance.now() - started)}${details ? ' ' + details : ''}`);
    const bounded = async <T,>(action: Promise<T>, name: string, milliseconds: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([action, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`[offline-archive] ${name} did not settle within ${milliseconds}ms`)), milliseconds); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    phase('start', `node=${process.version} platform=${process.platform} arch=${process.arch}`);
    try {
      phase('seed-start'); await seedDatabase(db); const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
      const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [], options: [], state: [] }, applicationStorage: {} };
      phase('source-setup-start'); a = await fixture(true, { hostFactory: createStructuredEncryptionHost }); b = await fixture(true, { hostFactory: createStructuredEncryptionHost });
      let source = a.runtime.getHost(); const recovery = await source.prepareMigration(bundle); await source.verifyRecovery(recovery.recoveryCode);
      const challenge = await source.createDeviceChallenge('fictional-offline-enrollment-check');
      const key = await recoverMasterKey(recovery.recoveryCode, recovery.wrappedKey, recovery.appId, recovery.vaultId, recovery.keyVersion);
      try { await source.verifyDeviceResponse(challenge.deviceId, await answerEnrollmentChallenge(key, challenge)); } finally { key.fill(0); }
      expect(await source.completeMigration(bundle)).toEqual({ revision: 1 });
      phase('source-root-one'); const row = { ...primary.tables.students[0], firstName: 'Synthetic offline recovery canary' };
      await source.commitDelta(1, [{ namespace: 'primary', table: 'students', key: row.id, value: row }]); await source.createBackup('manual', 2);
      phase('source-revision-three'); const parts: Uint8Array[] = []; await source.exportArchive(async (part: Uint8Array) => { parts.push(new Uint8Array(part)); }, 'user-tyler'); const archive = Buffer.concat(parts);
      phase('archive-exported', `bytes=${archive.length} frames=${parts.length}`); expect(archive.toString()).not.toContain(row.firstName);
      async function* read(bytes = archive) { for (let at = 0; at < bytes.length; at += 65536) yield bytes.subarray(at, at + 65536); }
      await expect(b.runtime.prepareRecoveryFile('WRONG-CODE', read())).rejects.toThrow(); expect(b.calls()).toBe(0);
      phase('wrong-code-rejected'); const lines = archive.toString('utf8').trimEnd().split('\n'), footer = JSON.parse(lines[lines.length - 1]), envelope = JSON.parse(footer.seal);
      envelope.ciphertext = (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1); footer.seal = JSON.stringify(envelope); lines[lines.length - 1] = JSON.stringify(footer);
      await expect(b.runtime.prepareRecoveryFile(recovery.recoveryCode, read(Buffer.from(lines.join('\n') + '\n')))).rejects.toThrow(); expect(b.calls()).toBe(0);
      phase('tampered-footer-rejected'); const canceled = await b.runtime.prepareRecoveryFile(recovery.recoveryCode, read()); b.runtime.cancelOfflineRecovery();
      await expect(b.runtime.authorizeOfflineRecovery(canceled.handle, 'user-tyler')).rejects.toThrow(); expect(b.calls()).toBe(0);
      phase('canceled-preview-rejected'); let arrived!: () => void, release!: () => void, heldOnce = false;
      const arrivedPromise = new Promise<void>(r => { arrived = r; }), held = new Promise<void>(r => { release = r; releaseHeld = r; });
      const { createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs');
      c = await fixture(true, { hostFactory: createStructuredEncryptionHost, createChunks: (input: any) => {
        const store = createCipherChunkStore(input); return { ...store, stage: async (...args: any[]) => {
          if (!heldOnce && path.basename(input.directory) === 'chunks') { heldOnce = true; arrived(); await held; }
          return store.stage(...args);
        } };
      } });
      const interrupted = await c.runtime.prepareRecoveryFile(recovery.recoveryCode, read()); phase('cancel-preview-verified'); await c.runtime.authorizeOfflineRecovery(interrupted.handle, 'user-tyler'); phase('cancel-owner-authorized');
      const interruptedApply = c.runtime.applyOfflineRecovery(interrupted.handle, 'user-tyler');
      // Observe rejection immediately: an apply that fails before the held live
      // stage must fail this test, rather than leaving an unrelated waiter hung.
      const earlyOutcome = interruptedApply.then(() => ({ kind: 'fulfilled' as const }), (error: any) => ({ kind: 'rejected' as const, code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'UNCLASSIFIED' }));
      phase('cancel-copy-applying');
      try {
        const arrival = await bounded(Promise.race([arrivedPromise.then(() => ({ kind: 'arrived' as const })), earlyOutcome]), 'live-stage arrival or early apply outcome', 30000);
        if (arrival.kind !== 'arrived') throw Error(`[offline-archive] apply settled before live staging: ${arrival.kind}${'code' in arrival ? ' code=' + arrival.code : ''}`);
        phase('cancel-held-stage-arrived'); c.runtime.lockNow(); release(); phase('cancel-lock-issued');
        await bounded(expect(interruptedApply).rejects.toThrow(), 'locked live-copy apply rejection', 20000); phase('cancel-apply-rejected');
      } finally { release(); }
      expect(c.runtime.status().mode).toBe('encrypted'); expect(await c.options().rawStore.read()).toBeNull(); expect((await c.runtime.refreshMode()).mode).toBe('enrollment-pending');
      phase('cancel-state-verified'); const preview = await b.runtime.prepareRecoveryFile(recovery.recoveryCode, read()); expect(preview.operators.some((user: any) => user.id === 'user-tyler')).toBe(true);
      phase('recovery-preview-verified'); expect(b.runtime.status().vaultId).not.toBe(recovery.vaultId); expect(b.calls()).toBe(0); expect(await fs.stat(path.join(b.directory, 'working')).catch(() => null)).toBeNull();
      await expect(b.runtime.authorizeOfflineRecovery(preview.handle, 'fictional-missing-owner')).rejects.toThrow();
      await b.runtime.authorizeOfflineRecovery(preview.handle, 'user-tyler'); phase('recovery-owner-authorized'); expect(await bounded(b.runtime.applyOfflineRecovery(preview.handle, 'user-tyler'), 'confirmed recovery apply', 60000)).toEqual({ revision: 1 }); phase('recovery-apply-completed');
      expect((await b.runtime.getHost().read()).snapshot.primary.tables.students.find((student: any) => student.id === row.id).firstName).toBe(row.firstName);
      expect((await b.runtime.getHost().listBackups()).length).toBe(1);
      await expect(b.runtime.applyOfflineRecovery(preview.handle, 'user-tyler')).rejects.toThrow();
      b.runtime.close(); const reopened = await createNativeEncryptionRuntime(b.config); b.runtime = reopened;
      expect(reopened.status().mode).toBe('encrypted'); await reopened.getHost().unlock(); const saved = await reopened.getHost().read(); expect(saved.revision).toBe(1);
      phase('reopened-unlocked'); expect(saved.snapshot.primary.tables.students.find((student: any) => student.id === row.id).firstName).toBe(row.firstName);
      for (const sub of ['device-keys', 'working', 'chunks']) for (const file of await fs.readdir(path.join(b.directory, sub))) expect((await fs.readFile(path.join(b.directory, sub, file))).includes(Buffer.from(row.firstName))).toBe(false);
    } finally { c?.runtime.lockNow(); releaseHeld(); a?.runtime.close(); b?.runtime.close(); c?.runtime.close(); await db.delete(); phase('cleanup-complete'); }
  }, 90000);
});

describe('interrupted initial migration retry', () => {
  it('retains the independently enrolled master and requires fresh recovery/device proofs after an explicit return', async () => {
    const { createStructuredEncryptionHost } = require('../../electron/structuredEncryptionHost.cjs'), { createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs');
    const db = new OntarioTeacherDB('fictional-resumable-runtime-' + crypto.randomUUID()); let f: any, receiver: any;
    try {
      await seedDatabase(db); const primary = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
      const bundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [], options: [], state: [] }, applicationStorage: {} }; let interrupt = true;
      f = await fixture(true, { hostFactory: createStructuredEncryptionHost, createChunks: (input: any) => {
        const store = createCipherChunkStore(input); return { ...store, stage: async (...args: any[]) => { if (interrupt) { interrupt = false; throw Error('SYNTHETIC_INITIAL_CHUNK_FAILURE'); } return store.stage(...args); } };
      } });
      receiver = await fixture(true, { hostFactory: createStructuredEncryptionHost });
      let host = f.runtime.getHost(); const first = await host.prepareMigration(bundle); await host.verifyRecovery(first.recoveryCode);
      const oldChallenge = await host.createDeviceChallenge(receiver.runtime.status().deviceId);
      const firstResponse = await receiver.runtime.enrollFromRecovery(first.recoveryCode, first.wrappedKey, oldChallenge), oldResponse = firstResponse.ciphertext;
      await host.verifyDeviceResponse(firstResponse.deviceId, oldResponse);
      receiver.runtime.close(); receiver.runtime = await createNativeEncryptionRuntime(receiver.config); expect(receiver.runtime.status().mode).toBe('enrollment-pending');
      await expect(host.completeMigration(bundle)).rejects.toThrow(); expect(await f.options().rawStore.read()).toBeNull();
      f.runtime.close(); f.runtime = await createNativeEncryptionRuntime(f.config); expect(f.runtime.status().mode).toBe('enrollment-pending');
      await f.runtime.cancelEnrollment(); expect((await f.runtime.refreshMode()).mode).toBe('legacy');
      const unchanged = JSON.parse(await new PortabilityService(db).createFullBackupJSON()); expect(unchanged.tables).toEqual(primary.tables);
      host = f.runtime.getHost(); const retry = await host.prepareMigration(bundle); expect(retry.vaultId).toBe(first.vaultId); expect(retry.wrappedKey).not.toBe(first.wrappedKey); expect(retry.recoveryCode).not.toBe(first.recoveryCode);
      const retained = await recoverMasterKey(retry.recoveryCode, retry.wrappedKey, retry.appId, retry.vaultId, retry.keyVersion), previous = await recoverMasterKey(first.recoveryCode, first.wrappedKey, first.appId, first.vaultId, first.keyVersion);
      try { expect(retained).toEqual(previous); } finally { previous.fill(0); }
      const wrong = generateMasterKey(), wrongCode = await generateRecoveryCode();
      try {
        const wrongWrapper = await wrapMasterKey(wrong, wrongCode, retry.appId, retry.vaultId, retry.keyVersion), deviceId = receiver.runtime.status().deviceId;
        const context = { appId: retry.appId, vaultId: retry.vaultId, keyVersion: retry.keyVersion, purpose: 'transfer' as const, recordId: 'enrollment/' + deviceId + '/' + crypto.randomUUID(), revision: 0 };
        const wrongChallenge = { deviceId, context, ciphertext: await encryptBytes(wrong, context, new Uint8Array(32)) };
        await expect(receiver.runtime.enrollFromRecovery(wrongCode, wrongWrapper, wrongChallenge)).rejects.toMatchObject({ code: 'DEVICE_KEY_CONTEXT_CHANGED' });
        expect(await receiver.options().rawStore.readAux('recovery-wrapper')).toBe(first.wrappedKey); expect(receiver.runtime.status().mode).toBe('enrollment-pending');
      } finally { wrong.fill(0); }
      await receiver.runtime.cancelEnrollment(); expect((await receiver.runtime.refreshMode()).mode).toBe('legacy');
      await expect(host.completeMigration(bundle)).rejects.toThrow(); await host.verifyRecovery(retry.recoveryCode); const challenge = await host.createDeviceChallenge(receiver.runtime.status().deviceId);
      await expect(host.verifyDeviceResponse(challenge.deviceId, oldResponse!)).rejects.toThrow();
      try { const nextResponse = await receiver.runtime.enrollFromRecovery(retry.recoveryCode, retry.wrappedKey, challenge); await host.verifyDeviceResponse(nextResponse.deviceId, nextResponse.ciphertext); } finally { retained.fill(0); }
      expect(await host.completeMigration(bundle)).toEqual({ revision: 1 }); f.runtime.close(); f.runtime = await createNativeEncryptionRuntime(f.config);
      expect(f.runtime.status().mode).toBe('encrypted'); await f.runtime.getHost().unlock(); expect((await f.runtime.getHost().read()).revision).toBe(1);
      expect((await f.runtime.getHost().read()).snapshot.primary.tables).toEqual(primary.tables);
    } finally { f?.runtime.close(); receiver?.runtime.close(); await db.delete(); }
  }, 90000);
});
