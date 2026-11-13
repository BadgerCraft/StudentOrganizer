const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contractRoot = app.isPackaged ? path.join(process.resourcesPath, 'owner-update-contract') : path.join(__dirname, '../../../electron');
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
let window;
if (ownsProfile) app.whenReady().then(async () => {
  await require(path.join(contractRoot, 'controlPanel.cjs')).attachControlPanel({ ipcMain, dialog, getWindow: () => window, index, storeFile: path.join(app.getPath('userData'), 'local-approval.json') });
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
