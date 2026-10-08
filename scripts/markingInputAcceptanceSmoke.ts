import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';

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
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();

  // Build every matrix cell manually. A duplicate column rename must reject the
  // edit without moving, overwriting or dropping any descriptor.
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional manual descriptor matrix');
  await page.getByLabel('Criterion 1 name', { exact: true }).fill('Evidence');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByRole('button', { name: 'Add criterion', exact: true }).click();
  await page.getByLabel('Criterion 2 name', { exact: true }).fill('Organization');
  await page.getByLabel('Criterion 2 KTAC mapping').selectOption('C');
  const oldLevels = ['Level 1', 'Level 2', 'Level 3', 'Level 4'];
  const descriptor = (criterion: string, index: number) => `${criterion}: fictional descriptor ${index + 1}; retain this exact text.`;
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of oldLevels.entries()) await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).fill(descriptor(criterion, index));
  }
  await page.getByLabel('Achievement label 1', { exact: true }).fill('Level 2');
  await page.getByRole('alert').filter({ hasText: 'Each achievement label must be unique' }).waitFor();
  assert.equal(await page.getByLabel('Achievement label 1', { exact: true }).inputValue(), 'Level 1');
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of oldLevels.entries()) assert.equal(await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).inputValue(), descriptor(criterion, index));
  }
  await page.screenshot({ path: '/tmp/markinator-input-duplicate-label.png', fullPage: true });
  const levels = ['Beginning', 'Developing', 'Proficient', 'Extending'];
  for (const [index, label] of levels.entries()) await page.getByLabel(`Achievement label ${index + 1}`, { exact: true }).fill(label);
  // A malformed pasted table must not destroy the manual matrix already entered.
  await page.getByLabel('Paste rubric text or table').fill('Criterion\tDuplicate\tDuplicate\nReasoning\tFirst\tSecond');
  await page.getByRole('button', { name: 'Preview pasted rubric', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /distinct achievement labels/i }).waitFor();
  for (const criterion of ['Evidence', 'Organization']) {
    for (const [index, label] of levels.entries()) assert.equal(await page.getByLabel(`${criterion} ${label} descriptor`, { exact: true }).inputValue(), descriptor(criterion, index));
  }
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).click();
  await page.getByTestId('marking-files').waitFor();
  const [rubric] = await waitForCount(page, 'markingRubrics', 1);
  assert.deepEqual(rubric.levels, levels);
  assert.deepEqual(rubric.criteria.map((row: any) => ({ name: row.name, categoryCode: row.categoryCode, descriptors: row.descriptors })), [
    { name: 'Evidence', categoryCode: 'T', descriptors: Object.fromEntries(levels.map((label, index) => [label, descriptor('Evidence', index)])) },
    { name: 'Organization', categoryCode: 'C', descriptors: Object.fromEntries(levels.map((label, index) => [label, descriptor('Organization', index)])) }
  ]);
  console.log('PASS: manually entered complete 2×4 rubric matrix; duplicate achievement label and malformed pasted rubric rejected without descriptor loss; corrected custom labels persist.');

  const firstFile = txt('Fictional essay.txt', 'Essay passage. Fictional reasoning follows.');
  const secondFile = txt('Fictional notes.txt', 'Notes passage. Fictional planning follows.');
  await page.getByTestId('marking-files').setInputFiles([firstFile, secondFile]);
  await page.getByRole('checkbox', { name: /Keep all these files as separate attachments/ }).check();
  const match = page.getByLabel('Confirm student for Fictional essay.txt');
  await match.waitFor();
  const enrollmentIds = await match.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  assert.ok(enrollmentIds.length >= 2);
  await match.selectOption(enrollmentIds[0]);
  assert.equal(await page.getByLabel('Confirm student for Fictional notes.txt').count(), 0);
  await page.getByTestId('marking-import-confirm').click();
  const [grouped] = await waitForCount(page, 'markingAttempts', 1);
  assert.equal(grouped.classEnrollmentId, enrollmentIds[0]); assert.equal(grouped.previousAttemptId, null);
  assert.deepEqual(grouped.documents.map((row: any) => row.name), [firstFile.name, secondFile.name]);
  for (const [index, document] of grouped.documents.entries()) {
    assert.equal(document.original?.base64, [firstFile, secondFile][index].buffer.toString('base64'), 'original attachment bytes retained exactly');
  }
  await page.getByTestId(`marking-session-open-${grouped.id}`).click();
  await page.getByTestId('marking-document').waitFor();
  const documentSelect = page.getByRole('combobox', { name: /^Document/ });
  for (const [index, document] of grouped.documents.entries()) {
    await documentSelect.selectOption(document.id);
    assert.equal(await page.getByTestId('marking-document').innerText(), document.text);
    await selectPassage(page, 0, 13);
    await page.getByTestId('marking-feedback').fill(`Fictional attachment feedback ${index + 1}`);
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

  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await page.getByTestId('marking-files').setInputFiles(txt('Fictional revised essay.txt', 'Revised fictional argument, with new reasoning.'));
  await page.getByLabel('Confirm student for Fictional revised essay.txt').selectOption(enrollmentIds[0]);
  const relationship = page.getByRole('combobox', { name: /^Attempt relationship/ });
  const relationshipOptions = await relationship.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, text: node.textContent })));
  assert.ok(relationshipOptions.some(option => option.value === grouped.id && option.text?.startsWith('Resubmission after ')));
  await relationship.selectOption(grouped.id);
  await page.getByTestId('marking-import-confirm').click();
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
  await page.getByRole('checkbox', { name: /Keep all these files as separate attachments/ }).uncheck();
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    (window as any).restoreMarkingFileRead = () => { File.prototype.arrayBuffer = original; };
    File.prototype.arrayBuffer = function () {
      if (this.name === 'Fictional unreadable.txt') return Promise.reject(new DOMException('Fictional file read failure', 'NotReadableError'));
      return original.call(this);
    };
  });
  await page.getByTestId('marking-files').setInputFiles([
    txt('Fictional valid remainder.txt', 'Valid fictional remainder for mixed parsing.'),
    { name: 'Fictional malformed.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not a ZIP archive') },
    { name: 'Fictional unsupported.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fictional') },
    { name: 'Fictional bad-encoding.txt', mimeType: 'text/plain', buffer: Buffer.from([0xc3, 0x28]) },
    txt('Fictional unreadable.txt', 'Browser file read deliberately fails.')
  ]);
  await page.getByRole('alert').filter({ hasText: 'Fictional file read failure' }).waitFor();
  const importErrors = await page.getByRole('alert').filter({ hasText: 'Fictional file read failure' }).innerText();
  for (const filename of ['Fictional malformed.docx', 'Fictional unsupported.pdf', 'Fictional bad-encoding.txt', 'Fictional unreadable.txt']) assert.ok(importErrors.includes(filename));
  assert.match(importErrors, /valid UTF-8/); assert.match(importErrors, /PDF, HTML and remote links are not supported/);
  assert.equal(await page.getByRole('combobox', { name: /^Confirm student for / }).count(), 1);
  assert.equal((await records(page, 'markingAttempts')).length, 2, 'file preview cannot persist partial data');
  await page.evaluate(() => { (window as any).restoreMarkingFileRead(); delete (window as any).restoreMarkingFileRead; });
  await page.screenshot({ path: '/tmp/markinator-input-malformed.png', fullPage: true });
  await page.getByLabel('Confirm student for Fictional valid remainder.txt').selectOption(enrollmentIds[1]);
  await page.getByTestId('marking-import-confirm').click();
  await waitForCount(page, 'markingAttempts', 3);
  console.log('PASS: malformed DOCX, unsupported PDF, invalid UTF-8 and browser file-read failures produce named errors; valid remainder alone imports after roster confirmation.');

  // Fail the second import's audit write inside its real transaction, after its
  // attempt write. It must roll back while the first import remains committed;
  // retry must create the failed attempt and audit exactly once.
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await page.getByTestId('marking-files').setInputFiles([
    txt('Fictional retry-first.txt', 'First successful fictional batch item.'),
    txt('Fictional retry-second.txt', 'Second fictional batch item fails once.')
  ]);
  await page.getByLabel('Confirm student for Fictional retry-first.txt').selectOption(enrollmentIds[0]);
  await page.getByLabel('Confirm student for Fictional retry-second.txt').selectOption(enrollmentIds[1]);
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
  await page.getByTestId('marking-import-confirm').click();
  await page.getByRole('alert').filter({ hasText: 'Fictional second import storage failure' }).waitFor();
  const partial = await waitForCount(page, 'markingAttempts', 4);
  assert.equal(partial.filter(row => row.documents.some((doc: any) => doc.name === 'Fictional retry-first.txt')).length, 1);
  assert.equal(partial.filter(row => row.documents.some((doc: any) => doc.name === 'Fictional retry-second.txt')).length, 0);
  const importAudits = (rows: any[], filename: string) => rows.filter(row => row.entityName === 'markingAttempts' && row.action === 'INSERT' && JSON.parse(row.newStateJson).documents.some((document: any) => document.name === filename));
  const partialAudits = await records(page, 'auditEntries');
  assert.equal(importAudits(partialAudits, 'Fictional retry-first.txt').length, 1);
  assert.equal(importAudits(partialAudits, 'Fictional retry-second.txt').length, 0);
  assert.equal(await page.getByLabel('Confirm student for Fictional retry-first.txt').count(), 0, 'successful item leaves pending preview');
  assert.equal(await page.getByLabel('Confirm student for Fictional retry-second.txt').inputValue(), enrollmentIds[1], 'failed item retains its roster decision');
  await page.screenshot({ path: '/tmp/markinator-input-partial-retry.png', fullPage: true });
  await page.evaluate(() => { (window as any).restoreMarkingImport(); delete (window as any).restoreMarkingImport; });
  await page.getByTestId('marking-import-confirm').click();
  const retried = await waitForCount(page, 'markingAttempts', 5);
  const retriedAudits = await records(page, 'auditEntries');
  for (const filename of ['Fictional retry-first.txt', 'Fictional retry-second.txt']) {
    assert.equal(retried.filter(row => row.documents.some((doc: any) => doc.name === filename)).length, 1);
    assert.equal(importAudits(retriedAudits, filename).length, 1);
  }
  assert.deepEqual(retried.find(row => row.id === grouped.id), grouped);
  await page.getByRole('button', { name: 'Import submissions', exact: true }).click();
  await page.getByTestId('marking-files').setInputFiles(txt('Fictional retry-first.txt', 'First successful fictional batch item.'));
  await page.getByLabel('Confirm student for Fictional retry-first.txt').selectOption(enrollmentIds[0]);
  await page.getByTestId('marking-import-confirm').click();
  await page.getByRole('alert').filter({ hasText: 'This exact submission is already imported' }).waitFor();
  assert.equal((await records(page, 'markingAttempts')).length, 5);
  assert.deepEqual({ assessments: await records(page, 'studentAssessments'), results: await records(page, 'categoryResults'), commits: await records(page, 'markingCommits') }, officialBefore, 'all input acceptance workflows leave official records unchanged');
  assert.deepEqual(errors, [], 'browser exceptions'); assert.deepEqual(external, [], 'external requests');
  console.log('PASS: later-item storage failure preserves earlier atomic import and pending student match; retry imports only remaining item; duplicate reimport rejected; official records unchanged, zero external requests or browser exceptions.');
} finally {
  await browser.close(); await server.close();
}
