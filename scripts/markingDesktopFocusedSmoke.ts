import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { runMarkingDesktopAcceptance, verifyAfterRestart, openMarkingQueue } from '../src/benchmarks/markingDesktopAcceptance';

// Execute the exact packaged acceptance helper against production renderer bytes.
// This is browser reload evidence only; OS packaging/process checks remain CI-owned.
const server = await preview({ preview: { host: '127.0.0.1', port: 4218, strictPort: true } });
const origin = 'http://127.0.0.1:4218';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-markbook-btn').click();
  const evidence = await runMarkingDesktopAcceptance(page, '/tmp/focused-desktop-acceptance');
  await page.reload();
  await page.getByTestId('nav-markbook-btn').click();
  await verifyAfterRestart(page, evidence);
  // Native upgrade/bootstrap/recovery callers reopen setup before downloading a
  // historical report. Prove their exact helper path and retained pending editor.
  await page.getByTestId(`open-marking-${evidence.assessmentId}`).click();
  await openMarkingQueue(page);
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click();
  const report = await download;
  assert.equal(await readFile((await report.path())!, 'utf8'), await readFile(evidence.reportPath, 'utf8'), 'reopened queue exports the unchanged finalized report');
  await page.getByTestId(`marking-session-open-${evidence.firstAttemptId}`).click();
  await page.getByTestId('marking-feedback').waitFor();
  assert.equal(await page.getByTestId('marking-feedback').inputValue(), evidence.pendingFeedback, 'post-upgrade queue access reopens the exact pending feedback');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: packaged acceptance helper on production renderer; rubric/TXT/DOCX/matching/annotations/finalization/report/backup/confirmed restore/reload; no page errors or external requests. Native process restart not claimed.');
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer!.close(() => resolve())); }
