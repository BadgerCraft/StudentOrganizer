import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { STARTUP_UPDATE_FIXTURE, HOLD_UPDATE_WRITE } from './helpers/startupUpdateFixture';
import { installFictionalClassroom } from './helpers/classroomFixture';

const root = path.resolve('dist');
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, '.' + new URL(request.url!, 'http://local').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(file === root ? path.join(root, 'index.html') : file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
const evidence = 'docs/work-orders/evidence/UPDATES-2026-11-09';
await mkdir(evidence, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const external: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.addInitScript(STARTUP_UPDATE_FIXTURE);
  await page.goto(origin);
  assert.equal(await page.evaluate(() => (window as any).desktopUpdates?.mode), 'github-release', `Startup bridge fixture failed: ${errors.join('; ')}`);
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('student-seat-card').first().waitFor();
  const banner = page.getByRole('region', { name: 'Update available', exact: true });
  const update = banner.getByRole('button', { name: 'Update and restart', exact: true });
  await update.waitFor();
  assert.equal(await page.evaluate(() => (window as any).__updates.checks), 0, 'renderer mount/polling must not call remote check');
  await page.screenshot({ path: `${evidence}/green-update-banner.png`, fullPage: true });
  // Dirty classroom participation remains intact; no download begins.
  await page.getByTestId('student-seat-card').first().click();
  await page.getByTestId('toggle-note-btn').click();
  const note = page.getByTestId('observation-note-input'); await note.fill('Fictional unfinished observation');
  await update.click(); await banner.getByRole('alert').filter({ hasText: 'Save your unfinished changes' }).waitFor();
  assert.equal(await note.inputValue(), 'Fictional unfinished observation');
  assert.equal(await page.evaluate(() => (window as any).__updates.downloads), 0);
  await note.fill(''); await page.keyboard.press('Escape');
  // Hold real IndexedDB work so the attendance handler remains pending before its write.
  const toolsToggle = page.getByTestId('classroom-tools-toggle');
  if (await toolsToggle.getAttribute('aria-expanded') !== 'true') await toolsToggle.click();
  await page.evaluate(HOLD_UPDATE_WRITE);
  const attendance = page.getByRole('button', { name: /^Mark .+ absent$/ }).first();
  await attendance.click(); await update.click();
  await banner.getByRole('alert').filter({ hasText: 'Wait for the current save' }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__updates.downloads), 0);
  await page.evaluate(() => (window as any).__releaseUpdateWrite());
  await page.getByRole('button', { name: /^Mark .+ present$/ }).first().waitFor();
  // The custom Markbook popover is also an editor, despite not using ModalDialog.
  await page.getByRole('button', { name: 'Markbook', exact: true }).click();
  await page.getByRole('button', { name: 'Open grade grid', exact: true }).click();
  await page.locator('[data-testid^="markbook-cell-"]').first().click();
  await page.getByRole('button', { name: 'Close result editor', exact: true }).waitFor();
  await page.evaluate(() => (document.querySelector('[data-testid="startup-update-banner"] button') as HTMLButtonElement).click());
  await banner.getByRole('alert').filter({ hasText: 'Save or close the open editor' }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__updates.downloads), 0);
  await page.getByRole('button', { name: 'Close result editor', exact: true }).click();
  await page.getByRole('button', { name: 'Class View', exact: true }).click();
  // Inline import/restore screens retain unfinished copied roster work.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Backups & import / export', exact: true }).click();
  await page.getByRole('button', { name: 'Open import / export & manual restore', exact: true }).click();
  const roster = page.getByTestId('roster-csv-textarea'); await roster.fill('Fictional, Student\t001234');
  await update.click(); await banner.getByRole('alert').filter({ hasText: 'Save or close the open editor' }).waitFor();
  assert.equal(await roster.inputValue(), 'Fictional, Student\t001234');
  assert.equal(await page.evaluate(() => (window as any).__updates.downloads), 0);
  await roster.fill(''); await page.getByRole('button', { name: 'Class View', exact: true }).click();
  // Cancel restores the usable workspace; repeated clicks cannot queue installs.
  await update.click(); await banner.getByRole('button', { name: 'Cancel update', exact: true }).waitFor();
  assert.equal(await page.locator('#app-workspace').getAttribute('inert'), '');
  await page.evaluate(() => (document.querySelector('[data-testid="startup-update-banner"] button') as HTMLButtonElement).click());
  assert.equal(await page.evaluate(() => (window as any).__updates.downloads), 1);
  // An overlapping manual check cannot remove progress/cancellation while the workspace is locked.
  for (const status of ['checking', 'current', 'error']) {
    await page.evaluate(status => { (window as any).__updates.offer = { status }; }, status);
    const reads = await page.evaluate(() => (window as any).__updates.startupReads);
    await page.waitForFunction(reads => (window as any).__updates.startupReads > reads, reads);
    assert.equal(await banner.isVisible(), true);
    assert.equal(await banner.getByRole('button', { name: 'Cancel update', exact: true }).isVisible(), true);
  }
  await page.evaluate(() => { (window as any).__updates.offer = { status: 'available', version: '1.0.2', installationAvailable: true }; });
  await banner.getByRole('button', { name: 'Cancel update', exact: true }).click();
  await update.waitFor(); assert.equal(await page.locator('#app-workspace').getAttribute('inert'), null);
  assert.equal(await page.evaluate(() => (window as any).__updates.installs), 0);
  // Network/download failure unlocks and retries; unsigned never reaches backup/install.
  for (const result of [{ status: 'error', installationAvailable: true, error: 'Fictional network failure' }, { status: 'downloaded', installationAvailable: true, signature: 'unsigned' }]) {
    await update.click(); await page.evaluate(result => (window as any).__updates.finish(result), result);
    await banner.getByRole('alert').waitFor(); await update.waitFor();
    assert.equal(await page.locator('#app-workspace').getAttribute('inert'), null);
    assert.equal(await page.evaluate(() => (window as any).__updates.installs), 0);
  }
  // Explicit capability blockers for unsigned installed build, protected workspace and Mac are visible.
  for (const message of ['This installed app is unsigned. Install a trusted signed build first.', 'Protected installer recovery is not yet available.', 'Automatic installation is not supported on this Mac build.']) {
    await page.evaluate(message => { (window as any).__updates.offer = { status: 'available', version: '1.0.2', installationAvailable: false, message }; }, message);
    await banner.getByRole('status').filter({ hasText: message }).waitFor(); assert.equal(await update.isDisabled(), true);
  }
  for (const status of ['unpublished', 'current', 'error']) {
    await page.evaluate(status => { (window as any).__updates.offer = { status }; }, status); await banner.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'updates', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Desktop updates', exact: true });
  await settings.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Updates could not be checked' }).waitFor();
  await page.evaluate(() => { (window as any).__updates.offer = { status: 'available', version: '1.0.2', installationAvailable: true }; });
  await update.waitFor();
  // One click executes download, verified complete backup and install; launch failure unlocks.
  await page.evaluate(() => { (window as any).__updates.installOutcome = 'error'; });
  await update.click(); await page.evaluate(() => (window as any).__updates.finish({ status: 'downloaded', installationAvailable: true, signature: 'valid', version: '1.0.2' }));
  await banner.getByRole('alert').filter({ hasText: 'Fictional installer launch failure' }).waitFor();
  assert.equal(await page.locator('#app-workspace').getAttribute('inert'), null);
  const backup = await page.evaluate(() => { const s = (window as any).__updates; return { json: s.backup, acknowledge: s.acknowledge, installs: s.installs }; });
  assert.equal(backup.installs, 1); assert.equal(backup.acknowledge, false);
  const parsed = JSON.parse(backup.json); assert.equal(parsed.schemaVersion, 5); assert.equal(Object.keys(parsed.tables).length, 41); assert.ok(parsed.tables.students.length > 0);
  await page.evaluate(() => { (window as any).__updates.installOutcome = 'installing'; });
  await update.click(); await page.evaluate(() => (window as any).__updates.finish({ status: 'downloaded', installationAvailable: true, signature: 'valid', version: '1.0.2' }));
  await banner.getByRole('status').filter({ hasText: 'Installing and restarting' }).waitFor();
  await page.waitForFunction(() => (window as any).__updates.installs === 2);
  assert.equal(await page.locator('#app-workspace').getAttribute('inert'), '');
  assert.equal(await banner.getByRole('button', { name: 'Cancel update', exact: true }).count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: production renderer green banner, no polling network, one-click backup/install chain, dirty-draft preservation, duplicate/cancel/retry, missing/current/offline release, unsigned/protected/Mac blockers, launch failure unlocking; all 41 fictional backup tables. Native signatures/replacement/restart are not simulated as real acceptance.');
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
