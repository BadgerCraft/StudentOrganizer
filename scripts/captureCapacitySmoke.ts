/** Optional realistic capacity gate. Input must be a fictional phone-exported package. */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';

const zipPath = process.env.CAPTURE_CAPACITY_ZIP || '/tmp/capture-class-capacity.zip';
const file = await stat(zipPath);
assert.ok(file.isFile() && file.size <= 256 * 1024 * 1024, 'Provide a bounded fictional phone ZIP.');
const origin = 'http://127.0.0.1:4233';
const server = await createServer({ server: { host: '127.0.0.1', port: 4233, strictPort: true, watch: null, hmr: false }, plugins: [{ name: 'fictional-capacity-input', configureServer(vite) {
  vite.middlewares.use('/fictional-capacity.zip', (_request, response) => {
    response.setHeader('Content-Type', 'application/zip'); response.setHeader('Content-Length', file.size);
    const stream = createReadStream(zipPath); stream.on('error', error => response.destroy(error)); stream.pipe(response);
  });
} }] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(); const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('CAPACITY ')) console.log(message.text()); });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.addInitScript('globalThis.__name = (fn) => fn');
  await page.goto(origin); await installFictionalClassroom(page);
  const result = await page.evaluate(async () => {
    const run = async () => {
      const databasePath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts';
      const servicePath = '/src/capture/attachmentService.ts', protocolPath = '/shared/capturePackage.ts';
      const backupPath = '/src/capture/backupCapacity.ts', portabilityPath = '/src/services/portabilityService.ts';
      const { db } = await import(databasePath);
      const { selectActingTeacher, getIdentityEpoch } = await import(identityPath);
      const { CaptureAttachmentService } = await import(servicePath);
      const { decodeCapturePackage, captureSha256 } = await import(protocolPath);
      const { assertCaptureBackupCapacity, CAPTURE_BACKUP_MAX_BYTES } = await import(backupPath);
      const { PortabilityService } = await import(portabilityPath);
      const identity = await selectActingTeacher(db, 'user-tyler');
      const actor = { userId: identity.userId, deviceId: identity.deviceId, identityEpoch: getIdentityEpoch() };
      const service = new CaptureAttachmentService(db);
      const initial = await service.context('assess-eng-essay', actor);
      const template = initial.roster[0];
      for (let index = 0; index < 40; index++) {
        const studentId = `capacity-fictional-student-${index}`;
        await db.students.add({ ...template.student, id: studentId, firstName: 'Fictional', lastName: `Capacity ${index}`, localStudentNumber: `capacity-${index}` });
        await db.classEnrollments.add({ ...template.enrollment, id: `capacity-fictional-enrollment-${index}`, studentId });
      }
      const officialBefore = JSON.stringify({ grades: await db.studentAssessments.toArray(), results: await db.categoryResults.toArray(), marking: await db.markingAttempts.toArray() });
      const started = performance.now();
      let archive: ArrayBuffer | null = await (await fetch('/fictional-capacity.zip')).arrayBuffer();
      const zipBytes = archive.byteLength;
      const pkg = await decodeCapturePackage(new Uint8Array(archive)); archive = null;
      const decodeMs = performance.now() - started;
      if (pkg.submissions.length !== 40 || pkg.submissions.some((s: any) => s.pages.length !== 10)) throw new Error('Expected forty fictional ten-page student sets.');
      const importStart = performance.now();
      for (let index = 0; index < pkg.submissions.length; index++) {
        await service.confirm('assess-eng-essay', pkg, pkg.submissions[index].id, `capacity-fictional-enrollment-${index}`, actor);
        console.log(`CAPACITY saved ${index + 1}/40 in ${Math.round(performance.now() - importStart)} ms`);
      }
      const importMs = performance.now() - importStart;
      const saved = await service.context('assess-eng-essay', actor);
      if (saved.attachments.length !== 40 || saved.receipts.length !== 40 || saved.attachments.reduce((sum: number, a: any) => sum + a.pageCount, 0) !== 400) throw new Error('Whole-class durable counts differ.');
      // Recheck original byte hashes and edit/order metadata at both ends of the class.
      for (const index of [0, 39]) {
        const receipt = saved.receipts.find((r: any) => r.submissionId === pkg.submissions[index].id);
        const attachment = await service.getAttachment('assess-eng-essay', receipt.attachmentId, actor);
        for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
          const retained = attachment.pages[pageIndex], expected = pkg.submissions[index].pages[pageIndex];
          if (JSON.stringify(retained.metadata) !== JSON.stringify(expected.metadata)) throw new Error('Original metadata differs.');
          const bytes = Uint8Array.from(atob(retained.base64), c => c.charCodeAt(0));
          if (await captureSha256(bytes) !== expected.metadata.sha256 || bytes.length !== expected.bytes.length) throw new Error('Retained original bytes differ.');
        }
      }
      const countedBytes = await db.transaction('r', db.tables, () => assertCaptureBackupCapacity(db));
      const backupStart = performance.now();
      const backup = await new PortabilityService(db).createFullBackupJSON();
      const actualBackupBytes = new TextEncoder().encode(backup).length;
      if (actualBackupBytes !== countedBytes || actualBackupBytes > CAPTURE_BACKUP_MAX_BYTES) throw new Error('Full backup exceeds safe capacity or differs from the streaming count.');
      const officialAfter = JSON.stringify({ grades: await db.studentAssessments.toArray(), results: await db.categoryResults.toArray(), marking: await db.markingAttempts.toArray() });
      if (officialAfter !== officialBefore) throw new Error('Matching changed official grades or started marking.');
      return { zipBytes, submissions: 40, pages: 400, originalBytes: pkg.submissions.reduce((n: number, s: any) => n + s.pages.reduce((p: number, page: any) => p + page.bytes.length, 0), 0), decodeMs: Math.round(decodeMs), importMs: Math.round(importMs), backupBytes: actualBackupBytes, backupMs: Math.round(performance.now() - backupStart), totalMs: Math.round(performance.now() - started) };
    };
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop capacity benchmark exceeded 120 seconds.')), 120_000); })]); }
    finally { clearTimeout(timer!); }
  });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`PASS fictional phone ZIP -> desktop browser decode/40 atomic matches/400 retained pages/full backup: ${JSON.stringify(result)}`);
} finally { await browser.close(); await server.close(); }
