import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, type BrowserContext, type Page } from 'playwright';

// Actual UI acceptance with fictional local files. Module access is confined to
// read-only observations, explicit authorization fixtures and rejected boundary
// calls. Successful marking, finalization and backup/restore all use visible UI.
const port = 4198, origin = `http://127.0.0.1:${port}`;
const artifacts = '/tmp/markinator-modes-photo';
const completedScenarios: string[] = [], errors: string[] = [], external: string[] = [];
const startedAt = new Date().toISOString();
async function result(status: 'running' | 'pass' | 'fail', failure?: string) {
  await writeFile(`${artifacts}-results.json`, JSON.stringify({ status, startedAt, completedScenarios, browserErrors: errors, externalRequests: external, physicalCameraVerified: false, nativeDeviceVerified: false, failure }, null, 2));
}
function passed(description: string) { completedScenarios.push(description); console.log(`PASS: ${description}`); }
async function guard(context: BrowserContext) {
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    external.push(url); return route.abort();
  });
}
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
async function official(page: Page, assessmentId: string) {
  const assessments = (await records(page, 'studentAssessments')).filter(row => row.assessmentId === assessmentId);
  const ids = new Set(assessments.map(row => row.id));
  return { assessments, results: (await records(page, 'categoryResults')).filter(row => ids.has(row.studentAssessmentId)), commits: (await records(page, 'markingCommits')).filter(row => row.assessmentId === assessmentId) };
}
async function session(page: Page, attemptId: string) {
  return (await records(page, 'markingSessions')).filter(row => row.attemptId === attemptId).sort((a, b) => b.revision - a.revision)[0];
}
async function saved(page: Page) {
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByTestId('marking-save-status').filter({ hasText: 'Saved locally' }).waitFor();
}
async function reopen(page: Page, assessmentId: string, attemptId: string) {
  await page.reload();
  await page.getByTestId(`open-marking-${assessmentId}`).click();
  await page.getByTestId(`marking-session-open-${attemptId}`).click();
  await page.getByTestId('marking-rubric-evidence').waitFor();
}
async function imageFile(page: Page, number: number, orientation: 2 | 3 | 6 | 8) {
  const base64 = await page.evaluate(number => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
    for (const [color, x, y] of [['#f00000', 0, 0], ['#0000f0', 500, 0], ['#00f000', 0, 700], ['#f0f000', 500, 700]] as const) { ctx.fillStyle = color; ctx.fillRect(x, y, 100, 100); }
    ctx.fillStyle = '#24364a'; ctx.font = '24px sans-serif'; ctx.fillText(`Fictional handwritten page ${number}`, 30, 60);
    ctx.font = '20px cursive';
    for (let row = 0; row < 12; row++) ctx.fillText(`Fictional reasoning ${number}.${row + 1}: explain the evidence.`, 35, 110 + row * 42);
    return canvas.toDataURL('image/jpeg', .95).split(',')[1];
  }, number);
  const bytes = Buffer.from(base64, 'base64');
  // Real JPEG encoded by Chromium plus a minimal valid little-endian EXIF
  // orientation entry. Retaining the original must retain this metadata exactly.
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000000000000000000', 'hex');
  exif.writeUInt16LE(orientation, 24);
  const marker = Buffer.alloc(4); marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(exif.length + 2, 2);
  return { name: `Fictional-page-${number}-EXIF-${orientation}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.concat([bytes.subarray(0, 2), marker, exif, bytes.subarray(2)]) };
}
async function assertOriginalAxes(page: Page, name: string) {
  await page.waitForFunction(name => {
    const canvas = document.querySelector(`canvas[aria-label="Original image preview: ${name}"]`) as HTMLCanvasElement | null;
    if (!canvas || canvas.width !== 600 || canvas.height !== 800 || getComputedStyle(canvas).visibility !== 'visible') return false;
    const pixel = canvas.getContext('2d')!.getImageData(30, 30, 1, 1).data;
    return pixel[0] > 200 && pixel[1] < 30 && pixel[2] < 30;
  }, name);
  const colors = await page.locator(`canvas[aria-label="Original image preview: ${name}"]`).evaluate(node => {
    const canvas = node as HTMLCanvasElement, context = canvas.getContext('2d')!;
    return { width: canvas.width, height: canvas.height, pixels: [[30, 30], [570, 30], [30, 770], [570, 770]].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3)) };
  });
  assert.equal(colors.width, 600); assert.equal(colors.height, 800);
  assert.ok(colors.pixels[0][0] > 200 && colors.pixels[0][1] < 30 && colors.pixels[0][2] < 30, 'raw upper-left red quadrant');
  assert.ok(colors.pixels[1][2] > 200 && colors.pixels[1][0] < 30, 'raw upper-right blue quadrant');
  assert.ok(colors.pixels[2][1] > 200 && colors.pixels[2][0] < 30, 'raw lower-left green quadrant');
  assert.ok(colors.pixels[3][0] > 200 && colors.pixels[3][1] > 200 && colors.pixels[3][2] < 30, 'raw lower-right yellow quadrant');
}
async function stroke(page: Page, tool: 'Pen' | 'Highlight' | 'Add comment', start: { x: number; y: number }, end?: { x: number; y: number }) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const surface = page.getByTestId('image-annotation-surface'); await surface.waitFor({ state: 'visible' }); await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * start.x, box.y + box.height * start.y);
  await page.mouse.down();
  if (end) await page.mouse.move(box.x + box.width * end.x, box.y + box.height * end.y, { steps: 8 });
  await page.mouse.up();
}
async function delayedPreview(page: Page, attemptId: string, action: () => Promise<unknown>) {
  const surface = page.getByTestId('image-annotation-surface');
  await surface.scrollIntoViewIfNeeded(); const box = await surface.boundingBox(); assert.ok(box);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    let release: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    (window as any).releaseFictionalImageDecode = () => { window.createImageBitmap = original; release(); };
    window.createImageBitmap = (async (...args: any[]) => { await gate; return (original as any)(...args); }) as typeof createImageBitmap;
  });
  await action();
  await page.getByText('Loading original image…', { exact: true }).waitFor();
  assert.equal(await surface.isVisible(), false, 'stale annotation surface is hidden while matching pixels decode');
  assert.equal(await page.locator('canvas').isVisible(), false, 'stale original pixels are hidden');
  await page.mouse.click(box.x + box.width * .5, box.y + box.height * .4);
  await saved(page);
  assert.ok((await session(page, attemptId)).draft.imageFeedback.every((item: any) => item.annotations.length === 0), 'pointer cannot mark new page/transform before its matching preview');
  await page.evaluate(() => { (window as any).releaseFictionalImageDecode(); delete (window as any).releaseFictionalImageDecode; });
  await surface.waitFor({ state: 'visible' });
}

await result('running');
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
let activePage: Page | undefined;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); await guard(context);
  const page = activePage = await context.newPage(); await page.goto(origin);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill('Fictional modes and photo acceptance');
  await page.getByRole('button', { name: /Create Assessment|Save Assessment/ }).click();
  let assessment: any;
  for (let i = 0; i < 40; i++) {
    assessment = (await records(page, 'assessments')).find(row => row.title === 'Fictional modes and photo acceptance');
    if (assessment) break;
    await page.waitForTimeout(100);
  }
  assert.ok(assessment);
  const actorId = await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id')); assert.ok(actorId);
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByTestId('marking-mode-written').waitFor();
  for (const mode of ['written', 'oral', 'rubric']) assert.equal(await page.getByTestId(`marking-mode-${mode}`).count(), 1);
  await page.getByTestId('marking-mode-written').click();
  await page.getByLabel('Paste rubric text or table').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited\tSome\tClear\tThorough\nOrganization\tLimited structure\tSome structure\tClear structure\tStrong structure');
  await page.getByRole('button', { name: 'Preview pasted rubric', exact: true }).click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional modes rubric');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByLabel('Criterion 2 KTAC mapping').selectOption('C');
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version', exact: true }).click();
  const rubric = (await records(page, 'markingRubrics')).find(row => row.assessmentId === assessment.id); assert.ok(rubric);
  const criterionId = rubric.criteria[0].id;
  const student = page.getByTestId('marking-image-student');
  const enrollmentIds = await student.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  assert.ok(enrollmentIds.length >= 2);

  // Seed a nonempty official baseline through the established markbook service,
  // so preservation assertions cannot pass merely because the gradebook is empty.
  const fixturePage = await context.newPage(); await fixturePage.goto(origin);
  const otherTeacherId = await fixturePage.evaluate(async ({ actorId, assessmentId, enrollmentId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', servicePath = '/src/services/markbookService.ts', authPath = '/src/services/authHelper.ts';
    const { db } = await import(dbPath), { selectActingTeacher } = await import(identityPath), { MarkbookDomainService } = await import(servicePath), { assertClassSectionWriteAccess } = await import(authPath);
    const actor = await selectActingTeacher(db, actorId), assessment = await db.assessments.get(assessmentId);
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray()).find((row: any) => row.categoryCode === 'K' && row.deletedAt === null);
    const sa = await db.studentAssessments.where({ assessmentId, classEnrollmentId: enrollmentId }).first();
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId, classSectionId: assessment.classSectionId, classEnrollmentId: enrollmentId, assessmentCategoryId: category.id, rawScore: '2+', inputFormat: 'scale_code', feedback: 'Fictional existing manual K judgment', expectedStudentAssessmentVersion: sa?.version, userId: actor.userId, deviceId: actor.deviceId });
    return db.transaction('rw', db.tables, async () => {
      await assertClassSectionWriteAccess(db, actor.userId, assessment.classSectionId);
      const member = await db.organizationMemberships.where('userId').equals(actor.userId).first();
      const staff = await db.classSectionStaff.where('classSectionId').equals(assessment.classSectionId).first();
      const now = new Date().toISOString(), id = crypto.randomUUID(), memberId = crypto.randomUUID();
      await db.users.add({ ...actor.user, id, authSubject: 'fictional-modes-photo-qa', name: 'Jordan Fictional Modes QA', email: 'modes.qa@example.invalid', createdAt: now, updatedAt: now });
      await db.organizationMemberships.add({ ...member, id: memberId, userId: id, createdAt: now, updatedAt: now });
      await db.classSectionStaff.add({ ...staff, id: crypto.randomUUID(), organizationMembershipId: memberId, role: 'co_teacher', createdAt: now, updatedAt: now });
      return id;
    });
  }, { actorId, assessmentId: assessment.id, enrollmentId: enrollmentIds[0] });
  const baseline = await official(page, assessment.id); assert.equal(baseline.results.length, 1);

  const files = [await imageFile(page, 1, 6), await imageFile(page, 2, 3), await imageFile(page, 3, 8), await imageFile(page, 4, 2)];
  assert.equal(await page.getByTestId('marking-image-capture').getAttribute('capture'), 'environment');
  // Headless desktop has no physical camera. Exercise its real file-input
  // fallback, then replace the unsaved preview with the multiple-file import.
  await page.getByTestId('marking-image-capture').setInputFiles(files[0]);
  await page.getByAltText(`Preview ${files[0].name}`, { exact: true }).waitFor();
  await page.getByTestId('marking-image-capture').setInputFiles(files[2]);
  await page.getByAltText(`Preview ${files[2].name}`, { exact: true }).waitFor();
  await page.getByTestId('marking-image-capture').setInputFiles(files[1]);
  await page.getByAltText(`Preview ${files[1].name}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Photographed work import' }).locator('img').count(), 3);
  await page.getByTestId('marking-image-capture').setInputFiles([]);
  assert.equal(await page.getByRole('region', { name: 'Photographed work import' }).locator('img').count(), 3, 'cancelled capture retains pending pages');
  assert.equal((await records(page, 'markingAttempts')).length, 0);
  await page.getByTestId('marking-image-files').setInputFiles(files);
  await page.getByAltText(`Preview ${files[3].name}`, { exact: true }).waitFor();
  await page.getByAltText(`Preview ${files[1].name}`, { exact: true }).waitFor();
  await page.getByAltText(`Preview ${files[2].name}`, { exact: true }).waitFor();
  await page.waitForFunction(name => document.querySelector('[aria-label="Photographed work import"] img:nth-of-type(1)') !== null && Array.from(document.querySelectorAll('[aria-label="Photographed work import"] img'))[1]?.getAttribute('alt') === `Preview ${name}`, files[1].name);
  assert.deepEqual(await page.getByRole('region', { name: 'Photographed work import' }).locator('img').evaluateAll(nodes => nodes.map(node => node.getAttribute('alt'))), files.map(file => `Preview ${file.name}`), 'local batch replaces capture preview in chosen order');
  await student.selectOption(enrollmentIds[0]);
  await page.getByTestId('marking-image-confirm').click();
  await page.getByTestId('image-markup').waitFor();
  await page.waitForFunction(() => { const canvas = document.querySelector('canvas'); return canvas?.width === 600 && canvas.height === 800; });
  await assertOriginalAxes(page, files[0].name);
  for (const file of files.slice(1)) { await page.getByRole('button', { name: 'Next page', exact: true }).click(); await assertOriginalAxes(page, file.name); }
  for (let i = 1; i < files.length; i++) await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  const photo = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id && row.imagePages?.length === files.length); assert.ok(photo);
  assert.equal(photo.mode, 'written'); assert.equal(photo.classEnrollmentId, enrollmentIds[0]);
  for (const [i, image] of photo.imagePages.entries()) assert.equal(image.base64, files[i].buffer.toString('base64'));
  await delayedPreview(page, photo.id, () => page.getByRole('button', { name: 'Next page', exact: true }).click());
  await assertOriginalAxes(page, files[1].name);
  await delayedPreview(page, photo.id, () => page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click());
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click(); await page.getByTestId('image-annotation-surface').waitFor({ state: 'visible' }); }
  await assertOriginalAxes(page, files[1].name);
  await delayedPreview(page, photo.id, () => page.getByLabel('Crop width', { exact: true }).fill('80'));
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click();
  await page.getByTestId('image-annotation-surface').waitFor({ state: 'visible' });
  await assertOriginalAxes(page, files[1].name);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.getByTestId('image-annotation-surface').waitFor({ state: 'visible' });
  passed('delayed real image decoder during page switch, rotation and crop hides stale pixels/surface and blocks pointer marks until exact preview is ready; raw original axes recover after reset.');
  await stroke(page, 'Pen', { x: .2, y: .2 }, { x: .7, y: .3 });
  await stroke(page, 'Highlight', { x: .2, y: .35 }, { x: .65, y: .35 });
  await stroke(page, 'Add comment', { x: .4, y: .5 });
  await page.getByLabel('Image comment text', { exact: true }).fill('Fictional page comment before edit');
  await page.getByLabel('Image criterion', { exact: true }).selectOption(criterionId);
  await page.getByLabel('Image level', { exact: true }).selectOption('Level 3');
  await page.getByLabel('Crop width', { exact: true }).fill('80');
  await page.getByLabel('Crop height', { exact: true }).fill('70');
  await page.getByLabel('Crop x', { exact: true }).fill('10');
  await page.getByLabel('Crop y', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click();
  await page.getByRole('button', { name: 'Move page later', exact: true }).click();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await assertOriginalAxes(page, files[1].name);
  await stroke(page, 'Pen', { x: .15, y: .2 }, { x: .55, y: .5 });
  await page.getByTestId(`marking-criterion-level-${criterionId}`).selectOption('Level 4');
  await page.getByTestId(`marking-criterion-feedback-${criterionId}`).fill('Fictional photo rubric feedback');
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill('Fictional photo draft');
  // Wait for actual autosave without pressing Save now.
  for (let i = 0; i < 80 && (await session(page, photo.id)).draft.overallFeedback !== 'Fictional photo draft'; i++) await page.waitForTimeout(100);
  const photoSaved = await session(page, photo.id);
  assert.equal(photoSaved.draft.overallFeedback, 'Fictional photo draft');
  assert.deepEqual(photoSaved.draft.imageFeedback.map((row: any) => row.pageId), [photo.imagePages[1].id, photo.imagePages[0].id, ...photo.imagePages.slice(2).map((row: any) => row.id)]);
  const transformed = photoSaved.draft.imageFeedback.find((row: any) => row.pageId === photo.imagePages[0].id);
  assert.equal(transformed.rotation, 90); assert.deepEqual(transformed.crop, { x: .1, y: .2, width: .8, height: .7 });
  assert.deepEqual(transformed.annotations.map((row: any) => row.kind), ['pen', 'highlight', 'comment']);
  assert.ok(transformed.annotations[0].points.length >= 2);
  assert.ok(Math.abs(transformed.annotations[0].points[0].x - .2) < .01 && Math.abs(transformed.annotations[0].points[0].y - .2) < .01, 'pen anchor remains in original pixels after crop/rotation');
  assert.ok(Math.abs(transformed.annotations[2].points[0].x - .4) < .01 && Math.abs(transformed.annotations[2].points[0].y - .5) < .01, 'comment anchor remains in original pixels after crop/rotation');
  assert.equal(photoSaved.draft.imageFeedback[0].annotations.length, 1);
  assert.deepEqual(await official(page, assessment.id), baseline);
  await page.screenshot({ path: `${artifacts}-photo-markup.png`, fullPage: true });
  passed('capture file fallback accumulates EXIF 6/8/3 pages and cancellation retains preview; four-page local replacement/import renders original EXIF6/3/8/2 pixel axes including mirror metadata; real pointer pen/highlight/comment, crop, rotation, reorder and autosave; retained JPEG bytes and manual grade unchanged.');

  await reopen(page, assessment.id, photo.id);
  assert.deepEqual((await session(page, photo.id)).draft, photoSaved.draft);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByLabel('Select saved mark', { exact: true }).selectOption(transformed.annotations[2].id);
  await page.getByLabel('Image comment text', { exact: true }).fill('Fictional edited photo comment');
  await saved(page);
  assert.equal((await session(page, photo.id)).draft.imageFeedback[1].annotations[2].text, 'Fictional edited photo comment');
  assert.deepEqual((await records(page, 'markingAttempts')).find(row => row.id === photo.id), photo);
  // Existing K must be explicitly retained; evidence labels never choose T.
  await page.getByRole('checkbox', { name: 'Assess K', exact: true }).check();
  await page.getByLabel('Official K judgment', { exact: true }).selectOption('2+');
  await page.getByLabel('Category K feedback', { exact: true }).fill('Fictional existing manual K judgment');
  await page.getByRole('checkbox', { name: 'Assess T', exact: true }).check();
  await page.getByLabel('Official T judgment', { exact: true }).selectOption('3+');
  await page.getByTestId('marking-finalize-preview').click();
  assert.deepEqual(await official(page, assessment.id), baseline, 'preview does not finalize');
  await page.getByTestId('marking-finalize-confirm').click();
  await page.getByText('Finalized revision — current official results shown below', { exact: false }).waitFor();
  const committed = await official(page, assessment.id);
  assert.equal(committed.commits.length, 1); assert.equal(committed.results.length, 2);
  assert.ok(committed.results.some(row => row.rawScore === '2+')); assert.ok(committed.results.some(row => row.rawScore === '3+'));
  const finalizedSession = await session(page, photo.id);
  await page.getByRole('region', { name: 'Marking session', exact: true }).getByRole('button', { name: 'Reopen as draft revision', exact: true }).click();
  await page.getByText('Revision 2', { exact: false }).waitFor();
  await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill('Fictional photo revision recovered');
  await saved(page);
  assert.deepEqual(await official(page, assessment.id), committed);
  assert.deepEqual((await records(page, 'markingSessions')).find(row => row.id === finalizedSession.id), finalizedSession);
  passed('reload recovered complete photo draft; comment edit kept original bytes; preview/confirmed finalization preserved K, wrote reviewed T once; revision two leaves official grades and finalized history intact.');

  const nonwritten: { attempt: any; saved: any }[] = [];
  for (const mode of ['oral', 'rubric'] as const) {
    await page.getByTestId(`marking-mode-${mode}`).click();
    await page.getByTestId('marking-mode-student').selectOption(enrollmentIds[1]);
    await page.getByTestId('marking-mode-create').click();
    await page.getByTestId('marking-rubric-evidence').waitFor();
    const attempt = (await records(page, 'markingAttempts')).find(row => row.assessmentId === assessment.id && row.mode === mode); assert.ok(attempt);
    assert.equal(attempt.classEnrollmentId, enrollmentIds[1]); assert.deepEqual(attempt.documents, []);
    assert.equal(await page.getByTestId('image-markup').count(), 0); assert.equal(await page.getByTestId('marking-document').count(), 0);
    if (mode === 'oral') {
      await page.getByTestId('marking-oral-add-item').click();
      await page.getByLabel('Checklist item 1 label', { exact: true }).fill('Explains fictional evidence clearly');
      await page.getByRole('checkbox', { name: /Checklist item 1 observed/ }).check();
      await page.getByLabel('Checklist item 1 private note', { exact: true }).fill('Fictional private item note');
      await page.getByTestId('marking-oral-private-notes').fill('Fictional private presentation notes');
      await page.getByRole('button', { name: 'Remove checklist item 1', exact: true }).click();
      await page.getByRole('group', { name: 'Confirm removal of checklist item 1', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Keep checklist item', exact: true }).click();
      await page.getByTestId('marking-oral-add-item').click();
      await page.getByLabel('Checklist item 2 label', { exact: true }).fill('Addresses the fictional audience');
    } else assert.equal(await page.getByTestId('marking-oral-evidence').count(), 0);
    await page.getByTestId(`marking-criterion-level-${criterionId}`).selectOption(mode === 'oral' ? 'Level 3' : 'Level 2');
    await page.getByTestId(`marking-criterion-feedback-${criterionId}`).fill(`Fictional ${mode} rubric feedback`);
    await page.getByRole('textbox', { name: /^Overall student-facing feedback/ }).fill(`Fictional ${mode} overall draft`);
    await saved(page); const stored = await session(page, attempt.id);
    assert.equal(stored.draft.overallFeedback, `Fictional ${mode} overall draft`);
    assert.equal(stored.draft.rubricFeedback[0].feedback, `Fictional ${mode} rubric feedback`);
    if (mode === 'oral') { assert.equal(stored.draft.oral.items.length, 2); assert.equal(stored.draft.oral.items[0].checked, true); assert.equal(stored.draft.oral.notes, 'Fictional private presentation notes'); }
    await reopen(page, assessment.id, attempt.id);
    assert.equal(await page.getByTestId(`marking-criterion-feedback-${criterionId}`).inputValue(), `Fictional ${mode} rubric feedback`);
    if (mode === 'oral') assert.equal(await page.getByTestId('marking-oral-private-notes').inputValue(), stored.draft.oral.notes);
    assert.deepEqual((await session(page, attempt.id)).draft, stored.draft);
    assert.deepEqual(await official(page, assessment.id), committed);
    await page.screenshot({ path: `${artifacts}-${mode}.png`, fullPage: true });
    nonwritten.push({ attempt, saved: stored });
    passed(`${mode} mode created against confirmed rubric/student; ${mode === 'oral' ? 'custom checklist, private notes, removal cancellation and ' : ''}rubric evidence saved/reopened after reload without grade changes.`);
  }

  // Simulate the supported older serialized shape, where the optional evidence
  // field did not exist. Only the fixture migration shape bypasses UI.
  const legacy = nonwritten[1];
  await fixturePage.evaluate(async sessionId => {
    const path = '/src/db/database.ts', { db } = await import(path);
    const stored = await db.markingSessions.get(sessionId);
    const draft = { ...stored.draft }; delete draft.rubricFeedback;
    await db.markingSessions.put({ ...stored, draft });
  }, legacy.saved.id);
  await reopen(page, assessment.id, legacy.attempt.id);
  await page.getByTestId(`marking-criterion-feedback-${criterionId}`).fill('Fictional legacy first-criterion edit');
  await saved(page); legacy.saved = await session(page, legacy.attempt.id);
  assert.deepEqual(legacy.saved.draft.rubricFeedback.map((row: any) => row.criterionId), rubric.criteria.map((row: any) => row.id));
  assert.equal(legacy.saved.draft.rubricFeedback[0].feedback, 'Fictional legacy first-criterion edit');
  await reopen(page, assessment.id, legacy.attempt.id);
  assert.equal(await page.getByTestId(`marking-criterion-feedback-${criterionId}`).inputValue(), 'Fictional legacy first-criterion edit');
  assert.deepEqual(await official(page, assessment.id), committed);
  passed('legacy optional rubric evidence absent: editing one of two pinned criteria saves/reloads a complete criterion matrix without grade changes.');

  // Rejected boundary calls are deliberately domain checks, not claimed UI flows.
  // A rejected URI never becomes an img src; wrong-teacher private records must
  // remain unavailable even to an otherwise authorized co-teacher of this class.
  const boundary = await fixturePage.evaluate(async ({ actorId, otherTeacherId, assessmentId, rubricId, photoId, photoSessionId }) => {
    const dbPath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts', markingPath = '/src/marking/markingService.ts';
    const { db } = await import(dbPath), { selectActingTeacher, getIdentityEpoch } = await import(identityPath), { MarkingService } = await import(markingPath);
    const service = new MarkingService(db), identity = await selectActingTeacher(db, actorId);
    const actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    const photo = await db.markingAttempts.get(photoId), original = photo.imagePages[0];
    const before = Object.fromEntries(await Promise.all(['markingAttempts', 'markingSessions', 'markingCommits', 'auditEntries'].map(async table => [table, await db.table(table).toArray()])));
    const messages: string[] = [];
    const finalized = await db.markingSessions.get(photoSessionId);
    const retriedCommit = await service.finalize(finalized.id, finalized.version, actor);
    for (const base64 of ['https://fictional.invalid/student.png', 'data:image/png;base64,' + original.base64, 'file:///private/fictional.png']) {
      try { await service.importImageAttempt(assessmentId, rubricId, [{ ...original, id: crypto.randomUUID(), base64 }], null, actor); messages.push('UNEXPECTED success'); }
      catch (error) { messages.push((error as Error).message); }
    }
    try { await service.createModeAttempt(assessmentId, rubricId, 'oral', '', actor); messages.push('UNEXPECTED unmatched success'); }
    catch (error) { messages.push((error as Error).message); }
    const nextIdentity = await selectActingTeacher(db, otherTeacherId);
    const other = { userId: nextIdentity.userId, deviceId: nextIdentity.deviceId, epoch: getIdentityEpoch() };
    const foreignContext = await service.getContext(assessmentId, other);
    try { await service.openSession(photoId, other); messages.push('UNEXPECTED foreign open success'); }
    catch (error) { messages.push((error as Error).message); }
    const stored = await db.markingSessions.get(photoSessionId);
    try { await service.saveDraft(stored.id, stored.draft, stored.version, other); messages.push('UNEXPECTED foreign write success'); }
    catch (error) { messages.push((error as Error).message); }
    await selectActingTeacher(db, actorId);
    const after = Object.fromEntries(await Promise.all(Object.keys(before).map(async table => [table, await db.table(table).toArray()])));
    return { before, after, messages, foreignAttempts: foreignContext.attempts.length, retriedCommitId: retriedCommit.id };
  }, { actorId, otherTeacherId, assessmentId: assessment.id, rubricId: rubric.id, photoId: photo.id, photoSessionId: finalizedSession.id });
  assert.equal(boundary.messages.length, 6); assert.ok(boundary.messages.every(message => !message.startsWith('UNEXPECTED')));
  assert.equal(boundary.foreignAttempts, 0); assert.deepEqual(boundary.after, boundary.before);
  assert.equal(boundary.retriedCommitId, committed.commits[0].id, 'finalization retry returns immutable prior commit');
  assert.deepEqual(await official(page, assessment.id), committed);
  passed('domain boundary regressions reject remote/data/file image URIs, unconfirmed student and wrong-teacher open/write; finalized retry returns same commit; attempts, drafts, commits, audit and official grades unchanged.');

  const tables = ['markingAttempts', 'markingSessions', 'markingRubrics', 'markingCommits'];
  const before = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await records(page, table)).filter(row => row.assessmentId === assessment.id)])));
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId('nav-portability-btn').click();
  const download = page.waitForEvent('download'); await page.getByTestId('create-backup-btn').click();
  await (await download).saveAs(`${artifacts}-backup.json`);
  const backup = JSON.parse(await readFile(`${artifacts}-backup.json`, 'utf8'));
  assert.equal(backup.tables.markingAttempts.filter((row: any) => row.assessmentId === assessment.id).length, 3);
  const restoredContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); await guard(restoredContext);
  const restored = activePage = await restoredContext.newPage(); await restored.goto(origin);
  await restored.locator('[data-testid^="select-teacher-"]').first().click();
  await restored.getByTestId('nav-portability-btn').click();
  await restored.getByTestId('restore-file-input').setInputFiles(`${artifacts}-backup.json`);
  await restored.getByTestId('restore-confirm-dialog').waitFor();
  assert.equal((await records(restored, 'markingAttempts')).length, 0, 'backup preview has no writes');
  await restored.getByTestId('confirm-restore-btn').click();
  await restored.getByText(/Database successfully restored/).waitFor();
  for (const table of tables) assert.deepEqual((await records(restored, table)).filter(row => row.assessmentId === assessment.id), before[table], `${table} restores exactly`);
  assert.deepEqual(await official(restored, assessment.id), committed);
  await restored.reload();
  if (await restored.getByTestId(`select-teacher-${actorId}`).count()) await restored.getByTestId(`select-teacher-${actorId}`).click();
  await restored.getByTestId('nav-dashboard-btn').click();
  await restored.getByTestId('chiclet-open-overlay-btn').first().click();
  await restored.getByRole('button', { name: 'Assessments', exact: true }).click();
  await restored.getByTestId(`open-marking-${assessment.id}`).click();
  await restored.getByTestId(`marking-session-open-${photo.id}`).click();
  await restored.getByTestId('image-markup').waitFor();
  assert.equal(await restored.getByRole('textbox', { name: /^Overall student-facing feedback/ }).inputValue(), 'Fictional photo revision recovered');
  assert.deepEqual((await records(restored, 'markingAttempts')).find(row => row.id === photo.id).imagePages, photo.imagePages);
  await restored.getByRole('button', { name: 'Next page', exact: true }).click();
  await restored.getByLabel('Select saved mark', { exact: true }).selectOption(transformed.annotations[2].id);
  assert.equal(await restored.getByLabel('Image comment text', { exact: true }).inputValue(), 'Fictional edited photo comment');
  await restored.getByRole('button', { name: 'Next page', exact: true }).click(); await assertOriginalAxes(restored, files[2].name);
  await restored.getByRole('button', { name: 'Next page', exact: true }).click(); await assertOriginalAxes(restored, files[3].name);
  for (const { attempt, saved: stored } of nonwritten) {
    await restored.getByTestId(`marking-session-open-${attempt.id}`).click();
    await restored.waitForFunction(({ criterionId, feedback }) => (document.querySelector(`[data-testid="marking-criterion-feedback-${criterionId}"]`) as HTMLTextAreaElement | null)?.value === feedback, { criterionId, feedback: stored.draft.rubricFeedback[0].feedback });
    assert.equal(await restored.getByTestId(`marking-criterion-feedback-${criterionId}`).inputValue(), stored.draft.rubricFeedback[0].feedback);
    if (attempt.mode === 'oral') assert.equal(await restored.getByTestId('marking-oral-private-notes').inputValue(), stored.draft.oral.notes);
  }
  await restored.screenshot({ path: `${artifacts}-restored.png`, fullPage: true });
  assert.deepEqual(await official(restored, assessment.id), committed);
  passed('actual full backup download and clean-profile preview/confirmed restore recover exact photo bytes/transforms/edited marks, finalized history and revision, oral checklist/private notes, rubric-only draft and official records; reopened UI verifies evidence.');
  assert.deepEqual(errors, [], 'browser errors'); assert.deepEqual(external, [], 'external requests');
  passed('zero external requests and browser exceptions; physical camera and native Windows/iPad interactions remain unverified.');
  await result('pass');
} catch (error) {
  if (activePage) await activePage.screenshot({ path: `${artifacts}-failure.png`, fullPage: true }).catch(() => {});
  await result('fail', error instanceof Error ? error.stack : String(error));
  throw error;
} finally { await browser.close(); await server.close(); }
