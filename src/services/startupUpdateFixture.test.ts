import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { STARTUP_UPDATE_FIXTURE, HOLD_UPDATE_WRITE } from '../../scripts/helpers/startupUpdateFixture';

describe('self-contained browser update fixtures', () => {
  it('initializes and runs every bridge method without Node/tsx helper globals', async () => {
    const context = { window: {} as any };
    runInNewContext(STARTUP_UPDATE_FIXTURE, context);
    const bridge = context.window.desktopUpdates, state = context.window.__updates;
    expect(bridge.mode).toBe('github-release');
    expect(await bridge.startupStatus()).toMatchObject({ status: 'available', version: '1.0.2' });
    expect(state.startupReads).toBe(1); expect(state.checks).toBe(0);
    expect(await bridge.check()).toMatchObject({ status: 'available' });
    expect(await bridge.status()).toMatchObject({ status: 'idle' });
    const cancelled = bridge.download(); expect(await bridge.status()).toMatchObject({ status: 'downloading' });
    await bridge.cancel(); expect(await cancelled).toMatchObject({ status: 'cancelled' });
    const complete = bridge.download(); state.finish({ status: 'downloaded', signature: 'valid' });
    expect(await complete).toMatchObject({ status: 'downloaded' });
    expect(await bridge.install('fictional backup', false)).toMatchObject({ status: 'installing' });
    expect(state.backup).toBe('fictional backup'); expect(state.acknowledge).toBe(false); expect(state.installs).toBe(1);
  });
  it('holds and releases real IndexedDB writes with no serialized-function dependencies', async () => {
    const indexedDB = new IDBFactory();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('OntarioTeacherAssessmentDB');
      opening.onupgradeneeded = () => opening.result.createObjectStore('users');
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const context = { window: {} as any, indexedDB };
    await runInNewContext(HOLD_UPDATE_WRITE, context);
    let committed = false;
    const completion = new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('users', 'readwrite');
      transaction.objectStore('users').put('fictional teacher', 'fictional-id');
      transaction.oncomplete = () => { committed = true; resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(committed).toBe(false);
    } finally { context.window.__releaseUpdateWrite(); await completion; database.close(); }
    expect(committed).toBe(true);
  });
});
