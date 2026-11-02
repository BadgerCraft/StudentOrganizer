import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { openUnifiedMarking } from './helpers/unifiedMarking';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { pixelCaptureFixture } from './helpers/pixelCaptureFixture';

const origin = 'http://127.0.0.1:4247', output = '/tmp/studentorganizer-qa05';
await mkdir(output, { recursive: true });
const fixture = await pixelCaptureFixture();
const server = await createServer({ cacheDir: '/tmp/studentorganizer-qa05-vite', server: { host: '127.0.0.1', port: 4247, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(90_000);
  const errors: string[] = [], external: string[] = [];
  page.on('dialog', dialog => void dialog.accept()); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page); await page.locator('[data-testid^="select-teacher-"]').first().click();
  await openUnifiedMarking(page);
  await page.getByTestId('capture-zip').setInputFiles({ name: 'fictional-pixel-pages.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.zip) });
  await page.getByTestId('capture-set-pixel-student').click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
  await page.getByTestId('image-markup').waitFor();
  for (let index = 0; index < 5; index++) {
    await page.getByTestId('image-markup').getByText(new RegExp(`Page ${index + 1} of 5:`)).waitFor();
    await page.locator('canvas[aria-label^="Original image preview"]').waitFor({ state: 'visible' });
    if (index < 4) await page.getByRole('button', { name: 'Next page', exact: true }).click();
  }
  console.log(`PASS UI ZIP→match→one attempt→five decoded pages (${fixture.bytes.length * 5} pixel bytes)`);
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  const result = await page.evaluate(async ({ hash, size }) => {
    const d = '/src/db/database.ts', m = '/src/marking/markingService.ts', i = '/src/services/identityService.ts', p = '/src/services/portabilityService.ts', r = '/src/marking/annotatedReport.ts';
    const { db } = await import(d), identity = await import(i), marking = new (await import(m)).MarkingService(db);
    const userId = identity.getActiveTeacherId(), device = await db.devices.where('userId').equals(userId).first();
    const actor = { userId, deviceId: device.id, epoch: identity.getIdentityEpoch() };
    const attempts = await db.markingAttempts.toArray(); if (attempts.length !== 1) throw new Error('Expected one attempt'); const attempt = attempts[0];
    if (attempt.imagePages.length !== 5 || attempt.imagePages.some((page: any) => !page.captureRef || page.base64 || page.hash !== hash || page.size !== size)) throw new Error('Reference representation mismatch');
    const originals = (await db.captureAttachments.toArray())[0].pages.map((page: any) => page.base64);
    let session = await marking.openSession(attempt.id, actor);
    session.draft.overallFeedback = 'Fictional retained annotation report';
    session.draft.imageFeedback[0].annotations = [{ id: 'fictional-comment', kind: 'comment', points: [{ x: .3, y: .4 }], color: 'red', width: .004, text: 'Fictional evidence comment', criterionId: 'fictional-evidence', level: 'Clear' }];
    session.draft.judgments.forEach((judgment: any) => Object.assign(judgment, { assessed: true, rawScore: '4+', inputFormat: 'scale_code' }));
    session = await marking.saveDraft(session.id, session.draft, session.version, actor); const commit = await marking.finalize(session.id, session.version, actor);
    await marking.finalize(session.id, session.version, actor);
    const portability = new (await import(p)).PortabilityService(db); const backup = await portability.createFullBackupJSON(); await portability.restoreFromJSON(backup);
    db.close(); await db.open();
    for (let index = 0; index < 5; index++) if ((await marking.readImagePage(attempt.id, attempt.imagePages[index].id, actor)).base64 !== originals[index]) throw new Error('Original bytes changed');
    const html = await (await import(r)).renderAnnotatedMarkingReport(await marking.exportContext(commit.id, actor), (pageId: string) => marking.readImagePage(attempt.id, pageId, actor));
    return { html, backupBytes: new TextEncoder().encode(backup).length, attemptId: attempt.id, commitId: commit.id, result: (await db.categoryResults.toArray()).filter((value: any) => value.source === 'marking') };
  }, { hash: fixture.hash, size: fixture.bytes.length });
  assert.equal((result.html.match(/class="marked-page"/g) ?? []).length, 5); assert.match(result.html, /Fictional evidence comment/);
  const report = await browser.newPage(); await report.setContent(result.html); await report.evaluate(() => Promise.all(Array.from(document.images).map(image => image.decode())));
  const pdf = await report.pdf({ format: 'A4' }); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await writeFile(`${output}/fictional-reference-report.pdf`, pdf); await report.close();
  await page.reload(); const teacher = page.locator('[data-testid^="select-teacher-"]').first(); if (await teacher.isVisible()) await teacher.click();
  await openUnifiedMarking(page); await page.getByTestId('capture-zip').setInputFiles({ name: 'fictional-pixel-pages.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.zip) });
  await page.getByRole('status').filter({ hasText: '1 already saved' }).waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`PASS same-attempt draft/finalize/retry/reopen/backup+restore exact five originals/annotated5page PDF (${pdf.length} bytes), backup=${result.backupBytes}, reload dedup, zero browser errors/external requests`);
} finally { await browser.close(); await server.close(); }
