const { writeFile, readFile, mkdtemp, rename, rm } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const validPdf = pdf => Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(pdf.subarray(-1024).toString());
/** Isolated, scriptless print renderer. No persistent student HTML or network access. */
function createReportPdfExporter({ BrowserWindow, dialog, session, parent, write = writeFile, read = readFile, makeTemp = mkdtemp, replace = rename, cleanup = rm }) {
  let busy = false;
  return async function exportPdf(filename, html) {
    if (busy) throw new Error('A PDF export is already in progress.');
    if (typeof filename !== 'string' || !/^marked-assessment-[a-zA-Z0-9_-]+\.pdf$/.test(filename) || typeof html !== 'string' || Buffer.byteLength(html) > 100 * 1024 * 1024 || !html.startsWith('<!doctype html>')) throw new Error('Invalid assessment PDF.');
    busy = true; let printWindow; let tempDirectory;
    try {
      const result = await dialog.showSaveDialog(parent(), { title: 'Save marked assessment PDF', defaultPath: filename, filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return false;
      const printSession = session.fromPartition(`assessment-pdf-${require('node:crypto').randomUUID()}`, { cache: false });
      printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      printSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
      printWindow = new BrowserWindow({ show: false, webPreferences: { session: printSession, javascript: false, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      printWindow.webContents.on('will-navigate', event => event.preventDefault());
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      if (!validPdf(pdf)) throw new Error('PDF generation failed.');
      // Same-directory staging keeps replacement on the destination filesystem.
      // Never truncate or remove the old PDF; a failed rename leaves it intact.
      tempDirectory = await makeTemp(join(dirname(result.filePath), '.assessment-pdf-'));
      const temporaryPath = join(tempDirectory, 'report.pdf');
      await write(temporaryPath, pdf, { flag: 'wx', mode: 0o600, flush: true });
      const saved = await read(temporaryPath);
      if (!validPdf(saved) || !saved.equals(pdf)) throw new Error('PDF write validation failed.');
      await replace(temporaryPath, result.filePath);
      return true;
    } finally {
      // Cleanup must not turn a completed atomic replacement into a reported failure.
      try { if (tempDirectory) await cleanup(tempDirectory, { recursive: true, force: true }); }
      catch { /* Best effort if the OS refuses removal of the private staging directory. */ }
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); busy = false;
    }
  };
}
module.exports = { createReportPdfExporter };
