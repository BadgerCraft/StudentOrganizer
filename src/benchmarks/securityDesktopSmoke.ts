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
    await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
    await page.locator('[data-testid="student-settings-gear-btn"]').first().click();
    await page.locator('[data-testid="student-preferred-name-input"]').fill('Fictional Security');
    await page.locator('[data-testid="save-student-settings-btn"]').click();
    await page.locator('[data-testid="student-settings-modal"]').waitFor({ state: 'hidden' });
    assert.equal(errors.length, 0, errors.join('; '));
    console.log('PASS: Packaged app loads with CSP, preserves renderer protections, blocks remote images at both page/session layers with zero collector requests, and permits an authorized profile save.');
  } finally {
    await app?.close();
    await new Promise<void>(resolve => collector.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
