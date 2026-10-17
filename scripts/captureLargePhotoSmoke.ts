import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { encodeCapturePackage, capturePagePath, captureSha256, type CaptureManifest } from '../shared/capturePackage';

const origin = 'http://127.0.0.1:4233';
const server = await createServer({ server: { host: '127.0.0.1', port: 4233, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  // Browser-generated fictional image: uncompressed random pixels yield a real
  // camera-sized PNG, exercising browser decode as well as retained-byte checks.
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1200;
    const context = canvas.getContext('2d')!, pixels = context.createImageData(1200, 1200);
    let state = 42;
    for (let i = 0; i < pixels.data.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; pixels.data[i] = state >>> 24; }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64')); assert.ok(bytes.length > 4 * 1024 * 1024);
  const hash = await captureSha256(bytes), files: Record<string, Uint8Array> = {};
  const manifest: CaptureManifest = { format: 'studentorganizer-capture', version: 2, packageId: 'large-fictional', assignmentId: 'fictional-assignment', assignmentName: 'Large fictional photos', revision: 1, completed: true, submissions: [] };
  for (let s = 0; s < 2; s++) {
    const id = `large-set-${s}`, pageId = `large-page-${s}`, path = capturePagePath(id, pageId, 'image/png'); files[path] = bytes;
    manifest.submissions.push({ id, label: 'Fictional same name', pages: [{ id: pageId, order: 0, path, mime: 'image/png', byteLength: bytes.length, sha256: hash, edits: { rotation: 90, crop: { x: 0, y: 0, width: .5, height: 1 } } }] });
  }
  console.log(`Generated ${bytes.length}-byte fictional photo.`);
  const zip = await encodeCapturePackage(manifest, files);
  const rows = (table: string): Promise<any[]> => page.evaluate(async table => { const path = '/src/db/database.ts'; return (await import(path)).db.table(table).toArray(); }, table);
  const before = await rows('studentAssessments');
  const idle = () => page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled === false);
  async function open() { await page.getByRole('button', { name: 'Assessments', exact: true }).click(); await page.locator('[data-testid^="upload-pictures-"]').first().click(); await idle(); }
  console.log('Opening matching.');
  await open();
  await page.getByTestId('capture-zip').setInputFiles({ name: 'fictional-large.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  for (const submission of manifest.submissions) {
    await page.getByTestId(`capture-set-${submission.id}`).click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
    await page.getByTestId(`capture-set-${submission.id}`).getByText(/^Saved to /).waitFor(); await idle();
  }
  console.log('Both photo groups saved.');
  const attachments = await rows('captureAttachments'), receipts = await rows('captureImportReceipts');
  assert.equal(attachments.length, 2);
  assert.equal(new Set(attachments.map(saved => saved.classEnrollmentId)).size, 2);
  const rubricId = await page.evaluate(async assessmentId => {
    const d = '/src/db/database.ts', m = '/src/marking/markingService.ts', i = '/src/services/identityService.ts';
    const { db } = await import(d), identity = await import(i), userId = identity.getActiveTeacherId(), device = await db.devices.where('userId').equals(userId).first();
    return (await new (await import(m)).MarkingService(db).saveRubric(assessmentId, { title: 'Fictional photo rubric', levels: ['Clear'], criteria: [{ id: 'evidence', name: 'Evidence', categoryCode: 'K', descriptors: { Clear: 'Clear evidence' } }] }, { userId, deviceId: device.id, epoch: identity.getIdentityEpoch() })).id;
  }, attachments[0].assessmentId);
  page.on('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Close matching' }).click(); await open(); await page.getByTestId('capture-rubric').selectOption(rubricId);
  for (const saved of attachments) {
    await page.getByTestId(`capture-start-${saved.id}`).click();
    await page.getByRole('status').filter({ hasText: 'associated with marking' }).waitFor(); await idle();
  }
  const attempts = await rows('markingAttempts'); assert.equal(attempts.length, 2);
  const linked = await rows('captureAttachments');
  for (const saved of attachments) {
    const root = linked.find(row => row.id === saved.id); assert.ok(root?.markingAttemptId);
    const attempt = attempts.find(a => a.id === root.markingAttemptId); assert.ok(attempt);
    assert.equal(attempt.classEnrollmentId, saved.classEnrollmentId);
    assert.equal(attempt.imagePages[0].hash, hash); assert.equal(attempt.imagePages[0].base64, encoded);
  }
  await page.reload(); const teacher = page.locator('[data-testid^="select-teacher-"]').first(); if (await teacher.isVisible()) await teacher.click();
  await open(); await page.getByTestId('capture-zip').setInputFiles({ name: 'fictional-large.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.getByRole('status').filter({ hasText: '2 already saved' }).waitFor(); await idle();
  assert.equal((await rows('markingAttempts')).length, 2); assert.deepEqual(await rows('captureImportReceipts'), receipts); assert.deepEqual(await rows('studentAssessments'), before);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.screenshot({ path: '/tmp/capture-large-photo.png', fullPage: true });
  console.log(`PASS ${bytes.length}-byte generated PNG: ZIP import, two explicit UI starts, exact retained bytes and student attribution, reload/reimport deduplication, unchanged marks, no browser errors/external requests.`);
} finally { await browser.close(); await server.close(); }
