import { preview } from 'vite';
import { chromium, webkit, type Page, type BrowserContext } from 'playwright';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Real UI writes, read-only IndexedDB assertions. Fictional seeded data only.
async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(tableName => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(tableName, 'readonly');
      const all = tx.objectStore(tableName).getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
      tx.oncomplete = () => database.close();
    };
  }), table);
}
async function selectTeacher(page: Page) {
  const teacher = page.locator('[data-testid^="select-teacher-"]').first();
  await Promise.race([
    teacher.waitFor({ state: 'visible' }),
    page.locator('[data-testid="header-teacher-btn"]').waitFor({ state: 'visible' })
  ]);
  if (await teacher.isVisible()) await teacher.tap();
}
async function noPageOverflow(page: Page, label: string) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(sizes.scroll <= sizes.width + 1, `${label}: page overflow ${JSON.stringify(sizes)}`);
}
async function waitForRecords(page: Page, table: string, matches: (rows: any[]) => boolean) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await records(page, table);
    if (matches(result)) return result;
    await page.waitForTimeout(100);
  }
  const alerts = await page.getByRole('alert').allTextContents();
  const moveState = await page.locator('[data-testid="tap-move-seats-btn"]').getAttribute('aria-pressed').catch(() => null);
  throw new Error(`Expected record change was not observed in ${table}; UI alerts=${JSON.stringify(alerts)}; tap move enabled=${moveState}`);
}
async function openAssessmentHub(page: Page) {
  await page.locator('button[title="Manage Assessments & Rubrics"]').tap();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor();
}
async function createAssessment(page: Page, title: string) {
  await openAssessmentHub(page);
  await page.getByRole('button', { name: 'New Assessment', exact: true }).tap();
  const form = page.getByRole('heading', { name: 'Create New Assessment' }).locator('..').locator('form');
  assert.equal(await form.getByText('Code', { exact: true }).count(), 0);
  await form.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
  await form.getByRole('button', { name: 'Create Assessment', exact: true }).tap();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
async function download(page: Page, buttonTestId: string) {
  const promise = page.waitForEvent('download');
  await page.locator(`[data-testid="${buttonTestId}"]`).tap();
  const file = await promise;
  assert.equal(await file.failure(), null);
  const filename = await file.path();
  assert.ok(filename);
  return { name: file.suggestedFilename(), body: readFileSync(filename) };
}

async function main() {
  const engine = process.env.IPAD_TEST_BROWSER === 'webkit' ? webkit : chromium;
  const server = await preview({ preview: { host: '127.0.0.1', port: 4178, strictPort: true } });
  const url = 'http://127.0.0.1:4178/';
  const profile = mkdtempSync(join(tmpdir(), 'fictional-ipad-test-'));
  const evidenceDir = join('screenshots', `ipad-${engine.name()}`);
  mkdirSync(evidenceDir, { recursive: true });
  let context: BrowserContext | undefined;
  let latestPage: Page | undefined;
  try {
    context = await engine.launchPersistentContext(profile, {
      headless: true, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true,
      acceptDownloads: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
    });
    let page = context.pages()[0] || await context.newPage();
    latestPage = page;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await selectTeacher(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="offline-app-status"]')?.textContent?.includes('Ready for offline'));
    await noPageOverflow(page, 'portrait dashboard');
    await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().tap();
    await page.locator('[data-testid="student-seat-card"]').first().waitFor();
    for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 512, height: 768 }]) {
      await page.setViewportSize(viewport);
      await noPageOverflow(page, `seating ${viewport.width}`);
      const firstAttendance = page.locator('[data-testid="student-seat-card"]').first().locator('button').first();
      await firstAttendance.scrollIntoViewIfNeeded();
      const reachable = await firstAttendance.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { reachable: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && !!hit && el.contains(hit),
          left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      });
      assert.ok(reachable.reachable, `Attendance touch target must be reachable at ${viewport.width}px: ${JSON.stringify(reachable)}`);
      await page.screenshot({ path: join(evidenceDir, `seating-${viewport.width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    // Tap-to-swap uses the same service as dragging and preserves both occupants.
    const locked = page.getByRole('button', { name: 'Locked', exact: true });
    if (await locked.isVisible()) await locked.tap();
    const beforeSeats = await records(page, 'seatPositions');
    await page.locator('[data-testid="tap-move-seats-btn"]').tap();
    await page.locator('[data-testid="student-seat-card"]').nth(0).tap();
    await page.waitForFunction(() => document.querySelector('[data-testid="student-seat-card"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('[data-testid="student-profile-modal"]').count(), 0, 'Tap-move must not open profile');
    await page.locator('[data-testid="student-seat-card"]').nth(1).tap();
    const afterSeats = await waitForRecords(page, 'seatPositions', rows => JSON.stringify(rows) !== JSON.stringify(beforeSeats));
    assert.equal(afterSeats.length, beforeSeats.length);
    assert.deepEqual(afterSeats.map(row => row.classEnrollmentId).sort(), beforeSeats.map(row => row.classEnrollmentId).sort());
    await page.locator('[data-testid="tap-move-seats-btn"]').tap();
    // Attendance and a note-bearing participation event through touch controls.
    const attendanceBefore = await records(page, 'attendanceRecords');
    await page.locator('[data-testid="student-seat-card"]').first().locator('button').first().tap();
    await waitForRecords(page, 'attendanceRecords', rows => JSON.stringify(rows) !== JSON.stringify(attendanceBefore));
    await page.locator('[data-testid="student-seat-name"]').first().tap();
    await page.locator('[data-testid="toggle-note-btn"]').tap();
    await page.locator('[data-testid="observation-note-input"]').fill('Fictional iPad observation');
    await noPageOverflow(page, 'participation dock');
    await page.getByRole('button', { name: /Contributed an idea/ }).tap();
    await waitForRecords(page, 'participationEvents', rows => rows.some(row => row.note === 'Fictional iPad observation'));
    // Student profile form and local photo selection.
    await page.locator('[data-testid="student-settings-gear-btn"]').first().tap();
    // The settings form initializes its controlled fields in a React effect.
    // Wait for existing required names before changing the fictional draft.
    await page.waitForFunction(() => {
      const first = document.querySelector<HTMLInputElement>('[data-testid="student-first-name-input"]');
      const last = document.querySelector<HTMLInputElement>('[data-testid="student-last-name-input"]');
      return !!first?.value && !!last?.value;
    });
    await page.locator('[data-testid="student-preferred-name-input"]').fill('Fictional Tablet');
    const removePhoto = page.locator('[data-testid="remove-photo-btn"]');
    if (await removePhoto.isVisible()) await removePhoto.tap();
    await removePhoto.waitFor({ state: 'hidden' });
    await page.locator('[data-testid="student-photo-file-input"]').setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: readFileSync('dist/icon-180.png') });
    // FileReader + image resizing complete asynchronously; wait before saving.
    await removePhoto.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-testid="student-preferred-name-input"]').inputValue(), 'Fictional Tablet');
    await page.locator('[data-testid="save-student-settings-btn"]').tap();
    await page.locator('[data-testid="student-settings-modal"]').waitFor({ state: 'hidden' });
    const photoStudents = await waitForRecords(page, 'students', rows => rows.some(row => row.preferredName === 'Fictional Tablet' && row.photoUrl?.startsWith('data:image/')));
    const editedStudent = photoStudents.find(row => row.preferredName === 'Fictional Tablet');
    assert.ok(editedStudent);
    const title = `Fictional iPad assessment ${Date.now()}`;
    await createAssessment(page, title);
    // Locate the new assessment's K cell from its rendered header, not a guessed column.
    await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).tap();
    await page.locator('table tbody tr').first().waitFor();
    const knowledgeColumn = await page.evaluate(assessmentTitle => {
      const header = Array.from(document.querySelectorAll<HTMLTableCellElement>('th')).find(th =>
        th.querySelector('span[title]')?.getAttribute('title') === assessmentTitle &&
        th.querySelector('div > span:nth-child(2)')?.textContent?.trim() === 'K');
      return header?.cellIndex ?? -1;
    }, title);
    assert.ok(knowledgeColumn >= 0, 'New assessment K header must be visible in markbook');
    const studentRow = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `${editedStudent.lastName}, ${editedStudent.preferredName}`, exact: true }) });
    assert.equal(await studentRow.count(), 1, 'Mark must be entered for the edited fictional student');
    await studentRow.locator('td').nth(knowledgeColumn).tap();
    await page.getByPlaceholder('e.g. 4+, 88%, 18/20').fill('88%');
    await page.getByPlaceholder('e.g. 4+, 88%, 18/20').locator('..').locator('..').locator('select').selectOption('percentage');
    await page.getByPlaceholder('Optional constructive feedback for this category...').fill('Fictional iPad K feedback');
    await page.getByRole('button', { name: 'Save Result', exact: true }).tap();
    await waitForRecords(page, 'categoryResults', rows => rows.some(row => row.rawScore === '88%' && row.normalizedPercentage === 88 && row.feedback === 'Fictional iPad K feedback'));
    await noPageOverflow(page, 'markbook horizontal scrolling');
    await page.screenshot({ path: join(evidenceDir, 'markbook-result.png'), fullPage: true });
    await page.locator('[data-testid="nav-portability-btn"]').tap();
    await page.locator('[data-testid="roster-file-input"]').setInputFiles({ name: 'fictional.csv', mimeType: 'text/csv', buffer: Buffer.from('LastName,FirstName,StudentNumber\nTablet,Fictional,IPAD-9901\n') });
    await page.locator('[data-testid="preview-roster-btn"]').tap();
    await page.locator('[data-testid="import-roster-btn"]').tap();
    await page.locator('[data-testid="roster-import-success"]').waitFor();
    const backup = await download(page, 'create-backup-btn');
    assert.match(backup.name, /\.json$/);
    const backupJson = JSON.parse(backup.body.toString());
    assert.ok(JSON.stringify(backupJson).includes(title));
    const csv = await download(page, 'export-markbook-btn');
    assert.match(csv.name, /\.csv$/);
    assert.ok(csv.body.length > 0);
    // Invalid file rejects before replacement, preserving the existing assessment.
    await page.locator('[data-testid="restore-file-input"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.getByText('Restore Rejected: Database Left Intact', { exact: true }).waitFor();
    assert.ok((await records(page, 'assessments')).some(row => row.title === title));
    const afterBackupTitle = `${title} after backup`;
    await createAssessment(page, afterBackupTitle);
    await page.locator('[data-testid="nav-portability-btn"]').tap();
    await page.locator('[data-testid="restore-file-input"]').setInputFiles({ name: backup.name, mimeType: 'application/json', buffer: backup.body });
    await page.locator('[data-testid="restore-confirm-dialog"]').waitFor();
    await page.screenshot({ path: join(evidenceDir, 'restore-preview.png'), fullPage: true });
    // Preview does not mutate; only this teacher-confirmed UI click restores.
    assert.ok((await records(page, 'assessments')).some(row => row.title === afterBackupTitle));
    await page.locator('[data-testid="confirm-restore-btn"]').tap();
    await page.getByText(/Database successfully restored/).waitFor();
    assert.ok((await records(page, 'assessments')).some(row => row.title === title));
    assert.ok(!(await records(page, 'assessments')).some(row => row.title === afterBackupTitle));
    assert.ok((await records(page, 'categoryResults')).some(row => row.rawScore === '88%' && row.feedback === 'Fictional iPad K feedback'));
    // Close the browser process, relaunch the same profile offline, reopen records.
    await context.close();
    context = await engine.launchPersistentContext(profile, {
      headless: true, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
    });
    await context.setOffline(true);
    page = context.pages()[0] || await context.newPage();
    latestPage = page;
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await selectTeacher(page);
    await openAssessmentHub(page);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.ok((await records(page, 'students')).some(row => row.preferredName === 'Fictional Tablet' && row.photoUrl));
    assert.ok((await records(page, 'participationEvents')).some(row => row.note === 'Fictional iPad observation'));
    assert.ok((await records(page, 'categoryResults')).some(row => row.rawScore === '88%' && row.feedback === 'Fictional iPad K feedback'));
    await page.screenshot({ path: join(evidenceDir, 'offline-reopened.png'), fullPage: true });
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const entries: string[] = [];
      for (const key of keys.filter(name => name.startsWith('ontario-app-shell-'))) {
        for (const request of await (await caches.open(key)).keys()) entries.push(request.url);
      }
      return entries;
    });
    assert.ok(cached.some(item => item.endsWith('/index.html')));
    assert.ok(cached.every(item => /\/(index\.html|manifest\.webmanifest|app-icon\.svg|icon-\d+\.png|assets\/[^/]+\.(js|css))$/.test(item)));
    assert.deepEqual(errors, []);
    console.log(`PASS ${engine.name()}: touch portrait/landscape/split view, seat swap, attendance, notes, photo, assessment/K mark, file roster/CSV/backup/replacement, offline process reopen and persisted records; not physical iPad verification.`);
  } catch (error) {
    if (latestPage && !latestPage.isClosed()) await latestPage.screenshot({ path: join(evidenceDir, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
