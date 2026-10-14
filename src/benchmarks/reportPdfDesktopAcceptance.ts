import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

/**
 * Actual packaged preload -> trusted IPC -> isolated Electron printToPDF -> disk.
 * Only the native save-dialog choice is controlled in this CI process. No app hooks,
 * student fixtures, network resources, real OS-dialog or physical-device claims.
 */
export async function runReportPdfDesktopAcceptance(app: ElectronApplication, page: Page, evidencePrefix: string) {
  await mkdir(path.dirname(evidencePrefix), { recursive: true });
  const pdfPath = path.resolve(`${evidencePrefix}-marked.pdf`);
  const sentinel = Buffer.from('%PDF-1.7\nFICTIONAL EXISTING PDF SENTINEL\n%%EOF\n');
  await writeFile(pdfPath, sentinel);
  const stagingBefore = (await readdir(path.dirname(pdfPath))).filter(name => name.startsWith('.assessment-pdf-')).sort();
  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await app.evaluate(({ dialog }, destination) => {
    const state = globalThis as any;
    if (state.__reportPdfAcceptance) throw new Error('PDF dialog acceptance is already running.');
    state.__reportPdfAcceptance = { original: dialog.showSaveDialog, destination, canceled: false, calls: 0 };
    dialog.showSaveDialog = (async (..._args: unknown[]) => {
      const current = (globalThis as any).__reportPdfAcceptance; current.calls++;
      return { canceled: current.canceled, filePath: current.destination };
    }) as typeof dialog.showSaveDialog;
  }, pdfPath);
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{size:A4;margin:14mm}body{font-family:sans-serif}.page{break-before:page}img{width:80px;height:80px}</style></head><body><h1>Fictional marked assessment</h1><p>Rubric: clear reasoning. Teacher judgment: 3+.</p><section class="page"><h2>Fictional marked page 1</h2><img alt="Local fictional image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=="><p>1. Fictional supporting feedback.</p></section><section class="page"><h2>Fictional marked page 2</h2><p>2. Fictional second-page feedback.</p></section></body></html>`;
    const saved = await page.evaluate(async html => {
      const bridge = (window as any).desktopReports;
      if (typeof bridge?.exportPdf !== 'function') throw new Error('Packaged PDF preload bridge is missing.');
      return bridge.exportPdf('marked-assessment-fictional-acceptance.pdf', html);
    }, html);
    assert.equal(saved, true, 'Packaged bridge must complete genuine PDF export');
    const pdf = await readFile(pdfPath);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 2000, 'Real renderer must produce a nonempty assessment PDF');
    assert.notDeepEqual(pdf, sentinel, 'Successful overwrite must replace the existing PDF');
    assert.match(pdf.subarray(-1024).toString(), /%%EOF\s*$/);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowsBefore, 'Print window must close after success');

    await writeFile(pdfPath, sentinel);
    await app.evaluate(() => { (globalThis as any).__reportPdfAcceptance.canceled = true; });
    assert.equal(await page.evaluate(html => (window as any).desktopReports.exportPdf('marked-assessment-fictional-acceptance.pdf', html), html), false);
    assert.deepEqual(await readFile(pdfPath), sentinel, 'Cancel must preserve existing destination bytes');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowsBefore, 'Cancel must not create a hidden window');
    const dialogCalls = await app.evaluate(() => (globalThis as any).__reportPdfAcceptance.calls);
    assert.equal(dialogCalls, 2);
    assert.deepEqual((await readdir(path.dirname(pdfPath))).filter(name => name.startsWith('.assessment-pdf-')).sort(), stagingBefore, 'Export and cancellation must clean all staging artifacts');
    // Preserve the successful PDF, after verifying cancellation against the sentinel.
    await writeFile(pdfPath, pdf);
    const evidence = { status: 'pass', platform: process.platform, pdfBytes: pdf.length, dialogCalls, successfulOverwriteVerified: true, stagingCleanedUp: true, cancellationPreservedDestination: true, printWindowCleanedUp: true, packagedElectronPdfBridgeVerified: true, actualNativeSaveDialogVerified: false, physicalDeviceVerified: false };
    await writeFile(`${evidencePrefix}-results.json`, JSON.stringify(evidence, null, 2));
    console.log('PASS: packaged Electron PDF bridge/renderer writes genuine local PDF, closes its print window and safely cancels; save destination controlled by CI.');
    return evidence;
  } finally {
    await app.evaluate(({ dialog }) => {
      const state = (globalThis as any).__reportPdfAcceptance;
      if (state) { dialog.showSaveDialog = state.original; delete (globalThis as any).__reportPdfAcceptance; }
    });
  }
}
