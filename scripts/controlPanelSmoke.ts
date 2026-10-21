import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const contract = require('../electron/updateApproval.cjs');
const root = path.resolve('apps/control-panel/dist');
const server = createServer(async (req, res) => {
  try {
    const requested = path.resolve(root, '.' + new URL(req.url!, 'http://local').pathname);
    if (requested !== root && !requested.startsWith(root + path.sep)) throw new Error('Invalid path');
    const file = requested === root ? path.join(root, 'index.html') : requested;
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const external: string[] = [], errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Approve a tested candidate locally' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Import candidate + verify installer' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Analytics pipeline', exact: true }).click();
  await page.getByRole('heading', { name: 'Queried adoption & reliability' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run local pipeline', exact: true }).isDisabled(), true);
  await page.getByLabel('I consent to this fictional simulation session only.').check();
  await page.getByRole('button', { name: 'Run local pipeline', exact: true }).click();
  await page.getByText(/Local fictional pipeline completed:/).waitFor();
  assert.equal(await page.getByTestId('analytics-weekly').innerText(), '6');
  assert.match(await page.locator('main').innerText(), /5 \/ 6/);
  assert.equal(await page.locator('table').count(), 3);
  await page.setViewportSize({ width: 820, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Exercise UI actions with the real pure contract behind a fictional native-bridge double.
  // No installer launch, native-dialog, OS packaging or live release is implied.
  let prepared: any = null, exports = 0;
  const c = { schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64', sourceCommit: '81058d87d669ff4cd787b06c25fe84217581f2ad',
    artifact: { name: 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe', bytes: 1, sha512: createHash('sha512').update('x').digest('base64') } };
  await page.exposeFunction('fictionalOwnerAction', (name: string, notes?: string) => {
    if (name === 'importCandidate') prepared = contract.prepare(c);
    if (name === 'recordTest') prepared = contract.recordTest(prepared, notes);
    if (name === 'approve') prepared = contract.approve(prepared);
    if (name === 'revoke') prepared = contract.revoke(prepared);
    if (name === 'exportPreview') { assert.equal(contract.exportPreview(prepared).publicationReady, false); exports++; }
    return { approval: prepared, mode: 'local-preview-only', publicationReady: false, message: 'FICTIONAL NATIVE BRIDGE TEST — no file or release published' };
  });
  await page.addInitScript(`window.ownerConsole = Object.fromEntries(['status', 'importCandidate', 'recordTest', 'approve', 'revoke', 'exportPreview'].map(name => [name, notes => window.fictionalOwnerAction(name, notes)]));`);
  await page.reload();
  await page.getByRole('button', { name: 'Import candidate + verify installer' }).click();
  await page.getByText('CANDIDATE — LOCAL ONLY', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve locally', exact: true }).isDisabled(), true);
  await page.getByLabel('Verification evidence (no personal or student data)').fill('FICTIONAL UI test: mocked backup and reopen, not native acceptance.');
  assert.equal(await page.getByRole('button', { name: 'Record completed verification' }).isDisabled(), true);
  await page.getByLabel('I performed the checks described above on this exact installer.').check();
  await page.getByRole('button', { name: 'Record completed verification' }).click();
  await page.getByText('TESTED — LOCAL ONLY', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve locally', exact: true }).click();
  await page.getByText('APPROVED — LOCAL ONLY', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Export local preview feed' }).click();
  await page.getByRole('button', { name: 'Revoke local approval' }).click();
  await page.getByText('REVOKED — LOCAL ONLY', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Export local preview feed' }).isDisabled(), true);
  assert.equal(exports, 1);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log('PASS: production owner UI; fictional dashboard; preview isolation; approval states with contract-backed bridge double; no external requests or student payloads. Native dialogs and OS runtime UNVERIFIED.');
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
