const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { existsSync } = require('node:fs');
const { createInstallerUpdate, isInstalledNsis, configureUpdaterSession } = require('./windowsInstallerUpdate.cjs');

app.name = 'ontario-teacher-assessment';
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

const { createManualCheck, trustedCaller } = require('./manualUpdater.cjs');
const manualCheck = createManualCheck({ platform: process.platform, packaged: app.isPackaged, currentVersion: app.getVersion() });
let updateWindow;
let installerUpdates;
function requireUpdateCaller(event, args, expectedCount) {
  const indexUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  if (args.length !== expectedCount || !updateWindow || !trustedCaller(event, updateWindow.webContents, indexUrl)) throw new Error('Update action denied');
}
ipcMain.handle('manual-update:check', (event, ...args) => {
  requireUpdateCaller(event, args, 0);
  return manualCheck().then(result => ({ ...result, installationAvailable: installerUpdates?.status().installationAvailable === true }));
});
for (const method of ['status', 'download', 'cancel']) ipcMain.handle(`installer-update:${method}`, (event, ...args) => {
  requireUpdateCaller(event, args, 0);
  return installerUpdates[method]();
});
ipcMain.handle('installer-update:install', (event, ...args) => {
  requireUpdateCaller(event, args, 2);
  if (typeof args[0] !== 'string' || Buffer.byteLength(args[0]) > 256 * 1024 * 1024 || typeof args[1] !== 'boolean') throw new Error('Update installation denied');
  return installerUpdates.install(args[0], args[1]);
});
app.on('second-instance', () => {
  if (updateWindow && !updateWindow.isDestroyed()) {
    if (updateWindow.isMinimized()) updateWindow.restore();
    updateWindow.show(); updateWindow.focus();
  }
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    title: 'Ontario Teacher Assessment & Classroom Suite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: process.env.NODE_ENV === 'development'
    },
    show: false
  });

  updateWindow = mainWindow;

  // Remove default menu bar for clean teacher desktop experience
  if (process.env.NODE_ENV !== 'development') {
    if (process.platform === 'darwin') {
      // Native edit roles keep Command-C/V and standard Mac window actions available.
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
      ]));
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  // Load packaged local Vite build
  const indexPath = path.join(__dirname, '../dist/index.html');
  const bundleRoot = path.dirname(indexPath);
  // Desktop operation needs no network. Restrict file resources to the bundle.
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (url.protocol === 'file:') {
        const relative = path.relative(bundleRoot, fileURLToPath(url));
        allowed = relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      } else {
        allowed = ['data:', 'blob:'].includes(url.protocol);
      }
    } catch { /* Fail closed. */ }
    callback({ cancel: !allowed });
  });
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Security Lockdown: Block unwanted new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Security Lockdown: Block foreign navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow file:// protocol within the application bundle
    if (url.split('#')[0] !== pathToFileURL(indexPath).href) {
      event.preventDefault();
    }
  });

  return mainWindow;
}

app.whenReady().then(() => {
  if (!ownsInstance) return;
  const supported = isInstalledNsis({ platform: process.platform, packaged: app.isPackaged, exePath: app.getPath('exe'), exists: existsSync });
  const updater = supported ? require('electron-updater').autoUpdater : undefined;
  if (supported) configureUpdaterSession(session.fromPartition('electron-updater', { cache: false }));
  installerUpdates = createInstallerUpdate({ supported, currentVersion: app.getVersion(), userData: app.getPath('userData'), updater,
    installationDirectory: path.dirname(app.getPath('exe')),
    tokenFactory: () => new (require('builder-util-runtime').CancellationToken)() });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
