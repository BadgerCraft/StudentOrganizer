import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const product = 'Ontario Teacher Assessment';
const release = path.resolve('release');
const evidence = path.join(release, 'mac-smoke');
const arch = process.env.QA_ARCH || process.arch;
fs.mkdirSync(evidence, { recursive: true });

// These helpers observe IndexedDB; all classroom writes use the packaged UI.
async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(tableName => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Expected existing app database')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(tableName, 'readonly');
      const all = tx.objectStore(tableName).getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
      tx.oncomplete = () => database.close();
      tx.onabort = () => { database.close(); reject(tx.error); };
    };
  }), table);
}
async function waitForRecords(page: Page, table: string, matches: (rows: any[]) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await records(page, table);
    if (matches(result)) return result;
    await page.waitForTimeout(100);
  }
  throw new Error(`Expected record change was not observed in ${table}`);
}
async function openClass(page: Page) {
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'hidden' });
  await page.locator('[data-testid="nav-dashboard-btn"]').click();
  await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
  await page.locator('[data-testid="student-seat-card"]').first().waitFor();
}
async function openHub(page: Page) {
  await page.getByTitle('Manage Assessments & Rubrics', { exact: true }).click();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor();
}
async function createAssessment(page: Page, title: string) {
  await openHub(page);
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  const form = page.getByRole('heading', { name: 'Create New Assessment' }).locator('..').locator('form');
  if (await form.getByText('Code', { exact: true }).count()) throw new Error('Unexpected Code field');
  await form.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
  await form.getByRole('button', { name: 'Create Assessment', exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
async function openMarkCell(page: Page, assessmentTitle: string, studentLabel: string) {
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  // Locate the actual K column and intended fictional student's row, rather than
  // relying on the ordering of other assessments or manually seeding a result.
  const header = page.getByTitle(assessmentTitle, { exact: true }).locator('..').locator('..')
    .filter({ has: page.getByText('K', { exact: true }) });
  await header.waitFor();
  assert.equal(await header.count(), 1);
  const columnIndex = await header.evaluate(el => Array.from(el.parentElement!.children).indexOf(el));
  assert.ok(columnIndex >= 6, 'Must select an assessment category, never a summary column');
  const row = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: studentLabel, exact: true }) });
  assert.equal(await row.count(), 1);
  const cell = row.locator('td').nth(columnIndex);
  await cell.click();
  const form = page.locator('form').filter({ has: page.getByPlaceholder('e.g. 4+, 88%, 18/20', { exact: true }) });
  await form.waitFor();
  assert.ok(await form.getByText('Category:', { exact: false }).isVisible());
  return { form, cell };
}
async function assertCategoryResult(page: Page, studentAssessmentId: string, categoryId: string, feedback: string, rawScore: string) {
  const rows = await waitForRecords(page, 'categoryResults', rows => rows.some(row =>
    row.studentAssessmentId === studentAssessmentId && row.assessmentCategoryId === categoryId && row.rawScore === rawScore));
  const result = rows.find(row => row.studentAssessmentId === studentAssessmentId && row.assessmentCategoryId === categoryId && row.deletedAt === null);
  assert.ok(result);
  assert.equal(result.inputFormat, 'percentage');
  assert.equal(result.normalizedPercentage, Number(rawScore));
  assert.equal(result.feedback, feedback);
  return result;
}
async function checkApp(appPath: string, format: string) {
  const executablePath = path.join(appPath, 'Contents', 'MacOS', product);
  const marker = `${format}-${arch}-${Date.now()}`;
  const title = `Fictional Mac assessment ${marker}`;
  const preferredName = `Fictional Mac ${marker}`;
  const observation = `Fictional Mac observation ${marker}`;
  const feedback = `Fictional Mac category feedback ${marker}`;
  const errors: string[] = [];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath, timeout: 45000 });
    const userDataPath = await app.evaluate(({ app }) => app.getPath('userData'));
    let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await openClass(page);
    await page.locator('[data-testid="student-seat-card"]').first().click();
    await page.locator('[data-testid="toggle-note-btn"]').click();
    await page.locator('[data-testid="observation-note-input"]').fill(observation);
    await page.getByRole('button', { name: /Contributed an idea/ }).click();
    const events = await waitForRecords(page, 'participationEvents', rows => rows.some(row => row.note === observation));
    const event = events.find(row => row.note === observation);
    assert.ok(event);

    await page.locator('[data-testid="student-settings-gear-btn"]').first().click();
    await page.locator('[data-testid="student-preferred-name-input"]').fill(preferredName);
    const removePhoto = page.locator('[data-testid="remove-photo-btn"]');
    if (await removePhoto.isVisible()) await removePhoto.click();
    await removePhoto.waitFor({ state: 'hidden' });
    await page.locator('[data-testid="student-photo-file-input"]').setInputFiles({
      name: 'fictional-mac.png', mimeType: 'image/png', buffer: fs.readFileSync('dist/icon-180.png')
    });
    // Wait for the asynchronous image resize before committing the settings.
    await removePhoto.waitFor();
    await page.locator('[data-testid="save-student-settings-btn"]').click();
    const students = await waitForRecords(page, 'students', rows => rows.some(row => row.preferredName === preferredName && row.photoUrl?.startsWith('data:image/')));
    const student = students.find(row => row.preferredName === preferredName);
    const enrollment = (await records(page, 'classEnrollments')).find(row => row.id === event.classEnrollmentId);
    assert.equal(enrollment?.studentId, student.id, 'Photo and observation must target the same student');
    const studentLabel = `${student.lastName}, ${preferredName}`;

    await createAssessment(page, title);
    const assessment = (await waitForRecords(page, 'assessments', rows => rows.some(row => row.title === title))).find(row => row.title === title);
    const category = (await records(page, 'assessmentCategories')).find(row => row.assessmentId === assessment.id && row.categoryCode === 'K');
    assert.ok(category);
    const studentAssessment = (await records(page, 'studentAssessments')).find(row => row.assessmentId === assessment.id && row.classEnrollmentId === enrollment.id);
    assert.ok(studentAssessment);
    const editor = await openMarkCell(page, title, studentLabel);
    await editor.form.locator('select').selectOption('percentage');
    await editor.form.getByPlaceholder('e.g. 4+, 88%, 18/20', { exact: true }).fill('87');
    await editor.form.getByPlaceholder('Optional constructive feedback for this category...').fill(feedback);
    await editor.form.getByRole('button', { name: 'Complete', exact: true }).click();
    await editor.form.getByRole('button', { name: 'Save Result', exact: true }).click();
    await editor.form.waitFor({ state: 'hidden' });
    await assertCategoryResult(page, studentAssessment.id, category.id, feedback, '87');
    assert.equal(await editor.cell.innerText(), '87');
    const reopened = await openMarkCell(page, title, studentLabel);
    assert.equal(await reopened.form.getByPlaceholder('e.g. 4+, 88%, 18/20', { exact: true }).inputValue(), '87');
    assert.equal(await reopened.form.getByPlaceholder('Optional constructive feedback for this category...').inputValue(), feedback);
    await reopened.form.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.locator('[data-testid="nav-portability-btn"]').click();
    const backupPath = path.join(evidence, `${format}-fictional-backup.json`);
    // Observe the actual Electron download. CI chooses only the save destination;
    // it does not exercise the native save dialog or fabricate backup bytes.
    // Keep callbacks inline so tsx's name helpers do not cross process boundaries.
    await app.evaluate(({ BrowserWindow }, savePath) => {
      (globalThis as any).__fictionalBackupDownload = { state: 'pending' };
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(savePath);
        item.once('done', (_doneEvent, state) => {
          (globalThis as any).__fictionalBackupDownload = {
            state, filename: item.getFilename(), savedPath: item.getSavePath(), bytes: item.getReceivedBytes()
          };
        });
      });
    }, backupPath);
    assert.equal((await app.evaluate(() => (globalThis as any).__fictionalBackupDownload)).state, 'pending', 'Real session download listener must be registered');
    await page.locator('[data-testid="create-backup-btn"]').click();
    let downloaded: { state: string; filename?: string; savedPath?: string; bytes?: number } = { state: 'pending' };
    for (let attempt = 0; attempt < 300; attempt++) {
      downloaded = await app.evaluate(() => (globalThis as any).__fictionalBackupDownload);
      if (downloaded.state !== 'pending') break;
      await page.waitForTimeout(100);
    }
    assert.equal(downloaded.state, 'completed', 'Actual Electron backup download must finish');
    assert.match(downloaded.filename || '', /\.json$/);
    assert.equal(downloaded.savedPath, backupPath);
    assert.ok(downloaded.bytes && downloaded.bytes > 0);
    const body = fs.readFileSync(backupPath);
    const backup = JSON.parse(body.toString());
    assert.equal(backup.version, 2);
    assert.ok(backup.tables.assessments.some((row: any) => row.id === assessment.id));
    assert.ok(backup.tables.participationEvents.some((row: any) => row.id === event.id));
    assert.equal(backup.tables.students.find((row: any) => row.id === student.id)?.photoUrl, student.photoUrl);
    assert.ok(backup.tables.categoryResults.some((row: any) => row.studentAssessmentId === studentAssessment.id && row.rawScore === '87'));
    const storeNames = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open('OntarioTeacherAssessmentDB');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { resolve(Array.from(request.result.objectStoreNames)); request.result.close(); };
    }));
    assert.deepEqual(Object.keys(backup.tables).sort(), storeNames.sort(), 'Full backup must contain every application store');

    const beforeInvalid = await records(page, 'categoryResults');
    await page.locator('[data-testid="restore-file-input"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByText('Restore Rejected: Database Left Intact', { exact: true }).waitFor();
    assert.deepEqual(await records(page, 'categoryResults'), beforeInvalid);
    assert.ok((await records(page, 'assessments')).some(row => row.id === assessment.id));

    const laterTitle = `${title} after backup`;
    await createAssessment(page, laterTitle);
    const laterEditor = await openMarkCell(page, title, studentLabel);
    await laterEditor.form.getByPlaceholder('e.g. 4+, 88%, 18/20', { exact: true }).fill('42');
    await laterEditor.form.getByRole('button', { name: 'Save Result', exact: true }).click();
    await laterEditor.form.waitFor({ state: 'hidden' });
    await assertCategoryResult(page, studentAssessment.id, category.id, feedback, '42');
    await page.locator('[data-testid="nav-portability-btn"]').click();
    await page.locator('[data-testid="restore-file-input"]').setInputFiles({ name: 'fictional-backup.json', mimeType: 'application/json', buffer: body });
    await page.locator('[data-testid="restore-confirm-dialog"]').waitFor();
    assert.ok((await records(page, 'assessments')).some(row => row.title === laterTitle), 'Restore preview must not replace data');
    await assertCategoryResult(page, studentAssessment.id, category.id, feedback, '42');
    await page.locator('[data-testid="confirm-restore-btn"]').click();
    await page.getByText(/Database successfully restored/).waitFor();
    await assertCategoryResult(page, studentAssessment.id, category.id, feedback, '87');
    assert.ok(!(await records(page, 'assessments')).some(row => row.title === laterTitle));
    assert.equal((await records(page, 'students')).find(row => row.id === student.id)?.photoUrl, student.photoUrl);
    assert.ok((await records(page, 'participationEvents')).some(row => row.id === event.id && row.note === observation));
    await page.screenshot({ path: path.join(evidence, `${format}-recovered.png`) });

    await app.close();
    app = undefined;
    app = await electron.launch({ executablePath, timeout: 45000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await openClass(page);
    await openHub(page);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: laterTitle, exact: true }).count(), 0);
    await assertCategoryResult(page, studentAssessment.id, category.id, feedback, '87');
    const persisted = await openMarkCell(page, title, studentLabel);
    assert.equal(await persisted.form.getByPlaceholder('e.g. 4+, 88%, 18/20', { exact: true }).inputValue(), '87');
    assert.equal(await persisted.form.getByPlaceholder('Optional constructive feedback for this category...').inputValue(), feedback);
    await persisted.form.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await records(page, 'students')).find(row => row.id === student.id)?.photoUrl, student.photoUrl);
    assert.ok((await records(page, 'participationEvents')).some(row => row.id === event.id && row.note === observation));
    await page.screenshot({ path: path.join(evidence, `${format}-reopened.png`) });
    assert.deepEqual(errors, []);
    return { format, status: 'PASS', architecture: arch, userDataPath,
      assessmentCreatedAndRetained: true, noteParticipationRetained: true,
      categoryPercentageAndFeedbackRetained: true, localPhotoRetained: true,
      fullBackupAllStores: true, invalidRestoreRejected: true, confirmedRecoveryAndRestart: true,
      backupEvidence: path.basename(backupPath), nativeSaveDialog: 'CI selects evidence destination; unverified' };
  } finally {
    await app?.close();
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Actual package smoke requires a Mac runner.');
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Full recovery smoke is restricted to ephemeral GitHub Actions runners; a local teacher profile must never be replaced.');
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported QA architecture: ${arch}`);
  const files = fs.readdirSync(release);
  const dmg = files.find(file => file.endsWith(`-mac-${arch}.dmg`));
  const zip = files.find(file => file.endsWith(`-mac-${arch}.zip`));
  if (!dmg || !zip) throw new Error(`Missing ${arch} disk image or archive`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'student-organizer-mac-'));
  const mount = path.join(temp, 'mounted');
  const installed = path.join(temp, 'installed');
  const unpacked = path.join(temp, 'archive');
  fs.mkdirSync(mount); fs.mkdirSync(installed); fs.mkdirSync(unpacked);
  const results = [];
  let mounted = false;
  try {
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, path.join(release, dmg)]);
    mounted = true;
    const installedApp = path.join(installed, `${product}.app`);
    execFileSync('ditto', [path.join(mount, `${product}.app`), installedApp]);
    execFileSync('hdiutil', ['detach', mount]);
    mounted = false;
    // Test the copy installed from the exact DMG, after its disk is detached.
    results.push(await checkApp(installedApp, 'dmg'));
    execFileSync('ditto', ['-x', '-k', path.join(release, zip), unpacked]);
    results.push(await checkApp(path.join(unpacked, `${product}.app`), 'zip'));
    const packageInspection = Object.fromEntries([
      ['dmg', installedApp], ['zip', path.join(unpacked, `${product}.app`)]
    ].map(([format, bundle]) => {
      execFileSync('codesign', ['--verify', '--deep', '--strict', bundle]);
      const signatures = spawnSync('codesign', ['-d', '--verbose=2', bundle], { encoding: 'utf8' });
      if (signatures.status !== 0 || !signatures.stderr.includes('Signature=adhoc')) throw new Error(`Expected measured ad-hoc test signature: ${format}`);
      const binary = execFileSync('file', [path.join(bundle, 'Contents', 'MacOS', product)], { encoding: 'utf8' });
      if (!binary.includes(arch === 'x64' ? 'x86_64' : 'arm64')) throw new Error(`Wrong packaged architecture: ${format}`);
      return [format, { codesignEvidence: signatures.stderr, binaryEvidence: binary }];
    }));
    const report = {
      testedSource: process.env.QA_SOURCE_SHA || 'local source, SHA not provided',
      architecture: arch, macOS: os.release(), results,
      checksums: Object.fromEntries([dmg, zip].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(release, file))).digest('hex')])),
      signature: 'Ad-hoc test signature; no verified publisher identity or Apple notarization',
      packageInspection,
      limits: ['Ephemeral CI has no downloaded-file quarantine; colleague Gatekeeper/device policy not tested.', 'UI automation selects a local photo and backup file programmatically; Finder picker and native save-dialog interaction and physical school-managed Macs are not tested.', 'Fictional full recovery writes are restricted to ephemeral GitHub Actions Mac runners; this is not a classroom-data migration test.']
    };
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS: exact Mac disk-image and archive apps preserved assessment, participation, percentage/feedback and photo through full backup/recovery and restart.');
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', mount]);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  fs.writeFileSync(path.join(evidence, 'failure.txt'), String(error?.stack || error));
  console.error(error);
  process.exitCode = 1;
});
