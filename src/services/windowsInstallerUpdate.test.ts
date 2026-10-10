import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { CancellationToken } = require('builder-util-runtime');
const { TABLES, validateBackup, saveBackup, assertWritableInstallation, inspectSignature, isInstalledNsis, validateManifest, allowedUpdateRequest, sanitizeHeaders, installAndReopen, createInstallerUpdate } = require('../../electron/windowsInstallerUpdate.cjs');
const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
const sha512 = Buffer.alloc(64, 7).toString('base64');
const manifest = { version: '1.0.1', files: [{ url: 'OntarioTeacherAssessment-1.0.1-x64-nsis.exe', sha512 }] };
const backupJSON = JSON.stringify({ version: 2, schemaVersion: 4, exportedAt: new Date().toISOString(), tables: Object.fromEntries(TABLES.map((name: string) => [name, []])) });
function setup(options: Record<string, unknown> = {}) {
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => ({ updateInfo: manifest })),
    installerPath: '/cache/installer.exe',
    downloadUpdate: vi.fn(async (_token?: any) => ['/cache/installer.exe']), quitAndInstall: vi.fn(),
    downloadedUpdateHelper: { clear: vi.fn(async () => {}) },
    httpExecutor: { request: vi.fn() }
  });
  const backup = vi.fn(async () => '/local/userData/update-backups/backup.json');
  const hash = vi.fn(async () => sha512);
  const signature = vi.fn(async () => ({ signature: 'unsigned' }));
  const controller = createInstallerUpdate({ supported: true, currentVersion: '1.0.0', userData: '/local/userData', arch: 'x64', updater,
    tokenFactory: () => new CancellationToken(), backup, hash, signature, canReplace: async () => {}, launch: async () => updater.quitAndInstall(true, true), ...options });
  return { updater, controller, backup, hash, signature };
}
describe('explicit local-backup-first Windows installer updates', () => {
  it('requires actual installed NSIS, rejects portable, unpackaged and other platforms', () => {
    const input = { platform: 'win32', packaged: true, env: {}, exePath: 'C:/installed/app.exe', exists: vi.fn(() => true) };
    expect(isInstalledNsis(input)).toBe(true);
    for (const overrides of [{ platform: 'darwin' }, { packaged: false }, { env: { PORTABLE_EXECUTABLE_FILE: 'app.exe' } }, { env: { PORTABLE_EXECUTABLE_DIR: '/tmp' } }, { exists: () => false }]) expect(isInstalledNsis({ ...input, ...overrides })).toBe(false);
  });
  it('has no startup network and disables automatic download, quit-install, prerelease and downgrade', () => {
    const { updater, controller } = setup();
    expect(controller.status()).toMatchObject({ status: 'idle', installationAvailable: true });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, autoRunAppAfterInstall: true, allowPrerelease: false, allowDowngrade: false, disableWebInstaller: true, disableDifferentialDownload: true });
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'github', owner: 'BadgerCraft', repo: 'StudentOrganizer', private: false });
  });
  it('restricts update transport to the public repository and release CDN without student/device headers', async () => {
    for (const url of ['https://github.com/BadgerCraft/StudentOrganizer/releases.atom', 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest', 'https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.1/update.exe', 'https://release-assets.githubusercontent.com/asset?signature=public']) expect(allowedUpdateRequest(url)).toBe(true);
    for (const url of ['http://github.com/BadgerCraft/StudentOrganizer/releases.atom', 'https://github.com/Other/StudentOrganizer/releases.atom', 'https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1/../../other', 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest?student=x', 'https://github.com.evil.test/BadgerCraft/StudentOrganizer/releases.atom', 'https://user@github.com/BadgerCraft/StudentOrganizer/releases.atom']) expect(allowedUpdateRequest(url)).toBe(false);
    expect(allowedUpdateRequest('https://release-assets.githubusercontent.com/asset', 'POST')).toBe(false);
    expect(sanitizeHeaders({ Cookie: 'teacher=x', Referer: 'class=x', Authorization: 'secret', 'x-user-staging-id': 'device-id', Accept: 'application/xml', Range: 'bytes=0-999' })).toEqual({ Accept: 'application/xml', Range: 'bytes=0-999', 'User-Agent': 'StudentOrganizer-explicit-Windows-update' });
    const { updater } = setup();
    expect(await (updater as any).getOrCreateStagingUserId()).toBe('00000000-0000-4000-8000-000000000000');
    expect((updater as any).computeFinalHeaders({ 'x-user-staging-id': 'device-id' })).not.toHaveProperty('x-user-staging-id');
    expect(() => validateManifest({ ...manifest, stagingPercentage: 90 }, '1.0.0', 'x64')).toThrow();
  });
  it('rejects missing hashes, URLs/paths, portable installers, prereleases and web packages', () => {
    expect(validateManifest(manifest, '1.0.0', 'x64')).toBe(true);
    expect(validateManifest(manifest, '1.0.1', 'x64')).toBe(false);
    for (const info of [{ ...manifest, version: '1.1.0-beta' }, { ...manifest, packages: {} }, { ...manifest, files: [] }, { ...manifest, files: [{ ...manifest.files[0], sha512: '' }] }, { ...manifest, files: [{ ...manifest.files[0], url: 'https://evil.test/update.exe' }] }, { ...manifest, files: [{ ...manifest.files[0], url: '../update.exe' }] }, { ...manifest, files: [{ ...manifest.files[0], url: manifest.files[0].url.replace('nsis', 'Portable') }] }]) expect(() => validateManifest(info, '1.0.0', 'x64')).toThrow();
  });
  it('accepts the QA current identity only when moving to a stable release', () => {
    expect(validateManifest(manifest, '1.0.1-qa.185.1', 'x64')).toBe(true);
  });
  it('backs up only complete current-schema records and detects duplicate IDs', () => {
    expect(() => validateBackup(backupJSON)).not.toThrow();
    for (const json of ['', '{}', JSON.stringify({ ...JSON.parse(backupJSON), schemaVersion: 3 }), JSON.stringify({ ...JSON.parse(backupJSON), tables: {} })]) expect(() => validateBackup(json)).toThrow();
    const duplicate = JSON.parse(backupJSON); duplicate.tables.students = [{ id: 'x' }, { id: 'x' }];
    expect(() => validateBackup(JSON.stringify(duplicate))).toThrow();
  });
  it('persists an atomic backup and reads back the exact bytes without leaving temp files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'installer-backup-'));
    try {
      const file = await saveBackup(backupJSON, directory);
      expect(await readFile(file, 'utf8')).toBe(backupJSON);
      expect(await readdir(path.join(directory, 'update-backups'))).toHaveLength(1);
      await expect(saveBackup('{}', directory)).rejects.toThrow();
      expect(await readdir(path.join(directory, 'update-backups'))).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('proves directory writability with an actual exclusive create/delete before allowing replacement', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'installer-write-proof-'));
    try {
      await assertWritableInstallation(directory); expect(await readdir(directory)).toEqual([]);
      await expect(assertWritableInstallation(path.join(directory, 'missing'))).rejects.toMatchObject({ code: 'ERR_INSTALL_ELEVATION_REQUIRED' });
      const { controller, updater } = setup({ canReplace: async () => { throw Object.assign(new Error('no write permission'), { code: 'ERR_INSTALL_ELEVATION_REQUIRED' }); } });
      await controller.download();
      expect(await controller.install(backupJSON, true)).toMatchObject({ status: 'error', error: expect.stringContaining('per-user installation') });
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('requires a fresh backup and unsigned approval, then rehashes before one explicit installer call', async () => {
    const { updater, controller, backup, hash, signature } = setup();
    expect(await controller.download()).toMatchObject({ status: 'downloaded', version: '1.0.1', signature: 'unsigned', percent: 100 });
    expect(await controller.install(backupJSON, false)).toMatchObject({ status: 'downloaded' });
    expect(backup).not.toHaveBeenCalled(); expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(await controller.install(backupJSON, true)).toMatchObject({ status: 'installing', backupPath: '/local/userData/update-backups/backup.json' });
    expect(backup).toHaveBeenCalledWith(backupJSON, '/local/userData');
    expect(hash).toHaveBeenCalledTimes(2); expect(signature).toHaveBeenCalledTimes(2);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    await controller.install(backupJSON, true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it('never installs after backup failure, checksum changes or invalid Windows signature', async () => {
    for (const failure of ['backup', 'hash', 'signature']) {
      const { updater, controller, backup, hash, signature } = setup();
      await controller.download();
      if (failure === 'backup') backup.mockRejectedValueOnce(new Error('disk full'));
      if (failure === 'hash') hash.mockResolvedValueOnce('different');
      if (failure === 'signature') signature.mockRejectedValueOnce(new Error('invalid'));
      expect(await controller.install(backupJSON, true)).toMatchObject({ status: 'error' });
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      expect(updater.downloadedUpdateHelper.clear).toHaveBeenCalled();
    }
  });
  it('does not download unchanged versions and cleans interrupted state for retry', async () => {
    const { updater, controller } = setup();
    updater.checkForUpdates.mockResolvedValueOnce({ updateInfo: { ...manifest, version: '1.0.0' } });
    expect(await controller.download()).toMatchObject({ status: 'current' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    updater.downloadUpdate.mockRejectedValueOnce(new Error('network lost'));
    expect(await controller.download()).toMatchObject({ status: 'error' });
    expect(await controller.download()).toMatchObject({ status: 'downloaded' });
    await controller.cancel();
    expect(await controller.install(backupJSON, true)).toMatchObject({ status: 'cancelled' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('serializes download calls and cancels active transport without installation', async () => {
    const { updater, controller } = setup();
    updater.downloadUpdate.mockImplementationOnce((token: any) => token.createPromise(() => {}));
    const pending = controller.download();
    await vi.waitFor(() => expect(controller.status().status).toBe('downloading'));
    expect(await controller.download()).toMatchObject({ status: 'downloading' });
    await controller.cancel();
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(await controller.download()).toMatchObject({ status: 'downloaded' });
  });
  it('bounds metadata/download operations and clears partial data for retry', async () => {
    const { updater, controller } = setup({ downloadTimeout: 20 });
    updater.downloadUpdate.mockImplementationOnce((token: any) => token.createPromise(() => {}));
    expect(await controller.download()).toMatchObject({ status: 'error', error: expect.stringContaining('timed out') });
    expect(await controller.download()).toMatchObject({ status: 'downloaded' });
  });
  it('honors cancellation during both checksum and Windows signature verification', async () => {
    for (const stage of ['hash', 'signature']) {
      const { updater, controller, hash, signature } = setup();
      let release!: (value: any) => void;
      const slow = new Promise(resolve => { release = resolve; });
      if (stage === 'hash') hash.mockImplementationOnce(() => slow as Promise<string>);
      else signature.mockImplementationOnce(() => slow as Promise<{ signature: string }>);
      const pending = controller.download();
      await vi.waitFor(() => expect(stage === 'hash' ? hash : signature).toHaveBeenCalled());
      await controller.cancel();
      release(stage === 'hash' ? sha512 : { signature: 'unsigned' });
      expect(await pending).toMatchObject({ status: 'cancelled' });
      expect(await controller.install(backupJSON, true)).toMatchObject({ status: 'cancelled' });
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
    }
  });
  it('rejects checksum mismatch at download and does not inspect or execute that file', async () => {
    const { controller, hash, signature, updater } = setup();
    hash.mockResolvedValueOnce('wrong');
    expect(await controller.download()).toMatchObject({ status: 'error' });
    expect(signature).not.toHaveBeenCalled(); expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('keeps unsupported builds inert', async () => {
    const { controller, updater } = setup({ supported: false });
    for (const result of [controller.status(), await controller.download(), await controller.install(backupJSON, true)]) expect(result).toMatchObject({ status: 'unsupported', installationAvailable: false });
    expect(updater.setFeedURL).not.toHaveBeenCalled(); expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
describe('native installer launch bridge using pinned NsisUpdater install/doInstall', () => {
  function nativeSetup() {
    const app = { version: '1.0.0', name: 'ontario-teacher-assessment', quit: vi.fn(), whenReady: async () => {} };
    const updater = new NsisUpdater(undefined, app);
    updater.logger = { info() {}, warn() {}, error() {} };
    updater.downloadedUpdateHelper = { file: 'C:/cache/verified-nsis.exe', downloadedFileInfo: { isAdminRightsRequired: false }, packageFile: null };
    const original = updater.spawnLog;
    const beforeQuit = vi.fn();
    return { updater, app, original, beforeQuit };
  }
  function child() { return Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() }); }
  it('keeps the app open until OS spawn succeeds and preserves standard silent/reopen arguments', async () => {
    const { updater, app, original, beforeQuit } = nativeSetup();
    const process = child(); const launchProcess = vi.fn(() => process);
    const pending = installAndReopen(updater, { launchProcess, beforeQuit });
    expect(app.quit).not.toHaveBeenCalled();
    expect(launchProcess).toHaveBeenCalledWith('C:/cache/verified-nsis.exe', ['--updated', '/S', '--force-run'], { stdio: 'ignore', env: undefined, detached: true });
    process.emit('spawn'); await pending;
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
    expect(beforeQuit).toHaveBeenCalledTimes(1); expect(updater.spawnLog).toBe(original);
  });
  it('keeps the app running and resets install state after asynchronous spawn failure', async () => {
    const { updater, app, original, beforeQuit } = nativeSetup();
    const process = child();
    const pending = installAndReopen(updater, { launchProcess: () => process, beforeQuit });
    process.emit('error', Object.assign(new Error('missing file'), { code: 'ENOENT' }));
    await expect(pending).rejects.toThrow();
    expect(app.quit).not.toHaveBeenCalled(); expect(beforeQuit).not.toHaveBeenCalled();
    expect(updater.quitAndInstallCalled).toBe(false); expect(updater.spawnLog).toBe(original);
  });
  it('blocks NSIS elevation fallback before launching a helper or closing the app', async () => {
    const { updater, app, beforeQuit } = nativeSetup();
    const first = child(), elevated = child(); const launchProcess = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(elevated);
    const oldResources = (process as any).resourcesPath; (process as any).resourcesPath = 'C:/resources';
    try {
      const pending = installAndReopen(updater, { launchProcess, beforeQuit });
      first.emit('error', Object.assign(new Error('elevation needed'), { code: 'EACCES' }));
      await expect(pending).rejects.toMatchObject({ code: 'ERR_INSTALL_ELEVATION_REQUIRED' });
      expect(launchProcess).toHaveBeenCalledTimes(1); expect(app.quit).not.toHaveBeenCalled();
      expect(updater.quitAndInstallCalled).toBe(false);
    } finally { (process as any).resourcesPath = oldResources; }
  });
  it('blocks an initial administrator-required installer without even spawning the helper', async () => {
    const { updater, app, beforeQuit } = nativeSetup();
    updater.downloadedUpdateHelper.downloadedFileInfo.isAdminRightsRequired = true;
    const launchProcess = vi.fn();
    const oldResources = (process as any).resourcesPath; (process as any).resourcesPath = 'C:/resources';
    try {
      await expect(installAndReopen(updater, { launchProcess, beforeQuit })).rejects.toMatchObject({ code: 'ERR_INSTALL_ELEVATION_REQUIRED' });
      expect(launchProcess).not.toHaveBeenCalled(); expect(app.quit).not.toHaveBeenCalled();
      expect(updater.quitAndInstallCalled).toBe(false);
    } finally { (process as any).resourcesPath = oldResources; }
  });
  it('bounds a hung spawn and blocks a late success after timeout', async () => {
    const { updater, app, beforeQuit } = nativeSetup(); const process = child();
    const pending = installAndReopen(updater, { launchProcess: () => process, beforeQuit, timeout: 20 });
    await expect(pending).rejects.toThrow('timed out');
    expect(process.kill).toHaveBeenCalled(); expect(app.quit).not.toHaveBeenCalled();
    process.emit('spawn'); await new Promise(resolve => setImmediate(resolve));
    expect(app.quit).not.toHaveBeenCalled(); expect(updater.quitAndInstallCalled).toBe(false);
  });
});
describe('Windows PowerShell signature subprocess contract', () => {
  it('uses matching system modules despite inherited PowerShell7 module paths and passes the filename as data', async () => {
    const file = "C:\\teacher's folder\\installer [1]; $(untrusted).exe";
    const execute = vi.fn(async () => ({ stdout: '{"status":"NotSigned","publisher":null}', stderr: '' }));
    expect(await inspectSignature(file, { execute, environment: {
      SystemRoot: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules',
      PSMODULEPATH: 'another incompatible module path', psmodulepath: 'third incompatible path',
      studentorganizer_signature_file: 'old file', PATH: 'existing path'
    } })).toEqual({ signature: 'unsigned' });
    const [command, args, options] = execute.mock.calls[0] as any;
    expect(command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(path.win32.isAbsolute(command)).toBe(true);
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    expect(args[4]).toContain("$ErrorActionPreference = 'Stop'");
    expect(args[4]).toContain('-LiteralPath $env:STUDENTORGANIZER_SIGNATURE_FILE');
    expect(args[4]).not.toContain(file);
    expect(options).toMatchObject({ windowsHide: true, timeout: 15000, maxBuffer: 16384 });
    expect(options.env).toEqual({ SystemRoot: 'C:\\Windows', PATH: 'existing path',
      PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules', STUDENTORGANIZER_SIGNATURE_FILE: file });
    expect(Object.keys(options.env).filter(key => key.toLowerCase() === 'psmodulepath')).toHaveLength(1);
  });
  it('accepts a valid native signature and fails closed on subprocess, JSON or signature errors', async () => {
    const environment = { SYSTEMROOT: 'C:\\Windows' };
    expect(await inspectSignature('C:\\installer.exe', { environment,
      execute: async () => ({ stdout: ' {"status":"Valid","publisher":"CN=Publisher"}\r\n' }) })).toEqual({ signature: 'valid', publisher: 'CN=Publisher' });
    const subprocessError = Object.assign(new Error('CouldNotAutoloadMatchingModule'), { code: 1 });
    await expect(inspectSignature('C:\\installer.exe', { environment, execute: async () => { throw subprocessError; } })).rejects.toBe(subprocessError);
    for (const stdout of ['not JSON', '{}', '{"status":null}', '{"status":"HashMismatch"}', '{"status":"NotTrusted"}', '{"status":"UnknownError"}']) {
      await expect(inspectSignature('C:\\installer.exe', { environment, execute: async () => ({ stdout }) })).rejects.toThrow();
    }
  });
});
