import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, type BrowserContext, type Page } from 'playwright';

// Visible UI acceptance. Vite exposes only authorized fictional fixture mutations
// and a one-shot post-commit read failure; no marking/restore action bypasses UI.
const origin = 'http://127.0.0.1:4197';
const artifacts = '/tmp/markinator-portability';
const summary = 'Fictional saved feedback <script>window.reportExecuted=true</script> & evidence.';
const originalText = 'Fictional passage for saved report. Second passage for revision draft.';
const errors: string[] = [], external: string[] = [];
const startedAt = new Date().toISOString(), completedScenarios: string[] = [];
async function saveResults(result: 'running' | 'pass' | 'fail', failure?: string) {
  await writeFile(`${artifacts}-results.json`, JSON.stringify({ result, startedAt, finishedAt: result === 'running' ? null : new Date().toISOString(), completedScenarios, externalRequests: external, browserErrors: errors, nativePrintingVerified: false, failure }, null, 2));
}
function passed(description: string) { completedScenarios.push(description); console.log(`PASS: ${description}`); }
async function guard(context: BrowserContext) {
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('file:')) return route.continue();
    external.push(url); return route.abort();
  });
}
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
async function official(page: Page, assessmentId: string) {
  const assessments = (await records(page, 'studentAssessments')).filter(row => row.assessmentId === assessmentId);
  const ids = new Set(assessments.map(row => row.id));
  return {
    assessments,
    results: (await records(page, 'categoryResults')).filter(row => ids.has(row.studentAssessmentId)),
    commits: (await records(page, 'markingCommits')).filter(row => row.assessmentId === assessmentId)
  };
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
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end });
}
async function setup(context: BrowserContext) {
  const page = await context.newPage(); await page.goto(origin);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill('Fictional portability acceptance');
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  let assessment: any;
  for (let i = 0; i < 40; i++) {
    assessment = (await records(page, 'assessments')).find(row => row.title === 'Fictional portability acceptance');
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment);
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await page.getByLabel('Paste rubric text or table').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited\tSome\tClear\tThorough');
  await page.getByRole('button', { name: 'Preview pasted rubric' }).click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional portable rubric');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();
  await page.getByTestId('marking-files').setInputFiles({ name: 'Fictional-portable.txt', mimeType: 'text/plain', buffer: Buffer.from(originalText) });
  const match = page.getByLabel('Confirm student for Fictional-portable.txt');
  const enrollmentId = await match.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).find(Boolean)!);
  await match.selectOption(enrollmentId); await page.getByTestId('marking-import-confirm').click();
  await page.locator('[data-testid^="marking-session-open-"]').first().waitFor();
  const attempt = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id);
  const actorId = await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
  assert.ok(actorId);
  const otherPage = await context.newPage(); await otherPage.goto(origin);
  await otherPage.evaluate(async ({ actorId, assessmentId, enrollmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', authPath = '/src/services/authHelper.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { assertClassSectionWriteAccess } = await import(authPath);
    await selectActingTeacher(db, actorId);
    await db.transaction('rw', db.tables, async () => {
      const assessment = await db.assessments.get(assessmentId);
      await assertClassSectionWriteAccess(db, actorId, assessment.classSectionId);
      const enrollment = await db.classEnrollments.get(enrollmentId), student = await db.students.get(enrollment.studentId);
      await db.students.put({ ...student, firstName: 'Fictional <img src="https://fictional.invalid/name">', lastName: 'Learner & Example', preferredName: null, updatedAt: new Date().toISOString(), version: student.version + 1 });
    });
  }, { actorId, assessmentId: assessment.id, enrollmentId });
  await page.getByTestId(`marking-session-open-${attempt.id}`).click();
  await page.getByTestId('marking-document').waitFor();
  return { page, otherPage, assessment, attempt, enrollmentId, actorId };
}
await saveResults('running');
const server = await createServer({
  server: { host: '127.0.0.1', port: 4197, strictPort: true, watch: null, hmr: false },
  plugins: [{ name: 'standalone-saved-marking-report', configureServer(server) {
    // Chromium policy in this cloud forbids file://. Serve the downloaded bytes
    // without Vite HTML transforms or app scripts; native file association is not tested.
    server.middlewares.use('/__marking-saved-report.html', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(await readFile(`${artifacts}-report.html`, 'utf8'));
    });
  } }]
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); await guard(context);
  const { page, otherPage, assessment, attempt, enrollmentId, actorId } = await setup(context);
  await selectPassage(page, 0, 17); await page.getByTestId('marking-feedback').fill('Fictional annotation <b>literal</b> & care.');
  await page.getByTestId('marking-comment-save').click();
  await page.getByRole('checkbox', { name: 'Assess T', exact: true }).check();
  await page.getByRole('combobox', { name: 'Official T judgment', exact: true }).selectOption('3+');
  await page.getByLabel('Category T feedback').fill('Fictional category feedback <em>literal</em>.');
  await page.getByLabel('Overall student-facing feedback').fill(summary);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await otherPage.evaluate(async ({ actorId, assessmentId, enrollmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', servicePath = '/src/services/markbookService.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { MarkbookDomainService } = await import(servicePath);
    const actor = await selectActingTeacher(db, actorId), assessment = await db.assessments.get(assessmentId);
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === 'T' && row.deletedAt === null);
    const studentAssessment = await db.studentAssessments.where({ assessmentId, classEnrollmentId: enrollmentId }).first();
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId, classSectionId: assessment.classSectionId, classEnrollmentId: enrollmentId, assessmentCategoryId: category.id, rawScore: '2+', inputFormat: 'scale_code', feedback: 'Newer authorized fictional manual mark', expectedStudentAssessmentVersion: studentAssessment.version, userId: actor.userId, deviceId: actor.deviceId });
  }, { actorId, assessmentId: assessment.id, enrollmentId });
  const manual = await official(page, assessment.id); assert.equal(manual.results.length, 1); assert.equal(manual.results[0].rawScore, '2+');
  await page.getByTestId('marking-finalize-preview').click(); await page.getByTestId('marking-finalize-confirm').click();
  await page.getByRole('alert').filter({ hasText: /changed.*review|review.*changed|newer/i }).waitFor();
  assert.deepEqual(await official(page, assessment.id), manual, 'stale finalization must preserve newer manual marks');
  await page.getByRole('button', { name: 'Resolve newer manual mark conflict', exact: true }).click();
  await page.getByRole('region', { name: 'Review official mark conflict' }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Current official results' }).innerText(), /2\+/);
  await page.getByRole('button', { name: 'Accept reviewed official baseline', exact: true }).click();
  await page.getByRole('region', { name: 'Review official mark conflict' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await official(page, assessment.id), manual, 'accepting baseline alone must not write a mark');
  await page.getByTestId('marking-finalize-preview').click();
  // Inject failure after a successful commit, at the UI's readback boundary.
  await page.evaluate(async () => {
    const path = '/src/marking/markingService.ts', { MarkingService } = await import(path);
    const original = MarkingService.prototype.finalize;
    MarkingService.prototype.finalize = async function (...args: any[]) {
      MarkingService.prototype.finalize = original;
      const commit = await original.apply(this, args);
      const read = this.getContext;
      this.getContext = async function (...readArgs: any[]) {
        this.getContext = read;
        throw new Error('Fictional committed-save readback failure; retry confirmation');
      };
      return commit;
    };
  });
  await page.getByTestId('marking-finalize-confirm').click();
  await page.getByRole('alert').filter({ hasText: 'Fictional committed-save readback failure' }).waitFor();
  const committed = await official(page, assessment.id), auditCount = (await records(page, 'auditEntries')).length;
  assert.equal(committed.commits.length, 1); assert.equal(committed.results.length, 1); assert.equal(committed.results[0].rawScore, '3+');
  assert.equal(committed.assessments.find(row => row.classEnrollmentId === enrollmentId).overallFeedback, summary);
  await page.getByTestId('marking-finalize-confirm').click();
  await page.getByText('Finalized revision — current official results shown below', { exact: false }).waitFor();
  assert.deepEqual(await official(page, assessment.id), committed, 'retry must return same immutable commit without duplicated or updated official records');
  assert.equal((await records(page, 'auditEntries')).length, auditCount, 'retry must not duplicate audit writes');
  passed('actual UI stale manual mark conflict, explicit baseline acceptance, confirmed finalization, post-commit readback failure and idempotent UI retry.');

  const reportDownload = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click();
  const downloadedReport = await reportDownload; await downloadedReport.saveAs(`${artifacts}-report.html`);
  const reportHTML = await readFile(`${artifacts}-report.html`, 'utf8');
  assert.match(reportHTML, /Fictional &lt;img src=&quot;https:\/\/fictional.invalid\/name&quot;&gt;/);
  assert.match(reportHTML, /&lt;script&gt;window.reportExecuted=true&lt;\/script&gt;/);
  assert.doesNotMatch(reportHTML, /<script|<img|<iframe|<link\b/i);
  const reportContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); await guard(reportContext);
  const reportPage = await reportContext.newPage(); await reportPage.goto(`${origin}/__marking-saved-report.html`);
  await reportPage.getByRole('heading', { name: 'Fictional portability acceptance', exact: true }).waitFor();
  assert.equal(await reportPage.locator('script,img,iframe,link').count(), 0);
  assert.equal(await reportPage.evaluate(() => (window as any).reportExecuted), undefined);
  assert.match(await reportPage.locator('body').innerText(), /Fictional saved feedback <script>window.reportExecuted=true<\/script> & evidence\./);
  await reportPage.emulateMedia({ media: 'print' });
  assert.equal(await reportPage.evaluate(() => getComputedStyle(document.body).marginTop), '0px');
  assert.equal(await reportPage.evaluate(() => getComputedStyle(document.querySelector('article')!).breakInside), 'avoid');
  const pdf = await reportPage.pdf({ path: `${artifacts}-report.pdf`, format: 'A4', printBackground: true });
  assert.ok(pdf.length > 5000); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await reportPage.screenshot({ path: `${artifacts}-report.png`, fullPage: true });
  await reportContext.close();
  passed('downloaded inert HTML bytes served alone over loopback (file URLs blocked by cloud browser policy), escaped fictional student/feedback/annotation, print-media styles and headless Chromium PDF output. Native print dialog/printer are not tested.');

  await page.getByTestId(`marking-session-open-${attempt.id}`).click();
  await page.getByLabel('Overall student-facing feedback').fill('Fictional revision draft retained after full restore');
  await selectPassage(page, 35, 49); await page.getByTestId('marking-feedback').fill('Fictional unfinished annotation recovered from backup');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  assert.deepEqual(await official(page, assessment.id), committed);
  const before = {
    attempts: (await records(page, 'markingAttempts')).filter(row => row.assessmentId === assessment.id),
    sessions: (await records(page, 'markingSessions')).filter(row => row.assessmentId === assessment.id),
    rubrics: (await records(page, 'markingRubrics')).filter(row => row.assessmentId === assessment.id)
  };
  assert.equal(before.sessions.length, 2);
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId('nav-portability-btn').click();
  const backupDownload = page.waitForEvent('download'); await page.getByTestId('create-backup-btn').click();
  const downloadedBackup = await backupDownload; await downloadedBackup.saveAs(`${artifacts}-backup.json`);
  const backup = JSON.parse(await readFile(`${artifacts}-backup.json`, 'utf8'));
  assert.equal(backup.schemaVersion, 4); assert.equal(backup.tables.markingSessions.length, 2);
  assert.equal(Buffer.from(backup.tables.markingAttempts[0].documents[0].original.base64, 'base64').toString('utf8'), originalText);

  const restoredContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); await guard(restoredContext);
  const restoredPage = await restoredContext.newPage(); await restoredPage.goto(origin);
  await restoredPage.locator('[data-testid^="select-teacher-"]').first().click();
  assert.equal((await records(restoredPage, 'markingAttempts')).length, 0, 'restore profile must start without marking data');
  await restoredPage.getByTestId('nav-portability-btn').click();
  await restoredPage.getByTestId('restore-file-input').setInputFiles(`${artifacts}-backup.json`);
  await restoredPage.getByTestId('restore-confirm-dialog').waitFor();
  assert.equal((await records(restoredPage, 'markingAttempts')).length, 0, 'file preview must not mutate database');
  await restoredPage.getByTestId('confirm-restore-btn').click();
  await restoredPage.getByText(/Database successfully restored/).waitFor();
  assert.deepEqual(await official(restoredPage, assessment.id), committed);
  for (const [table, values] of [['markingAttempts', before.attempts], ['markingSessions', before.sessions], ['markingRubrics', before.rubrics]] as const) {
    assert.deepEqual((await records(restoredPage, table)).filter(row => row.assessmentId === assessment.id), values, `${table} restored exactly`);
  }
  passed('clean-profile backup preview left marking tables empty; confirmed restore exactly recovered attempts, sessions, rubrics and official records.');
  await restoredPage.reload();
  if (await restoredPage.getByTestId(`select-teacher-${actorId}`).count()) await restoredPage.getByTestId(`select-teacher-${actorId}`).click();
  // Reload preserves the Import/Export view, so return to the dashboard explicitly.
  await restoredPage.getByTestId('nav-dashboard-btn').click();
  await restoredPage.getByTestId('chiclet-open-overlay-btn').first().click();
  await restoredPage.getByRole('button', { name: 'Assessments', exact: true }).click();
  await restoredPage.getByTestId(`open-marking-${assessment.id}`).click();
  await restoredPage.getByTestId(`marking-session-open-${attempt.id}`).click();
  assert.equal(await restoredPage.getByTestId('marking-document').innerText(), originalText);
  assert.equal(await restoredPage.getByLabel('Overall student-facing feedback').inputValue(), 'Fictional revision draft retained after full restore');
  assert.equal(await restoredPage.getByTestId('marking-feedback').inputValue(), 'Fictional unfinished annotation recovered from backup');
  const restoredReportDownload = restoredPage.waitForEvent('download');
  await restoredPage.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click();
  const restoredReport = await restoredReportDownload; const restoredReportPath = await restoredReport.path();
  assert.equal(await readFile(restoredReportPath!, 'utf8'), reportHTML, 'finalized report must survive newer draft and full restore byte-for-byte');
  const restoredOriginal = (await records(restoredPage, 'markingAttempts')).find(row => row.id === attempt.id).documents[0].original;
  assert.deepEqual(restoredOriginal, before.attempts[0].documents[0].original, 'retained original bytes and hashes survive actual backup UI round trip');
  assert.deepEqual(await official(restoredPage, assessment.id), committed);
  await restoredPage.screenshot({ path: `${artifacts}-restored-draft.png`, fullPage: true });
  passed('actual full-backup download, clean-profile ImportExportModal preview/confirm restore, reopened pending draft, immutable finalized report, originals and official records preserved.');

  // Only the authorized fictional fixture mutation bypasses UI: remove an
  // unassessed category after finalization. Export must use the saved snapshot.
  const categoryPage = await restoredContext.newPage(); await categoryPage.goto(origin);
  await categoryPage.evaluate(async ({ actorId, assessmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', authPath = '/src/services/authHelper.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { assertClassSectionWriteAccess } = await import(authPath);
    await selectActingTeacher(db, actorId);
    await db.transaction('rw', db.tables, async () => {
      const assessment = await db.assessments.get(assessmentId);
      await assertClassSectionWriteAccess(db, actorId, assessment.classSectionId);
      const category = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === 'C' && row.deletedAt === null);
      if (!category) throw new Error('Expected fictional C category');
      const now = new Date().toISOString();
      await db.assessmentCategories.put({ ...category, deletedAt: now, updatedAt: now, version: category.version + 1 });
    });
  }, { actorId, assessmentId: assessment.id });
  await categoryPage.close();
  const historicalDownload = restoredPage.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await restoredPage.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click();
  const historicalReport = await historicalDownload;
  if (!historicalReport) {
    const alert = await restoredPage.getByRole('alert').allTextContents();
    await restoredPage.screenshot({ path: `${artifacts}-historical-report-failure.png`, fullPage: true });
    throw new Error(`Historical Report download failed after authorized category removal: ${alert.join(' ')}`);
  }
  await historicalReport.saveAs(`${artifacts}-historical-report.html`);
  assert.equal(await readFile(`${artifacts}-historical-report.html`, 'utf8'), reportHTML, 'historical report must retain its finalized categories after current category removal');
  assert.deepEqual(await official(restoredPage, assessment.id), committed, 'historical report export must not change official records');
  assert.deepEqual((await records(restoredPage, 'markingSessions')).filter(row => row.assessmentId === assessment.id), before.sessions, 'historical export must not alter the finalized session or pending revision');
  passed('historical finalized Report downloads byte-for-byte after authorized current-category removal; official records and both sessions stay unchanged.');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await saveResults('pass');
  console.log('PASS: zero external requests or page errors across all portability scenarios.');
} catch (error) {
  await saveResults('fail', error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  await browser.close(); await server.close();
}
