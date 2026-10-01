import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const product = 'Ontario Teacher Assessment';
const release = path.resolve('release');
const evidence = path.join(release, 'mac-smoke');
const arch = process.env.QA_ARCH || process.arch;
fs.mkdirSync(evidence, { recursive: true });

async function openHub(page: Page) {
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'hidden' });
  await page.locator('[data-testid="nav-dashboard-btn"]').click();
  await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
  await page.getByTitle('Manage Assessments & Rubrics', { exact: true }).click();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor();
}

async function checkApp(appPath: string, format: string) {
  const executablePath = path.join(appPath, 'Contents', 'MacOS', product);
  const title = `Fictional Mac ${format} ${arch} ${Date.now()}`;
  const errors: string[] = [];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ executablePath, timeout: 45000 });
    let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await openHub(page);
    await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
    const form = page.getByRole('heading', { name: 'Create New Assessment' }).locator('..').locator('form');
    if (await form.getByText('Code', { exact: true }).count()) throw new Error('Unexpected Code field');
    await form.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(title);
    await form.getByRole('button', { name: 'Create Assessment', exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, `${format}-created.png`) });
    await app.close();
    app = undefined;
    app = await electron.launch({ executablePath, timeout: 45000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await openHub(page);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, `${format}-reopened.png`) });
    if (errors.length) throw new Error(errors.join('; '));
    return { format, status: 'PASS', architecture: arch, assessmentCreatedAndRetained: true };
  } finally {
    await app?.close();
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Actual package smoke requires a Mac runner.');
  const files = fs.readdirSync(release);
  const dmg = files.find(file => file.endsWith(`-mac-${arch}.dmg`));
  const zip = files.find(file => file.endsWith(`-mac-${arch}.zip`));
  if (!dmg || !zip) throw new Error(`Missing ${arch} disk image or archive`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'student-organizer-mac-'));
  const mount = path.join(temp, 'mounted');
  const installed = path.join(temp, 'installed');
  const unpacked = path.join(temp, 'archive');
  fs.mkdirSync(mount); fs.mkdirSync(installed); fs.mkdirSync(unpacked);
  const results = [];
  let mounted = false;
  try {
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, path.join(release, dmg)]);
    mounted = true;
    const installedApp = path.join(installed, `${product}.app`);
    execFileSync('ditto', [path.join(mount, `${product}.app`), installedApp]);
    execFileSync('hdiutil', ['detach', mount]);
    mounted = false;
    // Test the copy installed from the exact DMG, after its disk is detached.
    results.push(await checkApp(installedApp, 'dmg'));
    execFileSync('ditto', ['-x', '-k', path.join(release, zip), unpacked]);
    results.push(await checkApp(path.join(unpacked, `${product}.app`), 'zip'));
    execFileSync('codesign', ['--verify', '--deep', '--strict', installedApp]);
    const signatures = spawnSync('codesign', ['-d', '--verbose=2', installedApp], { encoding: 'utf8' });
    if (signatures.status !== 0 || !signatures.stderr.includes('Signature=adhoc')) throw new Error('Expected measured ad-hoc test signature');
    const binary = execFileSync('file', [path.join(installedApp, 'Contents', 'MacOS', product)], { encoding: 'utf8' });
    if (!binary.includes(arch === 'x64' ? 'x86_64' : 'arm64')) throw new Error('Wrong packaged architecture');
    const report = {
      testedSource: process.env.QA_SOURCE_SHA || 'local source, SHA not provided',
      architecture: arch, macOS: os.release(), results,
      checksums: Object.fromEntries([dmg, zip].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(release, file))).digest('hex')])),
      signature: 'Ad-hoc test signature; no verified publisher identity or Apple notarization',
      codesignEvidence: signatures.stderr,
      binaryEvidence: binary,
      limits: ['Ephemeral CI has no downloaded-file quarantine; colleague Gatekeeper/device policy not tested.', 'Classroom participation/mark entry/photo and backup flows require the platform matrix checks; this smoke establishes assessment creation/restart only.']
    };
    fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS: exact Mac disk-image and archive apps created an assessment and retained it after restart.');
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', mount]);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  fs.writeFileSync(path.join(evidence, 'failure.txt'), String(error?.stack || error));
  console.error(error);
  process.exitCode = 1;
});
