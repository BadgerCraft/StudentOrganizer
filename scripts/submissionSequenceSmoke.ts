import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { chromium, type Page } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { revealRubricPaste, chooseOfficialLevel, showFinalOverview } from './helpers/classroomMarkingUi';

// Production build only. A disposable context contains fictional fixture rows;
// only two additional attempts are injected. All saving/navigation uses the UI.
const origin = 'http://127.0.0.1:4206';
const output = '/tmp/studentorganizer-submission-sequence';
mkdirSync(output, { recursive: true });
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
const server = await preview({ preview: { host: '127.0.0.1', port: 4206, strictPort: true } });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(`${origin}/`)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Markbook', exact: true }).click();
  await page.getByRole('button', { name: 'Create Assignment', exact: true }).click();
  const title = 'Fictional submission sequence';
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  await page.locator('[data-testid^="open-marking-"]').first().waitFor();
  let assessment: any;
  for (let retry = 0; retry < 50; retry++) {
    assessment = (await records(page, 'assessments')).find(row => row.title === title);
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment);
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await revealRubricPaste(page);
  await page.getByTestId('marking-rubric-paste').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited\tSome\tClear\tThorough');
  await page.getByTestId('marking-rubric-preview').click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional sequence rubric');
  await page.getByLabel('Criterion 1 KTCA mapping').selectOption('T');
  await page.getByTestId('marking-rubric-confirm').check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();
  await page.getByTestId('marking-import-mode').selectOption('rubric');
  const students = await page.getByTestId('marking-mode-student').locator('option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, label: node.textContent })).filter(row => row.value));
  assert.ok(students.length >= 2);
  await page.getByTestId('marking-mode-student').selectOption(students[0].value);
  await page.getByTestId('marking-mode-create').click();
  await page.getByRole('region', { name: 'Marking session', exact: true }).waitFor();
  const first = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id);
  assert.ok(first);
  const second = { ...first, id: `${first.id}-sequence-2` };
  const third = { ...first, id: `${first.id}-sequence-3`, classEnrollmentId: students[1].value };
  await page.evaluate(rows => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('markingAttempts', 'readwrite');
      for (const row of rows) tx.objectStore('markingAttempts').add(row);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), [second, third]);
  // Reload observes fixture additions without depending on Dexie's cross-tab events.
  await page.reload(); await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
  const queue = page.locator('[data-testid^="marking-session-open-"]');
  await queue.first().waitFor();
  assert.deepEqual(await queue.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!.replace('marking-session-open-', ''))), [first.id, second.id, third.id]);
  await page.getByTestId(`marking-session-open-${first.id}`).click();
  const session = page.getByRole('region', { name: 'Marking session', exact: true });
  const next = page.getByRole('button', { name: 'Save and next submission', exact: true });
  assert.equal(await page.getByRole('button', { name: 'Save and next student', exact: true }).count(), 0);
  const commits: string[] = [];
  for (const [index, attempt] of [first, second, third].entries()) {
    await session.getByRole('heading', { name: students[index < 2 ? 0 : 1].label!, exact: true }).waitFor();
    await chooseOfficialLevel(page, 'T', ['2', '3', '3+'][index]);
    await showFinalOverview(page);
    await page.getByLabel('Overall student-facing feedback').fill(`Fictional submission ${index + 1} feedback`);
    await next.click();
    if (index === 2) await page.getByTestId('marking-save-status').filter({ hasText: 'No next submission in this queue.' }).waitFor();
    else {
      await page.waitForFunction(id => (document.querySelector('[aria-label="Current submission"]') as HTMLSelectElement | null)?.value === id, [second, third][index].id);
      await showFinalOverview(page);
      assert.equal(await page.getByLabel('Overall student-facing feedback').inputValue(), '');
    }
    const saved = (await records(page, 'markingCommits')).filter(row => row.assessmentId === assessment.id);
    assert.equal(saved.length, index + 1);
    assert.ok(saved.some(row => row.attemptId === attempt.id), 'save must finalize the current submission in queue order');
    const savedSession = (await records(page, 'markingSessions')).find(row => row.attemptId === attempt.id);
    assert.equal(savedSession.status, 'finalized');
    assert.equal(savedSession.draft.overallFeedback, `Fictional submission ${index + 1} feedback`);
    commits.push(attempt.id);
    await page.screenshot({ path: `${output}/after-save-${index + 1}.png`, fullPage: true });
  }
  assert.equal(await session.getByRole('button', { name: 'Next submission', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const evidence = { result: 'PASS', origin, build: 'Vite production preview', tested: ['exact Save and next submission wording', 'same student consecutive submissions', 'existing queue order first → second → third', 'UI finalization with persisted feedback and commit per attempt', 'third submission belongs to another student', 'final submission stays open with no-next status and disabled forward navigation'], committedAttemptIds: commits, browserErrors: errors, externalRequests: external };
  writeFileSync(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
