const { createReadableReportWriter, reportError } = require('./readableReportFile.cjs');
const MESSAGES = Object.freeze({
  REPORT_CONTEXT_CHANGED: 'The teacher, class or saved workspace changed. No new export was authorized. Review the current report and start again.',
  REPORT_BUSY: 'A readable export is already in progress. Finish or cancel it before exporting again.',
  REPORT_INVALID: 'Choose a supported assessment PDF or class CSV export. No file was saved.',
  REPORT_WRITE_FAILED: 'The readable copy was not completed. Check the chosen folder and available space, then retry from the current report.',
  REPORT_WRITE_UNCONFIRMED: 'A readable, unencrypted copy may already exist at the chosen destination. Inspect it before exporting again. Do not assume that cancellation removed it.',
  REPORT_CLEANUP_REQUIRED: 'An incomplete readable, unencrypted staging file could not be removed. Inspect the chosen folder for a .teacher-readable-copy- folder and remove the incomplete copy before retrying.',
  REPORT_PUBLISHED_CLEANUP_REQUIRED: 'A readable, unencrypted copy may exist at the chosen destination, and its staging folder could not be removed. Inspect both the destination and any .teacher-readable-copy- folder before exporting again.'
});
/** Main-only focused transport. Caller permission checks are the existing trusted
 * renderer service boundary; this capability additionally pins native lifecycle,
 * teacher epoch and saved revision. It is not an arbitrary path/write API. */
function createProtectedReportExports({ dialog, parent, captureContext, exportPdf, saveReadable = createReadableReportWriter() }) {
  let generation = 0, busy = false;
  function cancel() { generation++; }
  async function run(format, filename, content, assertCaller, expectedRevision) {
    if (busy) throw Object.assign(new Error(MESSAGES.REPORT_BUSY), { code: 'REPORT_BUSY' });
    if (!['pdf', 'csv'].includes(format) || typeof filename !== 'string' || filename.length > 200 || !(format === 'pdf' ? /^marked-assessment-[A-Za-z0-9_-]+\.pdf$/ : /^[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/).test(filename) || typeof content !== 'string' || Buffer.byteLength(content) > 100 * 1024 * 1024 || (format === 'pdf' && !content.startsWith('<!doctype html>'))) throw Object.assign(new Error(MESSAGES.REPORT_INVALID), { code: 'REPORT_INVALID' });
    busy = true; const epoch = generation;
    try {
      const nativeGuard = captureContext(expectedRevision);
      const assertCurrent = () => {
        try { assertCaller(); if (epoch !== generation) throw reportError('REPORT_CONTEXT_CHANGED'); nativeGuard(); }
        catch { throw reportError('REPORT_CONTEXT_CHANGED'); }
      };
      assertCurrent();
      const response = await dialog.showMessageBox(parent(), { type: 'warning', title: 'Save an unencrypted teacher copy?', message: `This ${format.toUpperCase()} copy will not be encrypted.`, detail: 'Anyone who can access the saved file can read its student information. Choose an appropriate private folder, share only with authorized people, and handle or delete the copy according to your school policy. This permission applies only to this export.', buttons: ['Cancel', 'Save unencrypted copy'], defaultId: 0, cancelId: 0, noLink: true });
      assertCurrent(); if (response.response !== 1) return false;
      if (format === 'pdf') {
        const saved = await exportPdf(filename, content, { assertCurrent });
        if (typeof saved !== 'boolean') throw reportError('REPORT_WRITE_UNCONFIRMED');
        try { assertCurrent(); } catch (error) { if (saved) throw reportError('REPORT_WRITE_UNCONFIRMED'); throw error; }
        return saved;
      }
      const result = await dialog.showSaveDialog(parent(), { title: 'Save unencrypted class CSV', defaultPath: filename, filters: [{ name: 'CSV document', extensions: ['csv'] }] });
      assertCurrent(); if (result.canceled || !result.filePath) return false;
      if (typeof result.filePath !== 'string' || !/\.csv$/i.test(result.filePath)) throw reportError('REPORT_INVALID');
      const saved = await saveReadable(result.filePath, Buffer.from(content, 'utf8'), assertCurrent);
      try { assertCurrent(); } catch { throw reportError('REPORT_WRITE_UNCONFIRMED'); }
      return saved;
    } catch (error) {
      const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : error?.code === 'ENCRYPTION_CONTEXT_CHANGED' || error?.code === 'ENCRYPTION_RESTART_REQUIRED' ? 'REPORT_CONTEXT_CHANGED' : 'REPORT_WRITE_FAILED';
      // These outcomes concern readable files outside the vault. The initiating
      // renderer may have closed or switched class, so IPC rejection alone is
      // insufficient. Use an app-owned modal without a stale parent/window.
      if (['REPORT_WRITE_UNCONFIRMED', 'REPORT_CLEANUP_REQUIRED', 'REPORT_PUBLISHED_CLEANUP_REQUIRED'].includes(code)) {
        try { dialog.showErrorBox('Readable copy needs attention', MESSAGES[code]); }
        catch {
          try { await dialog.showMessageBox({ type: 'error', title: 'Readable copy needs attention', message: MESSAGES[code], buttons: ['OK'], noLink: true }); }
          catch { /* Preserve the sanitized critical rejection if native UI is shutting down. */ }
        }
      }
      throw Object.assign(new Error(MESSAGES[code]), { code });
    } finally { busy = false; }
  }
  return Object.freeze({ run, cancel });
}
module.exports = { createProtectedReportExports };
