import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Test-side automation only. No production hooks or altered application safeguards.
// Native dialog results select fictional files; all renderer/preload/IPC/state/file I/O is real.
const executablePath = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'Pass the actual packaged Control Panel executable, not a development Electron entry.');
const temporary = await mkdtemp(path.join(tmpdir(), 'owner-native-fictional-'));
const profile = path.join(temporary, 'owner-profile');
const teacherProfile = path.join(temporary, 'fictional-teacher-profile');
const fixtures = path.join(temporary, 'fixtures');
const exported = path.join(temporary, 'LOCAL-PREVIEW.json');
const storeFile = path.join(profile, 'local-approval.json');
const evidencePath = path.resolve(`release/control-panel/native-smoke-${process.platform}-${process.arch}.json`);
const steps: string[] = [];
let runtime: ElectronApplication | undefined;
let page!: Page;
const originalBytes = Buffer.from('FICTIONAL NON-EXECUTABLE INSTALLER FIXTURE\n');
const artifact = path.join(fixtures, 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe');
const descriptor = path.join(fixtures, 'candidate.json');
const candidate = { schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64',
  sourceCommit: '81058d87d669ff4cd787b06c25fe84217581f2ad', artifact: {
    name: path.basename(artifact), bytes: originalBytes.length,
    sha512: createHash('sha512').update(originalBytes).digest('base64') } };
const sentinel = '{"fictionalTeacherSentinel":"must remain byte-identical"}\n';
async function launch() {
  runtime = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], chromiumSandbox: true, timeout: 45000 });
  runtime.process().on('exit', (code, signal) => { console.log(`Packaged process exited: code=${code}, signal=${signal}`); });
  runtime.process().stderr?.on('data', chunk => { process.stderr.write(chunk); });
  page = await runtime.firstWindow();
  page.on('pageerror', error => { console.error('Owner renderer error:', error.message); });
  await page.getByRole('heading', { name: 'Approve a tested candidate locally' }).waitFor();
  await page.waitForFunction(() => typeof (window as any).ownerConsole?.status === 'function');
  return runtime;
}
async function close() { if (runtime) { await runtime.close(); runtime = undefined; } }
async function status(): Promise<any> { return page.evaluate(() => (window as any).ownerConsole.status()); }
async function call(method: string): Promise<any> { return page.evaluate(name => (window as any).ownerConsole[name](), method); }
async function chooseFiles(files: string[], destination = exported) {
  await runtime!.evaluate(({ dialog }, input) => {
    const queue = [...input.files];
    dialog.showOpenDialog = async () => {
      const file = queue.shift();
      if (!file) throw new Error('Unexpected native open dialog');
      return { canceled: false, filePaths: [file] };
    };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: input.destination });
  }, { files, destination });
}
async function importFixture(file = descriptor) {
  await chooseFiles([file, artifact]);
  await page.getByRole('button', { name: 'Import candidate + verify installer' }).click();
  await page.getByText('CANDIDATE — LOCAL ONLY', { exact: true }).waitFor();
}
async function finishTest() {
  await page.getByLabel('Verification evidence (no personal or student data)').fill('FICTIONAL native bridge/atomic store smoke only; this text does not attest installer execution.');
  await page.getByLabel('I performed the checks described above on this exact installer.').check();
  await page.getByRole('button', { name: 'Record completed verification' }).click();
  await page.getByText('TESTED — LOCAL ONLY', { exact: true }).waitFor();
}
async function assertTeacherIsolation() {
  assert.equal(await readFile(path.join(teacherProfile, 'sentinel.json'), 'utf8'), sentinel);
  assert.deepEqual(await readdir(teacherProfile), ['sentinel.json']);
  assert.equal(await runtime!.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.deepEqual(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name)), []);
}
try {
  await mkdir(fixtures); await mkdir(teacherProfile); await mkdir(profile);
  await writeFile(path.join(teacherProfile, 'sentinel.json'), sentinel);
  await writeFile(artifact, originalBytes); await writeFile(descriptor, JSON.stringify(candidate));
  await launch();
  const identity = await runtime!.evaluate(({ app, BrowserWindow }) => {
    const prefs = (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences();
    return { packaged: app.isPackaged, name: app.getName(), profile: app.getPath('userData'),
      sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration,
      unsafeSwitch: app.commandLine.hasSwitch('no-sandbox') || app.commandLine.hasSwitch('disable-web-security') };
  });
  assert.deepEqual(identity, { packaged: true, name: 'Student Organizer Control Panel', profile,
    sandbox: true, contextIsolation: true, nodeIntegration: false, unsafeSwitch: false });
  assert.equal((await status()).approval, null);
  assert.deepEqual(await page.evaluate(() => ({ require: typeof (window as any).require,
    process: typeof (window as any).process, teacherBridge: typeof (window as any).desktopUpdates })),
    { require: 'undefined', process: 'undefined', teacherBridge: 'undefined' });
  await assertTeacherIsolation(); steps.push('Actual packaged launch; production sandbox/preload; disposable profile; teacher isolation');

  await importFixture();
  assert.match((await call('approve')).error, /Only a tested candidate/);
  await finishTest();
  await page.getByRole('button', { name: 'Approve locally', exact: true }).click();
  await page.getByText('APPROVED — LOCAL ONLY', { exact: true }).waitFor();
  await chooseFiles([]);
  await page.getByRole('button', { name: 'Export local preview feed' }).click();
  await page.getByRole('status').filter({ hasText: 'Local preview saved' }).waitFor();
  const preview = JSON.parse(await readFile(exported, 'utf8'));
  assert.equal(preview.mode, 'local-preview-only'); assert.equal(preview.publicationReady, false);
  assert.equal(preview.approval.status, 'approved');
  assert.equal(JSON.stringify(preview).includes(temporary), false);
  steps.push('Real bridge import/hash/state/test/approve/export; automatic dialog-result selection only; no fixture execution');

  if (process.platform === 'win32') {
    const refused = await page.evaluate(() => (window as any).ownerConsole.preparePublication(false));
    assert.match(refused.error, /acknowledgement/);
    await chooseFiles([temporary]);
    const prepared = await page.evaluate(() => (window as any).ownerConsole.preparePublication(true));
    assert.match(prepared.message, /No release was published/);
    const folder = (await readdir(temporary)).find(name => name.startsWith('StudentOrganizer-release-'));
    assert.ok(folder);
    const record = JSON.parse(await readFile(path.join(temporary, folder, 'student-organizer-approval-x64.json'), 'utf8'));
    assert.equal(record.mode, 'approved-release'); assert.equal(record.signature.signature, 'unsigned');
    assert.deepEqual(await readFile(path.join(temporary, folder, candidate.artifact.name)), originalBytes);
    steps.push('Actual Windows native signature inspection, unsigned owner acknowledgement and exact publication preparation; no publication');
  } else {
    const refused = await page.evaluate(() => (window as any).ownerConsole.preparePublication(true));
    assert.match(refused.error, /Prepare delivery on Windows/);
    steps.push('Mac publication preparation refuses unavailable Windows signature inspection');
  }

  const approvedStore = await readFile(storeFile, 'utf8');
  await close(); await launch();
  assert.equal((await status()).approval.status, 'approved');
  assert.equal(await readFile(storeFile, 'utf8'), approvedStore);
  steps.push('Actual process restart retains approved decision and test evidence');

  await runtime!.evaluate(({ app }) => { (globalThis as any).ownerSecondLaunches = 0;
    app.on('second-instance', () => { (globalThis as any).ownerSecondLaunches++; }); });
  const originalPid = runtime!.process().pid;
  await new Promise<void>((resolve, reject) => {
    const second = spawn(executablePath, [`--user-data-dir=${profile}`], { stdio: 'ignore' });
    const timer = setTimeout(() => { second.kill(); reject(new Error('Second instance failed to exit within 15 seconds')); }, 15000);
    second.on('error', error => { clearTimeout(timer); reject(error); });
    second.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Second-instance exit ${code}`)); });
  });
  await page.waitForFunction(() => (window as any).ownerConsole.status().then((s: any) => s.approval?.status === 'approved'));
  assert.equal(await runtime!.evaluate(() => (globalThis as any).ownerSecondLaunches), 1);
  assert.equal(runtime!.process().pid, originalPid);
  assert.equal((await runtime!.windows()).length, 1);
  assert.equal(await readFile(storeFile, 'utf8'), approvedStore);
  steps.push('Normal second launch exits; existing instance receives event; one window and unchanged approval');

  await writeFile(artifact, Buffer.alloc(originalBytes.length, 88));
  assert.match((await call('exportPreview')).error, /does not match/);
  assert.equal(await readFile(storeFile, 'utf8'), approvedStore);
  await rm(artifact);
  assert.match((await call('exportPreview')).error, /ENOENT/);
  assert.equal(await readFile(storeFile, 'utf8'), approvedStore);
  await writeFile(artifact, originalBytes);
  await page.getByRole('button', { name: 'Revoke local approval' }).click();
  await page.getByText('REVOKED — LOCAL ONLY', { exact: true }).waitFor();
  await close(); await launch();
  assert.equal((await status()).approval.status, 'revoked');
  assert.match((await call('exportPreview')).error, /Only an approved candidate/);
  assert.equal(JSON.parse(await readFile(exported, 'utf8')).approval.status, 'approved', 'Old snapshots remain explicitly independent');
  steps.push('Changed and deleted artifact export rejected without store change; revoke persisted across restart');

  // Changed bytes must also block test→approval, not merely export after approval.
  await importFixture(); await finishTest();
  const testedStore = await readFile(storeFile, 'utf8');
  await writeFile(artifact, Buffer.alloc(originalBytes.length, 89));
  assert.match((await call('approve')).error, /does not match/);
  await rm(artifact);
  assert.match((await call('approve')).error, /ENOENT/);
  assert.equal(await readFile(storeFile, 'utf8'), testedStore);
  await writeFile(artifact, originalBytes);
  steps.push('Changed and deleted artifact approval rejected; tested state preserved');

  await close();
  const corrupt = '{corrupt fictional owner store'; await writeFile(storeFile, corrupt);
  await launch();
  assert.equal((await status()).approval, null);
  assert.match((await status()).message, /could not be read/);
  assert.equal(await readFile(storeFile, 'utf8'), corrupt);
  assert.match((await call('approve')).error, /Import a candidate/);
  await importFixture();
  assert.equal((await status()).approval.status, 'candidate');
  await assertTeacherIsolation();
  steps.push('Corrupt store retained and reported; no approval authority; explicit reimport recovers; teacher sentinel untouched');

  const evidence = { result: 'PASS', platform: process.platform, architecture: process.arch,
    sourceHead: process.env.QA_SOURCE_SHA || 'local', identity, steps,
    limits: ['Dialog selections are automated main-process test doubles, not physical picker acceptance',
      'Fictional installer bytes are never executed', 'No signing, Gatekeeper, UAC or physical installation acceptance',
      'No live distribution, collection, teacher data or credentials'] };
  await mkdir(path.dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({ result: 'FAIL', sourceHead: process.env.QA_SOURCE_SHA || 'local', steps,
    error: error instanceof Error ? error.stack : String(error) }, null, 2));
  throw error;
} finally { await close(); await rm(temporary, { recursive: true, force: true }); }
