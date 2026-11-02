import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPlatformKeyringStore, createWindowsDpapiProtector } = require('../../electron/platformKeyringStore.cjs');
const c = { appId: 'synthetic-app', vaultId: 'synthetic-vault', keyVersion: 1 };
function fixture(extra: Record<string, unknown> = {}) {
  const rows = new Map<string, number[]>(); const calls: string[] = []; let tail = Promise.resolve();
  class AsyncEntry {
    id: string;
    constructor(service: string, account: string) { calls.push('entry'); this.id = service + '.' + account; }
    async getSecret() { calls.push('get'); return rows.has(this.id) ? [...rows.get(this.id)!] : null; }
    async setSecret(bytes: Uint8Array) { if (!(bytes instanceof Uint8Array)) throw Error('NAPI requires Uint8Array'); calls.push('set'); rows.set(this.id, [...bytes]); }
    static withTarget() { throw Error('must never call'); }
  }
  const lock = async (fn: () => Promise<unknown>) => { const previous = tail; let release!: () => void; tail = new Promise<void>(r => { release = r; }); await previous; try { calls.push('lock'); return await fn(); } finally { release(); } };
  const store = createPlatformKeyringStore({ configured: true, platform: 'darwin', withExclusiveProfileLock: lock, loadBinding: () => ({ AsyncEntry }), ...extra });
  return { store, rows, calls, AsyncEntry };
}
describe('optional native keyring provider', () => {
  it('requires an explicit host profile lock and never loads bindings until configured', async () => {
    expect(() => createPlatformKeyringStore({})).toThrow();
    let loaded = 0; const { store } = fixture({ configured: false, loadBinding: () => { loaded++; throw Error('native'); } });
    expect(await store.available()).toBe(false); await expect(store.load(c)).rejects.toThrow(/no plaintext fallback/); expect(loaded).toBe(0);
  });
  it('roundtrips context-bound bytes, repeats identical enrollment and rejects replacement', async () => {
    const f = fixture(), key = new Uint8Array(32).fill(19);
    expect(await f.store.load(c)).toBeNull(); await f.store.save(c, key); expect(await f.store.load(c)).toEqual(key);
    await f.store.save(c, key); expect(f.calls.filter(x => x === 'set')).toHaveLength(1);
    await expect(f.store.save(c, new Uint8Array(32).fill(20))).rejects.toThrow();
    expect(await f.store.load(c)).toEqual(key);
    for (const patch of [{ appId: 'other' }, { vaultId: 'other' }, { keyVersion: 2 }]) expect(await f.store.load({ ...c, ...patch })).toBeNull();
  });
  it('owns enrollment bytes before awaiting the host lock', async () => {
    let enter!: () => void; const gate = new Promise<void>(resolve => { enter = resolve; });
    const f = fixture({ withExclusiveProfileLock: async (fn: () => Promise<unknown>) => { await gate; return fn(); } });
    const input = new Uint8Array(32).fill(77), expected = new Uint8Array(input);
    const save = f.store.save(c, input); input.fill(0); enter(); await save;
    expect(await f.store.load(c)).toEqual(expected);
  });
  it('validates the protected payload even when copied into another scoped entry', async () => {
    const f = fixture(), key = new Uint8Array(32).fill(21); await f.store.save(c, key);
    const original = [...f.rows.values()][0]; await f.store.save({ ...c, vaultId: 'other' }, key);
    const target = [...f.rows.keys()][1]; f.rows.set(target, original);
    await expect(f.store.load({ ...c, vaultId: 'other' })).rejects.toThrow();
  });
  it('distinguishes absent from locked and never leaks the native error', async () => {
    class Locked { async getSecret() { throw Error('PRIVATE_NATIVE_SECRET'); } }
    const { store } = fixture({ loadBinding: () => ({ AsyncEntry: Locked }) });
    await expect(store.load(c)).rejects.toThrow(/Protected device key/);
    try { await store.load(c); } catch (e) { expect(String(e)).not.toContain('PRIVATE_NATIVE_SECRET'); }
  });
  it('serializes enrollment through the provided lock and never overwrites the winner', async () => {
    const f = fixture(); const results = await Promise.allSettled([f.store.save(c, new Uint8Array(32).fill(31)), f.store.save(c, new Uint8Array(32).fill(32))]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']); expect(f.calls.filter(x => x === 'set')).toHaveLength(1);
  });
  it('reports uncertain enrollment after a write reply or readback fails', async () => {
    class Uncertain { async getSecret() { return null; } async setSecret() { throw Error('PRIVATE_TIMEOUT'); } }
    const { store } = fixture({ loadBinding: () => ({ AsyncEntry: Uncertain }) });
    await expect(store.save(c, new Uint8Array(32))).rejects.toMatchObject({ code: 'DEVICE_KEY_SAVE_UNCERTAIN' });
  });
  it('rejects unsupported platforms, malformed scopes and missing Windows binding', async () => {
    for (const platform of ['linux', 'freebsd', 'win32']) { const f = fixture({ platform, loadWindowsBinding: () => { throw Error('not installed'); } }); expect(await f.store.available()).toBe(false); }
    const f = fixture(); for (const bad of [{ ...c, keyVersion: 0 }, { ...c, extra: true }, { ...c, appId: '' }]) await expect(f.store.load(bad)).rejects.toThrow();
    await expect(f.store.save(c, new Uint8Array(31))).rejects.toThrow();
  });
  it('nests Windows CurrentUser and LocalMachine protection in reverse decode order', async () => {
    const scopes: string[] = [];
    const Dpapi = {
      protectData(bytes: Uint8Array, _entropy: Uint8Array, s: string) { scopes.push('protect-' + s); return Buffer.concat([Buffer.from(s === 'CurrentUser' ? [1] : [2]), Buffer.from(bytes)]); },
      unprotectData(bytes: Uint8Array, _entropy: Uint8Array, s: string) { scopes.push('unprotect-' + s); if (bytes[0] !== (s === 'CurrentUser' ? 1 : 2)) throw Error('wrong binding'); return Buffer.from(bytes.subarray(1)); }
    };
    const localRows = new Map<string, Uint8Array>();
    const localProtectedStorage = { read: async (id: string) => localRows.get(id) ? new Uint8Array(localRows.get(id)!) : null, create: async (id: string, value: Uint8Array) => { if (localRows.has(id)) throw Error('exists'); localRows.set(id, new Uint8Array(value)); } };
    const f = fixture({ platform: 'win32', localProtectedStorage, loadBinding: () => { throw Error('Windows must never load keyring'); }, loadWindowsBinding: () => ({ Dpapi, isPlatformSupported: true }) }); const key = new Uint8Array(32).fill(45);
    await f.store.save(c, key); expect(await f.store.load(c)).toEqual(key);
    expect(scopes.slice(0, 4)).toEqual(['protect-CurrentUser', 'protect-LocalMachine', 'unprotect-LocalMachine', 'unprotect-CurrentUser']);
    expect(Array.from([...localRows.values()][0].slice(0, 2))).toEqual([2, 1]); expect(f.rows.size).toBe(0);
    expect(() => createWindowsDpapiProtector({ Dpapi, isPlatformSupported: false })).toThrow();
  });
});
