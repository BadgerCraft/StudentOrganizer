import { preview } from 'vite';
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';

async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(table, 'readonly');
      const read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), table);
}
const server = await preview({ preview: { host: '127.0.0.1', port: 4186, strictPort: true } });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4186');
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
  await page.locator('[data-testid="student-seat-card"]').first().waitFor();
  const before = await records(page, 'seatPositions');
  await page.getByTestId('nav-portability-btn').click();
  await page.getByTestId('roster-csv-textarea').fill('Pilot, Fictional\tFICT-SEATING-01\nSample, Fictional\tFICT-SEATING-02');
  await page.getByTestId('preview-roster-btn').click();
  await page.getByTestId('roster-preview-step').waitFor();
  await page.getByTestId('import-roster-btn').click();
  await page.getByTestId('roster-import-success').waitFor();
  await page.getByRole('button', { name: 'Open Class View', exact: true }).click();
  const populate = page.getByRole('button', { name: 'Populate seating', exact: true });
  await populate.waitFor();
  assert.ok((await populate.boundingBox())!.y < 768, 'Populate must be visible without scrolling');
  const locked = page.getByRole('button', { name: 'Locked', exact: true });
  if (await locked.isVisible()) {
    assert.equal(await populate.isDisabled(), true);
    await locked.click();
  }
  await populate.click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Populate seating'));
  const populated = await records(page, 'seatPositions');
  assert.equal(populated.length, before.length + 2);
  for (const seat of before) assert.deepEqual(populated.find(s => s.id === seat.id), seat);
  const roster = await records(page, 'classEnrollments');
  const randomize = page.getByRole('button', { name: 'Randomize', exact: true });
  await randomize.click();
  const dialog = page.getByRole('dialog', { name: 'Randomize Seating Arrangement?' });
  await dialog.waitFor();
  const confirm = dialog.getByRole('button', { name: 'Confirm Randomize', exact: true });
  await confirm.click();
  await dialog.waitFor({ state: 'hidden' });
  const shuffled = await records(page, 'seatPositions');
  assert.deepEqual(shuffled.map(s => s.id).sort(), populated.map(s => s.id).sort());
  assert.deepEqual(shuffled.map(s => s.classEnrollmentId).sort(), populated.map(s => s.classEnrollmentId).sort());
  assert.deepEqual(await records(page, 'classEnrollments'), roster);
  assert.equal(shuffled.every(s => s.version === populated.find(p => p.id === s.id).version + 1), true);
  const audits = (await records(page, 'auditEntries')).filter(a => a.entityName === 'seatPositions');
  assert.equal(audits.length, 2 + shuffled.length);
  assert.ok(audits.every(a => a.userId && a.newStateJson));
  // Fictional clean-layout fixture: prove empty randomize is disabled and population works.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('seatPositions', 'readwrite');
      tx.objectStore('seatPositions').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await populate.waitFor();
  assert.equal(await randomize.isDisabled(), true);
  await populate.click();
  await page.locator('[data-testid="student-seat-card"]').first().waitFor();
  assert.equal((await records(page, 'seatPositions')).length, shuffled.length);
  assert.equal(await randomize.isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: fictional roster import → visible population → working randomize; preserved seats/roster, actor audit, empty/locked guards, no browser exceptions.');
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await new Promise<void>(resolve => server.httpServer.close(() => resolve()));
}
