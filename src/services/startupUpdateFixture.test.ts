import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { STARTUP_UPDATE_FIXTURE, HOLD_UPDATE_WRITE, READ_UPDATE_BANNER_VISUALS } from '../../scripts/helpers/startupUpdateFixture';

describe('self-contained browser update fixtures', () => {
  it('evaluates visual-inspection code without serialized-function helper globals', () => {
    const text = { box: { left: 200, right: 700, top: 16, bottom: 40, width: 500, height: 24 }, style: { color: 'rgb(6, 95, 70)', backgroundColor: 'rgba(0, 0, 0, 0)' }, getBoundingClientRect() { return this.box; }, contains: () => false };
    const button = { ...text, box: { left: 900, right: 1060, top: 16, bottom: 56, width: 160, height: 40 }, style: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(6, 95, 70)' } };
    const sidebar = { getBoundingClientRect: () => ({ right: 184 }), contains: () => false };
    const banner = { ...text, box: { left: 184, right: 1280, top: 0, bottom: 72, width: 1096, height: 72 }, style: { color: 'rgb(6, 95, 70)', backgroundColor: 'rgb(209, 250, 229)' }, contains: () => true, querySelectorAll: (selector: string) => selector === 'p' ? [text] : [button] };
    const document = { documentElement: { dataset: { theme: 'light' } }, querySelector: (selector: string) => selector.includes('startup-update-banner') ? banner : sidebar, elementFromPoint: (x: number) => x >= button.box.left ? button : x >= text.box.left ? text : banner };
    const result = runInNewContext(READ_UPDATE_BANNER_VISUALS, { document, innerWidth: 1280, getComputedStyle: (element: typeof text) => element.style });
    expect(result).toMatchObject({ theme: 'light', sidebarRight: 184, banner: { left: 184 }, text: [{ unobscured: true }], buttons: [{ width: 160, height: 40, unobscured: true }] });
    // Another child of this same banner must not count as a visible measured control.
    document.elementFromPoint = () => text;
    const occluded = runInNewContext(READ_UPDATE_BANNER_VISUALS, { document, innerWidth: 1280, getComputedStyle: (element: typeof text) => element.style });
    expect(occluded.text[0].unobscured).toBe(true);
    expect(occluded.buttons[0].unobscured).toBe(false);

  });

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
