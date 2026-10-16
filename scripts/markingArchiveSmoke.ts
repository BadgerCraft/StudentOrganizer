import { installFictionalClassroom } from './helpers/classroomFixture';
import { importDocumentsForStudents, chooseOfficialLevel, revealRubricPaste } from './helpers/classroomMarkingUi';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium, type Page } from 'playwright';

// Fictional data only. All successful writes use visible UI; IndexedDB is read-only.
const port = 4201, origin = `http://127.0.0.1:${port}`;
const artifacts = '/tmp/markinator-archive';
const removedSource = 'UNIQUE_FICTIONAL_ARCHIVE_SOURCE_TO_REMOVE';
const retainedSource = 'UNIQUE_FICTIONAL_EXEMPLAR_SOURCE_TO_KEEP';
const errors: string[] = [], external: string[] = [];
const scenarios: string[] = [];
async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(table, 'readonly');
      const read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), table);
}
async function waitRecord(page: Page, table: string, predicate: (row: any) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = (await records(page, table)).find(predicate);
    if (row) return row;
    await page.waitForTimeout(100);
  }
  throw new Error(`Expected fictional ${table} row was not persisted.`);
}
async function selectText(page: Page, length: number) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Save now' && button.matches(':enabled')));
  await page.getByTestId('marking-document').evaluate((root, length) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node = walk.nextNode();
    if (!node || (node.textContent?.length ?? 0) < length) throw new Error('Missing fictional selection');
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, length);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, length);
}
async function official(page: Page, assessmentId: string) {
  const assessments = (await records(page, 'studentAssessments')).filter(row => row.assessmentId === assessmentId);
  const ids = new Set(assessments.map(row => row.id));
  return { assessments, results: (await records(page, 'categoryResults')).filter(row => ids.has(row.studentAssessmentId)) };
}
const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin); await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.waitForFunction(() => !!sessionStorage.getItem('ontario_active_user_id'));
  const actorId = await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
  assert.ok(actorId, 'fictional teacher explicitly selected');
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill('Fictional Archive Acceptance');
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  const assessment = await waitRecord(page, 'assessments', row => row.title === 'Fictional Archive Acceptance');
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await revealRubricPaste(page); await page.getByTestId('marking-rubric-paste').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nReasoning\tLimited\tSome\tClear\tThorough');
  await page.getByTestId('marking-rubric-preview').click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional Archive Rubric');
  await page.getByLabel('Criterion 1 KTCA mapping').selectOption('T');
  await page.getByTestId('marking-rubric-confirm').check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();
  const students = await importDocumentsForStudents(page, [
    { name: 'Fictional-remove.txt', mimeType: 'text/plain', buffer: Buffer.from(removedSource) },
    { name: 'Fictional-keep.txt', mimeType: 'text/plain', buffer: Buffer.from(retainedSource) }
  ]);
  const first = await waitRecord(page, 'markingAttempts', row => row.assessmentId === assessment.id && row.classEnrollmentId === students[0].value);
  const second = await waitRecord(page, 'markingAttempts', row => row.assessmentId === assessment.id && row.classEnrollmentId === students[1].value);
  for (const [attempt, source, keep] of [[first, removedSource, false], [second, retainedSource, true]] as const) {
    await page.getByTestId(`marking-session-open-${attempt.id}`).click();
    await page.getByTestId('marking-document').waitFor();
    await selectText(page, source.length);
    await page.getByTestId('marking-feedback').fill('Fictional teacher passage feedback retained after archive.');
    await page.getByTestId('marking-comment-save').click();
    await chooseOfficialLevel(page, 'T', '3+');
    await page.getByLabel('Category T feedback').fill('Fictional archived category feedback.');
    await page.getByLabel('Overall student-facing feedback').fill('Fictional archived overall feedback.');
    await page.getByRole('button', { name: 'Save now', exact: true }).click();
    await page.getByTestId('marking-save-status').filter({ hasText: 'Saved locally' }).waitFor();
    await page.getByTestId('marking-finalize-preview').click();
    await page.getByTestId('marking-finalize-confirm').click();
    await page.getByText('Finalized revision — current official results shown below', { exact: false }).waitFor();
    const checkbox = page.getByRole('checkbox', { name: `Keep student work for ${attempt.id}`, exact: true });
    assert.equal(await checkbox.isChecked(), false, 'retention is off by default');
    const grades = await official(page, assessment.id);
    const beforeCancel = await records(page, 'markingAttempts');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByTestId(`marking-archive-${attempt.id}`).click();
    assert.deepEqual(await records(page, 'markingAttempts'), beforeCancel, 'cancel archive changes no attempt');
    assert.deepEqual(await official(page, assessment.id), grades);
    if (keep) {
      // This controlled value changes only after the local transaction/readback.
      await checkbox.click();
      await waitRecord(page, 'markingAttempts', row => row.id === attempt.id && row.keepStudentWork === true);
      await page.waitForFunction(id => (document.querySelector(`[aria-label="Keep student work for ${id}"]`) as HTMLInputElement | null)?.checked === true, attempt.id);
      const exportDownload = page.waitForEvent('download');
      await page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).last().click();
      await (await exportDownload).saveAs(`${artifacts}-retained-report.html`);
      assert.ok((await records(page, 'markingAttempts')).find(row => row.id === attempt.id).documents.length, 'export does not remove source');
    }
    page.once('dialog', async dialog => {
      assert.match(dialog.message(), keep ? /keep its submitted work/ : /permanently remove/);
      await dialog.accept();
    });
    await page.getByTestId(`marking-archive-${attempt.id}`).click();
    const archivedCard = page.getByTestId(`marking-archived-${attempt.id}`); await archivedCard.waitFor();
    assert.ok((await archivedCard.innerText()).includes(students[keep ? 1 : 0].label), 'archive retains the matched student name');
    assert.match(await archivedCard.innerText(), keep ? /Student work retained/ : /Student work removed/);
    await archivedCard.locator('summary').first().click();
    assert.match(await archivedCard.innerText(), /Fictional archived overall feedback/);
    assert.match(await archivedCard.innerText(), /T: 3\+/);
    if (!keep) assert.match(await archivedCard.innerText(), /Fictional teacher passage feedback retained/);
    assert.equal(await archivedCard.getByRole('textbox').count(), 0, 'archive is read-only');
    assert.equal(await page.getByTestId(`marking-session-open-${attempt.id}`).count(), 0);
    assert.deepEqual(await official(page, assessment.id), grades, 'archiving preserves official grades');
    const stored = (await records(page, 'markingAttempts')).find(row => row.id === attempt.id);
    assert.equal(!!stored.archivedAt, true);
    assert.equal(stored.documents.length, keep ? 1 : 0);
    scenarios.push(`${keep ? 'Explicit retain' : 'Default removal'}: UI matching/marking/finalization, cancel safety, archive names/feedback/marks/read-only, official grade preservation`);
    if (!keep) await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
  }
  const beforeRestart = await records(page, 'markingAttempts');
  await page.reload();
  await page.getByTestId('header-teacher-btn').waitFor();
  assert.equal(await page.getByTestId('teacher-selector-modal').count(), 0, 'reload retains the explicitly selected session');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), actorId);
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByTestId(`marking-archived-${first.id}`).waitFor();
  await page.getByTestId(`marking-archived-${second.id}`).waitFor();
  assert.deepEqual(await records(page, 'markingAttempts'), beforeRestart);
  scenarios.push('Reload retains the explicit teacher session and preserves separate Archive listing');
  await page.screenshot({ path: `${artifacts}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId('nav-portability-btn').click();
  const download = page.waitForEvent('download'); await page.getByTestId('create-backup-btn').click();
  await (await download).saveAs(`${artifacts}-backup.json`);
  const backupText = await readFile(`${artifacts}-backup.json`, 'utf8');
  assert.doesNotMatch(backupText, new RegExp(removedSource));
  assert.ok(!backupText.includes(Buffer.from(removedSource).toString('base64')), 'removed original bytes absent even from audit snapshots');
  assert.ok(backupText.includes(retainedSource), 'explicit exemplar original is retained');
  const backup = JSON.parse(backupText);
  assert.equal(backup.tables.markingAttempts.filter((row: any) => row.assessmentId === assessment.id && row.archivedAt).length, 2);
  scenarios.push('Actual downloaded backup contains no removed source text/base64; deliberately kept source remains');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(`${artifacts}-results.json`, JSON.stringify({ status: 'pass', scenarios, browserErrors: errors, externalRequests: external, nativeDeviceVerified: false }, null, 2));
  console.log(`PASS: ${scenarios.join('; ')}.`);
} catch (error) {
  await writeFile(`${artifacts}-results.json`, JSON.stringify({ status: 'fail', scenarios, failure: error instanceof Error ? error.stack : String(error), browserErrors: errors, externalRequests: external }, null, 2));
  if (page) await page.screenshot({ path: `${artifacts}-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.httpServer!.close(() => resolve()));
}
