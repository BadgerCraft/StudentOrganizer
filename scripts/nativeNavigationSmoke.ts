import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium, type Page } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { showClassTools } from './helpers/organizerNavigation';

// Production renderer proof for the selectors shared by native security/Mac QA.
// Native IPC, OS processes and installed packages remain separate CI evidence.
const server = await preview({ preview: { host: '127.0.0.1', port: 4228, strictPort: true } });
const origin = 'http://127.0.0.1:4228';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
async function events(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('participationEvents', 'readonly');
      const read = tx.objectStore('participationEvents').getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }));
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByTestId('student-seat-card').first().waitFor();
  await showClassTools(page);
  const before = await events(page);
  for (const index of [1, 2]) {
    await page.getByTestId('student-seat-card').first().click();
    await page.getByTestId('toggle-note-btn').click();
    await page.getByTestId('observation-note-input').fill(`Fictional native navigation observation ${index}`);
    if (index === 2) assert.ok(await page.getByRole('button', { name: /Contributed an idea/ }).count() > 1, 'today correction and record action deliberately share a label fragment');
    const record = page.getByTestId('participation-event-btn').filter({ hasText: 'Contributed an idea' });
    assert.equal(await record.count(), 1);
    await record.click();
    await page.getByTestId('observation-note-input').waitFor({ state: 'hidden' });
  }
  const after = await events(page);
  assert.equal(after.length, before.length + 2);
  for (const event of before) assert.deepEqual(after.find(row => row.id === event.id), event, 'record action must never retract an earlier occurrence');
  for (const index of [1, 2]) assert.equal(after.filter(row => row.note === `Fictional native navigation observation ${index}` && row.deletedAt === null).length, 1);
  await page.getByTestId('student-settings-gear-btn').first().click();
  await page.getByTestId('student-preferred-name-input').fill('Fictional Native Navigation');
  await page.getByTestId('save-student-settings-btn').click();
  await page.getByTestId('student-settings-modal').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: native harness Classes → class tools → authorized profile save; repeated participation recording targets exactly the action while today correction coexists, preserving both occurrences and earlier history. Production browser only.');
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer!.close(() => resolve())); }
