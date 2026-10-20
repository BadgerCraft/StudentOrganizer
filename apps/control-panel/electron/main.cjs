const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contractRoot = app.isPackaged ? path.join(process.resourcesPath, 'owner-update-contract') : path.join(__dirname, '../../../electron');
const approval = require(path.join(contractRoot, 'updateApproval.cjs'));
const { hashFile } = require(path.join(contractRoot, 'windowsInstallerUpdate.cjs'));
const { trustedCaller } = require(path.join(contractRoot, 'manualUpdater.cjs'));
const { atomicJSON, verifyArtifact, assertPreviewDestination } = require('./store.cjs');
// This app never opens the teacher profile, IndexedDB, settings, exports or backups.
app.setName('Student Organizer Control Panel');
const isolatedProfile = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', isolatedProfile ? path.resolve(isolatedProfile) : path.join(app.getPath('appData'), 'StudentOrganizer-ControlPanel'));
app.enableSandbox();
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
});
const index = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
let window, stored = null, busy = false, storageError = '';
const storeFile = path.join(app.getPath('userData'), 'local-approval.json');
function snapshot(message = '') {
  return { approval: stored?.approval || null, message: message || storageError,
    mode: approval.MODE, publicationReady: false };
}
async function readJSON(file) {
  if ((await fs.stat(file)).size > 32 * 1024) throw new Error('Local approval JSON exceeds 32 KB.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function save(next) { await atomicJSON(storeFile, next); stored = next; storageError = ''; }
async function verify() {
  if (!stored) throw new Error('Import a candidate and select its installer first.');
  approval.state(stored.approval);
  await verifyArtifact(stored.approval, stored.artifactPath, hashFile);
}
const handlers = {
  status: async () => snapshot(),
  import: async () => {
    const descriptor = await dialog.showOpenDialog(window, { title: 'Select local candidate JSON (no student data)', filters: [{ name: 'Candidate JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (descriptor.canceled) return snapshot('Import cancelled.');
    const next = approval.prepare(await readJSON(descriptor.filePaths[0]));
    const installer = await dialog.showOpenDialog(window, { title: `Select ${next.candidate.artifact.name}`, filters: [{ name: 'NSIS installer', extensions: ['exe'] }], properties: ['openFile'] });
    if (installer.canceled) return snapshot('Import cancelled. Previous approval retained.');
    await verifyArtifact(next, installer.filePaths[0], hashFile);
    await save({ approval: next, artifactPath: installer.filePaths[0] });
    return snapshot('Candidate bytes verified. Publisher signature has not been verified.');
  },
  test: async notes => {
    if (typeof notes !== 'string' || notes.length > 2000) throw new Error('Invalid verification notes.');
    await verify(); await save({ ...stored, approval: approval.recordTest(stored.approval, notes) });
    return snapshot('Test evidence recorded for these exact installer bytes.');
  },
  approve: async () => {
    await verify(); await save({ ...stored, approval: approval.approve(stored.approval) });
    return snapshot('Approved locally only. Nothing was published; installed apps cannot discover this approval.');
  },
  revoke: async () => {
    if (!stored) throw new Error('No local approval.');
    await save({ ...stored, approval: approval.revoke(stored.approval) });
    return snapshot('Local approval revoked. Previously exported preview files are independent snapshots.');
  },
  export: async () => {
    await verify();
    if (stored.approval.status !== 'approved') throw new Error('Only an approved candidate can be exported as a preview.');
    const result = await dialog.showSaveDialog(window, { title: 'Save LOCAL PREVIEW ONLY — no publication', defaultPath: `LOCAL-PREVIEW-${stored.approval.candidate.version}.json`, filters: [{ name: 'Preview JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return snapshot('Export cancelled.');
    await assertPreviewDestination(result.filePath, [storeFile, stored.artifactPath]);
    await atomicJSON(result.filePath, approval.exportPreview(stored.approval));
    return snapshot('Local preview saved. No telemetry, credentials or executable paths are included. No release was published.');
  }
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`owner:${name}`, async (event, ...args) => {
  if (!window || !trustedCaller(event, window.webContents, index) || args.length !== (name === 'test' ? 1 : 0)) throw new Error('Owner action denied.');
  if (name === 'status') return snapshot();
  if (busy) throw new Error('Another local approval action is in progress.');
  busy = true;
  try { return await handler(...args); }
  catch (error) { return { ...snapshot(), error: error instanceof Error ? error.message : 'Local preparation failed.' }; }
  finally { busy = false; }
});
if (ownsProfile) app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
  try {
    const value = await readJSON(storeFile);
    if (typeof value.artifactPath !== 'string' || Object.keys(value).sort().join(',') !== 'approval,artifactPath') throw new Error('Invalid local store.');
    stored = { approval: approval.state(value.approval), artifactPath: value.artifactPath };
  } catch (error) { if (error.code !== 'ENOENT') storageError = 'Saved approval could not be read. Original file retained; import a candidate to start again.'; }
  const local = session.fromPartition('owner-console');
  local.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  local.setPermissionCheckHandler(() => false);
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  window = new BrowserWindow({ width: 1180, height: 850, minWidth: 800, minHeight: 600, title: 'Student Organizer Control Panel — local preview',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, session: local } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  await window.loadURL(index);
});
app.on('window-all-closed', () => app.quit());
