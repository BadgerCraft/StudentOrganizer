import { preview } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { installFictionalClassroom } from './helpers/classroomFixture';

// Exercise the production build with disposable fictional profiles.
const server = process.env.TEACHER_PROFILE_SMOKE_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4222, strictPort: true } });
const origin = process.env.TEACHER_PROFILE_SMOKE_URL || 'http://127.0.0.1:4222';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(origin);
  await page.getByLabel('Teacher name', { exact: true }).fill('Avery Fictional');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  const openSettings = async () => {
    await page.getByTestId('card-display-settings-btn').click();
    await page.getByTestId('card-display-settings-modal').waitFor();
  };
  const saveSettings = async () => {
    await page.getByTestId('save-card-display-btn').click();
    await page.getByTestId('card-display-settings-modal').waitFor({ state: 'hidden' });
  };
  await openSettings();
  await page.getByTestId('title-format-code-only').check();
  await saveSettings();
  await openSettings();
  assert.equal(await page.getByTestId('title-format-code-only').isChecked(), true);
  await saveSettings();
  await page.getByTestId('header-teacher-btn').click();
  await page.getByRole('button', { name: 'Add another teacher', exact: true }).click();
  await page.getByLabel('Teacher name', { exact: true }).fill('Blair Fictional');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  await openSettings();
  assert.equal(await page.getByTestId('title-format-title-only').isChecked(), true);
  await page.getByTestId('title-format-code-and-title').check();
  await saveSettings();
  // An interrupted edit is discarded explicitly and never overwrites the saved choice.
  await openSettings();
  await page.getByTestId('title-format-title-only').check();
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await page.getByTestId('card-display-settings-modal').waitFor({ state: 'hidden' });
  await openSettings();
  assert.equal(await page.getByTestId('title-format-code-and-title').isChecked(), true);
  await saveSettings();
  await page.getByTestId('header-teacher-btn').click();
  await page.locator('[data-testid^="select-teacher-"]').filter({ hasText: 'Avery Fictional' }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  await openSettings();
  assert.equal(await page.getByTestId('title-format-code-only').isChecked(), true);
  await saveSettings();
  await page.reload();
  await openSettings();
  assert.equal(await page.getByTestId('title-format-code-only').isChecked(), true);
  await saveSettings();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByTestId('teacher-selector-modal').waitFor();
  assert.equal(await page.getByTestId('card-display-settings-btn').isDisabled(), true);
  const gradingContext = await browser.newContext();
  const gradingPage = await gradingContext.newPage();
  gradingPage.on('pageerror', error => errors.push(error.message));
  await gradingContext.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await gradingPage.goto(origin);
  await installFictionalClassroom(gradingPage);
  const fixture = await gradingPage.evaluate(() => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['studentAssessments', 'categoryResults', 'assessments'], 'readwrite');
      const assignments = transaction.objectStore('studentAssessments').getAll();
      const results = transaction.objectStore('categoryResults').getAll();
      let chosen: any;
      results.onsuccess = () => {
        const assignment = assignments.result.find(row => row.deletedAt === null && row.classSectionId === 'class-eng4u-01');
        if (!assignment) { transaction.abort(); return; }
        const matching = results.result.filter(row => row.studentAssessmentId === assignment.id && row.deletedAt === null);
        chosen = { enrollmentId: assignment.classEnrollmentId, assessmentId: assignment.assessmentId, categoryId: matching[0].assessmentCategoryId };
        transaction.objectStore('studentAssessments').put({ ...assignment, overallFeedback: '', completionStatus: 'complete' });
        matching.forEach((row, index) => transaction.objectStore('categoryResults').put({ ...row, normalizedPercentage: null, rawScore: '', inputFormat: 'descriptive', feedback: index === 0 ? 'Fictional category-only feedback' : '' }));
      };
      transaction.oncomplete = () => { database.close(); resolve(chosen); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('Fixture failed')); };
    };
    request.onerror = () => reject(request.error);
  }));
  await gradingPage.reload();
  await gradingPage.locator('[data-testid^="select-teacher-"]').first().click();
  await gradingPage.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  const snapshot = () => gradingPage.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['studentAssessments', 'categoryResults'], 'readonly');
      const assignments = transaction.objectStore('studentAssessments').getAll();
      const results = transaction.objectStore('categoryResults').getAll();
      transaction.oncomplete = () => { database.close(); resolve(JSON.stringify([assignments.result, results.result])); };
    };
  }));
  const beforeToggle = await snapshot();
  for (let iteration = 0; iteration < 3; iteration++) {
    await gradingPage.getByRole('button', { name: 'Collapse assessment details', exact: true }).click();
    const summary = gradingPage.getByTestId(`markbook-summary-${fixture.enrollmentId}-${fixture.assessmentId}`);
    await summary.filter({ hasText: 'Feedback only' }).waitFor();
    assert.doesNotMatch(await summary.innerText(), /Unassessed|Calculated/);
    await gradingPage.getByRole('button', { name: 'Expand assessment details', exact: true }).click();
    await gradingPage.getByTestId(`markbook-cell-${fixture.enrollmentId}-${fixture.categoryId}`).filter({ hasText: 'Feedback only' }).waitFor();
  }
  assert.equal(await snapshot(), beforeToggle, 'Repeated collapse and expand preserve all official results and assignment records');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: isolated teacher preferences, repeated saves, interrupted edit/reopen, teacher switch, reload, no selected actor; C12 category-only feedback repeated collapse/expand without record changes; no page errors or external requests.');
} finally { await browser.close(); if (server) await new Promise<void>(resolve => server.httpServer!.close(() => resolve())); }
