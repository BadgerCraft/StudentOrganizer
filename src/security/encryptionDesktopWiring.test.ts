import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
async function fixture(mode: 'legacy' | 'encrypted' | 'enrollment-pending', failStart = false) {
  const handlers = new Map<string, any>(), windows: any[] = [], violations: string[] = [], routes: string[] = [];
  let runtimeLocks = 0, hostLocks = 0, quits = 0, runtimeClosed = false;
  const app: any = Object.assign(new EventEmitter(), { requestSingleInstanceLock: () => true, quit: () => { quits++; }, isPackaged: false, getVersion: () => '1.0.0', getPath: (name: string) => path.resolve('/synthetic-desktop', name), whenReady: () => Promise.resolve() });
  class FakeWindow extends EventEmitter {
    static getAllWindows() { return windows.filter(w => !w.destroyed); }
    destroyed = false; options: any; webContents: any; loaded: any; hidden = false;
    constructor(options: any) {
      super(); this.options = options;
      const memory = Boolean(options.webPreferences.partition);
      this.webContents = Object.assign(new EventEmitter(), { session: Object.assign(new EventEmitter(), { isPersistent: () => !memory, storagePath: memory ? null : '/synthetic-persistent', webRequest: { onBeforeRequest() {} } }), stop() {}, setWindowOpenHandler() {} }); windows.push(this);
    }
    loadFile(...args: any[]) { this.loaded = args; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); app.emit('window-all-closed'); }
    show() {} hide() { this.hidden = true; } isMinimized() { return false; } restore() {} focus() {}
  }
  const host = { status: () => ({ state: 'locked', appId: 'student-organizer', vaultId: 'synthetic', keyVersion: 1, revision: null }), lock: () => { hostLocks++; } };
  const runtime = { status: () => ({ mode, activationReady: false, deviceId: 'device-synthetic', appId: 'student-organizer', vaultId: 'synthetic', keyVersion: 1 }), getHost: () => { if (runtimeClosed) throw Error('closed native runtime'); return host; }, refreshMode: async () => {}, lockNow: () => { runtimeLocks++; }, close() { runtimeClosed = true; }, cancelEnrollment: async () => {}, cancelOfflineRecovery: () => { if (runtimeClosed) throw Error('closed native runtime'); } };
  const transport = (label: string) => Object.fromEntries(['status', 'connect', 'list', 'download', 'upload', 'cancel', 'disconnect'].map(method => [method, () => { routes.push(label + ':' + method); return { configured: false }; }]));
  const localRequire = (id: string): any => {
    if (id === 'electron') return { app, BrowserWindow: FakeWindow, Menu: { setApplicationMenu() {}, buildFromTemplate: (x: any) => x }, ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn) }, session: {}, dialog: { showErrorBox: (_title: string, detail: string) => violations.push(detail) }, shell: {}, systemPreferences: {} };
    if (id === './manualUpdater.cjs') return { trustedCaller: (event: any) => event === 'trusted', createManualCheck: () => async () => ({}) };
    if (id === './captureDriveAuth.cjs') return { readConfig: () => null, authorizeDesktop: () => { throw Error('not authorized'); } };
    if (id === './captureDrive.cjs') return { createCaptureDrive: () => transport('capture'), DriveError: class extends Error {} };
    if (id === './organizerDrive.cjs') return { createOrganizerDrive: () => transport('legacy') };
    if (id === './encryptedOrganizerDrive.cjs') return { createEncryptedOrganizerDrive: ({ host: capability }: any) => { expect(capability).toHaveProperty('assertTransferContext'); expect(capability).not.toBe(host); return transport('encrypted'); } };
    if (id === './windowsInstallerUpdate.cjs') return { isInstalledNsis: () => false, configureUpdaterSession() {}, createInstallerUpdate: () => ({ status: () => ({ installationAvailable: true }), install: () => { routes.push('plaintext-install'); } }) };
    if (id === './reportPdf.cjs') return { createReportPdfExporter: () => () => { routes.push('pdf'); return {}; } };
    if (id === './dictationIpc.cjs') return { attachDictation() {} };
    if (id === './encryptionNativeRuntime.cjs') return { createNativeEncryptionRuntime: async () => { if (failStart) throw Error('PRIVATE_INIT_DETAILS'); return runtime; } };
    if (id === './structuredEncryptionHost.cjs') return { createStructuredEncryptionHost() {} };
    if (id.includes('generated/encryption/src/security/mainBundleValidation')) return { validateMainBundleIntegrity: async (value: any) => value, assertMainFullWorkspaceAuthority: async () => {} };
    if (id.startsWith('./')) return require('../../electron/' + id.slice(2));
    return require(id);
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8'), { require: localRequire, __dirname: path.resolve('electron'), process: { platform: 'win32', env: {} }, URL, Buffer, console });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return { handlers, windows, violations, routes, app, locks: () => ({ runtimeLocks, hostLocks }), quits: () => quits };
}
describe('actual Electron main wiring with synthetic native dependencies', () => {
  it.each(['encrypted', 'enrollment-pending'] as const)('chooses an ephemeral partition and protected marker before loading %s', async mode => {
    const f = await fixture(mode), window = f.windows[0]; expect(window.options.webPreferences.partition).not.toMatch(/^persist:/); expect(window.loaded[1]).toEqual({ hash: 'encrypted-workspace' });
    expect((await f.handlers.get('encryption:status')('trusted')).value.ephemeralPartition).toBe(true);
    await f.handlers.get('organizer-drive:status')('trusted'); expect(f.routes).toContain('encrypted:status'); expect(f.routes).not.toContain('legacy:status');
    let denied = false; window.webContents.session.emit('will-download', { preventDefault: () => { denied = true; } }); expect(denied).toBe(true);
    expect(await f.handlers.get('assessment-report:pdf')('trusted', 'fictional.pdf', '<p>fictional</p>')).toMatchObject({ ok: false }); expect(f.routes).not.toContain('pdf');
    expect(() => f.handlers.get('installer-update:install')('trusted', '{}', false)).toThrow(); expect(f.routes).not.toContain('plaintext-install');
    await f.handlers.get('encryption:lock')('trusted'); expect(f.locks().runtimeLocks).toBeGreaterThan(0);
  });
  it('preserves the original legacy partition and plaintext feature routes until explicit conversion', async () => {
    const f = await fixture('legacy'), window = f.windows[0]; expect(window.options.webPreferences.partition).toBeUndefined(); expect(window.loaded[1]).toBeUndefined();
    await f.handlers.get('organizer-drive:status')('trusted'); expect(f.routes).toContain('legacy:status'); await f.handlers.get('assessment-report:pdf')('trusted', 'fictional.pdf', '<p>fictional</p>'); expect(f.routes).toContain('pdf');
  });
  it('opens no fallback window when native startup fails and sanitizes the diagnostic', async () => {
    const f = await fixture('encrypted', true); expect(f.windows).toHaveLength(0); expect(f.quits()).toBe(1); expect(f.violations.join()).not.toContain('PRIVATE_INIT_DETAILS'); expect(f.violations.join()).toContain('No plaintext fallback');
  });
  it('locks both host and runtime on missing preload and same-document marker removal', async () => {
    const f = await fixture('encrypted'), window = f.windows[0]; window.webContents.emit('preload-error', {}, 'privatepath', Error('PRIVATE')); expect(window.hidden).toBe(true); expect(f.locks().runtimeLocks).toBeGreaterThan(0);
    expect(f.violations.join()).not.toContain('PRIVATE');
  });
  it('does not reopen or query a closed runtime when windows finish closing after quit', async () => {
    const f = await fixture('encrypted'); expect(() => f.app.emit('before-quit')).not.toThrow(); const locks = f.locks().runtimeLocks;
    expect(() => f.windows[0].emit('closed')).not.toThrow(); expect(() => f.app.emit('before-quit')).not.toThrow(); expect(f.locks().runtimeLocks).toBe(locks);
  });
});
