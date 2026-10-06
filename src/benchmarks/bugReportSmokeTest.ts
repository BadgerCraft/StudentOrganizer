import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, type Browser } from 'playwright';

// Fictional UI-only report flow; no database service hooks or external submissions.
const server = await createServer({ server: { port: 3229, strictPort: true } });
await server.listen();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto('http://localhost:3229');
  const chooseTeacher = page.locator('[data-testid^="select-teacher-"]').first();
  await chooseTeacher.waitFor({ state: 'visible' });
  await chooseTeacher.click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  const externalRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://localhost:3229')) externalRequests.push(request.url()); });
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  const modal = page.getByTestId('bug-report-modal');
  await modal.waitFor({ state: 'visible' });
  assert.match(await page.getByTestId('report-intake-status').innerText(), /not connected/);
  await page.getByTestId('bug-report-summary').fill('Fictional test: card did not move');
  await page.getByTestId('bug-report-actual').fill('The demo card stayed in its original place.');
  await modal.getByRole('button', { name: 'Review report', exact: true }).click();
  const preview = page.getByTestId('bug-report-preview');
  const generated = await preview.inputValue();
  assert.match(generated, /Platform:/);
  assert.match(generated, /Screen: dashboard/);
  const edited = 'Fictional edited report. No identifying details.\nExpected: card moves.';
  await preview.fill(edited);
  const savedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('ota.bug-report-draft.v1')!));
  assert.equal(savedDraft.summary, 'Fictional test: card did not move');
  assert.equal(savedDraft.previewText, edited);
  await modal.getByTestId('modal-close-x-btn').click();
  await page.reload();
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  await page.getByTestId('bug-report-summary').waitFor({ state: 'visible' });
  // Visibility can precede the modal's saved-draft hydration effect. Require
  // the restored value as well; fail if the saved draft never reaches the UI.
  await page.waitForFunction(expected => document.querySelector<HTMLTextAreaElement>('[data-testid="bug-report-summary"]')?.value === expected,
    'Fictional test: card did not move');
  assert.equal(await page.getByTestId('bug-report-summary').inputValue(), 'Fictional test: card did not move');
  await modal.getByRole('button', { name: 'Review report', exact: true }).click();
  assert.equal(await preview.inputValue(), edited);
  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Download report', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath);
  assert.equal(await fs.readFile(downloadPath, 'utf8'), edited);
  // A literal JavaScript expression stays self-contained when tsx serializes it;
  // nested TypeScript callbacks can otherwise retain an unavailable __name helper.
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async function () { throw new Error('Clipboard unavailable for test'); } }
  })`);
  await modal.getByRole('button', { name: 'Copy report', exact: true }).click();
  assert.ok(await modal.getByText('Copy was unavailable.', { exact: false }).isVisible());
  await page.evaluate(`(function () {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ota.bug-report-draft.v1') throw new DOMException('Test quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  })()`);
  await preview.fill('Unsaved details remain available to copy.');
  assert.ok(await modal.getByRole('alert').isVisible());
  page.once('dialog', dialog => dialog.dismiss());
  await modal.getByTestId('modal-close-x-btn').click();
  assert.ok(await modal.isVisible());
  assert.equal(await preview.inputValue(), 'Unsaved details remain available to copy.');
  assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('ota.bug-report-draft.v1')).previewText`), edited);
  assert.deepEqual(externalRequests, []);
  console.log('PASS: draft/reload, editable exact download, clipboard failure, quota preservation, guarded dismissal, no external report requests.');
} finally {
  await browser?.close();
  await server.close();
}
