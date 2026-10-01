import { preview } from 'vite';
import { chromium, webkit, type Page, type BrowserContext } from 'playwright';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
  throw new Error(`Expected record change was not observed in ${table}`);
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
  let context: BrowserContext | undefined;
  try {
    context = await engine.launchPersistentContext(profile, {
      headless: true, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true,
      acceptDownloads: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
    });
    let page = context.pages()[0] || await context.newPage();
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
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    // Tap-to-swap uses the same service as dragging and preserves both occupants.
    const locked = page.getByRole('button', { name: 'Locked', exact: true });
    if (await locked.isVisible()) await locked.tap();
    const beforeSeats = await records(page, 'seatPositions');
    await page.locator('[data-testid="tap-move-seats-btn"]').tap();
    await page.locator('[data-testid="student-seat-card"]').nth(0).tap();
    await page.locator('[data-testid="student-seat-card"]').nth(1).tap();
    const afterSeats = await waitForRecords(page, 'seatPositions', rows => JSON.stringify(rows) !== JSON.stringify(beforeSeats));
    assert.equal(afterSeats.length, beforeSeats.length);
    assert.deepEqual(afterSeats.map(row => row.classEnrollmentId).sort(), beforeSeats.map(row => row.classEnrollmentId).sort());
    await page.locator('[data-testid="tap-move-seats-btn"]').tap();
    // Attendance and a note-bearing participation event through touch controls.
    const attendanceBefore = await records(page, 'attendanceRecords');
    await page.locator('[data-testid="student-seat-card"]').first().locator('button').first().tap();
    await waitForRecords(page, 'attendanceRecords', rows => JSON.stringify(rows) !== JSON.stringify(attendanceBefore));
    await page.locator('[data-testid="student-seat-card"]').first().tap();
    await page.locator('[data-testid="toggle-note-btn"]').tap();
    await page.locator('[data-testid="observation-note-input"]').fill('Fictional iPad observation');
    await noPageOverflow(page, 'participation dock');
    await page.getByRole('button', { name: /Contributed an idea/ }).tap();
    await waitForRecords(page, 'participationEvents', rows => rows.some(row => row.note === 'Fictional iPad observation'));
    // Student profile form and local photo selection.
    await page.locator('[data-testid="student-settings-gear-btn"]').first().tap();
    await page.locator('[data-testid="student-preferred-name-input"]').fill('Fictional Tablet');
    await page.locator('[data-testid="student-photo-file-input"]').setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: readFileSync('dist/icon-180.png') });
    await page.locator('[data-testid="save-student-settings-btn"]').tap();
    await waitForRecords(page, 'students', rows => rows.some(row => row.preferredName === 'Fictional Tablet' && row.photoUrl?.startsWith('data:image/')));
    const title = `Fictional iPad assessment ${Date.now()}`;
    await createAssessment(page, title);
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
    // Preview does not mutate; only this teacher-confirmed UI click restores.
    assert.ok((await records(page, 'assessments')).some(row => row.title === afterBackupTitle));
    await page.locator('[data-testid="confirm-restore-btn"]').tap();
    await page.getByText(/Database successfully restored/).waitFor();
    assert.ok((await records(page, 'assessments')).some(row => row.title === title));
    assert.ok(!(await records(page, 'assessments')).some(row => row.title === afterBackupTitle));
    // Close the browser process, relaunch the same profile offline, reopen records.
    await context.close();
    context = await engine.launchPersistentContext(profile, {
      headless: true, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && engine === chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
    });
    await context.setOffline(true);
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await selectTeacher(page);
    await openAssessmentHub(page);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.ok((await records(page, 'students')).some(row => row.preferredName === 'Fictional Tablet' && row.photoUrl));
    assert.ok((await records(page, 'participationEvents')).some(row => row.note === 'Fictional iPad observation'));
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
    console.log(`PASS ${engine.name()}: touch portrait/landscape/split view, seat swap, attendance, notes, photo, assessment, file roster/CSV/backup/replacement, offline process reopen and persisted records; not physical iPad verification.`);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
