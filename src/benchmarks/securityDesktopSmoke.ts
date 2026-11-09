import { reserveInspectorPort, evaluateBeforeMain } from '../../scripts/helpers/approvedUpdateFixture';
import { openSettingsSection, showClassTools } from '../../scripts/helpers/organizerNavigation';
import { installFictionalClassroom } from '../../scripts/helpers/classroomFixture';
import { _electron as electron, type ElectronApplication } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs while the disposable native process is paused before application code.
// No production module or hook is changed; all HTTPS outside these fixtures fails.
function installUpdateTransportFixture() {
  const https = (process as any).getBuiltinModule('https');
  const { EventEmitter } = (process as any).getBuiltinModule('events');
  const root = globalThis as any;
  root.__startupUpdateOriginalGet = https.get;
  root.__startupUpdateOriginalRequest = https.request;
  root.__startupUpdateRequests = [];
  root.__startupUpdateMode = 'absent';
  root.__startupUpdateUnexpected = [];
  const latest = 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest';
  const tag = 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/git/ref/tags/v2.0.0';
  https.request = (...args: any[]) => { root.__startupUpdateUnexpected.push(String(args[0])); throw new Error('Unexpected HTTPS request'); };
  https.get = (url: string, options: any, respond: any) => {
    if (![latest, tag].includes(url)) { root.__startupUpdateUnexpected.push(String(url)); throw new Error('Unexpected update destination'); }
    root.__startupUpdateRequests.push({ url, headers: options.headers });
    const request = new EventEmitter();
    request.destroy = (error?: Error) => { if (error) request.emit('error', error); return request; };
    const response = new EventEmitter();
    response.statusCode = root.__startupUpdateMode === 'error' ? 503 : root.__startupUpdateMode === 'absent' ? 404 : 200;
    response.resume = () => {}; response.destroy = () => {};
    process.nextTick(() => {
      respond(response);
      if (response.statusCode !== 200) return;
      const installer = `OntarioTeacherAssessment-2.0.0-${process.arch}-nsis.exe`;
      const data = url === tag ? { object: { type: 'commit', sha: '1'.repeat(40) } } : {
        tag_name: 'v2.0.0', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v2.0.0',
        draft: false, prerelease: false, target_commitish: 'main',
        assets: [installer, 'latest.yml'].map(name => ({ name, state: 'uploaded', size: 128,
          browser_download_url: `https://github.com/BadgerCraft/StudentOrganizer/releases/download/v2.0.0/${name}` }))
      };
      response.emit('data', Buffer.from(JSON.stringify(data))); response.emit('end');
    });
    return request;
  };
  return { installed: true, originalNetworkUsed: false };
}

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
    const inspectorPort = await reserveInspectorPort();
    const launching = electron.launch({ executablePath: path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe'),
      args: [`--inspect-brk=127.0.0.1:${inspectorPort}`, `--user-data-dir=${profile}`], timeout: 60000 });
    void launching.catch(() => {});
    try {
      const result = await evaluateBeforeMain(inspectorPort, `(${installUpdateTransportFixture.toString()})()`);
      assert.equal(result.installed, true);
      app = await launching;
    } catch (error) {
      const failedLaunch = await launching.catch(() => undefined);
      await failedLaunch?.close().catch(() => {});
      throw error;
    }
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible' });
    await installFictionalClassroom(page);
    await page.locator('[data-testid^="select-teacher-"]').first().click();
    await page.getByTestId('nav-dashboard-btn').click();
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
    // Transport was installed before startup; preload, trusted-caller checks and
    // real GitHub parsers run unchanged with fictional responses, never live traffic.
    const startup = await page.evaluate(async () => {
      const bridge = (window as any).desktopUpdates;
      return { mode: bridge.mode, state: await bridge.startupStatus(), installer: await bridge.status() };
    });
    assert.equal(startup.mode, 'github-release');
    assert.equal(startup.state.status, 'unpublished');
    assert.equal(startup.installer.installationAvailable, false, 'Unpacked executable cannot install updates');
    assert.equal((await app.evaluate(() => (globalThis as any).__startupUpdateRequests)).length, 1, 'Exactly one metadata check runs at startup');
    await page.evaluate(async () => {
      const bridge = (window as any).desktopUpdates;
      await bridge.startupStatus(); await bridge.startupStatus(); await bridge.status();
    });
    await openSettingsSection(page, 'updates');
    const updates = page.getByRole('region', { name: 'Desktop updates', exact: true });
    await updates.waitFor();
    await updates.getByRole('status').filter({ hasText: 'No stable update is published.' }).waitFor();
    assert.equal((await app.evaluate(() => (globalThis as any).__startupUpdateRequests)).length, 1, 'Status reads and opening Settings must not start network activity');
    const check = updates.getByRole('button', { name: 'Check for updates', exact: true });
    await app.evaluate(() => { (globalThis as any).__startupUpdateMode = 'available'; });
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'Version 2.0.0 is available.' }).waitFor();
    const banner = page.getByTestId('startup-update-banner');
    await banner.waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Update and restart', exact: true }).isEnabled(), false, 'Unsigned/unpacked build must not offer one-click execution');
    const offer = await page.evaluate(() => (window as any).desktopUpdates.startupStatus());
    assert.equal(offer.installationAvailable, false);
    assert.ok(offer.message, 'Unsupported installation must explain its limitation');
    assert.equal((await app.evaluate(() => (globalThis as any).__startupUpdateRequests)).length, 3, 'Available release reads only latest metadata and fixed tag identity');
    assert.equal(await updates.getByRole('button', { name: 'Download update', exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => (window as any).desktopUpdates.status())).status, 'unsupported', 'Startup/manual check must not initiate a download');
    await app.evaluate(() => { (globalThis as any).__startupUpdateMode = 'error'; });
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'Updates could not be checked.' }).waitFor();
    assert.ok(await check.isEnabled(), 'Network failure must allow explicit retry');
    assert.equal((await app.evaluate(() => (globalThis as any).__startupUpdateRequests)).length, 4);
    await app.evaluate(() => { (globalThis as any).__startupUpdateMode = 'available'; });
    await check.click();
    await updates.getByRole('status').filter({ hasText: 'Version 2.0.0 is available.' }).waitFor();
    const lookups = await app.evaluate(() => (globalThis as any).__startupUpdateRequests);
    assert.equal(lookups.length, 6, 'Manual retry completes after a failed request');
    assert.ok(lookups.every((request: any) => Object.keys(request.headers).sort().join(',') === 'Accept,User-Agent'), 'No classroom records or device identifiers sent');
    assert.ok(lookups.every((request: any) => request.headers.Accept === 'application/vnd.github+json' &&
      request.headers['User-Agent'] === (request.url.endsWith('/releases/latest') ? 'StudentOrganizer-release-check' : 'StudentOrganizer-explicit-approved-update')), 'Only fixed application headers are sent');
    assert.deepEqual(await app.evaluate(() => (globalThis as any).__startupUpdateUnexpected), [], 'No artifact or unexpected HTTPS request occurred');
    await page.getByTestId('nav-dashboard-btn').click();
    await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
    await page.getByTestId('student-seat-card').first().waitFor();
    await showClassTools(page);
    await page.locator('[data-testid="student-settings-gear-btn"]').first().click();
    await page.locator('[data-testid="student-preferred-name-input"]').fill('Fictional Security');
    await page.locator('[data-testid="save-student-settings-btn"]').click();
    await page.locator('[data-testid="student-settings-modal"]').waitFor({ state: 'hidden' });
    assert.equal(errors.length, 0, errors.join('; '));
    console.log('PASS: Packaged app loads with CSP, preserves renderer protections, blocks remote images at both page/session layers with zero collector requests, permits an authorized profile save, and exercises packaged startup/manual-update IPC with one startup lookup, no network on status reads, stable release discovery without Control Panel approval, unsigned/unpacked install rejection, network error/retry, and zero live update traffic.');
  } finally {
    if (app) await app.evaluate(async () => {
      const https = (process as any).getBuiltinModule('https');
      if ((globalThis as any).__startupUpdateOriginalGet) https.get = (globalThis as any).__startupUpdateOriginalGet;
      if ((globalThis as any).__startupUpdateOriginalRequest) https.request = (globalThis as any).__startupUpdateOriginalRequest;
    }).catch(() => {});
    await app?.close();
    await new Promise<void>(resolve => collector.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
