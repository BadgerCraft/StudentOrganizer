import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const { createEncryptionKeyStore } = createRequire(import.meta.url)('../../electron/encryptionKeyStore.cjs');
const directories: string[] = [];
const nativeTestPlatform = process.platform === 'win32' ? 'win32' : 'darwin';
const c = { appId: 'student-organizer', vaultId: 'fictional-vault', keyVersion: 1 };
const key = new Uint8Array(32).fill(42);
// Synthetic protected-storage adapter, not a substitute for OS protection.
function mockStorage() { return { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (text: string) => Buffer.from('OS-MOCK:' + text), decryptStringAsync: async (bytes: Buffer) => { if (!bytes.toString().startsWith('OS-MOCK:')) throw new Error('private OS detail'); return { result: bytes.toString().slice(8), shouldReEncrypt: false };  } }; }
async function fixture(overrides: object = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-key-store-')); directories.push(directory);
  return { directory, store: createEncryptionKeyStore({ directory, safeStorage: mockStorage(), platform: nativeTestPlatform, ...overrides }) };
}
async function onlyFile(directory: string) { return path.join(directory, (await fs.readdir(directory)).find(n => n.endsWith('.device-key'))!); }
afterEach(async () => { for (const d of directories.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
describe('protected device key adapter', () => {
  it('roundtrips a synthetic device key with restrictive modes and no pending file', async () => {
    const { directory, store } = await fixture();
    expect(await store.load(c)).toBeNull(); await store.save(c, key);
    expect(await store.load(c)).toEqual(key);
    if (process.platform !== 'win32') expect((await fs.stat(await onlyFile(directory))).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(directory)).filter(n => n.startsWith('.pending-'))).toEqual([]);
  });
  it('refuses overwrite and concurrent enrollment keeps one complete key', async () => {
    const { store } = await fixture();
    const results = await Promise.allSettled([store.save(c, key), store.save(c, new Uint8Array(32).fill(7))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const saved = await store.load(c); expect([42, 7]).toContain(saved[0]);
    await expect(store.save(c, key)).rejects.toThrow(/no plaintext fallback/);
    expect(await store.load(c)).toEqual(saved);
  });
  it.each(['linux', 'freebsd', 'win32-unavailable', 'darwin-unavailable', 'linux-basic_text'])('fails closed on %s', async mode => {
    const storage = mockStorage();
    const { store, directory } = await fixture({ platform: mode.split('-')[0], safeStorage: { ...storage, isAsyncEncryptionAvailable: async () => !mode.includes('unavailable'), getSelectedStorageBackend: () => mode.includes('basic_text') ? 'basic_text' : 'keychain' } });
    expect(await store.available()).toBe(false);
    await expect(store.save(c, key)).rejects.toThrow(); await expect(store.load(c)).rejects.toThrow(); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('isolates per-app, per-vault and version identities and rejects transplanted bytes', async () => {
    const { store, directory } = await fixture(); await store.save(c, key);
    for (const changed of [{ ...c, appId: 'servetrack' }, { ...c, vaultId: 'other' }, { ...c, keyVersion: 2 }]) expect(await store.load(changed)).toBeNull();
    const file = await onlyFile(directory); const original = await fs.readFile(file);
    await fs.writeFile(file, original.toString().replace('student-organizer', 'servetrack'));
    await expect(store.load(c)).rejects.toThrow(/Protected device key/);
  });
  it('rejects truncated, oversized, malformed and extra-field protected payloads without exposing details', async () => {
    const { store, directory } = await fixture(); await store.save(c, key); const file = await onlyFile(directory);
    for (const bytes of [Buffer.from('private corruption'), Buffer.alloc(17000), Buffer.from('OS-MOCK:{'), Buffer.from('OS-MOCK:' + JSON.stringify({ version: 1, ...c, key: Buffer.from(key).toString('base64'), private: 'secret' }))]) {
      await fs.writeFile(file, bytes); await expect(store.load(c)).rejects.toThrow('Protected device key is unavailable. Use verified offline recovery; no plaintext fallback was used.');
    }
  });
  it.skipIf(process.platform === 'win32')('rejects weak file/directory permissions and symlink keys', async () => {
    const { store, directory } = await fixture(); await store.save(c, key); const file = await onlyFile(directory);
    await fs.chmod(file, 0o644); await expect(store.load(c)).rejects.toThrow(); await fs.chmod(file, 0o600);
    await fs.chmod(directory, 0o755); await expect(store.load(c)).rejects.toThrow(); await fs.chmod(directory, 0o700);
    await fs.rename(file, file + '.original'); await fs.symlink(file + '.original', file); await expect(store.load(c)).rejects.toThrow();
  });
  it('cleans partial temporary writes and never publishes incomplete key bytes', async () => {
    const failedFs = { ...fs, open: async (...args: Parameters<typeof fs.open>) => { const h = await fs.open(...args); return { writeFile: async (bytes: Buffer) => { await h.writeFile(bytes.subarray(0, 4)); throw new Error('private disk detail'); }, sync: () => h.sync(), close: () => h.close() }; } };
    const { store, directory } = await fixture({ fs: failedFs }); await expect(store.save(c, key)).rejects.toThrow(/Protected device key/); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('cleans a complete temp file when atomic publication fails', async () => {
    const { store, directory } = await fixture({ fs: { ...fs, link: async () => { throw new Error('private permission detail'); } } });
    await expect(store.save(c, key)).rejects.toThrow(); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('reports Windows file-only durability without claiming directory fsync', async () => {
    const { store } = await fixture({ platform: 'win32' });
    expect(await store.save(c, key)).toEqual({ durability: 'file-synced' });
    expect(await store.load(c)).toEqual(key);
  });
  it.skipIf(process.platform === 'win32')('surfaces post-publication directory sync failure as uncertain and preserves protected key', async () => {
    let directory = '';
    const injected = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const h = await fs.open(...args);
      if (args[0] === directory) return { sync: async () => { throw new Error('private sync error'); }, close: () => h.close() };
      return h;
    } };
    const fixtureResult = await fixture({ fs: injected }); directory = fixtureResult.directory;
    await expect(fixtureResult.store.save(c, key)).rejects.toMatchObject({ code: 'DEVICE_KEY_SAVE_UNCERTAIN' });
    expect(await fixtureResult.store.load(c)).toEqual(key);
    await expect(fixtureResult.store.save(c, key)).rejects.toThrow();
  });
  it('fails closed when OS key rewrapping is required and leaves protected bytes unchanged', async () => {
    const storage = mockStorage();
    const { store, directory } = await fixture({ safeStorage: { ...storage, decryptStringAsync: async (bytes: Buffer) => ({ ...await storage.decryptStringAsync(bytes), shouldReEncrypt: true }) } });
    await store.save(c, key); const file = await onlyFile(directory), before = await fs.readFile(file);
    await expect(store.load(c)).rejects.toMatchObject({ code: 'DEVICE_KEY_REWRAP_REQUIRED' });
    expect(await fs.readFile(file)).toEqual(before);
  });
  it('requires async protected storage APIs and never uses synchronous fallback', async () => {
    const { store } = await fixture({ safeStorage: { isEncryptionAvailable: () => true, encryptString: () => { throw new Error('must not call'); } } });
    expect(await store.available()).toBe(false); await expect(store.save(c, key)).rejects.toThrow();
  });
  it('validates key length and context without creating files or printing input', async () => {
    const { store, directory } = await fixture();
    for (const bad of [{ ...c, vaultId: '../private' }, { ...c, keyVersion: 0 }, { ...c, extra: true }, { ...c, appId: undefined }, { ...c, vaultId: 123 }]) await expect(store.save(bad, key)).rejects.toThrow();
    await expect(store.save(c, new Uint8Array(31))).rejects.toThrow(); expect(await fs.readdir(directory)).toEqual([]);
  });
});
