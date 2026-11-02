import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
class MemoryStorage implements Storage {
  values: Record<string, string> = {}; get length() { return Object.keys(this.values).length; }
  key(index: number) { return Object.keys(this.values)[index] ?? null; } getItem(key: string) { return this.values[key] ?? null; }
  setItem(key: string, value: string) { this.values[key] = String(value); } removeItem(key: string) { delete this.values[key]; } clear() { this.values = {}; }
}
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => { if (cleanup) await cleanup(); cleanup = null; vi.unstubAllGlobals(); vi.resetModules(); });
async function setup() {
  vi.stubGlobal('document', { documentElement: { classList: { toggle: () => {} }, dataset: {}, style: {} } });
  const storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', new MemoryStorage());
  const source = new OntarioTeacherDB('runtime-fixture-' + crypto.randomUUID()); await seedDatabase(source); const primary = JSON.parse(await new PortabilityService(source).createFullBackupJSON()); await source.delete();
  primary.tables.userPreferences[0].chicletDisplay = { primaryTitleFormat: 'code_only', showRoom: false, showPeriod: true };
  const initial = { format: 'student-organizer-working', version: 1, primary, recovery: { backups: [], options: [], state: [] }, applicationStorage: { 'student-organizer-appearance': 'dark' } };
  let current = structuredClone(initial), revision = 1, commitCount = 0, lockCount = 0, paused: Promise<void> | null = null, started: () => void = () => {};
  const bridge: any = {
    status: async () => ({ ok: true, value: { mode: 'encrypted', appId: 'student-organizer', vaultId: 'synthetic', deviceId: 'device-synthetic', keyVersion: 1, state: 'unlocked', activationReady: false, ephemeralPartition: true, revision } }),
    read: async () => ({ ok: true, value: { revision, snapshot: structuredClone(current) } }), unlock: async () => ({ ok: true, value: { revision } }),
    selectActingTeacher: async () => ({ ok: true, value: null }),
    commitDelta: async (expected: number, changes: any[]) => { started(); if (paused) await paused; if (expected !== revision) return { ok: false, code: 'stale', message: 'synthetic' }; const candidate: any = structuredClone(current); for (const change of changes) { if (change.namespace === 'storage') { if (change.deleted) delete candidate.applicationStorage[change.key]; else candidate.applicationStorage[change.key] = change.value; } else { const tables = change.namespace === 'primary' ? candidate.primary.tables : candidate.recovery; const rows = tables[change.table]; const index = rows.findIndex((row: any) => row.id === change.key); if (change.deleted) { if (index >= 0) rows.splice(index,1); } else if (index >= 0) rows[index] = change.value; else rows.push(change.value); } } current = candidate; revision++; commitCount++; return { ok: true, value: { revision } }; },
    commit: async (expected: number, candidate: any) => { started(); if (paused) await paused; if (expected !== revision) return { ok: false, code: 'stale', message: 'synthetic' }; current = structuredClone(candidate); revision++; commitCount++; return { ok: true, value: { revision } }; },
    lock: async () => { lockCount++; return { ok: true, value: null }; }
  };
  vi.stubGlobal('window', { desktopEncryption: bridge, localStorage: storage, addEventListener: () => {} });
  vi.resetModules(); const runtime = await import('./encryptedRuntime'); const status = (await bridge.status()).value;
  await runtime.initializeEncryptedRuntime(status, bridge); const { db } = await import('../db/database'); const { recoveryStore } = await import('../sync/backupStore');
  cleanup = async () => { runtime.lockEncryptedRuntime(); db.close(); recoveryStore.close(); await db.delete(); await recoveryStore.delete(); };
  return { runtime, storage, bridge, db, commits: () => commitCount, locks: () => lockCount, saved: () => structuredClone(current), pause: () => { let release!: () => void, notify!: () => void; paused = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { notify = resolve; }); started = notify; return { entered, release: () => { paused = null; release(); } }; } };
}
describe('encrypted renderer private persistence', () => {
  it('denies writes through reads and expires retained read/write facades', async () => {
    const f = await setup(); let retained!: Storage;
    await expect(f.runtime.privateStorageRead(storage => storage.setItem('student-organizer-appearance', 'light'))).rejects.toThrow(/reads cannot/);
    await f.runtime.privateStorageRead(storage => { retained = storage; expect(storage.getItem('student-organizer-appearance')).toBe('dark'); }); expect(() => retained.getItem('student-organizer-appearance')).toThrow(/ended/);
    await f.runtime.privateStorageWrite(storage => { retained = storage; storage.setItem('student-organizer-appearance', 'light'); }); expect(() => retained.setItem('student-organizer-appearance', 'dark')).toThrow(/ended/); expect(f.saved().applicationStorage['student-organizer-appearance']).toBe('light'); expect(f.commits()).toBe(1);
  });
  it('mirrors accepted snapshots only and applies removal without exposing the following pending save', async () => {
    const f = await setup(), held = f.pause(); const first = f.runtime.privateStorageWrite(storage => storage.setItem('student-organizer-appearance', 'light')); await held.entered;
    expect(f.storage.getItem('student-organizer-appearance')).toBe('dark'); let readDone = false; const reading = f.runtime.privateStorageRead(storage => storage.getItem('student-organizer-appearance')).then(value => { readDone = true; return value; }); await new Promise(resolve => setTimeout(resolve, 10)); expect(readDone).toBe(false); held.release(); await first; expect(await reading).toBe('light');
    await f.runtime.privateStorageWrite(storage => storage.removeItem('student-organizer-appearance')); expect(f.storage.getItem('student-organizer-appearance')).toBeNull(); expect(f.saved().applicationStorage).not.toHaveProperty('student-organizer-appearance');
  });
  it('always notifies lock subscribers and native key lock even if DOMStorage cleanup throws', async () => {
    const f = await setup(); let hidden = false; f.runtime.encryptedRuntimeStatus.subscribe(() => { hidden = true; });
    Object.defineProperty(f.storage, 'length', { get: () => { throw Error('Synthetic blocked DOM storage'); } }); expect(() => f.runtime.lockEncryptedRuntime()).not.toThrow(); await Promise.resolve(); await Promise.resolve(); expect(hidden).toBe(true); expect(f.locks()).toBeGreaterThan(0); expect(f.runtime.encryptedRuntimeStatus.getSnapshot()).toBe('locked');
  });
  it('serializes native catalog revisions with following private saves and locks on an unknown revision', async () => {
    const f = await setup();
    await f.runtime.protectedNativeMutation(async expected => (await f.bridge.commitDelta(expected, [])).value);
    await f.runtime.privateStorageWrite(storage => storage.setItem('student-organizer-appearance', 'light')); expect(f.commits()).toBe(2);
    await expect(f.runtime.protectedNativeMutation(async () => ({ revision: 999 }))).rejects.toThrow(/not verified/); expect(f.runtime.encryptedRuntimeStatus.getSnapshot()).toBe('locked');
  });
  it('preserves user-scoped class display preferences while binding this computer independently', async () => {
    const f = await setup(), preference = await f.db.userPreferences.toCollection().first();
    expect(preference?.chicletDisplay).toEqual({ primaryTitleFormat: 'code_only', showRoom: false, showPeriod: true });
    expect(f.storage.getItem('ontario_teacher_device_id')).toBe('device-synthetic');
    expect(f.saved().primary.tables.userPreferences[0].chicletDisplay).toEqual(preference?.chicletDisplay);
  });
  it('fails closed if protected launch is not independently marked as an ephemeral partition', async () => {
    const f = await setup(); await expect(f.runtime.initializeEncryptedRuntime({ ...(await f.bridge.status()).value, ephemeralPartition: false }, f.bridge)).rejects.toThrow(/isolated memory/);
  });
});
