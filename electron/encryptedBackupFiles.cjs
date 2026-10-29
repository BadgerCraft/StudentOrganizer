// User-selected native paths only. Every staged/exported byte is ciphertext;
// workspace validation, keys and archive authentication belong to the host.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_FILE_BYTES = 512 * 1024 * 1024 * 1024;
const fail = code => Object.assign(new Error('The encrypted backup file was not verified. Keep the original workspace and inspect the chosen destination before repeating an uncertain write.'), { code });
function createEncryptedBackupFiles({ dialog, parent = () => undefined, fileSystem = fs, maxFileBytes = MAX_FILE_BYTES }) {
  if (!dialog || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > MAX_FILE_BYTES) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID');
  const filters = [{ name: 'Student Organizer encrypted workspace', extensions: ['sovault'] }];
  async function* readHandle(handle, assertCurrent) {
    const buffer = Buffer.alloc(64 * 1024); let total = 0;
    try {
      for (;;) {
        assertCurrent(); const result = await handle.read(buffer, 0, buffer.length, null); assertCurrent();
        if (!result.bytesRead) break; total += result.bytesRead;
        if (total > maxFileBytes) throw fail('ENCRYPTION_ARCHIVE_FILE_TOO_LARGE');
        yield new Uint8Array(buffer.subarray(0, result.bytesRead));
      }
    } finally { buffer.fill(0); }
  }
  async function previewFile(readArchive, assertCurrent) {
    const choice = await dialog.showOpenDialog(parent(), { title: 'Choose an encrypted workspace backup', properties: ['openFile'], filters }); assertCurrent();
    if (choice.canceled) return { cancelled: true };
    if (!Array.isArray(choice.filePaths) || choice.filePaths.length !== 1 || typeof choice.filePaths[0] !== 'string' || !path.isAbsolute(choice.filePaths[0])) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID');
    let handle;
    try {
      handle = await fileSystem.open(choice.filePaths[0], 'r'); assertCurrent(); const stat = await handle.stat(); assertCurrent();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxFileBytes) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID');
      const value = await readArchive(readHandle(handle, assertCurrent)); assertCurrent();
      return { cancelled: false, ...value };
    } finally { if (handle) await handle.close(); }
  }
  async function exportFile(writeArchive, assertCurrent) {
    const choice = await dialog.showSaveDialog(parent(), { title: 'Save an encrypted workspace backup', defaultPath: 'StudentOrganizer-encrypted-' + new Date().toISOString().slice(0, 10) + '.sovault', filters, properties: ['showOverwriteConfirmation'] }); assertCurrent();
    if (choice.canceled) return { cancelled: true };
    if (typeof choice.filePath !== 'string' || !path.isAbsolute(choice.filePath)) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID');
    const destination = choice.filePath, temporary = path.join(path.dirname(destination), '.student-organizer-encrypted-' + randomUUID() + '.partial');
    let handle, published = false, publicationAttempted = false, total = 0; const digest = createHash('sha256');
    try {
      handle = await fileSystem.open(temporary, 'wx', 0o600); assertCurrent();
      const result = await writeArchive(async bytes => {
        assertCurrent(); if (!(bytes instanceof Uint8Array) || bytes.length > 32 * 1024 * 1024 || (total += bytes.length) > maxFileBytes) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID');
        // Freeze borrowed input before an asynchronous filesystem write.
        const owned = Buffer.from(bytes);
        try {
          let offset = 0;
          while (offset < owned.length) {
            assertCurrent(); const written = await handle.write(owned, offset, owned.length - offset, null); assertCurrent();
            if (!Number.isInteger(written.bytesWritten) || written.bytesWritten < 1 || written.bytesWritten > owned.length - offset) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID'); offset += written.bytesWritten;
          }
          digest.update(owned);
        } finally { owned.fill(0); }
      });
      assertCurrent(); if (!total) throw fail('ENCRYPTION_ARCHIVE_FILE_INVALID'); await handle.sync(); assertCurrent(); await handle.close(); handle = null; assertCurrent();
      publicationAttempted = true; await fileSystem.rename(temporary, destination); published = true; assertCurrent();
      const check = await fileSystem.open(destination, 'r');
      try {
        const copied = createHash('sha256'); let bytes = 0;
        for await (const part of readHandle(check, assertCurrent)) { bytes += part.length; copied.update(part); }
        if (bytes !== total || copied.digest('hex') !== digest.digest('hex')) throw fail('ENCRYPTION_BACKUP_WRITE_UNCONFIRMED');
      } finally { await check.close(); }
      assertCurrent(); return { cancelled: false, ...result };
    } catch (error) {
      if (publicationAttempted) throw fail('ENCRYPTION_BACKUP_WRITE_UNCONFIRMED');
      throw fail(error?.code === 'ENCRYPTION_ARCHIVE_FILE_TOO_LARGE' ? error.code : 'ENCRYPTION_BACKUP_WRITE_FAILED');
    } finally {
      try { if (handle) await handle.close(); } finally { if (!published) { try { await fileSystem.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw fail(publicationAttempted ? 'ENCRYPTION_BACKUP_WRITE_UNCONFIRMED' : 'ENCRYPTION_BACKUP_CLEANUP_REQUIRED'); } } }
    }
  }
  return Object.freeze({ previewFile, exportFile });
}
module.exports = { createEncryptedBackupFiles };
