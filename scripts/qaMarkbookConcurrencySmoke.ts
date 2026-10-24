import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';

const origin = 'http://127.0.0.1:4270';
const server = await createServer({ server: { host: '127.0.0.1', port: 4270, strictPort: true, watch: null, hmr: false },
  cacheDir: 'node_modules/.vite-qa-markbook-concurrency' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/db/database.ts';
    const { db } = await import(/* @vite-ignore */ modulePath);
    return Object.fromEntries(await Promise.all(['studentAssessments', 'categoryResults', 'auditEntries', 'syncMutations'].map(async name => [name, await db.table(name).toArray()])));
  });
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await page.goto(origin);
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();

  for (const initiallyAbsent of [false, true]) {
    const ids = await page.evaluate(async absent => {
      const modulePath = '/src/db/database.ts';
      const { db } = await import(/* @vite-ignore */ modulePath);
      const sa = await db.studentAssessments.where('assessmentId').equals('assess-eng-essay').first();
      const cr = await db.categoryResults.where('studentAssessmentId').equals(sa.id).first();
      if (absent) await db.transaction('rw', [db.studentAssessments, db.categoryResults], async () => {
        await db.categoryResults.where('studentAssessmentId').equals(sa.id).delete();
        await db.studentAssessments.delete(sa.id);
      });
      return { enrollment: sa.classEnrollmentId, category: cr.assessmentCategoryId, assessment: sa.assessmentId, section: sa.classSectionId };
    }, initiallyAbsent);
    const cell = page.getByTestId(`markbook-cell-${ids.enrollment}-${ids.category}`);
    if (initiallyAbsent) await page.waitForFunction(({ enrollment, category }) => document.querySelector(`[data-testid="markbook-cell-${enrollment}-${category}"]`)?.textContent?.includes('Unassessed'), ids);
    await cell.click();
    if (initiallyAbsent) await page.getByRole('button', { name: '3', exact: true }).click();
    else await page.getByRole('textbox', { name: 'Existing result', exact: true }).fill('3+');
    const feedback = page.getByPlaceholder('Optional constructive feedback for this category...');
    await feedback.fill('Retained unsaved fictional feedback');

    await page.evaluate(async ids => {
      const databasePath = '/src/db/database.ts', servicePath = '/src/services/markbookService.ts', identityPath = '/src/services/identityService.ts';
      const { db } = await import(/* @vite-ignore */ databasePath);
      const { MarkbookDomainService } = await import(/* @vite-ignore */ servicePath);
      const { getAppIdentity } = await import(/* @vite-ignore */ identityPath);
      await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: ids.assessment, classSectionId: ids.section,
        classEnrollmentId: ids.enrollment, assessmentCategoryId: ids.category, rawScore: '90', inputFormat: 'percentage',
        feedback: 'Newer official fictional feedback', ...(await getAppIdentity(db)) });
    }, ids);
    // Confirm the real live-query props have refreshed while the old editor stays open.
    await page.waitForFunction(({ enrollment, category }) => document.querySelector(`[data-testid="markbook-cell-${enrollment}-${category}"]`)?.textContent?.includes('Direct mark'), ids);
    const before = await snapshot(page);
    await page.getByRole('button', { name: 'Save Result', exact: true }).click();
    await page.getByText('This mark changed after the editor opened.', { exact: false }).waitFor();
    assert.equal(await feedback.inputValue(), 'Retained unsaved fictional feedback');
    assert.deepEqual(await snapshot(page), before, 'conflict must preserve newer scores, feedback, audit and outbox');

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cell.click();
    const currentInput = page.getByRole('textbox', { name: 'Existing result', exact: true });
    assert.equal(await currentInput.inputValue(), '90');
    assert.equal(await feedback.inputValue(), 'Newer official fictional feedback');
    await currentInput.fill('85');
    await page.getByRole('button', { name: 'Save Result', exact: true }).click();
    await currentInput.waitFor({ state: 'hidden' });
    const after = await snapshot(page);
    const savedAssignment = (after.studentAssessments as Array<{id: string; assessmentId: string; classEnrollmentId: string}>)
      .find(row => row.assessmentId === ids.assessment && row.classEnrollmentId === ids.enrollment);
    assert.ok(savedAssignment);
    const savedResult = (after.categoryResults as Array<{studentAssessmentId: string; assessmentCategoryId: string; rawScore: string; feedback: string}>)
      .find(row => row.studentAssessmentId === savedAssignment.id && row.assessmentCategoryId === ids.category);
    assert.ok(savedResult);
    assert.equal(savedResult.rawScore, '85');
    assert.equal(savedResult.feedback, 'Newer official fictional feedback');
    console.log(`PASS: ${initiallyAbsent ? 'Absent' : 'Existing'} editor baseline rejects a competing write, retains the draft, and saves only after explicit reopen/review.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
