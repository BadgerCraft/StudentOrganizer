import assert from 'node:assert/strict';
import type { Page, Locator } from 'playwright';
import { calculateOverallCourseGrade } from '../src/services/calculationEngine';

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

async function waitForRecord(page: Page, table: string, match: (row: any) => boolean) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = (await records(page, table)).find(match);
    if (found) return found;
    await page.waitForTimeout(100);
  }
  throw new Error(`Expected fictional ${table} record was not saved.`);
}

async function waitForVisibleText(locator: Locator, expected: string, description: string) {
  let actual = '';
  for (let attempt = 0; attempt < 60; attempt++) {
    actual = (await locator.innerText()).trim();
    if (actual === expected) return;
    await locator.page().waitForTimeout(100);
  }
  assert.equal(actual, expected, description);
}

async function persistedCourseGrade(page: Page, enrollmentId: string, classSectionId: string) {
  // Read the related grade inputs from one readonly transaction, then use the
  // production pure calculator in Node. This requests no development modules.
  const tables = await page.evaluate(() => new Promise<Record<string, any[]>>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = ['assessments', 'assessmentCategories', 'studentAssessments', 'categoryResults', 'gradingPolicies', 'gradeOverrides'];
      const tx = db.transaction(names, 'readonly');
      const data: Record<string, any[]> = {};
      for (const name of names) {
        const read = tx.objectStore(name).getAll();
        read.onsuccess = () => { data[name] = read.result; };
      }
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => { db.close(); resolve(data); };
    };
  }));
  const policy = tables.gradingPolicies.find(row => row.classSectionId === classSectionId && row.deletedAt === null);
  assert.ok(policy, 'persisted class policy exists');
  assert.equal(policy.excludeFormative, true, 'persisted class policy still excludes formative evidence');
  return calculateOverallCourseGrade(enrollmentId, null,
    tables.assessments.filter(row => row.classSectionId === classSectionId), tables.assessmentCategories,
    tables.studentAssessments, tables.categoryResults, policy, tables.gradeOverrides).finalOverall;
}

/** Begins at the dashboard after explicit first-teacher selection. Only real UI writes. */
export async function runUiAssessmentAcceptance(page: Page): Promise<void> {
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  const initialAssessments = await records(page, 'assessments');
  const seededUnit = (await records(page, 'units')).find(row => row.id === 'unit-eng-1');
  assert.ok(seededUnit, 'fictional English seed unit available');

  await page.getByRole('button', { name: 'Manage units', exact: true }).click();
  await page.getByRole('button', { name: `Edit unit ${seededUnit.code}`, exact: true }).click();
  await page.getByLabel('Unit name', { exact: true }).fill('Fictional cancelled rename');
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Edit unit', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Unit name', { exact: true }).inputValue(), 'Fictional cancelled rename', 'declining Escape discard retains draft');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual((await records(page, 'units')).find(row => row.id === seededUnit.id), seededUnit, 'cancel preserves unit');
  await page.getByRole('button', { name: `Edit unit ${seededUnit.code}`, exact: true }).click();
  await page.getByLabel('Unit code', { exact: true }).fill('UI-RENAMED');
  await page.getByLabel('Unit name', { exact: true }).fill('Fictional renamed evidence unit');
  await page.getByLabel('Unit display order', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save unit', exact: true }).click();
  const renamed = await waitForRecord(page, 'units', row => row.id === seededUnit.id && row.title === 'Fictional renamed evidence unit');
  assert.equal(renamed.version, seededUnit.version + 1);
  assert.equal(renamed.createdAt, seededUnit.createdAt);
  assert.deepEqual(await records(page, 'assessments'), initialAssessments, 'rename leaves historical assessment IDs/links untouched');
  await page.getByRole('button', { name: 'Edit unit UI-RENAMED', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New unit', exact: true }).click();
  await page.getByLabel('Unit code', { exact: true }).fill('UI-NEW');
  await page.getByLabel('Unit name', { exact: true }).fill('Fictional new assessment unit');
  await page.getByLabel('Unit starts on', { exact: true }).fill('2026-10-14');
  await page.getByLabel('Unit ends on', { exact: true }).fill('2026-10-21');
  await page.getByRole('button', { name: 'Save unit', exact: true }).click();
  const created = await waitForRecord(page, 'units', row => row.code === 'UI-NEW');
  const unitAudit = (await records(page, 'auditEntries')).find(row => row.entityId === created.id);
  assert.ok(unitAudit?.userId, 'unit insert attributed to explicit teacher');
  assert.equal((await records(page, 'syncMutations')).filter(row => row.transactionId === unitAudit.transactionId).length, 1);

  // Two real assessments prove collapse works independently of formative inclusion in course grades.
  const assessmentIds: Record<string, string> = {};
  for (const type of ['summative', 'formative']) {
    await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
    await page.getByLabel('Assessment type', { exact: true }).selectOption(type);
    await page.getByLabel('Assessment unit', { exact: true }).selectOption(created.id);
    await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(`Fictional UI ${type}`);
    await page.getByRole('button', { name: 'Create Assessment', exact: true }).click();
    const assessment = await waitForRecord(page, 'assessments', row => row.title === `Fictional UI ${type}`);
    assert.equal(assessment.unitId, created.id);
    assessmentIds[type] = assessment.id;
  }
  // Deliberately unequal weights distinguish the configured summary from a flat average.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const policyForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save Policy Settings', exact: true }) });
  for (const [index, weight] of [40, 30, 20, 10].entries()) await policyForm.getByRole('spinbutton').nth(index).fill(String(weight));
  await page.getByRole('button', { name: 'Save Policy Settings', exact: true }).click();
  await waitForRecord(page, 'gradingPolicies', row => row.classSectionId === seededUnit.classSectionId && row.weightK === 40 && row.weightT === 30 && row.weightC === 20 && row.weightA === 10);
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  const allCategories = await records(page, 'assessmentCategories');
  const allEnrollments = await records(page, 'classEnrollments');
  const summative = (await records(page, 'assessments')).find(row => row.id === assessmentIds.summative)!;
  const enrollment = allEnrollments.find(row => row.classSectionId === summative.classSectionId && row.deletedAt === null && row.enrollmentStatus === 'active')!;
  const policiesBefore = await records(page, 'gradingPolicies');
  const policy = policiesBefore.find(row => row.classSectionId === summative.classSectionId && row.deletedAt === null)!;
  assert.equal(policy.excludeFormative, true, 'fixture excludes formative course evidence');
  const levels = { K: '4(high)', T: '3−', C: 'R', A: '1' };
  const percentages = { K: 91, T: 71, C: 50, A: 55 };
  await page.getByRole('button', { name: 'Show percentage details', exact: true }).click();
  let courseAfterSummative = '';
  let persistedAfterSummative: number | null = null;
  for (const type of ['summative', 'formative']) {
    const assessmentId = assessmentIds[type];
    const categoryDefinitions = allCategories.filter(row => row.assessmentId === assessmentId && row.deletedAt === null);
    const order = await page.locator(`[data-testid^="markbook-header-${assessmentId}-"]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!.split('-').at(-1)));
    assert.deepEqual(order, ['K', 'T', 'C', 'A'], 'assessment display consistently KTCA');
    for (const code of ['K', 'T', 'C', 'A'] as const) {
      const category = categoryDefinitions.find(row => row.categoryCode === code)!;
      await page.getByTestId(`markbook-cell-${enrollment.id}-${category.id}`).click();
      await page.getByRole('group', { name: `Assigned ${code} level`, exact: true }).getByRole('button', { name: levels[code], exact: true }).click();
      await page.getByRole('button', { name: 'Complete', exact: true }).click();
      await page.getByRole('button', { name: 'Save Result', exact: true }).click();
      await page.getByRole('button', { name: 'Save Result', exact: true }).waitFor({ state: 'hidden' });
      const assignment = await waitForRecord(page, 'studentAssessments', row => row.assessmentId === assessmentId &&
        row.classEnrollmentId === enrollment.id && row.deletedAt === null && row.completionStatus === 'complete');
      await waitForRecord(page, 'categoryResults', row => row.studentAssessmentId === assignment.id &&
        row.assessmentCategoryId === category.id && row.deletedAt === null && row.rawScore === levels[code] && row.inputFormat === 'classroom_level' &&
        row.normalizedPercentage === percentages[code]);
      await waitForVisibleText(page.getByTestId(`markbook-cell-${enrollment.id}-${category.id}`),
        `${levels[code]}\n${percentages[code]}%`, `${type} ${code} saved score must be rendered before proceeding`);
    }
    const studentRow = page.getByTestId(`markbook-cell-${enrollment.id}-${categoryDefinitions[0].id}`).locator('..');
    const expectedCourse = await persistedCourseGrade(page, enrollment.id, summative.classSectionId);
    assert.notEqual(expectedCourse, null, 'stored results produce a course grade');
    if (type === 'summative') persistedAfterSummative = expectedCourse;
    else assert.equal(expectedCourse, persistedAfterSummative, 'stored formative results do not change the persisted course calculation');
    const expectedText = `${expectedCourse}%`;
    await waitForVisibleText(studentRow.locator('td').nth(1), expectedText,
      `${type} course grade must settle to the persisted calculation`);
    const overall = (await studentRow.locator('td').nth(1).innerText()).trim();
    if (type === 'summative') courseAfterSummative = overall;
    else assert.equal(overall, courseAfterSummative, 'saving formative results does not change course grade');
  }
  const resultSnapshot = await records(page, 'categoryResults');
  const assignmentSnapshot = await records(page, 'studentAssessments');
  await page.getByRole('button', { name: 'Collapse assessment details', exact: true }).click();
  const weights = { K: policy.weightK, T: policy.weightT, C: policy.weightC, A: policy.weightA };
  const expected = Math.round((Object.keys(percentages) as Array<keyof typeof percentages>)
    .reduce((sum, code) => sum + percentages[code] * weights[code], 0) / 100 * 10 ** policy.decimalPrecision) / 10 ** policy.decimalPrecision;
  assert.notEqual(expected, Object.values(percentages).reduce((sum, percentage) => sum + percentage, 0) / 4, 'unequal policy weights must not be replaced by a flat category average');
  for (const type of ['summative', 'formative']) {
    const summary = page.getByTestId(`markbook-summary-${enrollment.id}-${assessmentIds[type]}`);
    await summary.waitFor();
    await waitForVisibleText(summary.locator('span').first(), `${expected}%`, `${type} summary uses configured weights`);
  }
  await page.getByTestId(`markbook-summary-${enrollment.id}-${assessmentIds.formative}`).getByRole('button', { name: /^Edit / }).click();
  const formativeCategories = allCategories.filter(row => row.assessmentId === assessmentIds.formative);
  await page.getByTestId(`markbook-cell-${enrollment.id}-${formativeCategories[0].id}`).waitFor();
  assert.deepEqual(await records(page, 'categoryResults'), resultSnapshot, 'collapse and edit access do not rewrite scores');
  assert.deepEqual(await records(page, 'studentAssessments'), assignmentSnapshot, 'collapse preserves completion and feedback');
  assert.deepEqual(await records(page, 'gradingPolicies'), policiesBefore, 'summary never changes grading policy');
  await page.reload();
  const teacherChoice = page.locator('[data-testid^="select-teacher-"]').first();
  const readyHeader = page.getByTestId('header-class-select');
  // Reload can retain the explicit session actor. A new browser session may ask again.
  await Promise.race([teacherChoice.waitFor({ state: 'visible' }), readyHeader.waitFor({ state: 'visible' })]);
  if (await teacherChoice.isVisible()) await teacherChoice.click();
  await page.getByTestId('header-class-select').waitFor();
  assert.equal((await records(page, 'units')).find(row => row.id === seededUnit.id)?.title, renamed.title, 'renamed unit survives reopen');
  assert.equal((await records(page, 'units')).find(row => row.id === created.id)?.endsOn, '2026-10-21', 'new unit schedule survives reopen');
  console.log('PASS: real unit create/edit/cancel preserves historical IDs/links, attributed writes and reopen; both assessment types collapse to weighted summaries, expand/edit access, KTCA order and unchanged course policy.');
}
