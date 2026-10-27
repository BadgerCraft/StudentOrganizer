import { openRecovery, showClassTools, openAssignmentCreation, openSettingsSection } from '../../scripts/helpers/organizerNavigation';
import { installFictionalClassroom } from '../../scripts/helpers/classroomFixture';
import assert from 'node:assert/strict';
import { canonicalLegacyReport } from './legacyReportComparison';
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { runMarkingDesktopAcceptance, verifyAfterRestart, leaveMarkingWithDraft, openMarkingQueue, type MarkingDesktopEvidence } from './markingDesktopAcceptance';

// This deliberately uses the real installed application's normal profile. The
// guard below limits it to a disposable Windows runner containing fictional QA
// data; no replacement is attempted against a teacher's installation/profile.
const legacyBootstrap = process.argv.includes('--legacy-bootstrap');
const installRecovery = process.argv.includes('--install-recovery');
assert.ok(!(legacyBootstrap && installRecovery), 'Select one Windows acceptance mode');
const evidenceDir = path.resolve(`release/qa-evidence/${legacyBootstrap ? 'windows-bootstrap' : installRecovery ? 'windows-install-recovery' : 'windows-upgrade'}`);
const execFileAsync = promisify(execFile);
const versions = { A: '1.0.1', B: '1.0.2' };
const legacySource = 'b9a8790f4841fa9fd5057e7cfef097f619cbac4a';
type State = { status: string; version?: string; installationAvailable: boolean; signature?: string; backupPath?: string; error?: string };

function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
  if (child.exitCode !== null) return child.exitCode === 0 ? Promise.resolve() : Promise.reject(new Error(`Process exited ${child.exitCode}`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Installer did not exit in time')), timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installer exited ${code}`)); });
  });
}
function killOwned(child: ChildProcess) {
  if (child.pid && child.exitCode === null) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
  }
}
async function waitUntil<T>(read: () => Promise<T | undefined>, label: string, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value !== undefined) return value; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
async function state(page: Page): Promise<State> {
  return page.evaluate(() => (window as any).desktopUpdates.status());
}
async function waitState(page: Page, allowed: string[]) {
  return waitUntil(async () => {
    const current = await state(page);
    if (allowed.includes(current.status)) return current;
    if (['error', 'cancelled', 'current', 'unsupported'].includes(current.status)) throw new Error(`Unexpected updater state: ${JSON.stringify(current)}`);
    return undefined;
  }, `updater state ${allowed.join('/')}`);
}
async function openHub(page: Page) {
  page.setDefaultTimeout(30000);
  const chooser = page.getByTestId('teacher-selector-modal');
  await chooser.waitFor({ state: 'visible' });
  if (await chooser.isVisible()) {
    await Promise.race([page.getByPlaceholder('Enter Teacher here').waitFor(), page.locator('[data-testid^="select-teacher-"]').first().waitFor()]);
    if (await page.getByPlaceholder('Enter Teacher here').isVisible()) await installFictionalClassroom(page);
    await page.locator('[data-testid^="select-teacher-"]').first().click();
    await chooser.waitFor({ state: 'hidden' });
  }
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.locator('button[title="Manage Assessments & Rubrics"]').click();
  await page.getByRole('heading', { name: /^(Markbook|Central Assessment Hub & Rubrics)$/ }).waitFor();
}
async function snapshotAll(page: Page): Promise<Record<string, any[]>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('OntarioTeacherAssessmentDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const names = Array.from(db.objectStoreNames);
      const result: Record<string, any[]> = {};
      const tx = db.transaction(names, 'readonly');
      for (const name of names) {
        const read = tx.objectStore(name).getAll();
        read.onsuccess = () => { result[name] = read.result.sort((a, b) => String(a.id).localeCompare(String(b.id))); };
      }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function launchInstalled(executable: string, version: string) {
  const app = await electron.launch({ executablePath: executable, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version, 'Real installed binary must have the expected version');
  const page = await app.firstWindow();
  await page.getByTestId('nav-dashboard-btn').waitFor();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return { app, page, errors, userData: await app.evaluate(({ app }) => app.getPath('userData')) };
}

// Only redirect the QA destination. Renderer code still creates/downloads the
// backup/report; this test does not claim native Save As dialog coverage.
async function download(app: ElectronApplication, trigger: () => Promise<void>, destination: string) {
  const directory = fs.mkdtempSync(path.join(evidenceDir, 'download-'));
  const session = await app.context().newCDPSession(await app.firstWindow());
  let guid = ''; let progress = 'pending';
  session.on('Browser.downloadWillBegin', event => { guid = event.guid; });
  session.on('Browser.downloadProgress', event => { if (event.guid === guid) progress = event.state; });
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: directory, eventsEnabled: true });
    await trigger();
    await waitUntil(async () => progress === 'completed' ? true : progress === 'canceled' ? Promise.reject(new Error('QA export cancelled')) : undefined, 'actual renderer download');
    assert.ok(guid); fs.renameSync(path.join(directory, guid), destination);
    assert.ok(fs.statSync(destination).size);
  } finally {
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
    await session.detach(); fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** Observe the real status invocation without changing its event, arguments or result. */
async function observeStatusBoundary(app: ElectronApplication) {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const handlers = (ipcMain as any)._invokeHandlers;
    const original = handlers?.get?.('installer-update:status');
    if (typeof original !== 'function' || typeof handlers?.set !== 'function') return;
    (globalThis as any).__upgradeStatusCalls = [];
    handlers.set('installer-update:status', (event: any, ...args: any[]) => {
      const frame = event.senderFrame;
      const sender = event.sender;
      const windows = BrowserWindow.getAllWindows();
      const calls = (globalThis as any).__upgradeStatusCalls as any[];
      calls.push({
        argLength: args.length, senderId: sender?.id,
        senderFrameRoutingId: frame?.routingId, senderFrameProcessId: frame?.processId,
        senderFrameURL: frame?.url, senderFrameIsMainFrame: frame === sender?.mainFrame,
        ownerWindowIds: windows.filter(window => window.webContents === sender).map(window => window.id),
        windowWebContentsIds: windows.map(window => ({ windowId: window.id, webContentsId: window.webContents.id }))
      });
      if (calls.length > 3) calls.shift();
      return original(event, ...args);
    });
  });
}

/** Read-only diagnostics in the disposable main process; never relaxes IPC authorization. */
async function boundaryDiagnostics(app: ElectronApplication, page: Page) {
  const main = await app.evaluate(({ app, BrowserWindow }) => {
    const path = (process as any).getBuiltinModule('path');
    const fs = (process as any).getBuiltinModule('fs');
    const { pathToFileURL, fileURLToPath } = (process as any).getBuiltinModule('url');
    const index = path.join(app.getAppPath(), 'dist', 'index.html');
    let expectedCanonicalFile = '';
    try { expectedCanonicalFile = fs.realpathSync.native(index); } catch (error) { expectedCanonicalFile = String(error); }
    const expected = pathToFileURL(index).href;
    return {
      appPath: app.getAppPath(), exePath: app.getPath('exe'), userData: app.getPath('userData'),
      expectedIndexURL: expected, expectedCanonicalFile,
      statusCalls: (globalThis as any).__upgradeStatusCalls || [],
      windows: BrowserWindow.getAllWindows().map(window => {
        const contents = window.webContents;
        const frame = contents.mainFrame;
        const withoutHash = frame.url.split('#')[0];
        let frameFile = '';
        try { frameFile = fileURLToPath(withoutHash); } catch { /* Record the URL without coercion. */ }
        let frameCanonicalFile = '';
        if (frameFile) {
          try { frameCanonicalFile = fs.realpathSync.native(frameFile); } catch (error) { frameCanonicalFile = String(error); }
        }
        return {
          windowId: window.id, webContentsId: contents.id, webContentsURL: contents.getURL(),
          mainFrameURL: frame.url, mainFrameRoutingId: frame.routingId, mainFrameProcessId: frame.processId,
          mainFrameHasParent: frame.parent !== null, exactExpectedURL: withoutHash === expected,
          mainFrameFile: frameFile, mainFrameCanonicalFile: frameCanonicalFile,
          destroyed: contents.isDestroyed()
        };
      })
    };
  });
  const renderer = await page.evaluate(() => ({ href: location.href, origin: location.origin,
    isTopFrame: window === window.top, bridgePlatform: window.desktopUpdates?.platform,
    bridgeMethods: Object.keys(window.desktopUpdates || {}) })).catch(error => ({ error: String(error) }));
  return { main, renderer };
}

async function configureFixtureFeed(app: ElectronApplication, feed: string, artifact: { name: string; bytes: number; sha512: string }) {
  return app.evaluate(({ app }, input) => {
      const url = input.url;
      const { createRequire } = (process as any).getBuiltinModule('module');
      const require = createRequire(app.getAppPath() + '/package.json');
      const updater = require('electron-updater').autoUpdater;
      // Disposable main-process feed substitution only: production trusted IPC,
      // downloader, byte hash, signature check, backup and installer are intact.
      updater.setFeedURL({ provider: 'generic', url });
      // The production transport permits only fixed HTTPS GitHub origins. Allow
      // this loopback fixture in the disposable updater partition, keeping the
      // classroom renderer partition and production payload guards untouched.
      require('electron').session.fromPartition('electron-updater').webRequest.onBeforeRequest(null);
      (globalThis as any).__upgradeErrors = [];
      (globalThis as any).__upgradeDownloaded = [];
      updater.on('error', (error: any) => (globalThis as any).__upgradeErrors.push({ code: error.code, message: error.message }));
      updater.on('update-downloaded', (event: any) => {
        const fs = (process as any).getBuiltinModule('fs');
        const crypto = (process as any).getBuiltinModule('crypto');
        (globalThis as any).__upgradeDownloaded.push({ file: event.downloadedFile, installerPath: updater.installerPath,
          expectedSha512: event.files?.[0]?.sha512, actualSha512: crypto.createHash('sha512').update(fs.readFileSync(event.downloadedFile)).digest('base64') });
      });
      const https = (process as any).getBuiltinModule('https');
      const { EventEmitter } = (process as any).getBuiltinModule('events');
      (globalThis as any).__upgradeMetadataRequests = [];
      const approvals = require('./electron/updateApproval.cjs');
      const delivery = require('./electron/releaseDelivery.cjs');
      const document = delivery.preparePublication(approvals.approve(approvals.recordTest(approvals.prepare({
        schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64', sourceCommit: '81058d87d669ff4cd787b06c25fe84217581f2ad', artifact: input.artifact
      }), 'Fictional installed-update fixture: exact installer, actual native signature and backup/recovery checks.')), { signature: 'unsigned' }, true).document;
      const release = { tag_name: 'v1.0.2', target_commitish: document.approval.candidate.sourceCommit,
        html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.0.2', draft: false, prerelease: false,
        assets: [input.artifact.name, 'latest.yml', 'student-organizer-approval-x64.json'].map(name => ({ name, state: 'uploaded', size: name === input.artifact.name ? input.artifact.bytes : 100,
          browser_download_url: `https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.2/${name}` })) };
      https.get = (destination: string, options: any, respond: any) => {
        const approvalURL = 'https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.2/student-organizer-approval-x64.json';
        if (!['https://api.github.com/repos/BadgerCraft/StudentOrganizer/git/ref/tags/v1.0.2', approvalURL, 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest', 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/tags/v1.0.2'].includes(destination)) throw new Error('Unexpected release lookup destination');
        (globalThis as any).__upgradeMetadataRequests.push({ destination, headers: options.headers });
        const request = new EventEmitter();
        (request as any).destroy = (error: Error) => { request.emit('error', error); return request; };
        const response = new EventEmitter();
        (response as any).statusCode = 200; (response as any).resume = () => {};
        process.nextTick(() => {
          respond(response);
          response.emit('data', Buffer.from(JSON.stringify(destination.includes('/git/ref/') ? { object: { type: 'commit', sha: document.approval.candidate.sourceCommit } } : destination === approvalURL ? document : release)));
          response.emit('end');
        });
        return request;
      };
      return { autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit };
  }, { url: feed, artifact });
}

const canonicalPaths = new Map<string, string>();
function canonicalExecutable(executable: string) {
  const saved = canonicalPaths.get(executable);
  if (saved) return saved;
  try { const value = fs.realpathSync.native(executable); canonicalPaths.set(executable, value); return value; }
  catch {
    try { return path.join(fs.realpathSync.native(path.dirname(executable)), path.basename(executable)); }
    catch { return path.resolve(executable); }
  }
}
function writeEvidence(name: string, value: unknown) {
  try { fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(value, null, 2) + '\n'); }
  catch (error) { console.warn(`Evidence write failed (${name}): ${String(error)}`); }
}
function cleanupDirectory(directory: string) {
  try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (error) {
    const warning = { directory, error: String(error) };
    writeEvidence('cleanup-warning.json', warning);
    console.warn('UPGRADE CLEANUP WARNING:', JSON.stringify(warning));
  }
}
async function windowsPowerShell(script: string, values: Record<string, string>) {
  // GitHub starts commands in PowerShell 7; these helpers deliberately run
  // Windows PowerShell 5 with matching built-in modules, including CimCmdlets.
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const result = await execFileAsync(executable, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + script], {
    timeout: 15000, maxBuffer: 65536, env: { ...environment, ...values,
      PSModulePath: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') }
  });
  if (result.stderr.trim()) throw new Error(`Native PowerShell helper failed: ${result.stderr.slice(0, 2000)}`);
  return result;
}

async function nativeInstallDiagnostics(executable: string) {
  const script = `$target=$env:OTA_UPGRADE_EXECUTABLE
    $fileVersion=$null
    if (Test-Path -LiteralPath $target) { $fileVersion=(Get-Item -LiteralPath $target).VersionInfo.ProductVersion }
    $rows=@(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -like 'OntarioTeacherAssessment*' -or $_.Name -eq 'Ontario Teacher Assessment.exe' -or
      $_.CommandLine -like ('*' + $env:OTA_UPGRADE_DIRECTORY + '*')
    } | Select-Object -First 20 | ForEach-Object {
      $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      $v=$null
      if ($_.ExecutablePath -and (Test-Path -LiteralPath $_.ExecutablePath)) { $v=(Get-Item -LiteralPath $_.ExecutablePath).VersionInfo.ProductVersion }
      [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; name=$_.Name; path=$_.ExecutablePath;
        commandLine=$_.CommandLine; version=$v; title=$p.MainWindowTitle; matchesExpected=($_.ExecutablePath -eq $target) }
    })
    [pscustomobject]@{ expectedExecutable=$target; installedFileVersion=$fileVersion; processes=$rows } | ConvertTo-Json -Depth 5 -Compress`;
  const result = await windowsPowerShell(script, { OTA_UPGRADE_EXECUTABLE: canonicalExecutable(executable), OTA_UPGRADE_DIRECTORY: path.dirname(canonicalExecutable(executable)) });
  return { time: new Date().toISOString(), rawExecutable: executable, ...JSON.parse(result.stdout.trim()) };
}
async function installedProcess(executable: string) {
  // Values are passed in an environment variable, never interpolated as code.
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:OTA_UPGRADE_EXECUTABLE -and $_.CommandLine -notmatch '--type=' } | ForEach-Object {
    $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    [pscustomobject]@{ pid = $_.ProcessId; path = $_.ExecutablePath; version = (Get-Item $_.ExecutablePath).VersionInfo.ProductVersion; title = $p.MainWindowTitle }
  } | ConvertTo-Json -Compress`;
  const result = await windowsPowerShell(script, { OTA_UPGRADE_EXECUTABLE: canonicalExecutable(executable) });
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]) as { pid: number; path: string; version: string; title: string }[];
}
async function closeRelaunched(pid: number) {
  await windowsPowerShell('$p=Get-Process -Id $env:OTA_UPGRADE_PID -ErrorAction Stop; if (-not $p.CloseMainWindow()) { throw "Reopened app has no closable visible window" }; $p.WaitForExit(10000); if (-not $p.HasExited) { throw "Reopened app did not close" }', { OTA_UPGRADE_PID: String(pid) });
}

/** The old metadata-only copy needs a deliberate manual first installation. */
async function runLegacyBootstrap() {
  assert.ok(process.argv.includes('--acknowledge-unsigned'), 'Disposable unsigned bootstrap testing requires explicit acknowledgement');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '.legacy-bootstrap-source', encoding: 'utf8' }).trim(), legacySource,
    'A must be built from the actual pinned pre-updater source, not current code with an older version');
  const pair = { A: '1.0.0', B: versions.B };
  const installers = Object.fromEntries(Object.entries(pair).map(([key, version]) => {
    const directory = path.resolve(`release/${key === 'A' ? 'bootstrap-A' : 'upgrade-B'}`);
    const names = fs.readdirSync(directory).filter(name => name.endsWith('-nsis.exe'));
    assert.equal(names.length, 1, `One bootstrap ${key} installer required`);
    assert.ok(names[0].includes(version));
    return [key, path.join(directory, names[0])];
  })) as { A: string; B: string };
  const signatures: Record<string, unknown> = {};
  for (const [key, installer] of Object.entries(installers)) {
    const result = await windowsPowerShell('$s=Get-AuthenticodeSignature -LiteralPath $env:OTA_BOOTSTRAP_INSTALLER; [pscustomobject]@{ status=$s.Status.ToString(); publisher=$s.SignerCertificate.Subject } | ConvertTo-Json -Compress',
      { OTA_BOOTSTRAP_INSTALLER: installer });
    const signature = JSON.parse(result.stdout.trim());
    assert.ok(['NotSigned', 'Valid'].includes(signature.status), 'Actual installer signature errors must fail closed');
    signatures[key] = signature;
  }
  console.log('Disposable fictional-data unsigned bootstrap explicitly acknowledged; checksums do not verify publisher identity.');
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-ota-bootstrap-'));
  const executable = path.join(installDir, 'Ontario Teacher Assessment.exe');
  let running: Awaited<ReturnType<typeof launchInstalled>> | undefined;
  let setup: ChildProcess | undefined;
  let marking: MarkingDesktopEvidence | undefined;
  try {
    setup = spawn(installers.A, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    canonicalExecutable(executable);
    assert.ok(fs.existsSync(path.join(installDir, 'Uninstall Ontario Teacher Assessment.exe')), 'Actual registered per-user legacy installation required');
    running = await launchInstalled(executable, pair.A);
    assert.equal(await running.page.evaluate(() => typeof window.desktopUpdates?.install), 'undefined', 'The actual legacy bridge must have no installer capability');
    await openHub(running.page);
    marking = await runMarkingDesktopAcceptance(running.page, path.join(evidenceDir, 'marking-A'), (trigger, destination) => download(running!.app, trigger, destination), 4);
    const before = await snapshotAll(running.page);
    const legacyDatabaseSource = execFileSync('git', ['show', `${legacySource}:src/db/database.ts`], { cwd: '.legacy-bootstrap-source', encoding: 'utf8' });
    const legacyTableNames = [...legacyDatabaseSource.matchAll(/^  (\w+)!: Table</gm)].map(match => match[1]).sort();
    assert.equal(legacyTableNames.length, 39, 'Pinned schema-4 source inventory must remain explicit');
    assert.deepEqual(Object.keys(before).sort(), legacyTableNames, 'Bootstrap snapshot must cover exactly the pinned legacy tables');
    for (const table of ['captureAttachments', 'captureImportReceipts']) assert.equal(Object.prototype.hasOwnProperty.call(before, table), false);
    // Schema 5 adds only empty capture tables; every legacy record remains exact.
    const migratedBefore = { ...before, captureAttachments: [], captureImportReceipts: [] };
    assert.equal(Object.keys(migratedBefore).length, 41);
    const backupPath = path.join(evidenceDir, 'legacy-complete-backup.json');
    await download(running.app, () => running!.page.getByTestId('create-backup-btn').click(), backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.schemaVersion, 4);
    assert.deepEqual(Object.keys(backup.tables).sort(), Object.keys(before).sort());
    for (const [table, rows] of Object.entries(before)) {
      assert.deepEqual(backup.tables[table].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))), rows, `Actual legacy full backup must preserve ${table}`);
    }
    const profileA = running.userData;
    await running.page.screenshot({ path: path.join(evidenceDir, 'legacy-A-backed-up.png'), fullPage: true });
    await running.app.close(); running = undefined;
    assert.equal((await installedProcess(executable)).length, 0, 'Legacy app must be closed before manual replacement');
    setup = spawn(installers.B, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    running = await launchInstalled(executable, pair.B);
    assert.equal(running.userData, profileA, 'Manual bootstrap must discover the exact legacy profile');
    assert.deepEqual(await snapshotAll(running.page), migratedBefore, 'Manual bootstrap must preserve every existing table and record');
    assert.equal((await state(running.page)).installationAvailable, true, 'The bootstrapped real installed bridge must enable future updates');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);
    const reportB = path.join(evidenceDir, 'markinator-report-B.html');
    await running.page.getByTestId(`open-marking-${marking.assessmentId}`).click();
    await openMarkingQueue(running.page);
    await download(running.app, () => running!.page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click(), reportB);
    assert.equal(canonicalLegacyReport(fs.readFileSync(reportB, 'utf8')), canonicalLegacyReport(fs.readFileSync(marking.reportPath, 'utf8').replace('Criterion / KTAC', 'Criterion / KTCA')), 'Legacy report must preserve all content, allowing only category display reordering');
    // A no-op restore could pass an equality check against identical data.
    // Persist a real later edit in B, then require the actual old backup to
    // replace it while preserving the original official records.
    await running.page.getByTestId(`marking-session-open-${marking.firstAttemptId}`).click();
    await waitUntil(async () => {
      const document = running!.page.getByTestId('marking-document');
      const save = running!.page.getByRole('button', { name: 'Save now', exact: true });
      const session = running!.page.locator('section[aria-label="Marking session"]');
      if (!(await document.count()) || !(await save.count()) || !(await session.count())) return undefined;
      return (await document.innerText()).includes('Echo phrase. Middle words.')
        && (await session.innerText()).includes('Draft — official marks unchanged')
        && await save.isEnabled() ? true : undefined;
    }, 'bootstrapped pending workspace settled before later edit');
    const laterFeedback = 'Fictional post-bootstrap change that the legacy backup must replace';
    await running.page.getByTestId('marking-feedback').fill(laterFeedback);
    await running.page.getByRole('button', { name: 'Save now', exact: true }).click();
    await waitUntil(async () => (await snapshotAll(running!.page)).markingSessions.some(row => row.attemptId === marking!.firstAttemptId
      && row.status === 'draft' && row.draft.pending?.text === laterFeedback) ? true : undefined, 'actual later B feedback saved');
    const changed = await snapshotAll(running.page);
    assert.notDeepEqual(changed.markingSessions, before.markingSessions, 'B must contain a later saved edit before recovery');
    assert.deepEqual(changed.studentAssessments, before.studentAssessments, 'Later pending edits must leave official marks intact');
    assert.deepEqual(changed.categoryResults, before.categoryResults, 'Later pending edits must leave finalized category evidence intact');
    await leaveMarkingWithDraft(running.page);
    await openRecovery(running.page);
    await running.page.getByTestId('restore-file-input').setInputFiles(backupPath);
    await running.page.getByTestId('restore-confirm-dialog').waitFor();
    assert.deepEqual(await snapshotAll(running.page), changed, 'Legacy backup preview must leave the later bootstrapped edit intact');
    await running.page.getByTestId('confirm-restore-btn').click();
    await running.page.getByText(/Database successfully restored/).waitFor();
    assert.deepEqual(await snapshotAll(running.page), migratedBefore, 'The real legacy full backup must restore all records through the current UI');
    await running.app.close(); running = undefined;
    running = await launchInstalled(executable, pair.B);
    assert.equal(running.userData, profileA);
    assert.deepEqual(await snapshotAll(running.page), migratedBefore, 'A second B restart must retain all restored legacy records');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);
    const restoredReport = path.join(evidenceDir, 'markinator-report-restored-B.html');
    await running.page.getByTestId(`open-marking-${marking.assessmentId}`).click();
    await openMarkingQueue(running.page);
    await download(running.app, () => running!.page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click(), restoredReport);
    assert.deepEqual(fs.readFileSync(restoredReport), fs.readFileSync(reportB), 'Current report bytes must survive legacy restore and restart');
    assert.deepEqual(running.errors, []);
    writeEvidence('bootstrap-results.json', {
      versions: pair, legacySource, currentSource: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), signatures,
      acknowledgedUnsigned: true, profilePreserved: true, backupPath,
      installers: Object.fromEntries(Object.entries(installers).map(([key, file]) => [key, { file: path.basename(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }])),
      tablesPreserved: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])),
      migratedTables: Object.keys(migratedBefore).sort(), legacySchemaVersion: 4, currentSchemaVersion: 5, marking,
      checks: ['actual pinned metadata-only legacy source', 'actual complete UI backup readback', 'deliberate per-user NSIS manual bootstrap', 'same legacy userData and every record',
        'future installer bridge available', 'visible marking originals/rubric/pending and official feedback', 'legacy report content unchanged except category display order', 'identical current report bytes after restore and restart', 'current UI replaces a later saved B edit from the actual legacy backup', 'second B restart'],
      limits: ['unsigned fictional CI only', 'no physical Windows/UAC/dialog or managed-device acceptance', 'manual bootstrap does not prove automatic updater reopening', 'no installation interruption or future-schema claim', 'no live GitHub delivery or public release']
    });
    console.log('PASS: Actual metadata-only legacy A manually bootstrapped to updater-enabled B; exact profile, all 39 legacy tables plus two empty capture tables, originals/rubrics/pending/official feedback, report bytes and real legacy-backup UI restore survived another restart.');
  } catch (error) {
    writeEvidence('failure.json', { error: String(error), stack: error instanceof Error ? error.stack : undefined, legacySource, versions: pair, signatures, marking });
    console.error('BOOTSTRAP PRIMARY FAILURE:', error);
    if (running) await running.page.screenshot({ path: path.join(evidenceDir, 'failed.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await running?.app.close().catch(() => {});
    if (setup) killOwned(setup);
    for (const process of await installedProcess(executable).catch(() => [])) {
      try { execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
    }
    cleanupDirectory(installDir);
  }
}

/**
 * Exercise the supported recovery after replacement has started and the old
 * app can no longer stay open. The fixture installer uses the real NSIS
 * extraction/registration path, then deliberately deletes the installed
 * executable and aborts. This is deterministic binary-loss evidence, not a
 * claim about an actual power cut.
 */
async function runInstallRecovery() {
  assert.ok(process.argv.includes('--acknowledge-unsigned'), 'Disposable unsigned recovery testing requires explicit acknowledgement');
  const packageBuild = JSON.parse(fs.readFileSync('package.json', 'utf8')).build;
  assert.equal(packageBuild?.nsis?.include, undefined, 'The failure fixture must never be part of the production NSIS configuration');
  const pair = { A: versions.A, B: versions.B };
  const directories = { A: 'recovery-A', failure: 'recovery-failure-B', B: 'recovery-B' };
  const installers = Object.fromEntries(Object.entries(directories).map(([key, directory]) => {
    const names = fs.readdirSync(path.resolve('release', directory)).filter(name => name.endsWith('-nsis.exe'));
    assert.equal(names.length, 1, `One recovery ${key} installer required`);
    const expectedVersion = key === 'A' ? pair.A : pair.B;
    assert.ok(names[0].includes(expectedVersion));
    return [key, path.resolve('release', directory, names[0])];
  })) as { A: string; failure: string; B: string };
  const signatures: Record<string, unknown> = {};
  for (const [key, installer] of Object.entries(installers)) {
    const result = await windowsPowerShell(
      '$s=Get-AuthenticodeSignature -LiteralPath $env:OTA_RECOVERY_INSTALLER; [pscustomobject]@{ status=$s.Status.ToString(); publisher=$s.SignerCertificate.Subject } | ConvertTo-Json -Compress',
      { OTA_RECOVERY_INSTALLER: installer });
    const signature = JSON.parse(result.stdout.trim());
    assert.ok(['NotSigned', 'Valid'].includes(signature.status), 'Actual recovery installer signature errors must fail closed');
    signatures[key] = signature;
  }
  console.log('Disposable fictional-data unsigned recovery fixture explicitly acknowledged; checksums do not verify publisher identity.');

  const failureBytes = fs.readFileSync(installers.failure);
  const sha512 = createHash('sha512').update(failureBytes).digest('base64');
  const failureFilename = path.basename(installers.failure);
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url || '');
    const resource = new URL(request.url || '/', 'http://localhost').pathname;
    if (resource === '/latest.yml') {
      response.setHeader('Content-Type', 'text/yaml');
      response.end(`version: ${pair.B}\nfiles:\n  - url: ${failureFilename}\n    sha512: ${sha512}\n    size: ${failureBytes.length}\npath: ${failureFilename}\nsha512: ${sha512}\nreleaseDate: '2026-10-13T00:00:00.000Z'\n`);
    } else if (resource === `/${failureFilename}`) {
      response.setHeader('Content-Length', failureBytes.length);
      response.end(failureBytes);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const feed = `http://127.0.0.1:${address.port}`;
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-ota-install-recovery-'));
  const executable = path.join(installDir, 'Ontario Teacher Assessment.exe');
  const failureMarker = path.join(installDir, 'student-organizer-ci-install-failure.txt');
  let running: Awaited<ReturnType<typeof launchInstalled>> | undefined;
  let setup: ChildProcess | undefined;
  let marking: MarkingDesktopEvidence | undefined;
  let safetyBackup = '';
  let fixtureDownload = '';
  try {
    setup = spawn(installers.A, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    canonicalExecutable(executable);
    running = await launchInstalled(executable, pair.A);
    await openHub(running.page);
    marking = await runMarkingDesktopAcceptance(running.page, path.join(evidenceDir, 'marking-A'), (trigger, destination) => download(running!.app, trigger, destination));
    const before = await snapshotAll(running.page);
    assert.equal(Object.keys(before).length, 41, 'Install recovery must cover every current-schema table');
    const profileA = running.userData;
    await openSettingsSection(running.page, 'updates');
    const updates = running.page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    assert.deepEqual(await configureFixtureFeed(running.app, feed, { name: failureFilename, bytes: failureBytes.length, sha512 }), { autoDownload: false, autoInstallOnAppQuit: false });
    assert.equal(requests.length, 0, 'Recovery fixture must not check or download before a click');
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${pair.B} is available.` }).waitFor();
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    assert.equal((await waitState(running.page, ['downloaded'])).signature, 'unsigned');
    const downloaded = await running.app.evaluate(() => (globalThis as any).__upgradeDownloaded || []);
    assert.equal(downloaded.length, 1, 'Exactly one fixture installer download is required');
    assert.equal(downloaded[0].expectedSha512, downloaded[0].actualSha512, 'The downloaded failure fixture must match its metadata');
    fixtureDownload = downloaded[0].installerPath || downloaded[0].file;
    assert.ok(typeof fixtureDownload === 'string' && fixtureDownload.endsWith('.exe'), 'The exact downloaded fixture path is required');

    const installButton = updates.getByRole('button', { name: 'Backup and install', exact: true });
    await installButton.click();
    const dialog = running.page.getByRole('dialog', { name: 'Install Windows update' });
    await dialog.getByRole('checkbox', { name: 'I understand this installer is unsigned.' }).check();
    const exit = new Promise<void>(resolve => running!.app.process().once('exit', () => resolve()));
    await dialog.getByRole('button', { name: 'Install and reopen', exact: true }).click();
    await Promise.race([exit, delay(60000).then(() => { throw new Error('Production updater did not close A for the failure fixture'); })]);
    running = undefined;
    await waitUntil(async () => fs.existsSync(failureMarker) ? true : undefined, 'deliberate post-copy NSIS failure marker', 120000);
    await waitUntil(async () => (await installedProcess(fixtureDownload)).length === 0 ? true : undefined,
      'deliberate failure installer process exit', 120000);
    assert.equal(fs.existsSync(executable), false, 'The failure fixture must leave the installed executable unusable');
    assert.equal((await installedProcess(executable)).length, 0, 'A failed replacement must not claim an automatic reopen');

    const backupDirectory = path.join(profileA, 'update-backups');
    const backups = fs.readdirSync(backupDirectory).filter(name => name.endsWith('.json')).sort();
    assert.ok(backups.length, 'The verified safety backup must survive the post-launch installer failure');
    safetyBackup = path.join(backupDirectory, backups.at(-1)!);
    const backup = JSON.parse(fs.readFileSync(safetyBackup, 'utf8'));
    assert.equal(backup.schemaVersion, 5);
    for (const [table, rows] of Object.entries(before)) {
      assert.deepEqual((backup.tables[table] || []).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))), rows,
        `Safety backup must preserve ${table} before the failed replacement`);
    }

    setup = spawn(installers.B, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    running = await launchInstalled(executable, pair.B);
    assert.equal(running.userData, profileA, 'Manual repair must rediscover the original installed profile');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);

    // Make the restore observable: the saved pre-failure backup must replace a
    // later B edit rather than merely previewing data that already matches.
    await running.page.getByTestId(`open-marking-${marking.assessmentId}`).click();
    await openMarkingQueue(running.page);
    await running.page.getByTestId(`marking-session-open-${marking.firstAttemptId}`).click();
    await waitUntil(async () => {
      const document = running!.page.getByTestId('marking-document');
      const save = running!.page.getByRole('button', { name: 'Save now', exact: true });
      const session = running!.page.locator('section[aria-label="Marking session"]');
      if (!(await document.count()) || !(await save.count()) || !(await session.count())) return undefined;
      return (await document.innerText()).includes('Echo phrase. Middle words.')
        && (await session.innerText()).includes('Draft — official marks unchanged')
        && await save.isEnabled() ? true : undefined;
    }, 'repaired pending workspace settled before later edit');
    const laterFeedback = 'Fictional post-repair change that the safety backup must replace';
    await running.page.getByTestId('marking-feedback').fill(laterFeedback);
    await running.page.getByRole('button', { name: 'Save now', exact: true }).click();
    await waitUntil(async () => (await snapshotAll(running!.page)).markingSessions.some(row => row.attemptId === marking!.firstAttemptId
      && row.status === 'draft' && row.draft.pending?.text === laterFeedback) ? true : undefined, 'actual later repaired feedback saved');
    const changed = await snapshotAll(running.page);
    assert.notDeepEqual(changed.markingSessions, before.markingSessions);
    assert.deepEqual(changed.studentAssessments, before.studentAssessments, 'Later pending edits must leave official marks intact');
    assert.deepEqual(changed.categoryResults, before.categoryResults, 'Later pending edits must leave finalized category evidence intact');
    await leaveMarkingWithDraft(running.page);
    await openRecovery(running.page);
    await running.page.getByTestId('restore-file-input').setInputFiles(safetyBackup);
    await running.page.getByTestId('restore-confirm-dialog').waitFor();
    assert.deepEqual(await snapshotAll(running.page), changed, 'Safety-backup preview must not change the repaired database');
    await running.page.getByTestId('confirm-restore-btn').click();
    await running.page.getByText(/Database successfully restored/).waitFor();
    assert.deepEqual(await snapshotAll(running.page), before, 'Confirmed safety-backup recovery must restore every original record');

    await running.app.close(); running = undefined;
    running = await launchInstalled(executable, pair.B);
    assert.equal(running.userData, profileA);
    assert.deepEqual(await snapshotAll(running.page), before, 'A repaired B restart must retain the recovered records');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);
    const reportB = path.join(evidenceDir, 'markinator-report-recovered.html');
    await running.page.getByTestId(`open-marking-${marking.assessmentId}`).click();
    await openMarkingQueue(running.page);
    await download(running.app, () => running!.page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click(), reportB);
    assert.deepEqual(fs.readFileSync(reportB), fs.readFileSync(marking.reportPath), 'Recovered finalized report bytes must match the original');
    await running.app.close(); running = undefined;
    running = await launchInstalled(executable, pair.B);
    assert.equal(running.userData, profileA);
    assert.deepEqual(await snapshotAll(running.page), before, 'Another B restart must retain the recovered records');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);
    assert.deepEqual(running.errors, []);

    writeEvidence('install-recovery-results.json', {
      versions: pair, signatures, acknowledgedUnsigned: true, profilePreserved: true,
      failureFixture: { marker: path.basename(failureMarker), downloadedInstaller: path.basename(fixtureDownload),
        installerProcessExited: true, executableMissing: true, kind: 'deterministic post-copy NSIS abort; not a physical power interruption' },
      safetyBackup: { file: path.basename(safetyBackup), schemaVersion: backup.schemaVersion },
      installers: Object.fromEntries(Object.entries(installers).map(([key, file]) => [key, {
        file: path.basename(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
      }])),
      tablesRecovered: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])),
      reportSha256: createHash('sha256').update(fs.readFileSync(reportB)).digest('hex'),
      requests, marking,
      checks: ['production explicit check/download/unsigned acknowledgement', 'verified complete safety backup before quit',
        'real NSIS post-copy failure fixture leaves no usable executable or reopened app', 'manual good-installer repair finds the same profile',
        'actual UI restore replaces a later saved B edit', 'every table and visible marking/report recovered', 'second B restart'],
      limits: ['controlled NSIS failure injection, not actual power loss or OS shutdown', 'unsigned fictional hosted-runner evidence only',
        'no native dialogs/UAC or physical/managed-device acceptance', 'no future-schema, live GitHub delivery, public release or publisher-trust claim']
    });
    console.log('PASS: A deterministic post-launch NSIS failure left the app unusable while preserving the complete safety backup; manual B repair plus actual UI restore recovered all 41 current tables, visible marking and identical report bytes across another restart.');
  } catch (error) {
    writeEvidence('failure.json', { error: String(error), stack: error instanceof Error ? error.stack : undefined,
      versions: pair, signatures, safetyBackup, fixtureDownload, marking, requests });
    console.error('INSTALL RECOVERY PRIMARY FAILURE:', error);
    if (running) await running.page.screenshot({ path: path.join(evidenceDir, 'failed.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await running?.app.close().catch(() => {});
    if (setup) killOwned(setup);
    for (const process of await installedProcess(executable).catch(() => [])) {
      try { execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    cleanupDirectory(installDir);
  }
}

async function main() {
  if (process.platform !== 'win32' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Real installer replacement may run only on a disposable Windows GitHub Actions runner.');
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (legacyBootstrap) return runLegacyBootstrap();
  if (installRecovery) return runInstallRecovery();
  // Fail early on an installed IPC boundary problem, before building the A/B
  // pair. This also verifies the released QA installer exposes real status IPC.
  if (process.argv.includes('--ipc-boundary-only')) {
    const installer = fs.readdirSync('release').filter(name => name.endsWith('-nsis.exe'));
    assert.equal(installer.length, 1);
    const expectedVersion = process.env.QA_VERSION;
    assert.ok(expectedVersion);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-ota-boundary-'));
    let launched: Awaited<ReturnType<typeof launchInstalled>> | undefined;
    const setup = spawn(path.resolve('release', installer[0]), ['/S', '/currentuser', `/D=${directory}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    try {
      await waitForExit(setup, 120000);
      launched = await launchInstalled(path.join(directory, 'Ontario Teacher Assessment.exe'), expectedVersion);
      const signatureProbe = await launched.app.evaluate(async ({ app }, installerPath) => {
        const { createRequire } = (process as any).getBuiltinModule('module');
        const require = createRequire(app.getAppPath() + '/package.json');
        try { return { result: await require('./electron/windowsInstallerUpdate.cjs').inspectSignature(installerPath) }; }
        catch (error: any) { return { error: String(error), code: error.code, stdout: error.stdout, stderr: error.stderr,
          inheritedPSModulePath: process.env.PSModulePath }; }
      }, path.resolve('release', installer[0]));
      console.log('ACTUAL SIGNATURE INSPECTOR:', JSON.stringify(signatureProbe));
      fs.writeFileSync(path.join(evidenceDir, 'signature-inspector.json'), JSON.stringify(signatureProbe, null, 2));
      assert.deepEqual(signatureProbe, { result: { signature: 'unsigned' } }, 'Production signature inspector must classify the actual unsigned QA executable');
      await observeStatusBoundary(launched.app);
      const before = await boundaryDiagnostics(launched.app, launched.page);
      fs.writeFileSync(path.join(evidenceDir, 'installed-ipc-before.json'), JSON.stringify(before, null, 2));
      const actual = await state(launched.page);
      assert.equal(actual.installationAvailable, true);
      const after = await boundaryDiagnostics(launched.app, launched.page);
      fs.writeFileSync(path.join(evidenceDir, 'installed-ipc-after.json'), JSON.stringify(after, null, 2));
      console.log('PASS: Real installed QA binary authorizes only its owned main-frame status IPC.');
    } catch (error) {
      if (launched) {
        const diagnostic = await boundaryDiagnostics(launched.app, launched.page).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }));
        fs.writeFileSync(path.join(evidenceDir, 'installed-ipc-failure.json'), JSON.stringify(diagnostic, null, 2));
        console.error('INSTALLED IPC BOUNDARY:', JSON.stringify(diagnostic));
      }
      throw error;
    } finally {
      await launched?.app.close().catch(() => {});
      killOwned(setup);
      cleanupDirectory(directory);
    }
    return;
  }
  const installers = Object.fromEntries(Object.entries(versions).map(([key, version]) => {
    const directory = path.resolve(`release/upgrade-${key}`);
    const names = fs.readdirSync(directory).filter(name => name.endsWith('-nsis.exe'));
    assert.equal(names.length, 1, `One ${key} installer required`);
    assert.ok(names[0].includes(version));
    return [key, path.join(directory, names[0])];
  })) as { A: string; B: string };
  const bytes = fs.readFileSync(installers.B);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const filename = path.basename(installers.B);
  let mode: 'corrupt' | 'slow' | 'good' = 'corrupt';
  const requests: string[] = [];
  const requestHeaders: string[][] = [];
  let slowBytesSent = 0;
  const server = createServer((request, response) => {
    requests.push(request.url || '');
    requestHeaders.push(Object.keys(request.headers));
    const resource = new URL(request.url || '/', 'http://localhost').pathname;
    if (resource === '/latest.yml') {
      response.setHeader('Content-Type', 'text/yaml');
      response.end(`version: ${versions.B}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '2026-10-09T00:00:00.000Z'\n`);
    } else if (resource === `/${filename}`) {
      response.setHeader('Content-Length', bytes.length);
      if (mode === 'corrupt') {
        const invalid = Buffer.from(bytes); invalid[invalid.length - 1] ^= 0xff; response.end(invalid);
      } else if (mode === 'good') response.end(bytes);
      else {
        let position = 0;
        const interval = setInterval(() => {
          const end = Math.min(position + 64 * 1024, bytes.length);
          response.write(bytes.subarray(position, end)); slowBytesSent += end - position; position = end;
          if (position === bytes.length) { clearInterval(interval); response.end(); }
        }, 100);
        response.once('close', () => clearInterval(interval));
      }
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const feed = `http://127.0.0.1:${address.port}`;
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-ota-upgrade-'));
  const executable = path.join(installDir, 'Ontario Teacher Assessment.exe');
  let running: Awaited<ReturnType<typeof launchInstalled>> | undefined;
  let setup: ChildProcess | undefined;
  let marking: MarkingDesktopEvidence | undefined;
  const installTimeline: unknown[] = [];
  try {
    setup = spawn(installers.A, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    assert.ok(fs.existsSync(executable));
    canonicalExecutable(executable); // Cache while A exists; replacement may temporarily remove this file.
    assert.ok(fs.existsSync(path.join(installDir, 'Uninstall Ontario Teacher Assessment.exe')), 'Actual NSIS installed identity required');
    running = await launchInstalled(executable, versions.A);
    await openHub(running.page);
    marking = await runMarkingDesktopAcceptance(running.page, path.join(evidenceDir, 'marking-A'), (trigger, destination) => download(running!.app, trigger, destination));
    await openSettingsSection(running.page, 'updates');
    let updates = running.page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    await observeStatusBoundary(running.app);
    const initialBoundary = await boundaryDiagnostics(running.app, running.page);
    fs.writeFileSync(path.join(evidenceDir, 'initial-ipc-boundary.json'), JSON.stringify(initialBoundary, null, 2) + '\n');
    await state(running.page); // Reads installed updater state without network.
    const metadata = await configureFixtureFeed(running.app, feed, { name: filename, bytes: bytes.length, sha512 });
    assert.deepEqual(metadata, { autoDownload: false, autoInstallOnAppQuit: false });
    assert.equal(requests.length, 0, 'Startup/opening settings must not check or download');
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${versions.B} is available.` }).waitFor();
    assert.equal(requests.filter(url => url.includes('.exe')).length, 0, 'Checking must not download installer');
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    const rejected = await waitState(running.page, ['error']);
    assert.match(rejected.error || '', /verified or downloaded/i);
    const errors = await running.app.evaluate(() => (globalThis as any).__upgradeErrors);
    assert.ok(errors.some((error: any) => /checksum|sha512|hash/i.test(error.message) || error.code === 'ERR_CHECKSUM_MISMATCH'), 'Corrupted installer must be rejected for its actual checksum, not an unrelated failure');
    assert.equal(await running.app.evaluate(({ app }) => app.getVersion()), versions.A);
    mode = 'slow';
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${versions.B} is available.` }).waitFor();
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    await waitState(running.page, ['downloading']);
    await waitUntil(async () => slowBytesSent > 0 ? true : undefined, 'real installer download bytes before cancellation');
    await updates.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await waitState(running.page, ['cancelled']);
    assert.equal(await running.app.evaluate(({ app }) => app.getVersion()), versions.A);
    mode = 'good';
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${versions.B} is available.` }).waitFor();
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    const ready = await waitState(running.page, ['downloaded']);
    assert.equal(ready.signature, 'unsigned', 'Current free QA binaries require explicit unsigned acknowledgement');
    const metadataBeforeQuit = await running.app.evaluate(() => (globalThis as any).__upgradeMetadataRequests);
    assert.equal(metadataBeforeQuit.filter((request: any) => request.destination.endsWith('/latest')).length, 3, 'Three explicit release checks before ordinary quit');
    const beforeOrdinaryQuit = await snapshotAll(running.page);
    const requestsBeforeQuit = requests.length;
    await running.app.close(); running = undefined;
    await delay(2000);
    assert.equal((await installedProcess(executable)).length, 0, 'Ordinary close with a verified pending update must not install or reopen');
    running = await launchInstalled(executable, versions.A);
    assert.deepEqual(await snapshotAll(running.page), beforeOrdinaryQuit, 'Ordinary A restart must preserve data and leave A installed');
    assert.equal(requests.length, requestsBeforeQuit, 'Restart must not check or resume update traffic');
    await openHub(running.page);
    await openSettingsSection(running.page, 'updates');
    updates = running.page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    assert.deepEqual(await configureFixtureFeed(running.app, feed, { name: filename, bytes: bytes.length, sha512 }), { autoDownload: false, autoInstallOnAppQuit: false });
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${versions.B} is available.` }).waitFor();
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    assert.equal((await waitState(running.page, ['downloaded'])).signature, 'unsigned');
    const installButton = updates.getByRole('button', { name: 'Backup and install', exact: true });
    await installButton.waitFor();
    const gradingSection = running.page.getByRole('button', { name: 'grading', exact: true });
    if (await gradingSection.isVisible()) await gradingSection.click();
    const weight = running.page.getByText('Knowledge (K) %', { exact: true }).locator('..').getByRole('spinbutton');
    const previousWeight = await weight.inputValue();
    await weight.fill(String(Number(previousWeight) + 1));
    const updatesSection = running.page.getByRole('button', { name: 'updates', exact: true });
    if (await updatesSection.isVisible()) await updatesSection.click();
    assert.equal(await installButton.isEnabled(), false, 'Unsaved Settings changes must block installation');
    if (await gradingSection.isVisible()) await gradingSection.click();
    await weight.fill(previousWeight);
    if (await updatesSection.isVisible()) await updatesSection.click();
    await waitUntil(async () => await installButton.isEnabled() ? true : undefined, 'restored Settings installation eligibility');
    const metadataRequests = [...metadataBeforeQuit, ...await running.app.evaluate(() => (globalThis as any).__upgradeMetadataRequests)];
    assert.equal(metadataRequests.filter((request: any) => request.destination.endsWith('/latest')).length, 4, 'Only four explicit release-check clicks may query latest; explicit download verification also reads pinned approval/tag metadata');
    assert.ok(metadataRequests.every((request: any) => Object.keys(request.headers).sort().join(',') === 'Accept,User-Agent'), 'Manual metadata requests contain only static headers');
    assert.ok(requestHeaders.every(headers => !headers.some(header => /^(authorization|cookie|referer|x-user-staging-id)$/i.test(header))), 'Installer transport must strip account/session/staging headers');
    const before = await snapshotAll(running.page);
    const profileA = running.userData;
    const processA = running.app.process().pid;
    await running.page.screenshot({ path: path.join(evidenceDir, 'A-downloaded.png'), fullPage: true });
    await installButton.click();
    const dialog = running.page.getByRole('dialog', { name: 'Install Windows update' });
    const confirm = dialog.getByRole('button', { name: 'Install and reopen', exact: true });
    assert.equal(await confirm.isEnabled(), false, 'Unsigned installation must not default to approved');
    await dialog.getByRole('button', { name: 'Later', exact: true }).click();
    assert.equal((await state(running.page)).status, 'downloaded', 'Later must retain the verified download without starting installation');
    assert.equal(await running.app.evaluate(({ app }) => app.getVersion()), versions.A);
    await installButton.click();
    assert.equal(await confirm.isEnabled(), false, 'Reopened unsigned confirmation must still require approval');
    await dialog.getByRole('checkbox', { name: 'I understand this installer is unsigned.' }).check();
    assert.equal(await confirm.isEnabled(), true);
    assert.deepEqual(await snapshotAll(running.page), before, 'Opening installation confirmation must not modify classroom records');
    const exit = new Promise<void>(resolve => running!.app.process().once('exit', () => resolve()));
    installTimeline.push({ phase: 'before-confirm', ...await nativeInstallDiagnostics(executable).catch(error => ({ diagnosticError: String(error) })) });
    writeEvidence('install-timeline.json', installTimeline);
    await confirm.click();
    await Promise.race([exit, delay(60000).then(() => { throw new Error('Production updater did not close A'); })]);
    installTimeline.push({ phase: 'A-exited', exitCode: running.app.process().exitCode, signalCode: running.app.process().signalCode,
      ...await nativeInstallDiagnostics(executable).catch(error => ({ diagnosticError: String(error) })) });
    writeEvidence('install-timeline.json', installTimeline);
    assert.deepEqual(running.errors, []);
    // Observe a genuinely installer-reopened B, before any instrumented relaunch.
    let nextNativeSample = 0;
    const reopened = await waitUntil(async () => {
      const processes = await installedProcess(executable);
      if (Date.now() >= nextNativeSample) {
        installTimeline.push({ phase: 'waiting-for-B', ...await nativeInstallDiagnostics(executable).catch(error => ({ diagnosticError: String(error) })) });
        writeEvidence('install-timeline.json', installTimeline);
        nextNativeSample = Date.now() + 8000;
      }
      return processes.find(row => row.pid !== processA && row.version.startsWith(versions.B) && row.title.includes('Ontario Teacher Assessment'));
    }, 'installer replacement and automatic visible B reopen', 120000);
    writeEvidence('reopened-process.json', reopened);
    await closeRelaunched(reopened.pid);
    running = undefined;
    running = await launchInstalled(executable, versions.B);
    assert.equal(running.userData, profileA, 'Replacement must keep the normal installed profile location');
    assert.deepEqual(await snapshotAll(running.page), before, 'A-to-B upgrade must preserve every IndexedDB table and record');
    const safetyBackups = path.join(profileA, 'update-backups');
    const backupFiles = fs.readdirSync(safetyBackups).filter(name => name.endsWith('.json'));
    assert.ok(backupFiles.length, 'Install action must write a real safety backup before quitting');
    const backup = JSON.parse(fs.readFileSync(path.join(safetyBackups, backupFiles.sort().at(-1)!), 'utf8'));
    for (const [table, rows] of Object.entries(before)) {
      assert.deepEqual((backup.tables[table] || []).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))), rows, `Safety backup must preserve ${table}`);
    }
    await openHub(running.page);
    await verifyAfterRestart(running.page, marking);
    const reportB = path.join(evidenceDir, 'markinator-report-B.html');
    await running.page.getByTestId(`open-marking-${marking.assessmentId}`).click();
    await openMarkingQueue(running.page);
    await download(running.app, () => running!.page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click(), reportB);
    assert.deepEqual(fs.readFileSync(reportB), fs.readFileSync(marking.reportPath), 'Finalized report bytes must be identical after installing B');
    await running.app.close(); running = undefined;
    running = await launchInstalled(executable, versions.B);
    assert.deepEqual(await snapshotAll(running.page), before, 'B ordinary close/restart must preserve every record again');
    await openHub(running.page); await verifyAfterRestart(running.page, marking);
    assert.deepEqual(running.errors, []);
    fs.writeFileSync(path.join(evidenceDir, 'upgrade-results.json'), JSON.stringify({ versions, installers: Object.fromEntries(Object.entries(installers).map(([key, file]) => [key, { file: path.basename(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }])), reopened, profilePreserved: true, tablesPreserved: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])), checks: ['actual installed A', 'production Settings/preload/IPC check-download-install', 'no startup/quit-time automatic download/install', 'real corrupted-byte checksum rejection and retry', 'real download cancellation and retry', 'unsaved Settings install guard and safe Later deferral', 'explicit unsigned approval', 'actual safety backup before quit', 'real pending-update ordinary quit/restart leaves A unchanged', 'real NSIS A-to-B replacement', 'actual automatic visible B reopen', 'identical all-table data and marking report after upgrade', 'second B restart preservation'], requests, requestHeaders, metadataRequests, checksumErrors: errors, marking }, null, 2) + '\n');
    console.log('PASS: Real installed A upgraded through production IPC/download/hash/signature/backup/NSIS installer to B, automatically reopened, and preserved every record, original, rubric, pending feedback, official mark and report across another restart; corrupt/cancel/retry paths also passed.');
  } catch (error) {
    // Save the primary error before touching a possibly installer-closed app.
    writeEvidence('failure.json', { error: String(error), stack: error instanceof Error ? error.stack : undefined, requests, versions, marking });
    console.error('UPGRADE PRIMARY FAILURE:', error);
    const native = await nativeInstallDiagnostics(executable).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }));
    writeEvidence('failed-native-install.json', native);
    console.error('UPGRADE NATIVE INSTALL:', JSON.stringify(native));
    if (running) {
      const boundary = await boundaryDiagnostics(running.app, running.page).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }));
      writeEvidence('failed-ipc-boundary.json', boundary);
      console.error('UPGRADE IPC BOUNDARY:', JSON.stringify(boundary));
      const verification = await running.app.evaluate(() => ({ errors: (globalThis as any).__upgradeErrors || [], downloaded: (globalThis as any).__upgradeDownloaded || [] }))
        .catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }));
      writeEvidence('failed-verification.json', verification);
      console.error('UPGRADE VERIFICATION:', JSON.stringify(verification));
    }
    await running?.page.screenshot({ path: path.join(evidenceDir, 'failed.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await running?.app.close().catch(() => {});
    if (setup) killOwned(setup);
    for (const process of await installedProcess(executable).catch(() => [])) {
      try { execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    cleanupDirectory(installDir);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
