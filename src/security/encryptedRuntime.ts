import { getIdentityEpoch } from '../services/identityService';
import type { OntarioTeacherDB } from '../db/database';
import type { RecoveryStore } from '../sync/backupStore';
import type { StudentOrganizerWorkingBundle } from './studentOrganizerSource';
import { WorkingDelta } from './workingDelta';
import { DurableDexieGate } from './durableDexieGate';
import { privateStorageKey, validateEncryptedBundle } from './validateEncryptedBundle';
import { rendererStorageMode, setRendererStorageMode } from './rendererStorageMode';
import { unwrapEncryption, type DesktopEncryption, type EncryptionStatus } from './encryptionBridge';

let gate: DurableDexieGate | null = null;
let storage: Record<string, string> = {};
let revision = 0;
let bridge: DesktopEncryption | null = null;
const listeners = new Set<() => void>();
export const encryptedRuntimeStatus = { subscribe: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; }, getSnapshot: rendererStorageMode };
export function lockEncryptedRuntime(): void {
  if (rendererStorageMode() === 'legacy') return;
  gate?.lock(); storage = {}; setRendererStorageMode('locked');
  // Cleanup is best-effort; a Storage exception cannot keep the App visible or native keys unlocked.
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) { const key = localStorage.key(index); if (key && privateStorageKey(key)) localStorage.removeItem(key); }
  } catch { /* The isolated renderer is still locked and will be discarded on secure reopen. */ }
  finally {
    const native = bridge; if (native) void Promise.resolve().then(() => native.lock()).catch(() => {});
    for (const callback of listeners) { try { callback(); } catch { /* Another subscriber must still hide protected content. */ } }
  }
}
let mirroredRevision = 0;
function scopedStorage(values: Record<string, string>, writable: boolean, token: { active: boolean }): Storage {
  const check = () => { if (!token.active) throw Error('Private storage access has ended.'); };
  const change = () => { check(); if (!writable) throw Error('Private storage reads cannot change saved data.'); };
  return {
    get length() { check(); return Object.keys(values).length; }, key: index => { check(); return Object.keys(values)[index] ?? null; },
    getItem: key => { check(); return values[key] ?? null; },
    setItem: (key, value) => { change(); if (!privateStorageKey(key)) throw Error('Unsupported private storage key.'); values[key] = String(value); },
    removeItem: key => { change(); delete values[key]; }, clear: () => { change(); for (const key of Object.keys(values)) delete values[key]; }
  };
}
export async function privateStorageRead<T>(read: (source: Storage) => T): Promise<T> {
  if (rendererStorageMode() === 'legacy') return legacyCaptureGate ? legacyCaptureGate.readBarrier(async () => read(globalThis.localStorage)) : read(globalThis.localStorage);
  if (rendererStorageMode() !== 'encrypted' || !gate) throw Error('Encrypted workspace is locked.');
  return gate.readBarrier(async () => {
    const token = { active: true }, values = { ...storage };
    try { return await read(scopedStorage(values, false, token)); } finally { token.active = false; }
  });
}
export async function privateStorageWrite<T>(write: (target: Storage) => T): Promise<T> {
  if (rendererStorageMode() === 'legacy') return legacyCaptureGate ? legacyCaptureGate.externalWrite(async () => write(globalThis.localStorage)) : write(globalThis.localStorage);
  if (rendererStorageMode() !== 'encrypted' || !gate) throw Error('Encrypted workspace is locked.');
  let accepted: Record<string, string> | null = null, acceptedRevision = 0;
  try {
    const value = await gate.externalWrite(async () => {
      const token = { active: true }, candidate = { ...storage };
      try {
        const result = await write(scopedStorage(candidate, true, token));
        storage = { ...candidate }; accepted = { ...candidate }; acceptedRevision = revision + 1;
        return result;
      } finally { token.active = false; }
    });
    if (rendererStorageMode() !== 'encrypted') throw Error('Encrypted workspace is locked.');
    // Mirror exactly this accepted revision, never a following write's pending candidate.
    if (accepted && acceptedRevision >= mirroredRevision) {
      for (let index = localStorage.length - 1; index >= 0; index--) { const key = localStorage.key(index); if (key && privateStorageKey(key) && !(key in accepted)) localStorage.removeItem(key); }
      for (const [key, content] of Object.entries(accepted as Record<string, string>)) localStorage.setItem(key, content);
      mirroredRevision = acceptedRevision;
    }
    return value;
  } catch { lockEncryptedRuntime(); throw Error('The encrypted private save was not verified. Reopen the workspace before retrying.'); }
}
export async function initializeEncryptedRuntime(status: EncryptionStatus, native: DesktopEncryption): Promise<void> {
  if (status.mode !== 'encrypted' || status.appId !== 'student-organizer' || status.ephemeralPartition !== true || typeof status.deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(status.deviceId)) throw Error('Protected launch requires an isolated memory partition.');
  bridge = native; setRendererStorageMode('bootstrapping');
  try {
    if (status.state !== 'unlocked') unwrapEncryption(await native.unlock());
    const loaded = unwrapEncryption(await native.read());
    if (!Number.isSafeInteger(loaded.revision) || loaded.revision < 1) throw Error('Invalid protected revision.');
    const { db } = await import('../db/database'); const { recoveryStore } = await import('../sync/backupStore');
    const bundle = await validateEncryptedBundle(loaded.snapshot, db);
    await hydrate(db, recoveryStore, bundle); revision = loaded.revision; mirroredRevision = revision; storage = { ...bundle.applicationStorage, ontario_teacher_device_id: status.deviceId };
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    const appearance = await import('../services/theme'); appearance.applyTheme(appearance.readTheme());
    const identity = await import('../services/identityService'); identity.clearActiveTeacherId();
    // The gate rereads only mutated tables; unchanged photo/history bodies stay in its accepted cache.
    const delta = new WorkingDelta(bundle.primary.tables, bundle.recovery, bundle.applicationStorage);
    const coordinator = new DurableDexieGate(async (_snapshots, assertCurrent, dirty) => {
      const pending = delta.prepare(dirty.get(db) ?? {}, dirty.get(recoveryStore) ?? {}, storage);
      assertCurrent();
      const saved = unwrapEncryption(await native.commitDelta(revision, pending.changes)); assertCurrent();
      if (saved.revision !== revision + 1) throw Error('Protected save revision mismatch.');
      pending.accept(); revision = saved.revision;
    }, () => { const epoch = identity.getIdentityEpoch(); return () => { if (epoch !== identity.getIdentityEpoch()) throw Error('Teacher context changed during protected storage access.'); }; }, lockEncryptedRuntime);
    coordinator.register(db, bundle.primary.tables); coordinator.register(recoveryStore, bundle.recovery); gate = coordinator; setRendererStorageMode('encrypted');
    // Any durable boundary failure must hide the App. It must never resume on the old plaintext partition.
    window.addEventListener('beforeunload', lockEncryptedRuntime, { once: true });
  } catch { lockEncryptedRuntime(); throw Error('The encrypted workspace could not be opened or verified. Keep the original workspace and use verified recovery.'); }
}
async function hydrate(db: OntarioTeacherDB, recovery: RecoveryStore, bundle: StudentOrganizerWorkingBundle): Promise<void> {
  await db.open(); await recovery.open();
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) { await table.clear(); await table.bulkPut(bundle.primary.tables[table.name]); } });
  await recovery.transaction('rw', recovery.tables, async () => { await recovery.backups.clear(); await recovery.options.clear(); await recovery.state.clear(); await recovery.backups.bulkPut(bundle.recovery.backups); await recovery.options.bulkPut(bundle.recovery.options); await recovery.state.bulkPut(bundle.recovery.state); });
}

let legacyCaptureGate: DurableDexieGate | null = null;
/** Migration coordination preserves explicit legacy storage until conversion; it does not label it encrypted. */
export async function installLegacyCaptureGate(database: OntarioTeacherDB, recovery: RecoveryStore): Promise<DurableDexieGate> {
  if (rendererStorageMode() !== 'legacy') throw Error('Encryption preparation requires the preserved original workspace.');
  if (!legacyCaptureGate) {
    await database.open(); await recovery.open();
    // Existing persistent IDB remains the legacy authority. The gate only freezes concurrent capture.
    legacyCaptureGate = new DurableDexieGate(async (_snapshots, assertCurrent) => { assertCurrent(); }, () => { const epoch = getIdentityEpoch(); return () => { if (epoch !== getIdentityEpoch()) throw Error('Teacher changed during encryption preparation.'); }; });
    legacyCaptureGate.register(database); legacyCaptureGate.register(recovery);
  }
  return legacyCaptureGate;
}

/** Bind native exports/imports to the current accepted revision without allowing concurrent renderer writers. */
export async function protectedStorageBoundary<T>(action: () => Promise<T>): Promise<T> {
  if (rendererStorageMode() !== 'encrypted' || !gate) throw Error('Encrypted workspace is locked.');
  return gate.readBarrier(async () => action());
}

/** The old renderer must not resume its original source after a native mode transition. */
export function pauseForNativeTransition(): void {
  gate?.lock(); legacyCaptureGate?.lock(); storage = {}; setRendererStorageMode('locked');
  for (const callback of listeners) { try { callback(); } catch { /* All observers must still hide the App. */ } }
}

/** Native-only catalog changes share the same serialization/revision boundary as renderer writes. */
export async function protectedNativeMutation<T extends { revision: number }>(action: (expectedRevision: number) => Promise<T>): Promise<T> {
  if (rendererStorageMode() !== 'encrypted' || !gate) throw Error('Encrypted workspace is locked.');
  try {
    return await gate.readBarrier(async () => {
      const before = revision, result = await action(before);
      if (result.revision !== before && result.revision !== before + 1) throw Error('Protected save revision mismatch.');
      revision = result.revision; return result;
    });
  } catch { lockEncryptedRuntime(); throw Error('The native encrypted change was not verified. Reopen the workspace before retrying.'); }
}
