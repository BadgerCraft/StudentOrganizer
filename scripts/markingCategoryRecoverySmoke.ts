import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Page, type BrowserContext } from 'playwright';

// Vite is required only for the authorized second-context fixture and storage-failure
// injection. All draft editing/review/reconciliation below uses the visible UI.
const origin = 'http://127.0.0.1:4194';
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
async function storedSession(page: Page, attemptId: string) {
  return (await records(page, 'markingSessions')).find(row => row.attemptId === attemptId);
}
async function selectPassage(page: Page, start: number, end: number) {
  await page.getByTestId('marking-document').evaluate((root, { start, end }) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0, begin: [Node, number] | null = null, finish: [Node, number] | null = null;
    while ((node = walk.nextNode())) {
      const limit = offset + (node.textContent?.length || 0);
      if (!begin && start < limit) begin = [node, start - offset];
      if (end <= limit) { finish = [node, end - offset]; break; }
      offset = limit;
    }
    if (!begin || !finish) throw new Error('Invalid fictional selection');
    const range = document.createRange(); range.setStart(...begin); range.setEnd(...finish);
    const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end });
}
async function official(page: Page, assessmentId: string) {
  const assessments = (await records(page, 'studentAssessments')).filter(row => row.assessmentId === assessmentId);
  const ids = new Set(assessments.map(row => row.id));
  return {
    assessments,
    results: (await records(page, 'categoryResults')).filter(row => ids.has(row.studentAssessmentId)),
    commits: (await records(page, 'markingCommits')).filter(row => row.assessmentId === assessmentId)
  };
}
async function setup(context: BrowserContext, scenario: string) {
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  const title = `Fictional category recovery ${scenario}`;
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  let assessment: any;
  for (let i = 0; i < 40; i++) {
    assessment = (await records(page, 'assessments')).find(row => row.title === title);
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment, 'fictional assessment created through UI');
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await page.getByLabel('Paste rubric text or table').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited\tSome\tClear\tThorough');
  await page.getByRole('button', { name: 'Preview pasted rubric' }).click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional T-only pinned rubric');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();
  await page.getByTestId('marking-files').setInputFiles({ name: 'Fictional-recovery.txt', mimeType: 'text/plain', buffer: Buffer.from('First fictional passage. Second fictional passage.') });
  const match = page.getByLabel('Confirm student for Fictional-recovery.txt');
  const enrollmentId = await match.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).find(Boolean)!);
  await match.selectOption(enrollmentId);
  await page.getByTestId('marking-import-confirm').click();
  await page.locator('[data-testid^="marking-session-open-"]').first().waitFor();
  const attempt = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id);
  const actorId = await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
  assert.ok(actorId);
  const otherPage = await context.newPage();
  await otherPage.goto(origin);
  await otherPage.evaluate(async ({ actorId, assessmentId, enrollmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', servicePath = '/src/services/markbookService.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { MarkbookDomainService } = await import(servicePath);
    const actor = await selectActingTeacher(db, actorId);
    const assessment = await db.assessments.get(assessmentId);
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === 'K' && row.deletedAt === null);
    const studentAssessment = await db.studentAssessments.where({ assessmentId, classEnrollmentId: enrollmentId }).first();
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId, classSectionId: assessment.classSectionId, classEnrollmentId: enrollmentId, assessmentCategoryId: category.id, rawScore: '2+', inputFormat: 'scale_code', feedback: 'Existing official fictional mark', expectedStudentAssessmentVersion: studentAssessment?.version, userId: actor.userId, deviceId: actor.deviceId });
  }, { actorId, assessmentId: assessment.id, enrollmentId });
  const baseline = await official(page, assessment.id);
  assert.equal(baseline.results.length, 1, 'official-mark comparison must not be vacuous');
  await page.getByTestId(`marking-session-open-${attempt.id}`).click();
  await page.getByTestId('marking-document').waitFor();
  await selectPassage(page, 0, 23);
  await page.getByTestId('marking-feedback').fill(`Saved annotation ${scenario}`);
  await page.getByTestId('marking-comment-save').click();
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  const oldCategories = (await records(page, 'assessmentCategories')).filter(row => row.assessmentId === assessment.id && row.deletedAt === null);
  return { page, otherPage, actorId, assessment, attempt, baseline, oldCategories };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function pendingFeedback(fixture: Fixture, scenario: string) {
  const { page } = fixture;
  // Freeze only this page's JS timers so all these edits remain pending until the
  // teacher clicks Save now; the authorized other page retains normal timers.
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await selectPassage(page, 25, 49);
  await page.getByTestId('marking-feedback').fill(`Pending comment ${scenario}`);
  await page.getByLabel('Evidence level (optional)').selectOption('Level 3');
  await page.getByRole('checkbox', { name: 'Assess T', exact: true }).check();
  await page.getByRole('combobox', { name: 'Official T judgment', exact: true }).selectOption('3+');
  await page.getByLabel('Category T feedback').fill(`T feedback ${scenario}`);
  await page.getByLabel('Category K feedback').fill(`K feedback ${scenario}`);
  await page.getByLabel('Overall student-facing feedback').fill(`Overall feedback ${scenario}`);
  assert.notEqual((await storedSession(page, fixture.attempt.id)).draft.overallFeedback, `Overall feedback ${scenario}`, 'the scenario must begin with unsaved feedback');
}
async function changeCategory(fixture: Fixture, code: 'K' | 'T', replace: boolean, incompatible = false) {
  return fixture.otherPage.evaluate(async ({ actorId, assessmentId, code, replace, incompatible }) => {
    const dbPath = '/src/db/database.ts', authPath = '/src/services/authHelper.ts';
    const { db } = await import(dbPath), { assertClassSectionWriteAccess } = await import(authPath);
    return db.transaction('rw', db.tables, async () => {
      const assessment = await db.assessments.get(assessmentId);
      await assertClassSectionWriteAccess(db, actorId, assessment.classSectionId);
      const old = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === code && row.deletedAt === null);
      const now = new Date().toISOString();
      if (replace) {
        // Mirrors a category-ID replacement while respecting its unique code index.
        await db.assessmentCategories.delete(old.id);
        const replacement = { ...old, id: crypto.randomUUID(), createdAt: now, updatedAt: now, version: 1, maxScore: incompatible ? old.maxScore + 1 : old.maxScore };
        await db.assessmentCategories.add(replacement);
        return { old, replacement };
      }
      await db.assessmentCategories.put({ ...old, deletedAt: now, updatedAt: now, version: old.version + 1 });
      return { old, replacement: null };
    });
  }, { actorId: fixture.actorId, assessmentId: fixture.assessment.id, code, replace, incompatible });
}
async function restart(fixture: Fixture) {
  await fixture.page.clock.resume();
  await fixture.page.reload();
  await fixture.page.getByTestId(`open-marking-${fixture.assessment.id}`).click();
  await fixture.page.getByTestId(`marking-session-open-${fixture.attempt.id}`).click();
  await fixture.page.getByTestId('marking-document').waitFor();
}
function assertFeedback(draft: any, scenario: string) {
  assert.equal(draft.annotations.length, 1);
  assert.equal(draft.annotations[0].text, `Saved annotation ${scenario}`);
  assert.equal(draft.pending.text, `Pending comment ${scenario}`);
  assert.equal(draft.pending.quote, 'Second fictional passage');
  assert.equal(draft.pending.level, 'Level 3');
  assert.equal(draft.overallFeedback, `Overall feedback ${scenario}`);
}
async function failSessionWrites(page: Page, enabled: boolean) {
  await page.evaluate(async enabled => {
    const path = '/src/db/database.ts', { db } = await import(path);
    const fixture = window as unknown as { originalMarkingPut?: typeof db.markingSessions.put };
    if (enabled) {
      fixture.originalMarkingPut = db.markingSessions.put;
      db.markingSessions.put = async () => { throw new DOMException('Fictional storage failure', 'QuotaExceededError'); };
    } else {
      if (!fixture.originalMarkingPut) throw new Error('Missing original storage method');
      db.markingSessions.put = fixture.originalMarkingPut;
      delete fixture.originalMarkingPut;
    }
  }, enabled);
}
const server = await createServer({ server: { host: '127.0.0.1', port: 4194, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const errors: string[] = [], external: string[] = [];
  for (const scenario of ['replacement', 'removed', 'incompatible-rubric', 'incompatible-mapping']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    context.on('page', page => page.on('pageerror', error => errors.push(`${scenario}: ${error.message}`)));
    await context.route('**/*', route => {
      if (!route.request().url().startsWith(`${origin}/`)) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const fixture = await setup(context, scenario), { page, attempt } = fixture;
    await pendingFeedback(fixture, scenario);
    const change = await changeCategory(fixture, scenario === 'removed' ? 'K' : 'T', scenario === 'replacement' || scenario === 'incompatible-mapping', scenario === 'incompatible-mapping');
    const beforeSave = await storedSession(page, attempt.id);
    if (scenario === 'replacement') {
      await failSessionWrites(page, true);
      await page.getByRole('button', { name: 'Save now', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Fictional storage failure' }).waitFor();
      assert.deepEqual(await storedSession(page, attempt.id), beforeSave, 'failed recovery save leaves durable draft unchanged');
      assert.match(await page.getByTestId('marking-save-status').innerText(), /^Not saved/, 'a failed marking save must not report success');
      assert.match(await page.getByRole('region', { name: 'Category change conflict', exact: true }).innerText(), /Pending feedback is not yet saved/);
      await page.screenshot({ path: '/tmp/markinator-category-storage-failure.png', fullPage: true });
      await page.getByRole('button', { name: 'Review changed categories', exact: true }).click();
      assert.equal(await page.getByRole('region', { name: 'Review category changes', exact: true }).count(), 0, 'review must not claim recovery before durable save');
      await failSessionWrites(page, false);
    }
    await page.getByRole('button', { name: 'Save now', exact: true }).click();
    const savedRecovery = await storedSession(page, attempt.id);
    assertFeedback(savedRecovery.draft, scenario);
    assert.equal(savedRecovery.draft.judgments.find((judgment: any) => judgment.assessmentCategoryId === change.old.id).feedback, `${scenario === 'removed' ? 'K' : 'T'} feedback ${scenario}`);
    assert.deepEqual(await official(page, fixture.assessment.id), fixture.baseline, 'saving a recoverable draft must not change existing official records');
    await page.getByRole('button', { name: 'Review changed categories', exact: true }).click();
    let review = page.getByRole('region', { name: 'Review category changes', exact: true });
    await review.waitFor();
    assert.match(await review.innerText(), /Fictional T-only pinned rubric/);
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/markinator-category-${scenario}-review.png`, fullPage: true });
    if (scenario === 'incompatible-rubric') {
      assert.match(await review.innerText(), /Pinned rubric is incompatible/);
      assert.match(await review.innerText(), /Restore the required assessment categories/);
      assert.match(await review.innerText(), /Import\/Export → Download Full Backup/);
      assert.match(await review.innerText(), /assessment screen currently has no category editor/);
      assert.equal(await review.getByRole('button', { name: 'Reconcile reviewed categories', exact: true }).isDisabled(), true);
      await restart(fixture);
      assertFeedback((await storedSession(page, attempt.id)).draft, scenario);
      assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${scenario}`);
      assert.equal(await page.getByLabel('Category T feedback').inputValue(), `T feedback ${scenario}`);
      assert.deepEqual(await official(page, fixture.assessment.id), fixture.baseline);
      // Follow the UI's recovery instruction in the second authorized context.
      await fixture.otherPage.evaluate(async ({ actorId, category }) => {
        const dbPath = '/src/db/database.ts', authPath = '/src/services/authHelper.ts';
        const { db } = await import(dbPath), { assertClassSectionWriteAccess } = await import(authPath);
        await db.transaction('rw', db.tables, async () => {
          const assessment = await db.assessments.get(category.assessmentId);
          await assertClassSectionWriteAccess(db, actorId, assessment.classSectionId);
          await db.assessmentCategories.put({ ...category, version: category.version + 2, updatedAt: new Date().toISOString(), deletedAt: null });
        });
      }, { actorId: fixture.actorId, category: change.old });
      await page.getByRole('button', { name: 'Review changed categories', exact: true }).click();
      review = page.getByRole('region', { name: 'Review category changes', exact: true });
      await review.waitFor();
      await review.getByLabel('Reconcile T judgment').selectOption(change.old.id);
    } else {
      const code = scenario === 'removed' ? 'K' : 'T';
      const selector = review.getByLabel(`Reconcile ${code} judgment`);
      assert.equal(await selector.inputValue(), '', 'changed categories require an explicit decision');
      if (scenario === 'incompatible-mapping') {
        const options = await selector.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
        assert.ok(!options.includes(change.replacement.id), 'incompatible scale/maximum must not be offered as a remap');
      }
      await selector.selectOption(scenario === 'replacement' ? change.replacement.id : '__retain__');
    }
    const beforeReconcile = await storedSession(page, attempt.id);
    if (scenario === 'replacement') {
      await failSessionWrites(page, true);
      await review.getByRole('button', { name: 'Reconcile reviewed categories', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Fictional storage failure' }).waitFor();
      assert.deepEqual(await storedSession(page, attempt.id), beforeReconcile, 'failed reconciliation must not partially replace judgments or history');
      assert.equal(await review.isVisible(), true, 'failed reconciliation retains the review and pending choices');
      assert.equal(await page.getByRole('region', { name: 'Retained category feedback', exact: true }).count(), 0);
      await failSessionWrites(page, false);
    }
    await review.getByRole('button', { name: 'Reconcile reviewed categories', exact: true }).click();
    await review.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Save now', exact: true }).click();
    const reconciled = await storedSession(page, attempt.id);
    assertFeedback(reconciled.draft, scenario);
    assert.equal(reconciled.baseline, beforeSave.baseline, 'category recovery cannot accept newer official marks as a side effect');
    const retained = reconciled.retainedCategoryJudgments.find((row: any) => row.category.id === change.old.id);
    assert.ok(retained, 'the original changed/removed judgment remains recoverable');
    assert.equal(retained.judgment.feedback, `${scenario === 'removed' ? 'K' : 'T'} feedback ${scenario}`);
    if (scenario === 'replacement') {
      const judgment = reconciled.draft.judgments.find((row: any) => row.assessmentCategoryId === change.replacement.id);
      assert.equal(judgment.rawScore, '3+'); assert.equal(judgment.feedback, `T feedback ${scenario}`);
    }
    if (scenario === 'incompatible-mapping') {
      const judgment = reconciled.draft.judgments.find((row: any) => row.assessmentCategoryId === change.replacement.id);
      assert.equal(judgment.assessed, false); assert.equal(judgment.rawScore, ''); assert.equal(judgment.feedback, '');
      assert.equal(retained.judgment.rawScore, '3+');
    }
    await restart(fixture);
    const restarted = await storedSession(page, attempt.id);
    assert.deepEqual(restarted, reconciled, 'reload/reopen preserves saved recovered draft and history exactly');
    assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${scenario}`);
    assert.equal(await page.getByLabel('Overall student-facing feedback').inputValue(), `Overall feedback ${scenario}`);
    const history = page.getByRole('region', { name: 'Retained category feedback', exact: true });
    assert.match(await history.innerText(), new RegExp(`${scenario === 'removed' ? 'K' : 'T'} feedback ${scenario}`));
    assert.deepEqual(await official(page, fixture.assessment.id), fixture.baseline, 'official marks and commits unchanged after recovery and restart');
    await page.screenshot({ path: `/tmp/markinator-category-${scenario}.png`, fullPage: true });
    console.log(`PASS category recovery UI: ${scenario}; pending/saved comments, judgments, summary, restart and existing official marks preserved.`);
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: fictional category-change UI recovery covers explicit remap, removed feedback retention, incompatible pinned rubric/restoration, incompatible score mapping, failed save/reconciliation without false success, and restart; zero external requests/browser exceptions.');
} finally { await browser.close(); await server.close(); }
