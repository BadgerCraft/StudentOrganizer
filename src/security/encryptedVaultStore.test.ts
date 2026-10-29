import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { encryptBytes } from '../../shared/encryption';
const { createEncryptedVaultStore } = createRequire(import.meta.url)('../../electron/encryptedVaultStore.cjs');
const directories: string[] = [];
const nativeTestPlatform = process.platform === 'win32' ? 'win32' : 'darwin';
const nativeTestSync = process.platform === 'win32' ? async () => {} : undefined;
const scope = { appId: 'student-organizer', vaultId: 'synthetic-vault', keyVersion: 1 };
const key = new Uint8Array(32).fill(11);
async function checkpoint(revision: number, changed = {}) { return { revision, ciphertext: await encryptBytes(key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision, ...changed }, new TextEncoder().encode('Fictional student work and attachment')) }; }
async function fixture(overrides: object = {}) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-encrypted-vault-')); directories.push(directory); return { directory, store: createEncryptedVaultStore({ directory, scope, platform: nativeTestPlatform, syncDirectory: nativeTestSync, ...overrides }) }; }
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
describe('native encrypted authoritative container', () => {
  it('persists only encrypted bytes and reopens complete committed revisions', async () => {
    const { directory, store } = await fixture(); expect(await store.read()).toBeNull();
    const first = await checkpoint(1); await store.commit(null, first); expect(await store.read()).toEqual(first);
    const second = await checkpoint(2); await store.commit(1, second); expect(await store.read()).toEqual(second);
    const bytes = await fs.readFile(path.join(directory, 'workspace.vault'), 'utf8'); expect(bytes).not.toContain('Fictional');
    if (process.platform !== 'win32') expect((await fs.stat(path.join(directory, 'workspace.vault'))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(directory)).toEqual(['workspace.vault']);
  });
  it('rejects stale, skipped and malformed revisions without replacing saved bytes', async () => {
    const { store } = await fixture(); const first = await checkpoint(1); await store.commit(null, first);
    for (const [expected, next] of [[null, await checkpoint(1)], [1, await checkpoint(3)], [0, await checkpoint(1)], [2, await checkpoint(3)]]) await expect(store.commit(expected, next)).rejects.toThrow();
    expect(await store.read()).toEqual(first);
  });
  it('serializes concurrent independent adapter instances using exclusive filesystem lock', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await checkpoint(1));
    const other = createEncryptedVaultStore({ directory, scope, platform: nativeTestPlatform, syncDirectory: nativeTestSync });
    const results = await Promise.allSettled([store.commit(1, await checkpoint(2)), other.commit(1, await checkpoint(2))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await store.read()).revision).toBe(2);
  });
  it('never removes crash-stale locks or retries unknown prior writes', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await checkpoint(1));
    await fs.writeFile(path.join(directory, 'workspace.lock'), '', { mode: 0o600 });
    await expect(store.commit(1, await checkpoint(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_LOCKED' });
    expect((await store.read()).revision).toBe(1); expect(await fs.readdir(directory)).toContain('workspace.lock');
  });
  it('preserves the old ciphertext and cleans partial writes if temp creation fails', async () => {
    const { directory, store } = await fixture(); const first = await checkpoint(1); await store.commit(null, first);
    const broken = createEncryptedVaultStore({ directory, scope, platform: nativeTestPlatform, syncDirectory: nativeTestSync, fs: { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const h = await fs.open(...args); if (String(args[0]).includes('.vault-pending-')) return { writeFile: async (bytes: Buffer) => { await h.writeFile(bytes.subarray(0, 10)); throw new Error('private disk detail'); }, sync: () => h.sync(), close: () => h.close() }; return h;
    } } });
    await expect(broken.commit(1, await checkpoint(2))).rejects.toThrow(); expect(await store.read()).toEqual(first); expect(await fs.readdir(directory)).toEqual(['workspace.vault']);
  });
  it('marks a post-rename durability error uncertain and exposes the actual saved revision on reopen', async () => {
    const { directory, store } = await fixture(); await store.commit(null, await checkpoint(1));
    const uncertain = createEncryptedVaultStore({ directory, scope, platform: nativeTestPlatform, syncDirectory: async () => { throw new Error('private sync error'); } });
    await expect(uncertain.commit(1, await checkpoint(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' });
    expect((await store.read()).revision).toBe(2); await expect(store.commit(1, await checkpoint(2))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_STALE' });
  });
  it('fails closed before writing when Windows durability provider is unavailable', async () => {
    const { directory, store } = await fixture({ platform: 'win32', syncDirectory: undefined }); await expect(store.commit(null, await checkpoint(1))).rejects.toMatchObject({ code: 'ENCRYPTED_STORAGE_DURABILITY_UNAVAILABLE' }); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('accepts a trusted injected Windows durability adapter in synthetic tests', async () => {
    let flushed = 0; const { store } = await fixture({ platform: 'win32', syncDirectory: async () => { flushed++; } }); const first = await checkpoint(1); await store.commit(null, first); expect(flushed).toBe(1); expect(await store.read()).toEqual(first);
  });
  it('rejects plaintext, wrong app/purpose/record/version and inconsistent envelope metadata', async () => {
    const { directory, store } = await fixture();
    for (const changed of [{ appId: 'servetrack' }, { vaultId: 'other' }, { purpose: 'backup' }, { recordId: 'other' }, { keyVersion: 2 }, { revision: 0 }]) await expect(store.commit(null, await checkpoint(1, changed))).rejects.toThrow();
    await expect(store.commit(null, { revision: 1, ciphertext: 'Fictional plaintext' })).rejects.toThrow(); expect(await fs.readdir(directory)).toEqual([]);
  });
  it('rejects corrupted, oversized, duplicate-field and symlink container files', async () => {
    const { directory, store } = await fixture({ maxBytes: 2048 }); const first = await checkpoint(1); await store.commit(null, first); const file = path.join(directory, 'workspace.vault'), saved = await fs.readFile(file);
    for (const bytes of [Buffer.from('invalid'), Buffer.alloc(2049), Buffer.from(saved.toString().replace('"revision":1', '"revision":1,"revision":1'))]) { await fs.writeFile(file, bytes); await expect(store.read()).rejects.toThrow(); }
    if (process.platform !== 'win32') { await fs.writeFile(file, saved); await fs.rename(file, file + '.original'); await fs.symlink(file + '.original', file); await expect(store.read()).rejects.toThrow(); }
  });
});
