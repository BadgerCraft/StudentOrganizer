import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { zipSync, strToU8 } from 'fflate';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { revealRubricPaste } from './helpers/classroomMarkingUi';
import { openUnifiedMarking } from './helpers/unifiedMarking';
import { encodeCapturePackage, capturePagePath, captureSha256 } from '../shared/capturePackage';

const origin = 'http://127.0.0.1:4234';
const server = await createServer({ server: { host: '127.0.0.1', port: 4234, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page); await page.locator('[data-testid^="select-teacher-"]').first().click();
  const rows = (table: string): Promise<any[]> => page.evaluate(async table => { const path = '/src/db/database.ts'; return (await import(path)).db.table(table).toArray(); }, table);
  const baseline = await rows('categoryResults');
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Upload picture assignment', exact: true }).count(), 0);
  const entry = page.getByRole('button', { name: 'Mark assignment', exact: true }).first();
  await entry.click(); await page.getByTestId('marking-mode-written').waitFor();
  for (const mode of ['written', 'oral', 'rubric']) assert.equal(await page.getByTestId(`marking-mode-${mode}`).count(), 1);
  await page.getByTestId('marking-mode-written').click();
  await revealRubricPaste(page);
  await page.getByTestId('marking-rubric-paste').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited\tSome\tClear\tThorough');
  await page.getByTestId('marking-rubric-preview').click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional unified rubric');
  await page.getByLabel('Criterion 1 KTCA mapping').selectOption('K');
  assert.equal(await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).isDisabled(), true);
  await page.getByTestId('marking-rubric-confirm').check();
  await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).click();
  const rubric = (await rows('markingRubrics'))[0]; assert.ok(rubric.confirmed);
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Identical fictional essay text.</w:t></w:r></w:p></w:body></w:document>'),
  });
  const classZip = zipSync({ 'First/Essay.docx': docx, 'Second/Essay.docx': docx });
  const wizard = page.getByTestId('evidence-import-wizard');
  await wizard.getByLabel('ZIP of DOCX essays (class set)', { exact: true }).check();
  await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
  await wizard.getByLabel('Choose DOCX class ZIP', { exact: true }).setInputFiles({ name: 'Class.zip', mimeType: 'application/zip', buffer: Buffer.from(classZip) });
  await wizard.getByRole('button', { name: 'Add work and select students', exact: true }).click();
  await wizard.getByRole('group', { name: 'Class students', exact: true }).waitFor();
  assert.equal((await rows('markingAttempts')).length, 0, 'archive entries never assign themselves');
  await wizard.getByLabel('Several students', { exact: true }).check();
  const students = wizard.getByRole('group', { name: 'Class students', exact: true });
  await students.getByRole('checkbox').nth(0).check(); await students.getByRole('checkbox').nth(1).check();
  await wizard.getByRole('button', { name: 'Continue to matching', exact: true }).click();
  for (const [index, path] of ['First/Essay.docx', 'Second/Essay.docx'].entries()) {
    await wizard.getByRole('group', { name: /^Work items/ }).getByLabel(path, { exact: true }).check();
    await wizard.getByRole('group', { name: /^Students ·/ }).getByRole('radio').first().check();
    await wizard.getByRole('button', { name: 'Confirm match', exact: true }).click();
  }
  await wizard.getByRole('button', { name: 'Review matches', exact: true }).click();
  await wizard.getByRole('button', { name: 'Confirm and start marking', exact: true }).click();
  await page.getByRole('region', { name: 'Marking session', exact: true }).waitFor();
  const criterionCard = page.getByTestId(`marking-criterion-${rubric.criteria[0].id}`);
  assert.equal(await criterionCard.getByRole('group', { name: 'K category judgment', exact: true }).count(), 1);
  assert.equal(await criterionCard.getByRole('group', { name: 'Evidence evidence level (optional)', exact: true }).count(), 0);
  await criterionCard.getByLabel('Category K feedback', { exact: true }).fill('Fictional category feedback survives reload.');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByTestId('marking-save-status').filter({ hasText: 'Saved locally' }).waitFor();
  const essays = await rows('markingAttempts'); assert.equal(essays.length, 2); assert.equal(new Set(essays.map(attempt => attempt.classEnrollmentId)).size, 2);
  assert.ok(essays.every(attempt => attempt.documents.length === 1 && attempt.documents[0].original.name === 'Essay.docx'));
  const feedbackAttemptId = (await rows('markingSessions')).find(session => session.draft.judgments.some((judgment: any) => judgment.feedback === 'Fictional category feedback survives reload.')).attemptId;
  await page.reload();
  await page.getByTestId(`open-marking-${rubric.assessmentId}`).click();
  await page.getByTestId(`marking-session-open-${feedbackAttemptId}`).click();
  await page.getByRole('region', { name: 'Marking session', exact: true }).waitFor({ timeout: 10000 }).catch(async error => { console.error((await page.locator('body').innerText()).slice(-10000)); throw error; });
  assert.equal(await page.getByRole('textbox', { name: /^Category K feedback/ }).inputValue(), 'Fictional category feedback survives reload.');
  assert.deepEqual(await rows('categoryResults'), baseline);
  const { assessmentId } = await openUnifiedMarking(page);
  const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100; canvas.getContext('2d')!.fillRect(0, 0, 80, 100); return canvas.toDataURL('image/png').split(',')[1]; });
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64')), path = capturePagePath('same-label', 'page-one', 'image/png');
  const zip = await encodeCapturePackage({ format: 'studentorganizer-capture', version: 2, packageId: 'fictional-unified', assignmentId: 'fictional', assignmentName: 'Fictional', revision: 1, completed: true, submissions: [{ id: 'same-label', label: 'Same label', pages: [{ id: 'page-one', order: 0, path, mime: 'image/png', byteLength: bytes.length, sha256: await captureSha256(bytes), edits: { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } } }] }] }, { [path]: bytes });
  await page.getByTestId('capture-zip').setInputFiles({ name: 'Phone.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.getByTestId('capture-set-same-label').click(); await page.locator('[data-testid^="capture-student-"]').first().click();
  // A bind failure after a durable match must expose its saved root, not invite re-upload.
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) { if (this.name === 'markingAttempts') { IDBObjectStore.prototype.put = original; throw new DOMException('Fictional bind failure', 'QuotaExceededError'); } return key === undefined ? original.call(this, value) : original.call(this, value, key); }; });
  await page.getByTestId('capture-confirm').click();
  await page.getByRole('alert').filter({ hasText: 'Match saved locally' }).waitFor();
  const roots = await rows('captureAttachments'); assert.equal(roots.length, 1); assert.equal((await rows('captureImportReceipts')).length, 1); assert.equal((await rows('markingAttempts')).length, 2);
  await page.getByTestId(`capture-start-${roots[0].id}`).click(); await page.getByTestId('image-markup').waitFor();
  assert.equal((await rows('markingAttempts')).length, 3);
  await page.reload(); await openUnifiedMarking(page, { phone: false });
  await page.getByTestId(`capture-open-${roots[0].id}`).click(); await page.getByTestId('image-markup').waitFor();
  assert.equal((await rows('markingAttempts')).length, 3, 'saved root opens without ZIP or duplicate attempt');
  assert.equal((await rows('captureImportReceipts')).length, 1); assert.deepEqual(await rows('categoryResults'), baseline);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.setViewportSize({ width: 760, height: 900 });
  const workPane = await page.getByTestId('marking-work-pane').boundingBox(), reviewPane = await page.getByTestId('marking-review-pane').boundingBox();
  assert.ok(workPane && reviewPane && reviewPane.y >= workPane.y + workPane.height - 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/unified-marking.png', fullPage: true });
  console.log(`PASS unified Mark assignment ${assessmentId}: explicit KTCA confirmation; identical DOCX essays retain separate explicit students; direct opening; durable phone match survives bind failure; saved roots reopen without upload/duplicates; grades unchanged; zero external requests.`);
} finally { await browser.close(); await server.close(); }
