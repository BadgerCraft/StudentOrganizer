// Main-process adapter only. The caller owns the directory and must guard IPC callers.
// Windows DPAPI does not protect against other programs running as the same OS user.
// No Electron import here: safeStorage is injected after app readiness.
const fsDefault = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const LIMIT = 16 * 1024;
const GENERIC = 'Protected device key is unavailable. Use verified offline recovery; no plaintext fallback was used.';
function context(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'appId,keyVersion,vaultId' ||
      typeof value.appId !== 'string' || typeof value.vaultId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.appId) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.vaultId) ||
      !Number.isSafeInteger(value.keyVersion) || value.keyVersion < 1) throw new Error(GENERIC);
  return { appId: value.appId, vaultId: value.vaultId, keyVersion: value.keyVersion };
}
function createEncryptionKeyStore({ directory, safeStorage, platform = process.platform, fs = fsDefault }) {
  if (!path.isAbsolute(directory)) throw new Error(GENERIC);
  async function available() {
    try {
      // Linux is intentionally unsupported, including its basic_text fallback.
      return ['win32', 'darwin'].includes(platform) && typeof safeStorage.isAsyncEncryptionAvailable === 'function' &&
        await safeStorage.isAsyncEncryptionAvailable() === true;
    } catch { return false; }
  }
  async function requireAvailable() { if (!await available()) throw new Error(GENERIC); }
  function filename(c) { return path.join(directory, createHash('sha256').update(JSON.stringify(c)).digest('hex') + '.device-key'); }
  function secureStat(stat, isDirectory = false) {
    if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : !stat.isFile()) ||
        (platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error(GENERIC);
  }
  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    secureStat(await fs.lstat(directory), true);
  }
  async function save(input, key) {
    await requireAvailable(); const c = context(input);
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new Error(GENERIC);
    let temporary, published = false;
    try {
      await ensureDirectory();
      const payload = JSON.stringify({ version: 1, ...c, key: Buffer.from(key).toString('base64') });
      const protectedBytes = await safeStorage.encryptStringAsync(payload);
      if (!Buffer.isBuffer(protectedBytes) || !protectedBytes.length || protectedBytes.length > LIMIT) throw new Error(GENERIC);
      temporary = path.join(directory, '.pending-' + randomUUID());
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(protectedBytes); await handle.sync(); } finally { await handle.close(); }
      // link is atomic and refuses an existing target: a failed enrollment cannot replace a key.
      await fs.link(temporary, filename(c)); published = true;
      if (platform === 'darwin') {
        const directoryHandle = await fs.open(directory, 'r');
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
      // Node cannot establish directory-entry fsync on Windows. Consumers must
      // verify enrollment/recovery across restart before conversion; no power-loss claim.
      return { durability: platform === 'darwin' ? 'directory-synced' : 'file-synced' };
    } catch {
      const error = new Error(GENERIC);
      if (published) error.code = 'DEVICE_KEY_SAVE_UNCERTAIN';
      throw error;
    }
    finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
  }
  async function load(input) {
    await requireAvailable(); const c = context(input); let handle;
    try {
      try { secureStat(await fs.lstat(directory), true); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      try { secureStat(await fs.lstat(filename(c))); handle = await fs.open(filename(c), constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const stat = await handle.stat(); secureStat(stat);
      if (stat.size < 1 || stat.size > LIMIT) throw new Error(GENERIC);
      const bounded = Buffer.alloc(LIMIT + 1); let offset = 0;
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (!bytesRead) break; offset += bytesRead;
      }
      if (offset !== stat.size || offset > LIMIT) throw new Error(GENERIC);
      const bytes = bounded.subarray(0, offset);
      const decrypted = await safeStorage.decryptStringAsync(bytes);
      if (!decrypted || typeof decrypted.result !== 'string' || typeof decrypted.shouldReEncrypt !== 'boolean') throw new Error(GENERIC);
      if (decrypted.shouldReEncrypt) {
        const rotation = new Error(GENERIC); rotation.code = 'DEVICE_KEY_REWRAP_REQUIRED'; throw rotation;
      }
      const parsed = JSON.parse(decrypted.result);
      if (!parsed || Object.keys(parsed).sort().join(',') !== 'appId,key,keyVersion,vaultId,version' ||
          parsed.version !== 1 || parsed.appId !== c.appId || parsed.vaultId !== c.vaultId || parsed.keyVersion !== c.keyVersion ||
          typeof parsed.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(parsed.key)) throw new Error(GENERIC);
      const key = Buffer.from(parsed.key, 'base64');
      if (key.length !== 32 || key.toString('base64') !== parsed.key) throw new Error(GENERIC);
      const result = new Uint8Array(key); key.fill(0); return result;
    } catch (cause) {
      const error = new Error(GENERIC);
      if (cause?.code === 'DEVICE_KEY_REWRAP_REQUIRED') error.code = cause.code;
      throw error;
    }
    finally { if (handle) await handle.close().catch(() => {}); }
  }
  return Object.freeze({ available, save, load });
}
module.exports = { createEncryptionKeyStore };
