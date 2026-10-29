import { openRecovery, showClassTools } from './helpers/organizerNavigation';
import { preview } from 'vite';
import { chromium, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { installFictionalClassroom } from './helpers/classroomFixture';

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
const server = await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  const resources: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('invalid.example')) resources.push(request.url()); });
  await page.route('**://invalid.example/**', route => route.abort());
  page.setDefaultTimeout(12000);
  await page.goto('http://127.0.0.1:4187');
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await openRecovery(page);
  const beforeStudents = await records(page, 'students');
  const beforeEnrollments = await records(page, 'classEnrollments');
  const paste = async (html: string, plain = '') => page.getByTestId('roster-csv-textarea').evaluate((element, data) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', data.html);
    clipboardData.setData('text/plain', data.plain);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, { html, plain });
  await paste('<table><tr><td>Vale, Ari</td><td>0001</td></tr><tr>Uncertain row</tr></table>', 'fallback');
  assert.match(await page.locator('body').innerText(), /text outside its cells/);
  assert.equal(await page.getByTestId('roster-csv-textarea').inputValue(), '');
  const html = '<table><tr><th>Room</th><th>OEN</th><th>Last Name</th><th>First Name</th><th>Local Student ID</th></tr>' +
    '<tr><td>201</td><td>00101</td><td>Vale</td><td>Ari<img src="https://invalid.example/image" onerror="window.__badPaste=true"><script>window.__badPaste=true</script></td><td>000901</td></tr>' +
    '<tr><td>201</td><td>00102</td><td>Vale</td><td>Ari</td><td>000902</td></tr>' +
    '<tr><td>201</td><td>00103</td><td>Lake</td><td>Jo</td><td>000902</td></tr>' +
    '<tr><td>201</td><td>00104</td><td>Uncertain</td><td></td><td>000904</td></tr></table>';
  await paste(html, 'wrong fallback');
  await page.getByTestId('preview-roster-btn').click();
  await page.getByTestId('roster-mapping').waitFor();
  assert.equal(await page.getByLabel('Column for number', { exact: true }).inputValue(), '-1');
  assert.equal(await page.getByTestId('import-roster-btn').isDisabled(), true);
  await page.getByLabel('Column for number', { exact: true }).selectOption('4');
  await page.getByTestId('apply-roster-mapping').click();
  await page.getByLabel('Row 2 firstName', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Row 2 studentNumber', { exact: true }).inputValue(), '000901');
  assert.match(await page.locator('body').innerText(), /remain separate/);
  // A later duplicate becomes valid after explicitly excluding the earlier row.
  await page.getByLabel('Include row 3', { exact: true }).uncheck();
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  assert.doesNotMatch(await page.locator('body').innerText(), /Duplicate student number/);
  await page.getByLabel('Include row 3', { exact: true }).check();
  await page.getByLabel('Row 4 studentNumber', { exact: true }).fill('000903');
  await page.getByLabel('Include row 5', { exact: true }).uncheck();
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('import-roster-btn').isEnabled(), true);
  // Cancellation must leave all persisted records unchanged.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await records(page, 'students'), beforeStudents);
  assert.deepEqual(await records(page, 'classEnrollments'), beforeEnrollments);
  await paste(html);
  await page.getByTestId('preview-roster-btn').click();
  await page.getByLabel('Column for number', { exact: true }).selectOption('4');
  await page.getByTestId('apply-roster-mapping').click();
  await page.getByLabel('Row 4 studentNumber', { exact: true }).fill('000903');
  await page.getByLabel('Include row 5', { exact: true }).uncheck();
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  const classPicker = page.getByTestId('header-class-select');
  const initialClass = await classPicker.inputValue();
  const otherClass = await classPicker.locator('option').evaluateAll((options, initial) => options.map(option => (option as HTMLOptionElement).value).find(value => value !== initial), initialClass);
  assert.ok(otherClass, 'fictional fixture has a second class');
  await classPicker.selectOption(otherClass);
  await page.getByRole('alert').filter({ hasText: 'selected class changed' }).waitFor();
  assert.equal(await page.getByTestId('import-roster-btn').isDisabled(), true);
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  await classPicker.selectOption(initialClass);
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  await page.getByTestId('import-roster-btn').click();
  await page.getByTestId('roster-import-success').waitFor();
  const afterStudents = await records(page, 'students');
  const newStudents = afterStudents.filter(student => !beforeStudents.some(before => before.id === student.id));
  assert.deepEqual(newStudents.map(student => student.localStudentNumber).sort(), ['000901', '000902', '000903']);
  assert.equal(newStudents.filter(student => student.firstName === 'Ari' && student.lastName === 'Vale').length, 2);
  const afterEnrollments = await records(page, 'classEnrollments');
  assert.equal(afterEnrollments.length, beforeEnrollments.length + 3);
  for (const enrollment of beforeEnrollments) assert.deepEqual(afterEnrollments.find(row => row.id === enrollment.id), enrollment);
  // Headerless extra columns and combined multipart names remain editable.
  await page.getByRole('button', { name: 'Done / Add More Students', exact: true }).click();
  await page.getByTestId('roster-csv-textarea').fill('Room 1\tSam de Lake\t000905');
  await page.getByTestId('preview-roster-btn').click();
  await page.getByLabel('First nonblank row is a header').uncheck();
  await page.getByLabel('Name interpretation', { exact: true }).selectOption('first_last');
  await page.getByLabel('Column for name', { exact: true }).selectOption('1');
  await page.getByLabel('Column for number', { exact: true }).selectOption('2');
  await page.getByTestId('apply-roster-mapping').click();
  await page.getByLabel('Row 1 firstName', { exact: true }).waitFor();
  assert.match(await page.locator('body').innerText(), /Multipart or missing name/);
  await page.getByLabel('Row 1 firstName', { exact: true }).fill('Sam');
  await page.getByLabel('Row 1 lastName', { exact: true }).fill('de Lake');
  await page.getByTestId('recheck-roster-preview').click();
  await page.getByTestId('recheck-roster-preview').waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('import-roster-btn').isEnabled(), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await records(page, 'students'), afterStudents);
  assert.deepEqual(resources, []);
  assert.equal(await page.evaluate(() => (window as any).__badPaste), undefined);
  assert.deepEqual(errors, []);
  console.log('PASS production Chromium: HTML paste without execution/resources; ambiguous OEN/local ID mapping; extra/reordered columns; string IDs; same-name students; edits; duplicate exclusion/recheck; explicit exclusions; cancellation; atomic persisted import and prior enrollment preservation.');
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.httpServer?.close(() => resolve()));
}
