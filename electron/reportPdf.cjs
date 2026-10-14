const { writeFile } = require('node:fs/promises');
/** Isolated, scriptless print renderer. No persistent student HTML or network access. */
function createReportPdfExporter({ BrowserWindow, dialog, session, parent, write = writeFile }) {
  let busy = false;
  return async function exportPdf(filename, html) {
    if (busy) throw new Error('A PDF export is already in progress.');
    if (typeof filename !== 'string' || !/^marked-assessment-[a-zA-Z0-9_-]+\.pdf$/.test(filename) || typeof html !== 'string' || Buffer.byteLength(html) > 100 * 1024 * 1024 || !html.startsWith('<!doctype html>')) throw new Error('Invalid assessment PDF.');
    busy = true; let printWindow;
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
      if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF generation failed.');
      await write(result.filePath, pdf);
      return true;
    } finally { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); busy = false; }
  };
}
module.exports = { createReportPdfExporter };
