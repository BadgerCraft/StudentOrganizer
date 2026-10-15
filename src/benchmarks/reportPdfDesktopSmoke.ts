import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runReportPdfDesktopAcceptance } from './reportPdfDesktopAcceptance';

// Run only on an ephemeral Windows CI machine with fictional QA profiles.
if (process.platform !== 'win32') throw new Error('This packaged PDF harness targets Windows CI.');
const profile = await mkdtemp(path.join(os.tmpdir(), 'ota-pdf-acceptance-'));
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe'), args: [`--user-data-dir=${profile}`], env, timeout: 45000 });
try {
  const page = await app.firstWindow();
  await page.waitForURL('file://**');
  await page.waitForFunction(() => typeof (window as any).desktopReports?.exportPdf === 'function');
  await runReportPdfDesktopAcceptance(app, page, path.resolve('release/qa-evidence/packaged-pdf'));
} finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
