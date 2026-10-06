import { _electron as electron, type ElectronApplication } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Disposable profile and loopback collector: never opens teacher/student data.
async function main() {
  const profile = mkdtempSync(path.join(tmpdir(), 'fictional-security-desktop-'));
  let received = 0;
  const collector = createServer((_request, response) => { received++; response.end('unexpected'); });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  assert.ok(address && typeof address !== 'string');
  const remoteUrl = `http://127.0.0.1:${address.port}/fictional-pixel`;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe'),
      args: [`--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid^="select-teacher-"]').first().click();
    await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().waitFor();
    assert.ok(await page.locator('meta[http-equiv="Content-Security-Policy"]').count());
    const exposedNode = await page.evaluate(() => ({ require: typeof (window as any).require, process: typeof (window as any).process }));
    assert.equal(exposedNode.require, 'undefined');
    assert.equal(exposedNode.process, 'undefined');
    const blocked = await page.evaluate(url => new Promise<boolean>(resolve => {
      const image = new Image(); image.onload = () => resolve(false); image.onerror = () => resolve(true); image.src = url;
    }), remoteUrl);
    assert.equal(blocked, true, 'Packaged page must reject a remote image');
    // Independently exercise the session guard from a CSP-free disposable renderer.
    const sessionBlocked = await app.evaluate(async ({ BrowserWindow }, url) => {
      const probe = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
      const blockedErrors: string[] = [];
      probe.webContents.session.webRequest.onErrorOccurred(details => {
        if (details.url === url) blockedErrors.push(details.error);
      });
      try {
        await probe.loadURL('data:text/html,<html><body>Fictional security probe</body></html>');
        const blocked = await probe.webContents.executeJavaScript(`new Promise(resolve => { const image = new Image(); image.onload = () => resolve(false); image.onerror = () => resolve(true); image.src = ${JSON.stringify(url)}; })`);
        return { blocked, blockedErrors };
      } finally {
        probe.webContents.session.webRequest.onErrorOccurred(null);
        probe.destroy();
      }
    }, remoteUrl);
    assert.equal(sessionBlocked.blocked, true, 'Session guard must block network without relying on page CSP');
    assert.ok(sessionBlocked.blockedErrors.some(error => error.includes('ERR_BLOCKED_BY_CLIENT')), 'Verify request cancellation by the session policy, not an unrelated load failure');
    assert.equal(received, 0, 'No request may reach the loopback collector');
    // Exercise the real packaged preload and IPC, without contacting GitHub.
    // Only the ephemeral main-process HTTPS transport is substituted; renderer
    // bridge, trusted-caller checks and updater parsing remain production code.
    await app.evaluate(async () => {
      const https = (process as any).getBuiltinModule('https');
      const { EventEmitter } = (process as any).getBuiltinModule('events');
      (globalThis as any).__manualUpdateOriginalGet = https.get;
      (globalThis as any).__manualUpdateRequests = [];
      (https as any).get = (url: string, options: any, respond: any) => {
        if (url !== 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest') throw new Error('Unexpected update destination');
        (globalThis as any).__manualUpdateRequests.push({ url, headers: options.headers });
        const request = new EventEmitter();
        (request as any).destroy = (error: Error) => { request.emit('error', error); return request; };
        const response = new EventEmitter();
        const count = (globalThis as any).__manualUpdateRequests.length;
        (response as any).statusCode = count === 1 ? 404 : count === 2 ? 200 : 503;
        (response as any).resume = () => {};
        process.nextTick(() => {
          respond(response);
          if ((response as any).statusCode === 200) {
            response.emit('data', Buffer.from(JSON.stringify({
              tag_name: 'v2.0.0', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v2.0.0',
              draft: false, prerelease: false
            })));
            response.emit('end');
          }
        });
        return request;
      };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const updates = page.getByRole('region', { name: 'Windows updates' });
    await updates.waitFor();
    assert.deepEqual(await app.evaluate(() => (globalThis as any).__manualUpdateRequests), [], 'Opening Settings must not check for updates');
    const check = updates.getByRole('button', { name: 'Check for updates', exact: true });
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'No stable release is published.' }).waitFor();
    assert.equal((await app.evaluate(() => (globalThis as any).__manualUpdateRequests)).length, 1);
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'Version 2.0.0 is available. Installation is unavailable' }).waitFor();
    assert.equal((await app.evaluate(() => (globalThis as any).__manualUpdateRequests)).length, 2);
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'The update could not be checked. Try again later.' }).waitFor();
    assert.ok(await check.isEnabled(), 'Failed lookup must permit a later manual retry');
    const lookups = await app.evaluate(() => (globalThis as any).__manualUpdateRequests);
    assert.equal(lookups.length, 3);
    assert.ok(lookups.every((request: any) => Object.keys(request.headers).sort().join(',') === 'Accept,User-Agent'), 'No classroom or device metadata sent');
    await app.evaluate(async () => {
      const https = (process as any).getBuiltinModule('https');
      https.get = (globalThis as any).__manualUpdateOriginalGet;
      delete (globalThis as any).__manualUpdateOriginalGet;
    });
    await page.getByTestId('nav-dashboard-btn').click();
    await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
    await page.locator('[data-testid="student-settings-gear-btn"]').first().click();
    await page.locator('[data-testid="student-preferred-name-input"]').fill('Fictional Security');
    await page.locator('[data-testid="save-student-settings-btn"]').click();
    await page.locator('[data-testid="student-settings-modal"]').waitFor({ state: 'hidden' });
    assert.equal(errors.length, 0, errors.join('; '));
    console.log('PASS: Packaged app loads with CSP, preserves renderer protections, blocks remote images at both page/session layers with zero collector requests, permits an authorized profile save, and exercises the real manual-update preload/IPC with deterministic absent/available/error responses and no external update traffic.');
  } finally {
    if (app) await app.evaluate(async () => {
      const https = (process as any).getBuiltinModule('https');
      if ((globalThis as any).__manualUpdateOriginalGet) https.get = (globalThis as any).__manualUpdateOriginalGet;
    }).catch(() => {});
    await app?.close();
    await new Promise<void>(resolve => collector.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
