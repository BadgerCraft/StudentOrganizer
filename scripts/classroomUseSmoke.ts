import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { strToU8, zipSync } from 'fflate';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { verifyCompactMarkbookEditor } from './helpers/markbookViewportAcceptance';

// Actual application UI and IndexedDB, with fictional local files. Vite module
// access below only injects bounded failures; successful saves use production services.
const origin = 'http://127.0.0.1:4208';
const completed: string[] = [], errors: string[] = [], external: string[] = [];
const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction(table, 'readonly'), read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => database.close();
    };
  }), table);
}
async function count(page: Page, table: string, expected: number) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const values = await rows(page, table);
    if (values.length === expected) return values;
    await page.waitForTimeout(100);
  }
  assert.equal((await rows(page, table)).length, expected, `${table} count`);
  return rows(page, table);
}
function pass(message: string) { completed.push(message); console.log(`PASS: ${message}`); }
const docx = Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fictional Word submission with evidence.</w:t></w:r></w:p></w:body></w:document>')
}));
const server = await createServer({ server: { host: '127.0.0.1', port: 4208, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(origin);
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  async function assessments() {
    await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  }
  await assessments();
  const historicalResults = await rows(page, 'categoryResults');
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill('Fictional classroom-use acceptance');
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  let assessment: any;
  for (let attempt = 0; attempt < 50; attempt++) {
    assessment = (await rows(page, 'assessments')).find(row => row.title === 'Fictional classroom-use acceptance');
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment);
  const students = await rows(page, 'students');
  const enrollments = (await rows(page, 'classEnrollments')).filter(row => row.classSectionId === assessment.classSectionId && row.enrollmentStatus === 'active');
  const label = (id: string) => { const enrollment = enrollments.find(row => row.id === id); const student = students.find(row => row.id === enrollment.studentId); return `${student.firstName} ${student.lastName} (${student.localStudentNumber})`; };
  const selected = enrollments.slice(0, 4).map(row => row.id);
  assert.equal(selected.length, 4);
  const compactCategory = (await rows(page, 'assessmentCategories')).find(row => row.assessmentId === assessment.id && row.categoryCode === 'K');
  assert.ok(compactCategory);
  await verifyCompactMarkbookEditor(page, selected[2], compactCategory.id);
  pass('At 1280×720 the result editor scrolls naturally to Save and Cancel, saves the selected level and feedback, and Cancel preserves the saved result.');
  await assessments();
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await page.getByText('Paste rubric text or table', { exact: true }).click();
  await page.getByTestId('marking-rubric-paste').fill('Criterion\tCategory\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tThinking\tLimited evidence\tSome evidence\tClear evidence\tThorough evidence');
  await page.getByTestId('marking-rubric-preview').click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional classroom rubric');
  await page.getByLabel('Criterion 1 KTCA mapping').selectOption('T');
  await page.getByTestId('marking-rubric-confirm').check();
  await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).click();
  const wizard = page.getByTestId('evidence-import-wizard');
  await wizard.getByLabel('Upload a text/document file').check();
  await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.match(await wizard.innerText(), /Older \.doc files are not supported/);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    (window as any).restoreClassroomRead = () => { File.prototype.arrayBuffer = original; };
    File.prototype.arrayBuffer = function () { return this.name === 'retry.txt' ? Promise.reject(new Error('Fictional read failure')) : original.call(this); };
  });
  const firstText = txt('A-one.txt', 'Fictional first page.\r\nRetain original line endings.');
  await wizard.getByLabel('Choose text/document files').setInputFiles([
    firstText, txt('A-two.txt', 'Fictional second page.'),
    { name: 'B.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx },
    txt('retry.txt', 'Fictional recovered page.'), { name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('unsupported') }
  ]);
  await wizard.getByRole('button', { name: 'Add work and select students' }).click();
  await wizard.getByRole('group', { name: 'Class students' }).waitFor();
  assert.match(await wizard.innerText(), /retry.txt: Fictional read failure/);
  await wizard.getByLabel('Several students').check();
  await wizard.getByLabel(label(selected[0]), { exact: true }).check();
  await wizard.getByLabel(label(selected[1]), { exact: true }).check();
  assert.equal(await wizard.getByRole('button', { name: 'Continue to matching' }).isDisabled(), true);
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => { (window as any).restoreClassroomRead(); delete (window as any).restoreClassroomRead; });
  await wizard.getByLabel('Choose text/document files').setInputFiles([firstText, txt('retry.txt', 'Fictional recovered page.')]);
  await wizard.getByRole('button', { name: 'Add work and select students' }).click();
  await wizard.getByRole('group', { name: 'Class students' }).waitFor();
  assert.match(await wizard.innerText(), /Already added; no extra copies: A-one.txt/);
  assert.match(await wizard.innerText(), /retry.txt: Fictional read failure/, 'reselecting a filename cannot acknowledge the failed original');
  await wizard.getByRole('button', { name: 'Retry retry.txt', exact: true }).click();
  await wizard.getByRole('button', { name: 'Retry retry.txt', exact: true }).waitFor({ state: 'detached' });
  assert.match(await wizard.innerText(), /Already added; no extra copies: retry.txt/);
  assert.doesNotMatch(await wizard.innerText(), /retry.txt: Fictional read failure/);
  await wizard.getByRole('checkbox', { name: /Continue with only the work successfully added/ }).check();
  await wizard.getByRole('button', { name: 'Continue to matching' }).click();
  async function match(file: string, id: string) {
    await wizard.getByLabel(file, { exact: true }).check();
    await wizard.getByRole('group', { name: /^Students ·/ }).locator('label').filter({ hasText: label(id) }).getByRole('radio').check();
    await wizard.getByRole('button', { name: 'Confirm match', exact: true }).click();
  }
  await match('A-one.txt', selected[0]);
  await match('A-two.txt', selected[0]);
  await match('B.docx', selected[1]);
  await match('retry.txt', selected[0]);
  assert.equal(await wizard.getByRole('button', { name: 'Undo / change match' }).count(), 4);
  await wizard.getByRole('button', { name: 'Undo / change match' }).first().click();
  await wizard.getByRole('button', { name: 'Confirm match', exact: true }).click();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  await wizard.getByRole('button', { name: 'Continue to matching' }).click();
  assert.equal(await wizard.getByRole('button', { name: 'Undo / change match' }).count(), 4);
  await wizard.getByRole('button', { name: 'Review matches' }).click();
  await page.evaluate(async enrollmentId => {
    const path = '/src/db/database.ts'; const { db } = await import(path);
    const original = db.auditEntries.add;
    (window as any).restoreClassroomImport = () => { db.auditEntries.add = original; };
    db.auditEntries.add = function (entry: any, ...args: any[]) {
      if (entry.entityName === 'markingAttempts' && JSON.parse(entry.newStateJson).classEnrollmentId === enrollmentId) return Promise.reject(new Error('Fictional import disk failure'));
      return original.call(this, entry, ...args);
    };
  }, selected[1]);
  await wizard.getByRole('button', { name: 'Confirm and start marking' }).click();
  await wizard.getByRole('alert').filter({ hasText: 'Fictional import disk failure' }).waitFor();
  await count(page, 'markingAttempts', 1);
  await page.evaluate(() => { (window as any).restoreClassroomImport(); delete (window as any).restoreClassroomImport; });
  await page.evaluate(async () => {
    const path = '/src/db/database.ts'; const { db } = await import(path); const original = db.markingSessions.add;
    (window as any).restoreClassroomOpen = () => { db.markingSessions.add = original; };
    db.markingSessions.add = () => Promise.reject(new Error('Fictional opening failure'));
  });
  await wizard.getByRole('button', { name: 'Retry and start marking' }).click();
  await wizard.getByRole('alert').filter({ hasText: 'Fictional opening failure' }).waitFor();
  await count(page, 'markingAttempts', 2);
  await page.evaluate(() => { (window as any).restoreClassroomOpen(); delete (window as any).restoreClassroomOpen; });
  await wizard.getByRole('button', { name: 'Retry and start marking' }).click();
  const attempts = await count(page, 'markingAttempts', 2);
  await page.getByTestId('marking-document').waitFor();
  const a = attempts.find(row => row.classEnrollmentId === selected[0]), b = attempts.find(row => row.classEnrollmentId === selected[1]);
  assert.equal(a.documents.length, 3); assert.equal(b.documents.length, 1);
  assert.equal(a.documents.find((doc: any) => doc.name === firstText.name).original.base64, firstText.buffer.toString('base64'));
  assert.equal(b.documents[0].original.base64, docx.toString('base64'));
  pass('Real TXT/DOCX guided import: explicit multi-student matching, several pages per student, Back, Undo, unsupported .doc, file-read retry, partial-save retry and failed-opening recovery without duplicates.');

  const first = attempts[0], second = attempts[1];
  await page.getByTestId(`marking-session-open-${first.id}`).click();
  const thinking = page.getByRole('group', { name: 'T category judgment', exact: true });
  await thinking.getByRole('button', { name: 'Level', exact: true }).click();
  const exactLevels = ['R', '1−', '1', '1+', '2−', '2', '2+', '3−', '3', '3+', '4−(low)', '4−(High)', '4(low)', '4(high)', '4+(low)', '4+(med)', '4+(high)'];
  for (const value of exactLevels) {
    const choice = thinking.getByRole('button', { name: value, exact: true }); await choice.click();
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
  }
  await thinking.getByRole('button', { name: '3+', exact: true }).click();
  await page.getByLabel('Category T feedback', { exact: true }).fill('Fictional category feedback.');
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill('Fictional first student saved feedback.');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/db/database.ts'; const { db } = await import(path); const original = db.markingCommits.add;
    (window as any).restoreClassroomFinalize = () => { db.markingCommits.add = original; };
    db.markingCommits.add = () => Promise.reject(new Error('Fictional final save failure'));
  });
  const beforeFailedSave = await rows(page, 'categoryResults');
  await page.getByTestId('marking-save-next').click();
  await page.getByRole('alert').filter({ hasText: 'Fictional final save failure' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), 'Fictional first student saved feedback.');
  assert.deepEqual(await rows(page, 'categoryResults'), beforeFailedSave);
  assert.equal((await rows(page, 'markingCommits')).length, 0);
  await page.evaluate(() => { (window as any).restoreClassroomFinalize(); delete (window as any).restoreClassroomFinalize; });
  await page.getByTestId('marking-save-next').click();
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).filter({ hasText: '' }).waitFor();
  await page.waitForFunction(() => (document.querySelector('textarea') !== null));
  for (let index = 0; index < 50 && await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue() !== ''; index++) await page.waitForTimeout(100);
  assert.equal(await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), '');
  const firstSA = (await rows(page, 'studentAssessments')).find(row => row.assessmentId === assessment.id && row.classEnrollmentId === first.classEnrollmentId);
  const firstResult = (await rows(page, 'categoryResults')).find(row => row.studentAssessmentId === firstSA.id);
  assert.equal(firstResult.rawScore, '3+'); assert.equal(firstResult.normalizedPercentage, 78);
  await page.getByLabel('Category T feedback', { exact: true }).fill('Fictional feedback only; no grade.');
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill('Fictional feedback-only student.');
  await page.getByTestId('marking-save-markbook').click();
  await page.getByRole('dialog', { name: 'Assessment marking', exact: true }).waitFor({ state: 'hidden' });
  await page.getByTestId(`markbook-cell-${first.classEnrollmentId}-${firstResult.assessmentCategoryId}`).filter({ hasText: '3+' }).waitFor();
  await page.getByTestId(`markbook-cell-${second.classEnrollmentId}-${firstResult.assessmentCategoryId}`).filter({ hasText: 'Feedback only' }).waitFor();
  const secondSA = (await rows(page, 'studentAssessments')).find(row => row.assessmentId === assessment.id && row.classEnrollmentId === second.classEnrollmentId);
  const feedbackOnlyResults = (await rows(page, 'categoryResults')).filter(row => row.studentAssessmentId === secondSA.id);
  assert.equal(feedbackOnlyResults.length, 1);
  assert.ok(feedbackOnlyResults.every(row => row.normalizedPercentage === null && row.rawScore === ''), 'feedback-only categories never receive a numerical grade');
  await page.reload();
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  await page.getByTestId(`markbook-cell-${first.classEnrollmentId}-${firstResult.assessmentCategoryId}`).filter({ hasText: '3+' }).waitFor();
  assert.equal((await rows(page, 'markingCommits')).length, 2);
  pass('All 17 level choices select visibly; failed final save retains draft and rolls back results; Save and next/return update Markbook, feedback-only stays ungraded, and saved results survive restart.');

  await assessments(); await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await wizard.getByLabel('Paste text', { exact: true }).check(); await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
  await wizard.getByLabel('Work title', { exact: true }).fill('Fictional pasted work');
  await wizard.getByRole('textbox', { name: /^Student work/ }).fill('Fictional pasted text remains intact when going Back.');
  await wizard.getByRole('button', { name: 'Add work and select students' }).click();
  await wizard.getByLabel(label(selected[2]), { exact: true }).check();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await wizard.getByRole('textbox', { name: /^Student work/ }).inputValue(), 'Fictional pasted text remains intact when going Back.');
  await wizard.getByRole('button', { name: 'Add work and select students' }).click();
  await wizard.getByRole('button', { name: 'Confirm student and review work' }).click();
  assert.equal(await wizard.getByRole('heading', { name: 'Match work to students' }).count(), 0);
  await wizard.getByRole('button', { name: 'Confirm and start marking' }).click();
  await count(page, 'markingAttempts', 3);
  await page.getByTestId('marking-document').filter({ hasText: 'Fictional pasted text' }).waitFor();
  pass('Single-student pasted-text flow requires explicit student confirmation, skips matching, and retains entered content on Back without duplicate imports.');

  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await wizard.getByLabel('Upload a picture', { exact: true }).check(); await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
  const pngs = await page.evaluate(() => [1, 2].map(number => { const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 640; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 640); ctx.fillStyle = '#111'; ctx.font = '20px sans-serif'; ctx.fillText(`Fictional photographed work ${number}`, 20, 40); return canvas.toDataURL('image/png').split(',')[1]; }));
  await wizard.getByLabel('Choose pictures', { exact: true }).setInputFiles(pngs.map((png, index) => ({ name: `Fictional-page-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await wizard.getByRole('button', { name: 'Add work and select students' }).click();
  await wizard.getByLabel(label(selected[3]), { exact: true }).check();
  await wizard.getByRole('button', { name: 'Confirm student and review work' }).click();
  await wizard.getByRole('button', { name: 'Confirm and start marking' }).click();
  const withPicture = await count(page, 'markingAttempts', 4), picture = withPicture.find(row => row.classEnrollmentId === selected[3]);
  assert.deepEqual(picture.imagePages.map((image: any) => image.base64), pngs); assert.equal(picture.documents.length, 0);
  await page.locator('[data-testid="image-annotation-surface"]:visible').first().waitFor();
  assert.deepEqual((await rows(page, 'categoryResults')).filter(row => historicalResults.some(old => old.id === row.id)), historicalResults);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  pass('Picture import preserves exact local bytes and opens image marking; historical results are unchanged; no external requests or browser errors.');

  // Returning to Markbook destroys the workspace's in-memory preparation. Both
  // kinds must be explicitly discarded before any official result is committed.
  for (const preparation of ['rubric', 'import'] as const) {
    await page.getByText(/Draft — official marks unchanged/).waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Save now' && button.matches(':enabled')));
    const feedback = `Fictional picture feedback with guarded ${preparation} preparation.`;
    await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill(feedback);
    await page.getByRole('button', { name: 'Save now', exact: true }).click();
    await page.getByTestId('marking-save-status').filter({ hasText: /^Saved locally$/ }).waitFor();
    const title = `Fictional unsaved ${preparation} preparation`;
    const work = 'Fictional student text that must survive a cancelled return.';
    if (preparation === 'rubric') {
      await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
      await page.getByLabel('Rubric title', { exact: true }).fill(title);
    } else {
      await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
      await wizard.getByLabel('Paste text', { exact: true }).check();
      await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
      await wizard.getByLabel('Work title', { exact: true }).fill(title);
      await wizard.getByRole('textbox', { name: /^Student work/ }).fill(work);
    }
    await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
    const before = Object.fromEntries(await Promise.all(['studentAssessments', 'categoryResults', 'markingCommits', 'markingSessions', 'markingRubrics', 'markingAttempts']
      .map(async table => [table, await rows(page, table)])));
    const cancelPrompt = page.waitForEvent('dialog');
    const cancelledReturn = page.getByTestId('marking-save-markbook').click();
    const cancellation = await cancelPrompt;
    assert.match(cancellation.message(), /discard unsaved rubric or import preparation/i);
    await cancellation.dismiss(); await cancelledReturn;
    assert.equal(await page.getByRole('dialog', { name: 'Assessment marking', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), feedback);
    for (const [table, records] of Object.entries(before)) assert.deepEqual(await rows(page, table), records, `${preparation}: cancellation must not finalize or change saved records`);
    if (preparation === 'rubric') {
      await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
      assert.equal(await page.getByLabel('Rubric title', { exact: true }).inputValue(), title);
    } else {
      await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
      assert.equal(await wizard.getByLabel('Work title', { exact: true }).inputValue(), title);
      assert.equal(await wizard.getByRole('textbox', { name: /^Student work/ }).inputValue(), work);
    }
    await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
    const acceptPrompt = page.waitForEvent('dialog');
    const acceptedReturn = page.getByTestId('marking-save-markbook').click();
    const acceptance = await acceptPrompt;
    assert.match(acceptance.message(), /discard unsaved rubric or import preparation/i);
    await acceptance.accept(); await acceptedReturn;
    await page.getByRole('dialog', { name: 'Assessment marking', exact: true }).waitFor({ state: 'hidden' });
    const savedCommits = await rows(page, 'markingCommits');
    assert.equal(savedCommits.length, before.markingCommits.length + 1);
    const receipt = savedCommits.find(row => !before.markingCommits.some((previous: { id: string }) => previous.id === row.id));
    assert.equal(receipt?.attemptId, picture.id);
    assert.equal(receipt?.draft.overallFeedback, feedback);
    const pictureAssessment = (await rows(page, 'studentAssessments')).find(row => row.assessmentId === assessment.id && row.classEnrollmentId === picture.classEnrollmentId);
    assert.equal(pictureAssessment?.overallFeedback, feedback);
    assert.deepEqual(await rows(page, 'markingAttempts'), before.markingAttempts, 'Discarding import preparation must not create a submission');
    assert.deepEqual(await rows(page, 'markingRubrics'), before.markingRubrics, 'Discarding rubric preparation must not create a rubric version');
    if (preparation === 'rubric') {
      await assessments(); await page.getByTestId(`open-marking-${assessment.id}`).click();
      await page.getByTestId(`marking-session-open-${picture.id}`).click();
      await page.getByRole('region', { name: 'Marking session', exact: true }).waitFor();
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  pass('Save and return protects unsaved rubric and import preparation: Cancel preserves exact preparation/draft/official records; explicit discard alone finalizes and returns to Markbook.');
  await page.screenshot({ path: '/tmp/classroom-use-marking.png', fullPage: true });
  await writeFile('/tmp/classroom-use-results.json', JSON.stringify({ status: 'pass', completed, errors, external, nativeDesktopVerified: false }, null, 2));
} catch (error) {
  await writeFile('/tmp/classroom-use-results.json', JSON.stringify({ status: 'fail', completed, errors, external, failure: String(error), nativeDesktopVerified: false }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); }
