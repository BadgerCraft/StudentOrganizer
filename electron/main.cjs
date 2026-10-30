const { app, BrowserWindow, Menu, ipcMain, session, dialog, systemPreferences, shell } = require('electron');
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
let encryptionRuntime, encryptionController, encryptedOrganizerDrive, activeLaunchPolicy;
let replacingWorkspaceWindow = false;
let encryptionShuttingDown = false;
const { createEncryptionLaunchPolicy, attachEncryptionWindowGuards } = require('./encryptionLaunchPolicy.cjs');
const { createEncryptionController, attachEncryptionIpc } = require('./encryptionIpc.cjs');
function protectedWorkspace() {
  // A malformed native status cannot select the original plaintext workspace.
  try { return encryptionRuntime ? encryptionRuntime.status().mode !== 'legacy' : true; } catch { return true; }
}
function disconnectWorkspaceTransports() {
  captureDrive.disconnect(); organizerDrive.disconnect(); encryptedOrganizerDrive?.disconnect();
}
function lockWorkspace() {
  protectedReports.cancel();
  if (!encryptionShuttingDown) encryptionController?.lockNow();
  disconnectWorkspaceTransports();
}
const { createCaptureDrive, DriveError } = require('./captureDrive.cjs');
const { readConfig, authorizeDesktop } = require('./captureDriveAuth.cjs');
const driveConfig = () => readConfig(path.join(app.getPath('userData'), 'desktop-drive-oauth.json'));
const captureDrive = createCaptureDrive({ configured: () => !!driveConfig(),
  authorize: signal => authorizeDesktop({ config: driveConfig(), openExternal: url => shell.openExternal(url), signal }) });
for (const method of ['status', 'connect', 'list', 'download', 'cancel', 'disconnect']) {
  ipcMain.handle(`capture-drive:${method}`, async (event, ...args) => {
    requireUpdateCaller(event, args, method === 'download' ? 1 : 0);
    try { return { ok: true, value: await captureDrive[method](...args) }; }
    catch (error) { return { ok: false, message: error instanceof DriveError ? error.message : 'Drive action failed. Retry or use a local ZIP.' }; }
  });
}
app.on('before-quit', () => {
  if (encryptionShuttingDown) return;
  lockWorkspace(); encryptionShuttingDown = true; encryptionRuntime?.close();
});
const { createOrganizerDrive } = require('./organizerDrive.cjs');
// Separate purpose-specific operator approval. Capture access cannot enable full-workspace uploads.
const organizerConfig = () => readConfig(path.join(app.getPath('userData'), 'organizer-sync-oauth.json'));
const organizerDrive = createOrganizerDrive({ configured: () => !!organizerConfig(),
  authorize: signal => authorizeDesktop({ config: organizerConfig(), openExternal: url => shell.openExternal(url), signal }) });
for (const method of ['status', 'connect', 'list', 'download', 'upload', 'disconnect']) {
  ipcMain.handle(`organizer-drive:${method}`, async (event, ...args) => {
    requireUpdateCaller(event, args, ['download', 'upload'].includes(method) ? 1 : 0);
    try {
      const transport = protectedWorkspace() ? encryptedOrganizerDrive : organizerDrive;
      if (!transport) throw new Error('Protected personal sync is not ready');
      return { ok: true, value: await transport[method](...args) };
    }
    catch (error) { return { ok: false, code: error instanceof DriveError && ['setup','auth','permission','network','uncertain','invalid','stale','conflict','storage'].includes(error.code) ? error.code : 'unknown', message: 'Personal sync did not complete. Check Settings for recovery steps.' }; }
  });
}

const exportReportPdf = require('./reportPdf.cjs').createReportPdfExporter({ BrowserWindow, dialog, session, parent: () => updateWindow });
const protectedReports = require('./protectedReportExports.cjs').createProtectedReportExports({
  dialog, parent: () => updateWindow, exportPdf: exportReportPdf,
  captureContext: expectedRevision => encryptionController.captureReadableExportContext(expectedRevision)
});
for (const format of ['pdf', 'csv']) ipcMain.handle(`assessment-report:${format}`, (event, ...args) => {
  requireUpdateCaller(event, args, args.length === 3 ? 3 : 2);
  if (protectedWorkspace()) return protectedReports.run(format, args[0], args[1], () => requireUpdateCaller(event, args, 3), args[2]);
  if (args.length !== 2) throw new Error('Invalid legacy report export.');
  // The legacy renderer retains its existing CSV download path.
  if (format !== 'pdf') throw new Error('Native CSV export requires an unlocked protected workspace.');
  return exportReportPdf(args[0], args[1]);
});
ipcMain.handle('assessment-report:cancel', (event, ...args) => {
  requireUpdateCaller(event, args, 0); protectedReports.cancel();
});
function requireUpdateCaller(event, args, expectedCount) {
  const indexUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  if (args.length !== expectedCount || !updateWindow || !trustedCaller(event, updateWindow.webContents, indexUrl)) throw new Error('Update action denied');
}
ipcMain.handle('manual-update:check', (event, ...args) => {
  requireUpdateCaller(event, args, 0);
  return manualCheck().then(result => ({ ...result, installationAvailable: !protectedWorkspace() && installerUpdates?.status().installationAvailable === true }));
});
for (const method of ['status', 'download', 'cancel']) ipcMain.handle(`installer-update:${method}`, (event, ...args) => {
  requireUpdateCaller(event, args, 0);
  const result = installerUpdates[method]();
  if (method === 'status' && protectedWorkspace()) return { ...result, installationAvailable: false, message: 'Installer recovery is not yet compatible with protected workspaces. Keep this version until an encrypted recovery path is available.' };
  return result;
});
ipcMain.handle('installer-update:install', (event, ...args) => {
  requireUpdateCaller(event, args, 2);
  if (protectedWorkspace()) throw new Error('Protected installer recovery is not yet available. No plaintext backup was written.');
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
  const indexPath = path.join(__dirname, '../dist/index.html');
  const policy = createEncryptionLaunchPolicy({ mode: encryptionRuntime.status().mode, indexPath });
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
      devTools: process.env.NODE_ENV === 'development',
      ...(policy.partition ? { partition: policy.partition } : {})
    },
    show: false
  });

  updateWindow = mainWindow;
  activeLaunchPolicy = policy;
  require('./dictationIpc.cjs').attachDictation({ app, window: mainWindow, ipcMain, dialog, systemPreferences });
  let launchDenied = false;
  const guarded = attachEncryptionWindowGuards({ window: mainWindow, policy, lock: lockWorkspace, onViolation: () => {
    launchDenied = true;
    // No raw exception, private payload or credentials enter this diagnostic.
    dialog.showErrorBox('Protected workspace stopped', 'The protected window could not be verified. Close and reopen the app. The original plaintext workspace was not selected as a fallback.');
  } });
  if (!guarded) { mainWindow.destroy(); return mainWindow; }
  if (policy.protectedMode) {
    // Renderer-generated downloads are not an approved route out of protected
    // storage. Focused native export actions must validate their own format.
    mainWindow.webContents.session.on('will-download', event => event.preventDefault());
  }

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
  mainWindow.loadFile(indexPath, policy.hash ? { hash: policy.hash } : undefined);

  mainWindow.once('ready-to-show', () => {
    if (!launchDenied) mainWindow.show();
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

async function replaceWorkspaceWindow() {
  replacingWorkspaceWindow = true;
  try {
    lockWorkspace();
    await encryptionRuntime.refreshMode();
    const previous = updateWindow;
    // Destroy the old renderer before evaluating App in the new storage mode.
    if (previous && !previous.isDestroyed()) previous.destroy();
    createWindow();
  } finally { replacingWorkspaceWindow = false; }
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const supported = isInstalledNsis({ platform: process.platform, packaged: app.isPackaged, exePath: app.getPath('exe'), exists: existsSync });
  const updater = supported ? require('electron-updater').autoUpdater : undefined;
  if (supported) configureUpdaterSession(session.fromPartition('electron-updater', { cache: false }));
  installerUpdates = createInstallerUpdate({ supported, currentVersion: app.getVersion(), userData: app.getPath('userData'), updater,
    installationDirectory: path.dirname(app.getPath('exe')),
    tokenFactory: () => new (require('builder-util-runtime').CancellationToken)() });
  encryptionRuntime = await require('./encryptionNativeRuntime.cjs').createNativeEncryptionRuntime({
    directory: path.join(app.getPath('userData'), 'protected-workspace'),
    // Production conversion remains disabled until the reviewed whole-app and
    // actual-device acceptance gates have been completed. No renderer switch.
    activationGate: () => false,
    createHost: require('./structuredEncryptionHost.cjs').createStructuredEncryptionHost
  });
  const validation = require('./generated/encryption/src/security/mainBundleValidation.js');
  encryptionController = createEncryptionController({
    getHost: create => encryptionRuntime.getHost(create),
    getStatus: () => ({ ...encryptionRuntime.status(), ephemeralPartition: activeLaunchPolicy?.observesEphemeral(updateWindow) === true }),
    validateIntegrity: validation.validateMainBundleIntegrity,
    assertFullAuthority: validation.assertMainFullWorkspaceAuthority,
    enrollFromRecovery: (...args) => encryptionRuntime.enrollFromRecovery(...args),
    cancelEnrollment: () => encryptionRuntime.cancelEnrollment(),
    prepareRecoveryFile: (...args) => encryptionRuntime.prepareRecoveryFile(...args),
    authorizeOfflineRecovery: (...args) => encryptionRuntime.authorizeOfflineRecovery(...args),
    applyOfflineRecovery: (...args) => encryptionRuntime.applyOfflineRecovery(...args),
    cancelOfflineRecovery: () => encryptionRuntime.cancelOfflineRecovery(),
    onLock: () => encryptionRuntime.lockNow(),
    files: require('./encryptedBackupFiles.cjs').createEncryptedBackupFiles({ dialog, parent: () => updateWindow }),
    replaceProtectedWindow: replaceWorkspaceWindow,
    onContextChange: () => { disconnectWorkspaceTransports(); if (!encryptionShuttingDown) encryptionRuntime.cancelOfflineRecovery(); }
  });
  attachEncryptionIpc({ ipcMain, requireCaller: requireUpdateCaller, controller: encryptionController });
  encryptedOrganizerDrive = require('./encryptedOrganizerDrive.cjs').createEncryptedOrganizerDrive({
    host: encryptionController.transferHost, configured: () => !!organizerConfig(),
    authorize: signal => authorizeDesktop({ config: organizerConfig(), openExternal: url => shell.openExternal(url), signal })
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(() => {
  // A native bootstrap error must not open the old default partition or an
  // apparently writable empty App. Keep diagnostics free of private exceptions.
  lockWorkspace();
  dialog.showErrorBox('Workspace could not start', 'The saved workspace mode could not be verified. Close and reopen the app or use verified encrypted recovery. No plaintext fallback was opened.');
  app.quit();
});

app.on('window-all-closed', () => {
  if (!replacingWorkspaceWindow && process.platform !== 'darwin') {
    app.quit();
  }
});
