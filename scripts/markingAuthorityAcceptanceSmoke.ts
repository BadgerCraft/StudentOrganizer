import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Page, type BrowserContext } from 'playwright';

// Real UI editing/navigation with isolated fictional browser profiles. Vite module
// access is reserved for explicit identity/authorization fixtures and failed-write
// injection; no fixture bypasses the marking service to save feedback.
const origin = 'http://127.0.0.1:4196';
async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction(table, 'readonly');
      const read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => database.close();
    };
  }), table);
}
async function storedSession(page: Page, attemptId: string) {
  return (await records(page, 'markingSessions')).find(row => row.attemptId === attemptId);
}
async function official(page: Page, assessmentId: string) {
  const assessments = (await records(page, 'studentAssessments')).filter(row => row.assessmentId === assessmentId);
  const ids = new Set(assessments.map(row => row.id));
  return { assessments, results: (await records(page, 'categoryResults')).filter(row => ids.has(row.studentAssessmentId)), commits: (await records(page, 'markingCommits')).filter(row => row.assessmentId === assessmentId) };
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
async function setup(context: BrowserContext, scenario: string) {
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  const title = `Fictional authority acceptance ${scenario}`;
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
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional authority rubric');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();
  await page.getByTestId('marking-files').setInputFiles({ name: 'Fictional-authority.txt', mimeType: 'text/plain', buffer: Buffer.from('First fictional passage. Second fictional passage.') });
  const match = page.getByLabel('Confirm student for Fictional-authority.txt');
  const enrollmentId = await match.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).find(Boolean)!);
  await match.selectOption(enrollmentId);
  await page.getByTestId('marking-import-confirm').click();
  await page.locator('[data-testid^="marking-session-open-"]').first().waitFor();
  const attempt = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id);
  const actorId = await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
  assert.ok(actorId);
  const otherPage = await context.newPage();
  await otherPage.goto(origin);
  const otherTeacherId = await otherPage.evaluate(async ({ actorId, assessmentId, enrollmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', servicePath = '/src/services/markbookService.ts', authPath = '/src/services/authHelper.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { MarkbookDomainService } = await import(servicePath), { assertClassSectionWriteAccess } = await import(authPath);
    const actor = await selectActingTeacher(db, actorId);
    const assessment = await db.assessments.get(assessmentId);
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === 'K' && row.deletedAt === null);
    const studentAssessment = await db.studentAssessments.where({ assessmentId, classEnrollmentId: enrollmentId }).first();
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId, classSectionId: assessment.classSectionId, classEnrollmentId: enrollmentId, assessmentCategoryId: category.id, rawScore: '2+', inputFormat: 'scale_code', feedback: 'Existing fictional official mark', expectedStudentAssessmentVersion: studentAssessment?.version, userId: actor.userId, deviceId: actor.deviceId });
    // Explicitly authorized fictional class fixture, equivalent to a second local
    // staff account. This is not an application user-management operation.
    return db.transaction('rw', db.tables, async () => {
      await assertClassSectionWriteAccess(db, actor.userId, assessment.classSectionId);
      const membership = await db.organizationMemberships.where('userId').equals(actor.userId).first();
      const staff = await db.classSectionStaff.where('classSectionId').equals(assessment.classSectionId).first();
      const now = new Date().toISOString(), id = crypto.randomUUID(), memberId = crypto.randomUUID();
      await db.users.add({ ...actor.user, id, authSubject: 'fictional-local-authority-qa', name: 'Jordan Fictional QA', email: 'jordan.qa@example.invalid', createdAt: now, updatedAt: now });
      await db.organizationMemberships.add({ ...membership, id: memberId, userId: id, createdAt: now, updatedAt: now });
      await db.classSectionStaff.add({ ...staff, id: crypto.randomUUID(), organizationMembershipId: memberId, role: 'co_teacher', createdAt: now, updatedAt: now });
      return id;
    });
  }, { actorId, assessmentId: assessment.id, enrollmentId });
  const baseline = await official(page, assessment.id);
  assert.equal(baseline.results.length, 1, 'official invariants must include a nonempty official mark');
  await page.getByTestId(`marking-session-open-${attempt.id}`).click();
  await page.getByTestId('marking-document').waitFor();
  await selectPassage(page, 0, 23);
  await page.getByTestId('marking-feedback').fill(`Saved annotation ${scenario}`);
  await page.getByTestId('marking-comment-save').click();
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  const actor = await page.evaluate(async () => {
    const path = '/src/services/identityService.ts', dbPath = '/src/db/database.ts';
    const { getAppIdentity, getIdentityEpoch } = await import(path), { db } = await import(dbPath);
    const identity = await getAppIdentity(db);
    return { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
  });
  return { page, otherPage, actorId, otherTeacherId, actor, assessment, attempt, baseline, scenario };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function pendingFeedback(fixture: Fixture) {
  const { page, scenario } = fixture;
  // Keep UI feedback demonstrably pending, independently of machine speed.
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await selectPassage(page, 25, 49);
  await page.getByTestId('marking-feedback').fill(`Pending comment ${scenario}`);
  await page.getByLabel('Evidence level (optional)').selectOption('Level 3');
  await page.getByLabel('Category T feedback').fill(`T feedback ${scenario}`);
  await page.getByLabel('Overall student-facing feedback').fill(`Overall feedback ${scenario}`);
  assert.notEqual((await storedSession(page, fixture.attempt.id)).draft.overallFeedback, `Overall feedback ${scenario}`);
}
function assertFeedback(draft: any, scenario: string) {
  assert.equal(draft.annotations.length, 1);
  assert.equal(draft.annotations[0].text, `Saved annotation ${scenario}`);
  assert.equal(draft.pending.text, `Pending comment ${scenario}`);
  assert.equal(draft.pending.quote, 'Second fictional passage');
  assert.equal(draft.pending.level, 'Level 3');
  assert.equal(draft.overallFeedback, `Overall feedback ${scenario}`);
  assert.ok(draft.judgments.some((row: any) => row.feedback === `T feedback ${scenario}`));
}
async function failSessionWrites(page: Page, enabled: boolean) {
  await page.evaluate(async enabled => {
    const path = '/src/db/database.ts', { db } = await import(path);
    const fixture = window as unknown as { originalMarkingPut?: typeof db.markingSessions.put };
    if (enabled) {
      fixture.originalMarkingPut = db.markingSessions.put;
      db.markingSessions.put = async () => { throw new DOMException('Fictional authority storage failure', 'QuotaExceededError'); };
    } else {
      if (!fixture.originalMarkingPut) throw new Error('Missing original storage method');
      db.markingSessions.put = fixture.originalMarkingPut;
      delete fixture.originalMarkingPut;
    }
  }, enabled);
}
async function reopen(fixture: Fixture) {
  await fixture.page.clock.resume();
  await fixture.page.getByTestId(`open-marking-${fixture.assessment.id}`).click();
  await fixture.page.getByTestId(`marking-session-open-${fixture.attempt.id}`).click();
  await fixture.page.getByTestId('marking-document').waitFor();
}
async function switchAndReturn(fixture: Fixture) {
  const { page, actorId, otherTeacherId } = fixture;
  await page.getByRole('button', { name: 'Switch teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor();
  assertFeedback((await storedSession(page, fixture.attempt.id)).draft, fixture.scenario);
  await page.clock.resume();
  assert.equal(await page.getByTestId('marking-document').count(), 0);
  await page.getByTestId(`select-teacher-${otherTeacherId}`).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), otherTeacherId);
  // The other authorized class teacher can see the assessment but cannot see the
  // first teacher's private submission, saved draft, or feedback.
  await page.getByTestId(`open-marking-${fixture.assessment.id}`).click();
  await page.getByText('No submissions yet. Confirm a rubric, then import student work.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId(`marking-session-open-${fixture.attempt.id}`).count(), 0);
  assert.equal(await page.getByText(`Saved annotation ${fixture.scenario}`, { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Switch teacher', exact: true }).click();
  await page.getByTestId(`select-teacher-${actorId}`).click();
  await reopen(fixture);
  assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${fixture.scenario}`);
  assertFeedback((await storedSession(page, fixture.attempt.id)).draft, fixture.scenario);
}
async function assertStaleSaveRejected(fixture: Fixture, baselineSession: any, match: RegExp) {
  const result = await fixture.page.evaluate(async ({ actor, session }) => {
    const dbPath = '/src/db/database.ts', servicePath = '/src/marking/markingService.ts';
    const { db } = await import(dbPath), { MarkingService } = await import(servicePath);
    try {
      await new MarkingService(db).saveDraft(session.id, { ...session.draft, overallFeedback: 'Forbidden stale write' }, session.version, actor);
      return 'unexpected success';
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, { actor: fixture.actor, session: baselineSession });
  assert.match(result, match);
  assert.deepEqual(await storedSession(fixture.page, fixture.attempt.id), baselineSession);
}

const server = await createServer({ server: { host: '127.0.0.1', port: 4196, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const errors: string[] = [], external: string[] = [];
  const scenarios = ['pending-teacher-switch', 'failed-navigation-retry', 'epoch-revoked', 'membership-revoked'];
  const requested = process.env.MARKING_AUTHORITY_SCENARIOS?.split(',') ?? scenarios;
  assert.ok(requested.every(scenario => scenarios.includes(scenario)), 'unknown authority scenario');
  for (const scenario of requested) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    context.on('page', page => page.on('pageerror', error => errors.push(`${scenario}: ${error.message}`)));
    await context.route('**/*', route => {
      if (!route.request().url().startsWith(`${origin}/`)) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const fixture = await setup(context, scenario), { page, attempt } = fixture;
    await pendingFeedback(fixture);
    const beforeSave = await storedSession(page, attempt.id);
    if (scenario === 'pending-teacher-switch') {
      await switchAndReturn(fixture);
      await page.clock.resume();
      await page.reload();
      await reopen(fixture);
      assertFeedback((await storedSession(page, attempt.id)).draft, scenario);
      assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${scenario}`);
    } else if (scenario === 'failed-navigation-retry') {
      await failSessionWrites(page, true);
      for (const action of ['Back to Organizer', 'Switch teacher', 'Rubric editor']) {
        await page.getByRole('button', { name: action, exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Fictional authority storage failure' }).waitFor();
        assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${scenario}`);
        assert.equal(await page.getByTestId('teacher-selector-modal').count(), 0);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), fixture.actorId);
        assert.match(await page.getByTestId('marking-save-status').innerText(), /^Not saved/);
        assert.deepEqual(await storedSession(page, attempt.id), beforeSave);
      }
      await page.screenshot({ path: '/tmp/markinator-authority-storage-blocked.png', fullPage: true });
      await failSessionWrites(page, false);
      await page.getByRole('button', { name: 'Retry save', exact: true }).click();
      assertFeedback((await storedSession(page, attempt.id)).draft, scenario);
      await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
      assert.equal(await page.getByTestId('marking-document').count(), 0);
      await reopen(fixture);
      await switchAndReturn(fixture);
      await page.clock.resume();
      await page.reload();
      await reopen(fixture);
      assert.equal(await page.getByTestId('marking-feedback').inputValue(), `Pending comment ${scenario}`);
    } else if (scenario === 'epoch-revoked') {
      await page.evaluate(async otherTeacherId => {
        const dbPath = '/src/db/database.ts', path = '/src/services/identityService.ts';
        const { db } = await import(dbPath), { selectActingTeacher } = await import(path);
        await selectActingTeacher(db, otherTeacherId);
      }, fixture.otherTeacherId);
      await page.getByRole('alert').filter({ hasText: 'Protected marking content is hidden' }).waitFor();
      await page.clock.runFor(1000);
      assert.equal(await page.getByTestId('marking-document').count(), 0);
      assert.equal(await page.getByTestId('marking-feedback').count(), 0);
      assert.equal(await page.getByLabel('Overall student-facing feedback').count(), 0);
      await assertStaleSaveRejected(fixture, beforeSave, /acting teacher changed/i);
      await page.screenshot({ path: '/tmp/markinator-authority-epoch-revoked.png', fullPage: true });
    } else {
      await fixture.otherPage.evaluate(async ({ actorId, classSectionId }) => {
        const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', authPath = '/src/services/authHelper.ts';
        const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { assertClassSectionWriteAccess } = await import(authPath);
        await selectActingTeacher(db, actorId);
        // Authorized second context revokes its own fictional membership only
        // after checking existing access. No post-revocation writes are made.
        await db.transaction('rw', db.tables, async () => {
          await assertClassSectionWriteAccess(db, actorId, classSectionId);
          const memberships = await db.organizationMemberships.where('userId').equals(actorId).toArray();
          for (const membership of memberships) await db.organizationMemberships.put({ ...membership, status: 'suspended', updatedAt: new Date().toISOString(), version: membership.version + 1 });
        });
      }, { actorId: fixture.actorId, classSectionId: fixture.assessment.classSectionId });
      await page.clock.runFor(1000);
      await page.getByText('Marking is unavailable for this teacher or assessment.', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('marking-document').count(), 0);
      assert.equal(await page.getByTestId('marking-feedback').count(), 0);
      assert.equal(await page.getByLabel('Overall student-facing feedback').count(), 0);
      await assertStaleSaveRejected(fixture, beforeSave, /membership is suspended/i);
      await page.screenshot({ path: '/tmp/markinator-authority-membership-revoked.png', fullPage: true });
    }
    assert.deepEqual(await official(page, fixture.assessment.id), fixture.baseline, 'authority/navigation acceptance must not alter existing official records');
    assert.deepEqual(errors, [], 'no unhandled page exceptions');
    assert.deepEqual(external, [], 'no external network requests');
    await context.close();
    console.log(`PASS: ${scenario}; existing official records unchanged.`);
  }
  assert.deepEqual(errors, [], 'no unhandled page exceptions');
  assert.deepEqual(external, [], 'no external network requests');
  console.log(`PASS: ${requested.length} fictional authority/navigation scenarios (${requested.join(', ')}); zero external requests and page exceptions. Browser evidence does not establish native readiness.`);
} finally {
  await browser.close();
  await server.close();
}
