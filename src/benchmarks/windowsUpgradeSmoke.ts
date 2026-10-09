import assert from 'node:assert/strict';
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { runMarkingDesktopAcceptance, verifyAfterRestart, type MarkingDesktopEvidence } from './markingDesktopAcceptance';

// This deliberately uses the real installed application's normal profile. The
// guard below limits it to a disposable Windows runner containing fictional QA
// data; no replacement is attempted against a teacher's installation/profile.
const evidenceDir = path.resolve('release/qa-evidence/windows-upgrade');
const execFileAsync = promisify(execFile);
const versions = { A: '1.0.1', B: '1.0.2' };
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
  return waitUntil(async () => { const current = await state(page); return allowed.includes(current.status) ? current : undefined; }, `updater state ${allowed.join('/')}`);
}
async function openHub(page: Page) {
  page.setDefaultTimeout(30000);
  const chooser = page.getByTestId('teacher-selector-modal');
  await chooser.waitFor({ state: 'visible' });
  if (await chooser.isVisible()) {
    await page.locator('[data-testid^="select-teacher-"]').first().click();
    await chooser.waitFor({ state: 'hidden' });
  }
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.locator('button[title="Manage Assessments & Rubrics"]').click();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor();
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

async function configureFixtureFeed(app: ElectronApplication, feed: string) {
  return app.evaluate(({ app }, url) => {
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
      updater.on('error', (error: any) => (globalThis as any).__upgradeErrors.push({ code: error.code, message: error.message }));
      const https = (process as any).getBuiltinModule('https');
      const { EventEmitter } = (process as any).getBuiltinModule('events');
      (globalThis as any).__upgradeMetadataRequests = [];
      https.get = (destination: string, options: any, respond: any) => {
        if (destination !== 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest') throw new Error('Unexpected release lookup destination');
        (globalThis as any).__upgradeMetadataRequests.push({ destination, headers: options.headers });
        const request = new EventEmitter();
        (request as any).destroy = (error: Error) => { request.emit('error', error); return request; };
        const response = new EventEmitter();
        (response as any).statusCode = 200; (response as any).resume = () => {};
        process.nextTick(() => {
          respond(response);
          response.emit('data', Buffer.from(JSON.stringify({ tag_name: 'v1.0.2', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.0.2', draft: false, prerelease: false })));
          response.emit('end');
        });
        return request;
      };
      return { autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit };
  }, feed);
}

async function installedProcess(executable: string) {
  // Values are passed in an environment variable, never interpolated as code.
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:OTA_UPGRADE_EXECUTABLE -and $_.CommandLine -notmatch '--type=' } | ForEach-Object {
    $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    [pscustomobject]@{ pid = $_.ProcessId; path = $_.ExecutablePath; version = (Get-Item $_.ExecutablePath).VersionInfo.ProductVersion; title = $p.MainWindowTitle }
  } | ConvertTo-Json -Compress`;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, OTA_UPGRADE_EXECUTABLE: executable } });
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]) as { pid: number; path: string; version: string; title: string }[];
}
async function closeRelaunched(pid: number) {
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=Get-Process -Id $env:OTA_UPGRADE_PID -ErrorAction Stop; if (-not $p.CloseMainWindow()) { throw "Reopened app has no closable visible window" }; $p.WaitForExit(30000); if (-not $p.HasExited) { throw "Reopened app did not close" }'], { env: { ...process.env, OTA_UPGRADE_PID: String(pid) } });
}

async function main() {
  if (process.platform !== 'win32' || process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Real installer replacement may run only on a disposable Windows GitHub Actions runner.');
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
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
  try {
    setup = spawn(installers.A, ['/S', '/currentuser', `/D=${installDir}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
    await waitForExit(setup, 120000);
    assert.ok(fs.existsSync(executable));
    assert.ok(fs.existsSync(path.join(installDir, 'Uninstall Ontario Teacher Assessment.exe')), 'Actual NSIS installed identity required');
    running = await launchInstalled(executable, versions.A);
    await openHub(running.page);
    marking = await runMarkingDesktopAcceptance(running.page, path.join(evidenceDir, 'marking-A'), (trigger, destination) => download(running!.app, trigger, destination));
    await running.page.getByTitle('Grading Policies & Scale Presets', { exact: true }).click();
    let updates = running.page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    await state(running.page); // Initializes installed updater without network.
    const metadata = await configureFixtureFeed(running.app, feed);
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
    assert.equal(metadataBeforeQuit.length, 3, 'Three explicit release checks before ordinary quit');
    const beforeOrdinaryQuit = await snapshotAll(running.page);
    const requestsBeforeQuit = requests.length;
    await running.app.close(); running = undefined;
    await delay(2000);
    assert.equal((await installedProcess(executable)).length, 0, 'Ordinary close with a verified pending update must not install or reopen');
    running = await launchInstalled(executable, versions.A);
    assert.deepEqual(await snapshotAll(running.page), beforeOrdinaryQuit, 'Ordinary A restart must preserve data and leave A installed');
    assert.equal(requests.length, requestsBeforeQuit, 'Restart must not check or resume update traffic');
    await openHub(running.page);
    await running.page.getByTitle('Grading Policies & Scale Presets', { exact: true }).click();
    updates = running.page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    assert.deepEqual(await configureFixtureFeed(running.app, feed), { autoDownload: false, autoInstallOnAppQuit: false });
    await updates.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await updates.getByRole('status').filter({ hasText: `Version ${versions.B} is available.` }).waitFor();
    await updates.getByRole('button', { name: 'Download update', exact: true }).click();
    assert.equal((await waitState(running.page, ['downloaded'])).signature, 'unsigned');
    const installButton = updates.getByRole('button', { name: 'Backup and install', exact: true });
    await installButton.waitFor();
    const weight = running.page.getByText('Knowledge (K) %', { exact: true }).locator('..').getByRole('spinbutton');
    const previousWeight = await weight.inputValue();
    await weight.fill(String(Number(previousWeight) + 1));
    assert.equal(await installButton.isEnabled(), false, 'Unsaved Settings changes must block installation');
    await weight.fill(previousWeight);
    await waitUntil(async () => await installButton.isEnabled() ? true : undefined, 'restored Settings installation eligibility');
    const metadataRequests = [...metadataBeforeQuit, ...await running.app.evaluate(() => (globalThis as any).__upgradeMetadataRequests)];
    assert.equal(metadataRequests.length, 4, 'Only four explicit release-check clicks may contact metadata');
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
    await confirm.click();
    await Promise.race([exit, delay(60000).then(() => { throw new Error('Production updater did not close A'); })]);
    assert.deepEqual(running.errors, []);
    // Observe a genuinely installer-reopened B, before any instrumented relaunch.
    const reopened = await waitUntil(async () => (await installedProcess(executable)).find(row => row.pid !== processA && row.version.startsWith(versions.B) && row.title.includes('Ontario Teacher Assessment')), 'installer replacement and automatic visible B reopen', 120000);
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
    await running?.page.screenshot({ path: path.join(evidenceDir, 'failed.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(evidenceDir, 'failure.json'), JSON.stringify({ error: String(error), requests, versions, marking }, null, 2));
    throw error;
  } finally {
    await running?.app.close().catch(() => {});
    if (setup) killOwned(setup);
    for (const process of await installedProcess(executable).catch(() => [])) {
      try { execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* Already closed. */ }
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(installDir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
