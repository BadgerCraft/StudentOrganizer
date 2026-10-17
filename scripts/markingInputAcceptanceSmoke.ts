import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Locator, type Page } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';

// Fictional UI acceptance. Vite module access is used only to inject bounded
// read/write failures; successful imports still use the real authorized service.
const origin = 'http://127.0.0.1:4195';
const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(table, 'readonly');
      const read = transaction.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }), table);
}
async function selectPassage(page: Page, start: number, end: number) {
  await page.getByTestId('marking-document').evaluate((root, { start, end }) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0, begin: [Node, number] | null = null, finish: [Node, number] | null = null;
    while ((node = walker.nextNode())) {
      const limit = offset + (node.textContent?.length || 0);
      if (!begin && start < limit) begin = [node, start - offset];
      if (end <= limit) { finish = [node, end - offset]; break; }
      offset = limit;
    }
    if (!begin || !finish) throw new Error('Invalid fictional selection');
    const range = document.createRange(); range.setStart(...begin); range.setEnd(...finish);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end });
}
async function waitForCount(page: Page, table: string, count: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await records(page, table);
    if (rows.length === count) return rows;
    await page.waitForTimeout(100);
  }
  assert.equal((await records(page, table)).length, count, `${table} count`);
  return records(page, table);
}
async function assertPrimaryContrast(control: Locator, label: string) {
  const colors = await control.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: style.color };
  });
  assert.equal(colors.text, 'rgb(255, 255, 255)', `${label} uses readable white text`);
  assert.notEqual(colors.background, colors.text, `${label} must not render white text on white`);
  assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)', `${label} needs a visible primary background`);
}
const wizard = (page: Page) => page.getByTestId('evidence-import-wizard');
async function addDocumentFiles(page: Page, files: ReturnType<typeof txt> | ReturnType<typeof txt>[]) {
  const panel = wizard(page);
  await panel.getByRole('radio', { name: 'Upload a text/document file', exact: true }).check();
  await panel.getByRole('button', { name: 'Continue', exact: true }).click();
  await panel.getByLabel('Choose text/document files', { exact: true }).setInputFiles(files);
  await assertPrimaryContrast(panel.getByRole('button', { name: 'Add work and select students', exact: true }), 'Wizard Add work');
  await panel.getByRole('button', { name: 'Add work and select students', exact: true }).click();
  await panel.getByRole('heading', { name: 'Who does this work belong to?', exact: true }).waitFor();
}
async function selectOneStudent(page: Page, label: string) {
  const panel = wizard(page);
  await panel.getByRole('radio', { name: 'One student', exact: true }).check();
  await panel.getByRole('radio', { name: label, exact: true }).check();
  await panel.getByRole('button', { name: 'Confirm student and review work', exact: true }).click();
  await panel.getByRole('heading', { name: 'Review student work', exact: true }).waitFor();
}
async function matchSeveralStudents(page: Page, pairs: { filename: string; label: string }[]) {
  const panel = wizard(page);
  await panel.getByRole('radio', { name: 'Several students', exact: true }).check();
  for (const label of [...new Set(pairs.map(pair => pair.label))]) await panel.getByRole('checkbox', { name: label, exact: true }).check();
  await panel.getByRole('button', { name: 'Continue to matching', exact: true }).click();
  for (const pair of pairs) {
    await panel.getByRole('radio', { name: pair.filename, exact: true }).check();
    await panel.getByRole('radio', { name: pair.label, exact: false }).check();
    await panel.getByRole('button', { name: 'Confirm match', exact: true }).click();
  }
  await panel.getByRole('button', { name: 'Review matches', exact: true }).click();
}
async function confirmImport(page: Page, retry = false) {
  await wizard(page).getByRole('button', { name: retry ? 'Retry and start marking' : 'Confirm and start marking', exact: true }).click();
}
const server = await createServer({ server: { host: '127.0.0.1', port: 4195, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(`${origin}/`)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(origin);
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill('Fictional input acceptance');
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  let assessment: any;
  for (let attempt = 0; attempt < 40; attempt++) {
    assessment = (await records(page, 'assessments')).find(row => row.title === 'Fictional input acceptance');
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment, 'assessment created through UI');
  const officialBefore = {
    assessments: await records(page, 'studentAssessments'), results: await records(page, 'categoryResults'), commits: await records(page, 'markingCommits')
  };
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await wizard(page).getByRole('radio', { name: 'Upload a text/document file', exact: true }).check();
  await wizard(page).getByRole('button', { name: 'Continue', exact: true }).click();
  await wizard(page).getByLabel('Choose text/document files', { exact: true }).setInputFiles({ name: 'Fictional failed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Unsupported fictional input') });
  await wizard(page).getByRole('button', { name: 'Add work and select students', exact: true }).click();
  await wizard(page).getByRole('button', { name: 'Retry Fictional failed.pdf', exact: true }).waitFor();
  await wizard(page).getByRole('button', { name: 'Back', exact: true }).click();
  await wizard(page).getByRole('radio', { name: 'Paste text', exact: true }).check();
  let failedOnlyPrompt = '';
  page.once('dialog', async dialog => { failedOnlyPrompt = dialog.message(); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  assert.match(failedOnlyPrompt, /discard unsaved/);
  await wizard(page).getByRole('button', { name: 'Retry Fictional failed.pdf', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  console.log('PASS: failed-only import survives source change and canceled departure; leaving requires explicit discard.');
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();

  // Build every matrix cell manually. A duplicate column rename must reject the
  // edit without moving, overwriting or dropping any descriptor.
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional manual descriptor matrix');
  await page.getByLabel('Criterion 1 name', { exact: true }).fill('Evidence');
  await page.getByLabel('Criterion 1 KTCA mapping').selectOption('T');
  await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  assert.equal(await page.getByLabel('Rubric title', { exact: true }).inputValue(), 'Fictional manual descriptor matrix');
  assert.equal(await page.getByLabel('Criterion 1 name', { exact: true }).inputValue(), 'Evidence');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByLabel('Rubric title', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
  await page.getByLabel('Criterion 2 name', { exact: true }).fill('Organization');
  await page.getByLabel('Criterion 2 KTCA mapping').selectOption('C');
  await page.getByText('Achievement labels (17)', { exact: true }).click();
  for (let index = 17; index > 4; index--) await page.getByRole('button', { name: `Remove achievement label ${index}`, exact: true }).click();
  const oldLevels = ['R', '1−', '1', '1+'];
  for (const index of [1, 2]) await page.getByText(`Descriptors and reference weight for criterion ${index}`, { exact: true }).click();
  const descriptor = (criterion: string, index: number) => `${criterion}: fictional descriptor ${index + 1}; retain this exact text.`;
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of oldLevels.entries()) await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).fill(descriptor(criterion, index));
  }
  await page.getByLabel('Achievement label 1', { exact: true }).fill(oldLevels[1]);
  await page.getByRole('alert').filter({ hasText: 'Each achievement label must be unique' }).waitFor();
  assert.equal(await page.getByLabel('Achievement label 1', { exact: true }).inputValue(), oldLevels[0]);
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of oldLevels.entries()) assert.equal(await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).inputValue(), descriptor(criterion, index));
  }
  await page.screenshot({ path: '/tmp/markinator-input-duplicate-label.png', fullPage: true });
  const levels = ['Beginning', 'Developing', 'Proficient', 'Extending'];
  for (const [index, label] of levels.entries()) await page.getByLabel(`Achievement label ${index + 1}`, { exact: true }).fill(label);
  // A malformed pasted table must not destroy the manual matrix already entered.
  await page.getByText('Paste rubric text or table', { exact: true }).click();
  await page.getByTestId('marking-rubric-paste').fill('Criterion\tDuplicate\tDuplicate\nReasoning\tFirst\tSecond');
  await page.getByRole('button', { name: 'Review pasted rubric', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /distinct achievement labels/i }).waitFor();
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of levels.entries()) assert.equal(await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).inputValue(), descriptor(criterion, index));
  }
  await page.getByRole('checkbox', { name: /reviewed the criteria and descriptors/ }).check();
  await assertPrimaryContrast(page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }), 'Rubric Save');
  await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).click();
  await wizard(page).getByRole('heading', { name: 'Where is the student work?', exact: true }).waitFor();
  const [rubric] = await waitForCount(page, 'markingRubrics', 1);
  assert.deepEqual(rubric.levels, levels);
  assert.deepEqual(rubric.criteria.map((row: any) => ({ name: row.name, categoryCode: row.categoryCode, descriptors: row.descriptors })), [
    { name: 'Evidence', categoryCode: 'T', descriptors: Object.fromEntries(levels.map((label, index) => [label, descriptor('Evidence', index)])) },
    { name: 'Organization', categoryCode: 'C', descriptors: Object.fromEntries(levels.map((label, index) => [label, descriptor('Organization', index)])) }
  ]);
  console.log('PASS: manually entered complete 2×4 rubric matrix; duplicate achievement label and malformed pasted rubric rejected without descriptor loss; corrected custom labels persist.');

  const firstFile = txt('Fictional essay.txt', 'Essay passage. Fictional reasoning follows.');
  const secondFile = txt('Fictional notes.txt', 'Notes passage. Fictional planning follows.');
  await addDocumentFiles(page, [firstFile, secondFile]);
  const enrollmentIds = (await records(page, 'classEnrollments')).filter(row => row.classSectionId === assessment.classSectionId && row.deletedAt === null && row.enrollmentStatus === 'active').map(row => row.id);
  assert.ok(enrollmentIds.length >= 2);
  const students = await records(page, 'students'), enrollments = await records(page, 'classEnrollments');
  const studentLabels = Object.fromEntries(enrollmentIds.map(id => {
    const enrollment = enrollments.find(row => row.id === id), student = students.find(row => row.id === enrollment.studentId);
    return [id, `${student.firstName} ${student.lastName} (${student.localStudentNumber})`];
  }));
  await selectOneStudent(page, studentLabels[enrollmentIds[0]]);
  assert.equal(await wizard(page).getByRole('heading', { name: 'Match work to students', exact: true }).count(), 0, 'one confirmed student bypasses unnecessary matching');
  await confirmImport(page);
  const [grouped] = await waitForCount(page, 'markingAttempts', 1);
  assert.equal(grouped.classEnrollmentId, enrollmentIds[0]); assert.equal(grouped.previousAttemptId, null);
  assert.deepEqual(grouped.documents.map((row: any) => row.name), [firstFile.name, secondFile.name]);
  for (const [index, document] of grouped.documents.entries()) {
    assert.equal(document.original?.base64, [firstFile, secondFile][index].buffer.toString('base64'), 'original attachment bytes retained exactly');
  }
  await page.getByTestId(`marking-session-open-${grouped.id}`).click();
  await page.getByTestId('marking-document').waitFor();
  const documentSelect = page.getByRole('combobox', { name: /^Document/ });
  const expectedPassageFeedback = ['Fictional attachment feedback 1', 'Fictional attachment feedback 2'];
  for (const [index, document] of grouped.documents.entries()) {
    await documentSelect.selectOption(document.id);
    assert.equal(await page.getByTestId('marking-document').innerText(), document.text);
    await selectPassage(page, 0, 13);
    await page.getByTestId('marking-feedback').fill(expectedPassageFeedback[index]);
    if (index === 0) {
      const textBank = page.locator('section[aria-label="Comment bank"]').first();
      await textBank.getByRole('button', { name: 'Import comment bank', exact: true }).click();
      await textBank.getByLabel('Or paste one comment per line', { exact: true }).fill('Original bank draft.');
      await textBank.getByRole('button', { name: 'Review pasted comments', exact: true }).click();
      await textBank.getByLabel('Bank comment 1', { exact: true }).waitFor();
      await textBank.getByLabel('Or paste one comment per line', { exact: true }).fill('Revised bank draft.');
      assert.equal(await textBank.getByLabel('Bank comment 1', { exact: true }).count(), 0, 'edited source invalidates stale review');
      assert.equal(await textBank.getByRole('button', { name: 'Add reviewed comments to bank', exact: true }).count(), 0, 'new paste cannot be discarded by saving old review');
      await textBank.getByRole('button', { name: 'Review pasted comments', exact: true }).click();
      assert.equal(await textBank.getByLabel('Bank comment 1', { exact: true }).inputValue(), 'Revised bank draft.');
      await textBank.getByRole('button', { name: 'Add reviewed comments to bank', exact: true }).click();
      const criterion = page.getByTestId(`marking-criterion-${rubric.criteria[0].id}`);
      await criterion.getByRole('button', { name: 'Write a comment', exact: true }).click();
      const rubricBank = criterion.locator('section[aria-label="Comment bank"]');
      // The rubric picker is already mounted with the original bank snapshot.
      await textBank.getByRole('button', { name: 'Import comment bank', exact: true }).click();
      await textBank.getByLabel('Or paste one comment per line', { exact: true }).fill('Added by passage composer.');
      await textBank.getByRole('button', { name: 'Review pasted comments', exact: true }).click();
      await textBank.getByRole('button', { name: 'Add reviewed comments to bank', exact: true }).click();
      await rubricBank.getByRole('button', { name: 'Import comment bank', exact: true }).click();
      await rubricBank.getByLabel('Or paste one comment per line', { exact: true }).fill('Added by rubric composer.');
      await rubricBank.getByRole('button', { name: 'Review pasted comments', exact: true }).click();
      await rubricBank.getByRole('button', { name: 'Add reviewed comments to bank', exact: true }).click();
      for (const text of ['Revised bank draft.', 'Added by passage composer.', 'Added by rubric composer.']) await rubricBank.getByRole('button', { name: text, exact: true }).waitFor();
      await assertPrimaryContrast(criterion.getByRole('button', { name: 'Done — review criteria', exact: true }), 'Criterion Done');
      await criterion.getByRole('button', { name: 'Done — review criteria', exact: true }).click();
      await textBank.getByRole('button', { name: /^Choose bank comment/ }).click(); // close the stale open chooser
      await textBank.getByRole('button', { name: /^Choose bank comment/ }).click(); // reopening reloads the saved bank
      await textBank.getByRole('button', { name: 'Added by rubric composer.', exact: true }).waitFor();
      await criterion.getByRole('button', { name: 'Write a comment', exact: true }).click();
      const delayedBank = criterion.locator('section[aria-label="Comment bank"]');
      await delayedBank.getByRole('button', { name: 'Import comment bank', exact: true }).click();
      await page.evaluate(() => {
        const original = File.prototype.arrayBuffer;
        (window as any).restoreBankRead = () => { File.prototype.arrayBuffer = original; };
        File.prototype.arrayBuffer = function () {
          if (this.name !== 'Fictional delayed bank.txt') return original.call(this);
          const file = this;
          return new Promise<ArrayBuffer>((resolve, reject) => {
            (window as any).releaseBankRead = () => original.call(file).then(bytes => { resolve(bytes); }, reject);
          });
        };
      });
      await delayedBank.getByLabel('Choose comment-bank file', { exact: true }).setInputFiles(txt('Fictional delayed bank.txt', 'Discard this delayed bank import.'));
      await delayedBank.getByRole('status').filter({ hasText: 'Reading comment bank' }).waitFor();
      let discardPrompt = '';
      page.once('dialog', async dialog => { discardPrompt = dialog.message(); await dialog.accept(); });
      await criterion.getByRole('button', { name: 'Done — review criteria', exact: true }).click();
      assert.match(discardPrompt, /Discard the unsaved comment bank import/, 'closing an in-flight import requires deliberate discard');
      await page.evaluate(async () => { await (window as any).releaseBankRead(); (window as any).restoreBankRead(); delete (window as any).releaseBankRead; delete (window as any).restoreBankRead; });
      await page.waitForTimeout(500); // allow the released local read/hash promises to settle after unmount
      const unexpectedDialogs: string[] = [];
      const unexpectedDialog = async (dialog: import('playwright').Dialog) => { unexpectedDialogs.push(dialog.message()); await dialog.dismiss(); };
      page.on('dialog', unexpectedDialog);
      await page.getByTestId(`marking-session-open-${grouped.id}`).click();
      page.off('dialog', unexpectedDialog);
      assert.deepEqual(unexpectedDialogs, [], 'discarded asynchronous import must not restore a phantom unsaved-bank guard');
      assert.equal(await page.getByRole('status').filter({ hasText: 'Reading comment bank' }).count(), 0);
      const savedBanks = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('ota.comment-bank.v1.')).map(key => JSON.parse(localStorage.getItem(key)!)));
      assert.equal(savedBanks.some(comments => comments.includes('Discard this delayed bank import.')), false, 'discarded import does not write the bank');
      const bankAddition = 'Added by rubric composer.';
      if (!await textBank.getByRole('button', { name: bankAddition, exact: true }).isVisible()) {
        await textBank.getByRole('button', { name: /^Choose bank comment/ }).click();
      }
      await textBank.getByRole('button', { name: bankAddition, exact: true }).click();
      expectedPassageFeedback[index] += `\n${bankAddition}`;
      assert.equal(await page.getByTestId('marking-feedback').inputValue(), expectedPassageFeedback[index], 'choosing reusable feedback preserves the teacher’s existing passage comment');
      console.log('PASS: edited comment-bank source invalidates stale review; concurrent composers preserve newer bank additions; delayed import requires discard and cannot recreate a phantom guard; selecting bank feedback appends to existing passage text; primary button colors contrast.');
    }

    if (index === 0) {
      const bank = page.locator('section[aria-label="Comment bank"]').first();
      await bank.getByRole('button', { name: 'Import comment bank', exact: true }).click();
      await bank.getByLabel('Or paste one comment per line', { exact: true }).fill('Keep unfinished fictional bank review.');
      await bank.getByRole('button', { name: 'Review pasted comments', exact: true }).click();
      await bank.getByLabel('Bank comment 1', { exact: true }).fill('Edited unfinished fictional bank review.');
      for (const action of ['save', 'cancel', 'save']) {
        let prompt = '';
        page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
        await (action === 'save' ? page.getByTestId('marking-comment-save') : page.getByRole('button', { name: 'Cancel comment', exact: true })).click();
        assert.match(prompt, /comment.bank import review/);
        assert.equal(await bank.getByLabel('Bank comment 1', { exact: true }).inputValue(), 'Edited unfinished fictional bank review.');
        assert.equal(await page.getByTestId('marking-feedback').inputValue(), expectedPassageFeedback[index]);
      }
      page.once('dialog', async dialog => { assert.match(dialog.message(), /comment.bank import review/); await dialog.accept(); });
      console.log('PASS: repeated Save/Cancel interruption retains edited passage bank review and feedback; explicit discard permits save.');
    }
    await page.getByRole('combobox', { name: /^Evidence level \(optional\)/ }).selectOption(levels[index + 1]);
    await page.getByTestId('marking-comment-save').click();
  }
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill('Original grouped attempt stays available.');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByTestId('marking-save-status').filter({ hasText: 'Saved locally' }).waitFor();
  const originalSession = (await records(page, 'markingSessions')).find(row => row.attemptId === grouped.id);
  assert.equal(originalSession.draft.annotations.length, 2);
  assert.deepEqual(originalSession.draft.annotations.map((row: any) => row.documentId), grouped.documents.map((row: any) => row.id));
  assert.deepEqual(originalSession.draft.annotations.map((row: any) => row.level), [levels[1], levels[2]]);
  assert.deepEqual(originalSession.draft.annotations.map((row: any) => row.text), expectedPassageFeedback, 'saved passage annotations retain both teacher-written and chosen bank feedback');

  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await addDocumentFiles(page, txt('Fictional revised essay.txt', 'Revised fictional argument, with new reasoning.'));
  await selectOneStudent(page, studentLabels[enrollmentIds[0]]);
  const relationship = wizard(page).getByRole('combobox', { name: /^Submission relationship/ });
  const relationshipOptions = await relationship.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, text: node.textContent })));
  assert.ok(relationshipOptions.some(option => option.value === grouped.id && option.text?.startsWith('Resubmission after ')));
  await relationship.selectOption(grouped.id);
  await confirmImport(page);
  const attemptsAfterResubmission = await waitForCount(page, 'markingAttempts', 2);
  const resubmission = attemptsAfterResubmission.find(row => row.id !== grouped.id)!;
  assert.equal(resubmission.previousAttemptId, grouped.id); assert.equal(resubmission.classEnrollmentId, grouped.classEnrollmentId);
  assert.deepEqual(attemptsAfterResubmission.find(row => row.id === grouped.id), grouped, 'resubmission must not mutate its predecessor');
  await page.getByTestId(`marking-session-open-${resubmission.id}`).click();
  await page.getByTestId('marking-document').filter({ hasText: resubmission.documents[0].text }).waitFor();
  assert.equal(await page.getByTestId('marking-document').innerText(), resubmission.documents[0].text);
  assert.equal(await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), '');
  await page.getByTestId(`marking-session-open-${grouped.id}`).click();
  await page.getByTestId('marking-document').filter({ hasText: grouped.documents[0].text }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), originalSession.draft.overallFeedback);
  await page.reload();
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByTestId(`marking-session-open-${grouped.id}`).click();
  await page.getByTestId('marking-document').filter({ hasText: grouped.documents[0].text }).waitFor();
  assert.deepEqual((await records(page, 'markingSessions')).find(row => row.attemptId === grouped.id), originalSession);
  assert.equal(await page.getByTestId(`marking-session-open-${resubmission.id}`).count(), 1);
  await page.screenshot({ path: '/tmp/markinator-input-grouped-resubmission.png', fullPage: true });
  console.log('PASS: grouped TXT attachments retain originals and isolated comments; explicit same-student resubmission creates linked attempt; predecessor feedback and both queue entries survive reload.');

  // File-read failure is a browser-file boundary injection. It creates no records
  // and retains the real parser for the good, malformed and unsupported files.
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    (window as any).restoreMarkingFileRead = () => { File.prototype.arrayBuffer = original; };
    let failedOriginal: File | undefined;
    File.prototype.arrayBuffer = function () {
      if (this.name === 'Fictional unreadable.txt' && (!failedOriginal || failedOriginal === this)) { failedOriginal = this; return Promise.reject(new DOMException('Fictional file read failure', 'NotReadableError')); }
      return original.call(this);
    };
  });
  await addDocumentFiles(page, [
    txt('Fictional valid remainder.txt', 'Valid fictional remainder for mixed parsing.'),
    { name: 'Fictional malformed.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not a ZIP archive') },
    { name: 'Fictional unsupported.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fictional') },
    { name: 'Fictional bad-encoding.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]) },
    txt('Fictional unreadable.txt', 'Browser file read deliberately fails.'),
    txt('Fictional unreadable.txt', 'Another file with different contents.')
  ]);
  await wizard(page).getByText('These files were not added', { exact: true }).waitFor();
  const importErrors = await wizard(page).innerText();
  for (const filename of ['Fictional malformed.docx', 'Fictional unsupported.pdf', 'Fictional bad-encoding.txt', 'Fictional unreadable.txt']) assert.ok(importErrors.includes(filename));
  assert.match(importErrors, /valid UTF-8/); assert.match(importErrors, /PDF, HTML and remote links are not supported/);
  assert.match(await wizard(page).innerText(), /2 work item\(s\) added/);
  const retry = wizard(page).getByRole('button', { name: 'Retry Fictional unreadable.txt', exact: true });
  await retry.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="evidence-import-wizard"]')?.getAttribute('aria-busy') === 'false');
  assert.equal(await retry.count(), 1, 'repeat failure keeps exactly one original-file warning');
  await wizard(page).getByRole('button', { name: 'Back', exact: true }).click();
  await wizard(page).getByLabel('Choose text/document files', { exact: true }).setInputFiles(txt('Fictional unreadable.txt', 'Another file with different contents.'));
  await wizard(page).getByRole('button', { name: 'Add work and select students', exact: true }).click();
  await wizard(page).getByRole('heading', { name: 'Who does this work belong to?', exact: true }).waitFor();
  assert.equal(await retry.count(), 1, 'successful distinct same-name file cannot clear failed-original warning');
  assert.match(await wizard(page).innerText(), /2 work item\(s\) added/);
  assert.equal((await records(page, 'markingAttempts')).length, 2, 'file preview cannot persist partial data');
  await page.evaluate(() => { (window as any).restoreMarkingFileRead(); delete (window as any).restoreMarkingFileRead; });
  await retry.click();
  await retry.waitFor({ state: 'detached' });
  assert.match(await wizard(page).innerText(), /3 work item\(s\) added/);
  assert.equal(await wizard(page).getByRole('button', { name: /Confirm student and review work|Continue to matching/ }).isDisabled(), true, 'other failures still require acknowledgment');
  await page.screenshot({ path: '/tmp/markinator-input-malformed.png', fullPage: true });
  await wizard(page).getByRole('checkbox', { name: 'Continue with only the work successfully added; leave these files out.', exact: true }).check();
  await selectOneStudent(page, studentLabels[enrollmentIds[1]]);
  await confirmImport(page);
  await waitForCount(page, 'markingAttempts', 3);
  console.log('PASS: malformed DOCX, unsupported PDF, invalid UTF-8 and browser file-read failures produce named errors; valid remainder alone imports after roster confirmation.');

  // Fail the second import's audit write inside its real transaction, after its
  // attempt write. It must roll back while the first import remains committed;
  // retry must create the failed attempt and audit exactly once.
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await addDocumentFiles(page, [
    txt('Fictional retry-first.txt', 'First successful fictional batch item.'),
    txt('Fictional retry-second.txt', 'Second fictional batch item fails once.')
  ]);
  await matchSeveralStudents(page, [
    { filename: 'Fictional retry-first.txt', label: studentLabels[enrollmentIds[0]] },
    { filename: 'Fictional retry-second.txt', label: studentLabels[enrollmentIds[1]] },
  ]);
  await page.evaluate(async () => {
    const databasePath = '/src/db/database.ts';
    const { db } = await import(databasePath);
    const original = db.auditEntries.add;
    (window as any).restoreMarkingImport = () => { db.auditEntries.add = original; };
    db.auditEntries.add = async function (entry: any, ...args: any[]) {
      if (entry.entityName === 'markingAttempts' && JSON.parse(entry.newStateJson).documents.some((document: any) => document.name === 'Fictional retry-second.txt')) {
        throw new DOMException('Fictional second import storage failure', 'QuotaExceededError');
      }
      return original.call(this, entry, ...args);
    };
  });
  await confirmImport(page);
  await page.getByRole('alert').filter({ hasText: 'Fictional second import storage failure' }).waitFor();
  const partial = await waitForCount(page, 'markingAttempts', 4);
  assert.equal(partial.filter(row => row.documents.some((doc: any) => doc.name === 'Fictional retry-first.txt')).length, 1);
  assert.equal(partial.filter(row => row.documents.some((doc: any) => doc.name === 'Fictional retry-second.txt')).length, 0);
  const importAudits = (rows: any[], filename: string) => rows.filter(row => row.entityName === 'markingAttempts' && row.action === 'INSERT' && JSON.parse(row.newStateJson).documents.some((document: any) => document.name === filename));
  const partialAudits = await records(page, 'auditEntries');
  assert.equal(importAudits(partialAudits, 'Fictional retry-first.txt').length, 1);
  assert.equal(importAudits(partialAudits, 'Fictional retry-second.txt').length, 0);
  const reviewCards = wizard(page).locator('article');
  assert.match(await reviewCards.filter({ hasText: 'Fictional retry-first.txt' }).innerText(), /Saved locally/, 'successful item is visibly saved and excluded from retry writes');
  assert.ok((await reviewCards.filter({ hasText: 'Fictional retry-second.txt' }).innerText()).includes(studentLabels[enrollmentIds[1]]), 'failed item retains its roster decision');
  await page.screenshot({ path: '/tmp/markinator-input-partial-retry.png', fullPage: true });
  await page.evaluate(() => { (window as any).restoreMarkingImport(); delete (window as any).restoreMarkingImport; });
  await confirmImport(page, true);
  const retried = await waitForCount(page, 'markingAttempts', 5);
  const retriedAudits = await records(page, 'auditEntries');
  for (const filename of ['Fictional retry-first.txt', 'Fictional retry-second.txt']) {
    assert.equal(retried.filter(row => row.documents.some((doc: any) => doc.name === filename)).length, 1);
    assert.equal(importAudits(retriedAudits, filename).length, 1);
  }
  assert.deepEqual(retried.find(row => row.id === grouped.id), grouped);
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await addDocumentFiles(page, txt('Fictional retry-first.txt', 'First successful fictional batch item.'));
  await selectOneStudent(page, studentLabels[enrollmentIds[0]]);
  await confirmImport(page);
  await page.getByRole('alert').filter({ hasText: 'This exact submission is already imported' }).waitFor();
  assert.equal((await records(page, 'markingAttempts')).length, 5);
  assert.deepEqual({ assessments: await records(page, 'studentAssessments'), results: await records(page, 'categoryResults'), commits: await records(page, 'markingCommits') }, officialBefore, 'all input acceptance workflows leave official records unchanged');
  assert.deepEqual(errors, [], 'browser exceptions'); assert.deepEqual(external, [], 'external requests');
  console.log('PASS: later-item storage failure preserves earlier atomic import and pending student match; retry imports only remaining item; duplicate reimport rejected; official records unchanged, zero external requests or browser exceptions.');
} finally {
  await browser.close(); await server.close();
}
