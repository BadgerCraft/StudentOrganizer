// Main-owned fixed directory/scope only; no renderer-selected paths or plaintext input.
// Metadata checks are not tag authentication: callers must authenticate before use.
// No external monotonic high-water mark: replacing this entire file with an old
// valid version is not prevented here. Activation must address that threat boundary.
// Mock fsync tests do not establish behavior under physical power loss.
const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const MAX_BYTES = 180 * 1024 * 1024;
const MESSAGE = 'Encrypted workspace could not be committed or verified. Reopen the verified saved version; do not blindly retry.';
function failure(code = 'ENCRYPTED_STORAGE_INVALID') { return Object.assign(new Error(MESSAGE), { code }); }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value); }
function base64(value, size, minimum = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw failure();
  const bytes = Buffer.from(value, 'base64'); if (bytes.length < minimum || bytes.length > size || bytes.toString('base64') !== value) throw failure();
}
function createEncryptedVaultStore({ directory, scope, platform = process.platform, fs = fsDefault, syncDirectory, maxBytes = MAX_BYTES }) {
  if (!path.isAbsolute(directory) || !scope || Object.keys(scope).sort().join(',') !== 'appId,keyVersion,vaultId' || !identifier(scope.appId) || !identifier(scope.vaultId) || !Number.isSafeInteger(scope.keyVersion) || scope.keyVersion < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_BYTES) throw failure();
  scope = Object.freeze({ ...scope });
  const target = path.join(directory, 'workspace.vault'), lock = path.join(directory, 'workspace.lock');
  // A supplied platform adapter must flush both the container directory and its
  // already-existing parent, including creation of this directory's entry.
  const sync = syncDirectory || (platform === 'darwin' ? async () => {
    for (const folder of [directory, path.dirname(directory)]) {
      const h = await fs.open(folder, 'r'); try { await h.sync(); } finally { await h.close(); }
    }
  } : null);
  function secure(stat, dir = false) { if (stat.isSymbolicLink() || (dir ? !stat.isDirectory() : !stat.isFile()) || (platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw failure(); }
  function validate(next) {
    if (!next || Object.keys(next).sort().join(',') !== 'ciphertext,revision' || !Number.isSafeInteger(next.revision) || next.revision < 1 || typeof next.ciphertext !== 'string' || Buffer.byteLength(next.ciphertext) > maxBytes) throw failure();
    const e = JSON.parse(next.ciphertext), c = e?.context;
    if (!e || Object.keys(e).sort().join(',') !== 'algorithm,ciphertext,context,format,nonce,salt,version' || e.format !== 'teacher-vault' || e.version !== 1 || e.algorithm !== 'AES-256-GCM-HKDF-SHA256' || !c || Object.keys(c).sort().join(',') !== 'appId,keyVersion,purpose,recordId,revision,vaultId' || c.appId !== scope.appId || c.vaultId !== scope.vaultId || c.keyVersion !== scope.keyVersion || c.purpose !== 'working-data' || c.recordId !== 'workspace' || c.revision !== next.revision) throw failure();
    base64(e.salt, 32); base64(e.nonce, 12); base64(e.ciphertext, 128 * 1024 * 1024 + 16, 16);
    const canonical = { format: e.format, version: e.version, algorithm: e.algorithm, context: { appId: c.appId, vaultId: c.vaultId, purpose: c.purpose, recordId: c.recordId, revision: c.revision, keyVersion: c.keyVersion }, salt: e.salt, nonce: e.nonce, ciphertext: e.ciphertext };
    if (JSON.stringify(canonical) !== next.ciphertext) throw failure();
    return { revision: next.revision, ciphertext: next.ciphertext };
  }
  async function read() {
    let handle;
    try {
      try { secure(await fs.lstat(directory), true); secure(await fs.lstat(target)); handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      const stat = await handle.stat(); secure(stat); if (stat.size < 1 || stat.size > maxBytes) throw failure();
      const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
      while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
      if (offset !== stat.size) throw failure();
      const text = bytes.subarray(0, offset).toString('utf8'), stored = JSON.parse(text);
      if (!stored || Object.keys(stored).sort().join(',') !== 'ciphertext,format,revision,version' || stored.format !== 'teacher-vault-checkpoint' || stored.version !== 1) throw failure();
      const result = validate({ revision: stored.revision, ciphertext: stored.ciphertext });
      if (JSON.stringify({ format: stored.format, version: stored.version, ...result }) !== text) throw failure();
      return result;
    } catch { throw failure(); } finally { if (handle) await handle.close().catch(() => {}); }
  }
  async function commit(expectedRevision, input) {
    if (!sync || !['darwin', 'win32'].includes(platform)) throw failure('ENCRYPTED_STORAGE_DURABILITY_UNAVAILABLE');
    let held = false, temporary, published = false;
    try {
      const next = validate(input);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw failure();
      if (next.revision !== (expectedRevision === null ? 1 : expectedRevision + 1)) throw failure();
      const bytes = Buffer.from(JSON.stringify({ format: 'teacher-vault-checkpoint', version: 1, ...next })); if (bytes.length > maxBytes) throw failure();
      // The main-owned parent must already exist; do not silently create a chain
      // whose directory entries have no established durability.
      try { await fs.mkdir(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      secure(await fs.lstat(directory), true);
      let lockHandle; try { lockHandle = await fs.open(lock, 'wx', 0o600); held = true; } catch (e) { if (e.code === 'EEXIST') throw failure('ENCRYPTED_STORAGE_LOCKED'); throw e; }
      await lockHandle.close();
      const current = await read(); if ((current?.revision ?? null) !== expectedRevision) throw failure('ENCRYPTED_STORAGE_STALE');
      temporary = path.join(directory, '.vault-pending-' + randomUUID()); const h = await fs.open(temporary, 'wx', 0o600);
      try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
      await fs.rename(temporary, target); published = true; await sync();
    } catch (cause) { if (published) throw failure('ENCRYPTED_STORAGE_COMMIT_UNCERTAIN'); throw failure(typeof cause?.code === 'string' && cause.code.startsWith('ENCRYPTED_STORAGE_') ? cause.code : undefined); }
    finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      if (held) await fs.unlink(lock).catch(() => {});
      // A crash-stale lock is intentionally not automatically removed or replayed.
    }
  }
  return Object.freeze({ read, commit });
}
module.exports = { createEncryptedVaultStore };
