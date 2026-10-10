// Explicit, local-backup-first NSIS updates. The renderer cannot choose destinations or commands.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { isNewer, version } = require('./manualUpdater.cjs');
const TABLES = Object.freeze(['organizations', 'users', 'organizationMemberships', 'classSectionStaff', 'devices', 'userPreferences', 'academicYears', 'terms', 'reportingPeriods', 'courses', 'classSections', 'units', 'classSessions', 'students', 'classEnrollments', 'attendanceRecords', 'seatingLayouts', 'seatPositions', 'markScaleFamilies', 'markScaleVersions', 'markScaleEntries', 'gradingPolicies', 'gradeOverrides', 'gradeSnapshots', 'assessments', 'assessmentCategories', 'studentAssessments', 'categoryResults', 'participationEventTypes', 'participationEvents', 'participationDailySummaries', 'studentNotes', 'auditEntries', 'syncMutations', 'syncCursors', 'markingRubrics', 'markingAttempts', 'markingSessions', 'markingCommits']);
const MAX_BACKUP = 256 * 1024 * 1024;
function validateBackup(json) {
  if (typeof json !== 'string' || Buffer.byteLength(json) > MAX_BACKUP) throw new Error('A complete local backup is required (maximum 256 MB).');
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('The local backup is not valid JSON.'); }
  if (!data || data.schemaVersion !== 4 || data.version !== 2 || !Number.isFinite(Date.parse(data.exportedAt)) ||
      !data.tables || Array.isArray(data.tables) || Object.keys(data.tables).length !== TABLES.length) throw new Error('The local backup must include the complete current database.');
  for (const name of TABLES) {
    if (!Array.isArray(data.tables[name])) throw new Error('The local backup is missing a database table.');
    const ids = new Set();
    for (const record of data.tables[name]) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)) throw new Error('The local backup contains invalid records.');
      ids.add(record.id);
    }
  }
}
async function saveBackup(json, userData) {
  validateBackup(json);
  const directory = path.join(userData, 'update-backups');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `before-update-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`);
  const temporary = destination + '.tmp';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(json, 'utf8'); await file.sync(); } finally { await file.close(); }
    await fs.rename(temporary, destination);
    if ((await fs.readFile(destination, 'utf8')) !== json) throw new Error('Local backup verification failed.');
    return destination;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
async function hashFile(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}
async function assertWritableInstallation(directory) {
  const probe = path.join(directory, `.studentorganizer-update-${crypto.randomUUID()}.tmp`);
  let handle;
  try { handle = await fs.open(probe, 'wx', 0o600); }
  catch (cause) {
    const error = new Error('The installation directory is not writable without administrator rights.');
    error.code = 'ERR_INSTALL_ELEVATION_REQUIRED'; error.cause = cause; throw error;
  }
  finally {
    if (handle) { await handle.close(); await fs.rm(probe, { force: true }); }
  }
}
async function inspectSignature(file, { execute = promisify(execFile), environment = process.env } = {}) {
  // The path is data in an environment variable, never PowerShell source or a renderer argument.
  const systemRoot = Object.entries(environment).find(([key]) => key.toLowerCase() === 'systemroot')?.[1] || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // A parent running PowerShell 7 can pass its incompatible Security module path to
  // Windows PowerShell 5.1. Use the matching built-in module directory, including
  // removing differently cased duplicate keys from Windows' case-insensitive env.
  const signatureEnv = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !['psmodulepath', 'studentorganizer_signature_file'].includes(key.toLowerCase())));
  signatureEnv.PSModulePath = path.win32.join(path.win32.dirname(powershell), 'Modules');
  signatureEnv.STUDENTORGANIZER_SIGNATURE_FILE = file;
  const { stdout } = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; $s = Get-AuthenticodeSignature -LiteralPath $env:STUDENTORGANIZER_SIGNATURE_FILE; @{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 15000, maxBuffer: 16384, env: signatureEnv });
  const result = JSON.parse(stdout.trim());
  if (result.status === 'NotSigned') return { signature: 'unsigned' };
  if (result.status !== 'Valid') throw new Error('Windows rejected the installer signature.');
  return { signature: 'valid', publisher: String(result.publisher || '').slice(0, 512) };
}
function isInstalledNsis({ platform, packaged, env = process.env, exePath, exists }) {
  return platform === 'win32' && packaged && !env.PORTABLE_EXECUTABLE_FILE && !env.PORTABLE_EXECUTABLE_DIR &&
    exists(path.join(path.dirname(exePath), 'Uninstall Ontario Teacher Assessment.exe'));
}
function validateManifest(info, current, arch) {
  if (!info || typeof info.version !== 'string') throw new Error('Missing installer update metadata.');
  if (info.stagingPercentage !== undefined) throw new Error('Staged updates are unsupported.');
  version(info.version);
  if (!isNewer(info.version, current)) return false;
  const expected = `OntarioTeacherAssessment-${info.version}-${arch}-nsis.exe`;
  if (info.packages || !Array.isArray(info.files) || info.files.length !== 1 || info.files[0].url !== expected ||
      typeof info.files[0].sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(info.files[0].sha512)) throw new Error('The update metadata does not identify a complete trusted NSIS installer.');
  return true;
}
function allowedUpdateRequest(rawUrl, method = 'GET') {
  if (!['GET', 'HEAD'].includes(method)) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    if (url.hostname === 'api.github.com') return url.pathname === '/repos/BadgerCraft/StudentOrganizer/releases/latest' && !url.search;
    if (url.hostname === 'github.com') return !url.search && /^\/BadgerCraft\/StudentOrganizer\/releases(?:\.atom|\/download\/[^/]+\/[^/]+|\/latest)?$/.test(url.pathname);
    return ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}
function sanitizeHeaders(headers = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(headers)) if (['accept', 'range', 'if-range', 'accept-encoding', 'cache-control'].includes(key.toLowerCase())) safe[key] = value;
  safe['User-Agent'] = 'StudentOrganizer-explicit-Windows-update';
  return safe;
}
function configureUpdaterSession(session) {
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedUpdateRequest(details.url, details.method) }));
  session.webRequest.onBeforeSendHeaders((details, callback) => callback({ requestHeaders: sanitizeHeaders(details.requestHeaders) }));
}
async function installAndReopen(updater, { launchProcess = spawn, timeout = 15000,
  beforeQuit = () => require('electron').autoUpdater.emit('before-quit-for-update') } = {}) {
  // NsisUpdater keeps authority over installer arguments and elevation decisions.
  // Its usual quitAndInstall closes the app before asynchronous spawn failure is known.
  const originalSpawnLog = updater.spawnLog;
  const children = new Set();
  let finished = false, failed = false, timer, launchErrorListener;
  try {
    await new Promise((resolve, reject) => {
      const onError = error => { if (!finished) { finished = true; failed = true; reject(error); } };
      launchErrorListener = onError;
      updater.once('error', onError);
      timer = setTimeout(() => onError(new Error('Installer launch timed out.')), timeout);
      updater.spawnLog = (command, args = [], env = undefined, stdio = 'ignore') => new Promise((spawnResolve, spawnReject) => {
        if (finished) { const error = new Error('Installer launch stopped.'); error.code = 'ERR_INSTALL_STOPPED'; spawnReject(error); return; }
        // A spawned elevation helper has not yet obtained UAC consent. Keep this app open
        // rather than claiming successful replacement before the teacher approves elevation.
        if (/(?:^|[\\/])elevate\.exe$/i.test(command)) {
          const error = new Error('Automatic replacement requires a per-user installation without administrator elevation.');
          error.code = 'ERR_INSTALL_ELEVATION_REQUIRED'; spawnReject(error); return;
        }
        let child;
        try { child = launchProcess(command, args, { stdio, env, detached: true }); }
        catch (error) { if (error.code === 'ENOENT') error.code = 'ERR_INSTALL_MISSING'; spawnReject(error); return; }
        children.add(child);
        child.once('error', error => {
          // Do not fall back to shell.openPath when the verified installer has disappeared.
          if (failed) error.code = 'ERR_INSTALL_STOPPED';
          else if (error.code === 'ENOENT') error.code = 'ERR_INSTALL_MISSING';
          spawnReject(error);
        });
        child.once('spawn', () => {
          if (failed) { child.kill(); const error = new Error('Installer launch stopped.'); error.code = 'ERR_INSTALL_STOPPED'; spawnReject(error); return; }
          child.unref();
          spawnResolve(true);
          if (!finished) { finished = true; resolve(); }
        });
      });
      // This calls the standard NSIS doInstall, without scheduling an early application quit.
      if (!updater.install(true, true)) onError(new Error('Installer launch was rejected.'));
      // The listener is removed in the outer finally, including synchronous install errors.
    });
    setImmediate(() => { beforeQuit(); updater.app.quit(); });
  } catch (error) {
    updater.quitAndInstallCalled = false;
    for (const child of children) { try { child.kill(); } catch {} }
    throw error;
  } finally {
    clearTimeout(timer);
    updater.spawnLog = originalSpawnLog;
    if (launchErrorListener) updater.removeListener('error', launchErrorListener);
  }
}
function createInstallerUpdate({ supported, currentVersion, userData, installationDirectory, arch = process.arch, updater, tokenFactory, signature = inspectSignature,
  backup = saveBackup, hash = hashFile, canReplace = () => assertWritableInstallation(installationDirectory), launch = installAndReopen, metadataTimeout = 10000, downloadTimeout = 15 * 60 * 1000 }) {
  let state = { status: supported ? 'idle' : 'unsupported', installationAvailable: supported };
  let active = false, cancellation, timedOut = false, downloaded;
  const snapshot = () => ({ ...state });
  const fail = (message) => { state = { status: 'error', installationAvailable: supported, error: message }; return snapshot(); };
  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true;
    updater.disableWebInstaller = true;
    // electron-updater otherwise creates a persistent random ID and sends it on metadata requests.
    // There are no staged rollouts here: use a nonidentifying constant and strip its header entirely.
    updater.getOrCreateStagingUserId = async () => '00000000-0000-4000-8000-000000000000';
    updater.computeFinalHeaders = headers => sanitizeHeaders(headers);
    updater.setFeedURL({ provider: 'github', owner: 'BadgerCraft', repo: 'StudentOrganizer', private: false });
    // Bound metadata transport with the same cancellation token as the explicit operation.
    if (updater.httpExecutor) {
      const request = updater.httpExecutor.request.bind(updater.httpExecutor);
      updater.httpExecutor.request = (options, token, data) => request({ ...options, timeout: metadataTimeout }, cancellation || token, data);
    }
    updater.on('error', () => {}); // errors are returned through controlled, privacy-safe state
    updater.on('download-progress', progress => {
      if (state.status === 'downloading') state.percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    });
  }
  async function cleanDownload() {
    downloaded = undefined;
    if (updater?.downloadedUpdateHelper) await updater.downloadedUpdateHelper.clear();
  }
  async function verifyDownloaded(token) {
    if (!downloaded || updater.installerPath !== downloaded.file || (await hash(downloaded.file)) !== downloaded.sha512) throw new Error('The downloaded installer changed or its checksum is invalid. Download it again.');
    if (token?.cancelled) throw new Error('cancelled');
    const inspected = await signature(downloaded.file);
    if (token?.cancelled) throw new Error('cancelled');
    return inspected;
  }
  async function download() {
    if (!supported || active || state.status === 'installing') return snapshot();
    active = true; timedOut = false; cancellation = tokenFactory();
    let timer = setTimeout(() => { timedOut = true; cancellation.cancel(); }, metadataTimeout);
    state = { status: 'checking', installationAvailable: true };
    try {
      await cleanDownload();
      const result = await updater.checkForUpdates();
      if (cancellation.cancelled) throw new Error('cancelled');
      if (!validateManifest(result?.updateInfo, currentVersion, arch)) {
        state = { status: 'current', installationAvailable: true }; return snapshot();
      }
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; cancellation.cancel(); }, downloadTimeout);
      const info = result.updateInfo;
      state = { status: 'downloading', installationAvailable: true, version: info.version, percent: 0 };
      const files = await updater.downloadUpdate(cancellation);
      if (cancellation.cancelled || !Array.isArray(files) || files.length !== 1) throw new Error('Installer download interrupted.');
      downloaded = { file: files[0], sha512: info.files[0].sha512 };
      const inspected = await verifyDownloaded(cancellation);
      if (cancellation.cancelled) throw new Error('cancelled');
      state = { status: 'downloaded', installationAvailable: true, version: info.version, percent: 100, ...inspected };
      return snapshot();
    } catch (error) {
      const cancelled = cancellation.cancelled;
      await cleanDownload().catch(() => {});
      if (cancelled && !timedOut) state = { status: 'cancelled', installationAvailable: true };
      else fail(timedOut ? 'The update timed out. Retry when your connection is ready.' : 'The installer could not be verified or downloaded. Your installed app and records are unchanged.');
      return snapshot();
    } finally { clearTimeout(timer); cancellation = undefined; active = false; }
  }
  async function cancel() {
    if (state.status === 'installing') return snapshot();
    if (active) { cancellation?.cancel(); return snapshot(); }
    active = true;
    try {
      await cleanDownload();
      state = { status: supported ? 'cancelled' : 'unsupported', installationAvailable: supported };
      return snapshot();
    } finally { active = false; }
  }
  async function install(json, acknowledgeUnsigned) {
    if (!supported || active || state.status !== 'downloaded') return snapshot();
    if (typeof acknowledgeUnsigned !== 'boolean') return fail('Installer approval is required.');
    if (state.signature === 'unsigned' && !acknowledgeUnsigned) return snapshot();
    active = true;
    try {
      validateBackup(json);
      const backupPath = await backup(json, userData);
      // Recheck bytes AND Windows signature after the backup immediately before execution.
      const inspected = await verifyDownloaded();
      if (inspected.signature === 'unsigned' && !acknowledgeUnsigned) throw new Error('Unsigned installer approval is required.');
      await canReplace();
      state = { ...state, ...inspected, status: 'installing', backupPath };
      await launch(updater);
      return snapshot();
    } catch (error) {
      await cleanDownload().catch(() => {});
      return fail(error.code === 'ERR_INSTALL_ELEVATION_REQUIRED'
        ? 'Automatic replacement supports a per-user installation. Administrator rights are required here, so the app has stayed open. Use the approved installer manually.'
        : 'Installation was stopped because the local backup, installer verification or process launch failed. Your installed app and records are unchanged.');
    } finally { active = false; }
  }
  return { status: snapshot, download, cancel, install };
}
module.exports = { TABLES, MAX_BACKUP, validateBackup, saveBackup, hashFile, assertWritableInstallation, inspectSignature, isInstalledNsis, validateManifest, allowedUpdateRequest, sanitizeHeaders, configureUpdaterSession, installAndReopen, createInstallerUpdate };
