const fs = require('node:fs/promises');
const { dirname, join } = require('node:path');
function reportError(code) { return Object.assign(new Error(code), { code }); }
/** Deliberate readable copy only. Never used for workspace persistence or backups. */
function createReadableReportWriter({ write = fs.writeFile, read = fs.readFile, makeTemp = fs.mkdtemp, replace = fs.rename, cleanup = fs.rm } = {}) {
  return async function saveReadableReport(destination, bytes, assertCurrent) {
    let temporaryDirectory, publicationAttempted = false, failure;
    try {
      assertCurrent();
      temporaryDirectory = await makeTemp(join(dirname(destination), '.teacher-readable-copy-')); assertCurrent();
      const temporaryPath = join(temporaryDirectory, 'report');
      await write(temporaryPath, bytes, { flag: 'wx', mode: 0o600, flush: true }); assertCurrent();
      const saved = await read(temporaryPath); assertCurrent();
      if (!Buffer.isBuffer(saved) || !saved.equals(bytes)) throw reportError('REPORT_WRITE_FAILED');
      // Last synchronous authorization check before the OS publication call.
      // Once rename starts, cancellation cannot promise that no copy was made.
      assertCurrent(); publicationAttempted = true;
      await replace(temporaryPath, destination); assertCurrent();
    } catch (error) {
      failure = publicationAttempted ? reportError('REPORT_WRITE_UNCONFIRMED') : error;
    }
    if (temporaryDirectory) {
      try { await cleanup(temporaryDirectory, { recursive: true, force: true }); }
      catch { throw reportError(publicationAttempted ? 'REPORT_PUBLISHED_CLEANUP_REQUIRED' : 'REPORT_CLEANUP_REQUIRED'); }
    }
    if (!failure) { try { assertCurrent(); } catch { failure = reportError('REPORT_WRITE_UNCONFIRMED'); } }
    if (failure) throw failure;
    return true;
  };
}
module.exports = { createReadableReportWriter, reportError };
