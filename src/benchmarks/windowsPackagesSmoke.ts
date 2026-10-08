import { runMarkingDesktopAcceptance, verifyAfterRestart } from './markingDesktopAcceptance';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Only run on an ephemeral Windows CI machine, never a teacher's live profile.
const build = JSON.parse(fs.readFileSync('release/qa-build.json', 'utf8'));
const evidenceDir = path.resolve('release/qa-evidence');

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0 ? Promise.resolve() : Promise.reject(new Error(`Process exited ${child.exitCode}`));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Process did not exit in time')), timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Process exited ${code}`));
    });
  });
}

function killOwnedProcess(child: ChildProcess) {
  if (child.pid && child.exitCode === null) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { /* Process may already have closed. */ }
  }
}

async function launch(executable: string) {
  const port = await unusedPort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { stdio: 'pipe' });
  let diagnostics = '';
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  child.stdout?.on('data', chunk => { diagnostics += chunk.toString(); });
  child.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
  let browser: Browser | undefined;
  const deadline = Date.now() + 60000;
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Launcher exited ${child.exitCode}: ${diagnostics}`);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 });
        break;
      } catch { await delay(250); }
    }
    if (!browser) throw new Error(`Could not connect to actual executable: ${diagnostics}`);
    let page: Page | undefined;
    while (!page && Date.now() < deadline) {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('file://'));
      if (!page) await delay(250);
    }
    if (!page) throw new Error('No packaged file:// app window appeared.');
    return { child, browser, page };
  } catch (error) {
    await browser?.close();
    killOwnedProcess(child);
    fs.writeFileSync(path.join(evidenceDir, 'launch-error.log'), diagnostics);
    throw error;
  }
}

async function close(app: Awaited<ReturnType<typeof launch>>) {
  try {
    // Close the real window so Electron flushes storage and the portable wrapper cleans up.
    await app.page.close();
    await app.browser.close();
    await waitForExit(app.child, 20000);
  } finally {
    killOwnedProcess(app.child);
  }
}

async function openHub(page: Page) {
  page.setDefaultTimeout(20000);
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'hidden' });
  const id = await page.getByTestId('qa-build-id').innerText();
  if (!id.includes(build.buildId)) throw new Error(`Wrong visible build: ${id}`);
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.locator('button[title="Manage Assessments & Rubrics"]').click();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor({ state: 'visible' });
}

// Select only the evidence destination; renderer export still creates the bytes.
// The native Save As dialog is deliberately outside this automation's claim.
async function markingDownload(browser: Browser, trigger: () => Promise<void>, destination: string) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), 'download-'));
  const session = await browser.newBrowserCDPSession();
  let guid = '';
  let state = 'pending';
  session.on('Browser.downloadWillBegin', event => { guid = event.guid; });
  session.on('Browser.downloadProgress', event => { if (event.guid === guid) state = event.state; });
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: temporary, eventsEnabled: true });
    await trigger();
    const deadline = Date.now() + 30000;
    while (state === 'pending' || state === 'inProgress') {
      if (Date.now() >= deadline) throw new Error('Actual packaged marking export download timed out');
      await delay(100);
    }
    if (state !== 'completed' || !guid) throw new Error(`Actual marking download failed: ${state}`);
    fs.renameSync(path.join(temporary, guid), destination);
    if (!fs.statSync(destination).size) throw new Error('Downloaded marking artifact is empty');
  } finally {
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
    await session.detach();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function verify(executable: string, variant: string) {
  const title = `QA Fictional ${variant} Assessment ${Date.now()}`;
  const errors: string[] = [];
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch(executable);
    app.page.on('pageerror', error => errors.push(error.message));
    await openHub(app.page);
    await app.page.getByRole('button', { name: 'New Assessment' }).click();
    const form = app.page.getByRole('heading', { name: 'Create New Assessment' }).locator('..').locator('form');
    if (await form.getByText('Code', { exact: true }).count()) throw new Error('Assessment form still has a Code field.');
    await form.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
    await form.getByRole('button', { name: 'Create Assessment' }).click();
    await app.page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
    await app.page.screenshot({ path: path.join(evidenceDir, `${variant}-created.png`) });
    const marking = await runMarkingDesktopAcceptance(app.page, path.join(evidenceDir, `${variant}-marking`), (trigger, destination) => markingDownload(app!.browser, trigger, destination));
    await close(app);
    app = undefined;
    app = await launch(executable);
    app.page.on('pageerror', error => errors.push(error.message));
    await openHub(app.page);
    await app.page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' });
    await verifyAfterRestart(app.page, marking);
    await app.page.screenshot({ path: path.join(evidenceDir, `${variant}-restarted.png`) });
    if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
    console.log(`PASS: Actual ${variant} app shows build ID, creates an assessment without Code, and retains it after restart.`);
    return { variant, executable: path.basename(executable), assessment: title, status: 'passed', marking };
  } catch (error) {
    await app?.page.screenshot({ path: path.join(evidenceDir, `${variant}-failed.png`) }).catch(() => {});
    throw error;
  } finally {
    if (app) await close(app);
  }
}

async function main() {
  if (process.platform !== 'win32' || process.env.CI !== 'true') {
    throw new Error('Exact-package smoke tests require an ephemeral Windows CI runner.');
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const files = fs.readdirSync('release');
  const portable = files.filter(file => file.endsWith('-Portable.exe'));
  const installer = files.filter(file => file.endsWith('-nsis.exe'));
  if (portable.length !== 1 || installer.length !== 1) throw new Error('Expected exactly one portable and one installer output.');
  const results = [await verify(path.resolve('release', portable[0]), 'portable')];
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-qa-installed-'));
  let setup: ChildProcess | undefined;
  try {
    // NSIS requires /D last and unquoted, even if the directory contains spaces.
    setup = spawn(path.resolve('release', installer[0]), ['/S', '/currentuser', `/D=${installDir}`], {
      windowsVerbatimArguments: true, stdio: 'inherit'
    });
    await waitForExit(setup, 120000);
    const installed = path.join(installDir, 'Ontario Teacher Assessment.exe');
    if (!fs.existsSync(installed)) throw new Error('Installer did not create the installed executable.');
    results.push(await verify(installed, 'installed'));
  } finally {
    if (setup) killOwnedProcess(setup);
    fs.rmSync(installDir, { recursive: true, force: true });
  }
  fs.writeFileSync('release/package-smoke.json', JSON.stringify({ build, results }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
