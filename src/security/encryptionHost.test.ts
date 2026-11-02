import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
let createEncryptionHost: any;
beforeAll(() => { execFileSync(process.execPath, ['scripts/buildEncryptionNative.cjs'], { cwd: process.cwd() }); ({ createEncryptionHost } = require('../../electron/encryptionHost.cjs')); });
const original = { students: [{ id: 'fictional', name: 'Fictional work' }], attachment: 'synthetic-attachment-bytes' };
function validate(value: unknown) { const v = value as typeof original; if (!v || !Array.isArray(v.students) || typeof v.attachment !== 'string') throw new Error('PRIVATE_VALIDATION_DETAIL'); }
function fixture(deviceId = 'computer-A', activationGate = async () => true, shared?: any) {
  let key: Uint8Array | null = null, saved: any = null, saves = 0, commits = 0;
  const state = shared || {
    read: async () => saved ? structuredClone(saved) : null,
    commit: async (expected: number | null, next: any) => { if ((saved?.revision ?? null) !== expected) throw new Error('private CAS mismatch'); saved = structuredClone(next); commits++; },
    get saved() { return saved; }, get commits() { return commits; }
  };
  const keys = { load: async () => key ? new Uint8Array(key) : null, save: async (_scope: any, value: Uint8Array) => { if (key) throw new Error('no overwrite'); key = new Uint8Array(value); saves++; } };
  const host = createEncryptionHost({ directory: path.join(os.tmpdir(), 'synthetic-host-no-disk'), vaultId: 'synthetic-vault', deviceId, keyStore: keys, workspaceStore: state, validateSnapshot: validate, activationGate });
  return { host, state, keys, get key() { return key; }, get saves() { return saves; } };
}
async function ceremony(a: ReturnType<typeof fixture>, b: ReturnType<typeof fixture>, value = original) {
  const recovery = await a.host.prepareMigration(value); await a.host.verifyRecovery(recovery.recoveryCode);
  const challenge = await a.host.createDeviceChallenge('computer-B');
  const response = await b.host.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, challenge);
  await a.host.verifyDeviceResponse(response.deviceId, response.ciphertext); return recovery;
}
describe('packaged native encryption host prerequisite', () => {
  it('uses the generated CommonJS crypto/session runtime without tsx and keeps all raw keys native', async () => {
    const a = fixture(), b = fixture('computer-B'); const recovery = await ceremony(a, b);
    expect(Object.keys(recovery).sort()).toEqual(['appId', 'keyVersion', 'recoveryCode', 'vaultId', 'wrappedKey']);
    const response = await a.host.completeMigration(original); expect(response).toEqual({ revision: 1 });
    expect(a.host.status()).toMatchObject({ appId: 'student-organizer', state: 'unlocked', revision: 1 });
    expect(await a.host.read()).toEqual({ revision: 1, snapshot: original });
    expect(JSON.stringify([response, recovery, a.host.status()])).not.toContain(Buffer.from(a.key!).toString('base64'));
    expect(a.state.saved.ciphertext).not.toContain('Fictional work'); expect(a.saves).toBe(1);
    a.host.lock(); expect(a.host.status().state).toBe('locked'); await expect(a.host.read()).rejects.toThrow();
    await a.host.unlock(); expect((await a.host.read()).snapshot).toEqual(original);
    expect(await a.host.commit(1, { ...original, attachment: 'synthetic later submission' })).toEqual({ revision: 2 });
    expect((await a.host.read()).snapshot.attachment).toBe('synthetic later submission');
    await expect(a.host.commit(1, original)).rejects.toThrow(); expect(a.state.commits).toBe(2);
  });
  it('requires recovery, independent device proof and explicit main-owned activation before conversion', async () => {
    const a = fixture(), b = fixture('computer-B'); const recovery = await a.host.prepareMigration(original);
    await expect(a.host.completeMigration(original)).rejects.toThrow(); expect(a.saves).toBe(0);
    await a.host.verifyRecovery(recovery.recoveryCode); await expect(a.host.completeMigration(original)).rejects.toThrow();
    const defaultGate = createEncryptionHost({ directory: path.join(os.tmpdir(), 'synthetic-host-no-disk'), vaultId: 'synthetic-vault', deviceId: 'computer-B', keyStore: b.keys, workspaceStore: b.state, validateSnapshot: validate });
    const challenge = await a.host.createDeviceChallenge('computer-B');
    await expect(defaultGate.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, challenge)).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(b.saves).toBe(0);
    const c = fixture('computer-C', async () => false), d = fixture('computer-B'); await ceremony(c, d);
    await expect(c.host.completeMigration(original)).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(c.saves).toBe(0); expect(c.state.saved).toBeNull();
  });
  it('cannot unlock an existing valid vault through the default-disabled host', async () => {
    const a = fixture(), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original); a.host.lock();
    const disabled = createEncryptionHost({ directory: path.join(os.tmpdir(), 'synthetic-host-no-disk'), vaultId: 'synthetic-vault', deviceId: 'computer-A', keyStore: a.keys, workspaceStore: a.state, validateSnapshot: validate });
    await expect(disabled.unlock()).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(disabled.status().state).toBe('locked');
    await expect(disabled.read()).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' });
  });
  it('locks an unlocked session when the main-owned activation gate is revoked', async () => {
    let allowed = true; const a = fixture('computer-A', async () => allowed), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original); allowed = false;
    await expect(a.host.read()).rejects.toMatchObject({ code: 'ENCRYPTION_ACTIVATION_REQUIRED' }); expect(a.host.status().state).toBe('locked');
    await expect(a.host.exportEncrypted('backup', 'synthetic-export')).rejects.toThrow(); await expect(a.host.commit(1, original)).rejects.toThrow(); expect(a.state.commits).toBe(1);
  });
  it('rejects changed source snapshots after enrollment without replacing the source', async () => {
    const a = fixture(), b = fixture('computer-B'); const source = structuredClone(original); await ceremony(a, b, source);
    await expect(a.host.completeMigration({ ...source, attachment: 'changed after preview' })).rejects.toThrow();
    expect(a.state.saved).toBeNull(); expect(source).toEqual(original); expect(a.host.status().state).toBe('locked');
  });
  it('locks after an uncertain commit and reopens the actual saved revision instead of blindly replaying', async () => {
    const a = fixture(), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original);
    const actual = a.state.commit; a.state.commit = async (expected: number, next: any) => { await actual(expected, next); throw new Error('PRIVATE_LOST_REPLY'); };
    await expect(a.host.commit(1, { ...original, attachment: 'committed reply lost' })).rejects.toThrow(); expect(a.host.status().state).toBe('locked');
    expect(a.state.commits).toBe(2); await a.host.unlock(); expect((await a.host.read()).revision).toBe(2); expect((await a.host.read()).snapshot.attachment).toBe('committed reply lost');
  });
  it('serializes competing revisions and preserves explicit expected-revision checks', async () => {
    const a = fixture(), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original);
    const results = await Promise.allSettled([a.host.commit(1, { ...original, attachment: 'first' }), a.host.commit(1, { ...original, attachment: 'second' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await a.host.read()).snapshot.attachment).toBe('first');
  });
  it('blocks raw or wrong-scope device recovery and repeated mismatched proof', async () => {
    const a = fixture(), b = fixture('computer-B'); const recovery = await a.host.prepareMigration(original); const challenge = await a.host.createDeviceChallenge('computer-B');
    await expect(b.host.enrollFromRecovery('invalid code', recovery.wrappedKey, challenge)).rejects.toThrow(); expect(b.saves).toBe(0);
    await expect(b.host.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, { ...challenge, context: { ...challenge.context, appId: 'servetrack' } })).rejects.toThrow();
    const response = await b.host.enrollFromRecovery(recovery.recoveryCode, recovery.wrappedKey, challenge);
    await expect(a.host.verifyDeviceResponse('computer-C', response.ciphertext)).rejects.toThrow(); await expect(a.host.completeMigration(original)).rejects.toThrow();
  });
  it('exports purpose-bound encrypted backup/transfer bytes and rejects unsupported export modes', async () => {
    const a = fixture(), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original);
    for (const purpose of ['backup', 'transfer']) { const exported = await a.host.exportEncrypted(purpose, 'synthetic-export'); expect(exported.revision).toBe(1); expect(exported.ciphertext).not.toContain('Fictional work'); expect(JSON.parse(exported.ciphertext).context.purpose).toBe(purpose); }
    await expect(a.host.exportEncrypted('working-data', 'not-allowed')).rejects.toThrow();
  });
  it('uses the actual protected-key and CAS disk adapters with synthetic OS protection', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-native-host-'));
    try {
      const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (text: string) => Buffer.from('SYNTHETIC_OS:' + text), decryptStringAsync: async (bytes: Buffer) => ({ result: bytes.toString().slice(13), shouldReEncrypt: false }) };
      const a = { host: createEncryptionHost({ directory, vaultId: 'synthetic-vault', deviceId: 'computer-A', platform: process.platform === 'win32' ? 'win32' : 'darwin', syncDirectory: process.platform === 'win32' ? async () => {} : undefined, safeStorage, validateSnapshot: validate, activationGate: () => true }) };
      const b = fixture('computer-B'); await ceremony(a as any, b); await a.host.completeMigration(original); a.host.lock(); await a.host.unlock();
      expect((await a.host.read()).snapshot).toEqual(original); expect(await fs.readdir(directory)).toEqual(['keys', 'working']);
      const bytes = await fs.readFile(path.join(directory, 'working/workspace.vault'), 'utf8'); expect(bytes).not.toContain('Fictional work');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('keeps a session locked after lock interrupts an already committing write', async () => {
    const a = fixture(), b = fixture('computer-B'); await ceremony(a, b); await a.host.completeMigration(original);
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { reached = r; }), pause = new Promise<void>(r => { release = r; });
    const actual = a.state.commit; a.state.commit = async (expected: number, next: any) => { reached(); await pause; await actual(expected, next); };
    const write = a.host.commit(1, { ...original, attachment: 'interrupted synthetic work' }); await entered; a.host.lock(); release();
    await expect(write).rejects.toThrow(); expect(a.host.status().state).toBe('locked'); await expect(a.host.read()).rejects.toThrow();
    await a.host.unlock(); expect((await a.host.read()).revision).toBe(2); expect((await a.host.read()).snapshot.attachment).toBe('interrupted synthetic work');
  });
  it('invalidates pending preparation on lock without making a protected enrollment', async () => {
    const a = fixture(); const pending = a.host.prepareMigration(original); a.host.lock(); await expect(pending).rejects.toThrow(); expect(a.saves).toBe(0); expect(a.state.saved).toBeNull();
  });
});
