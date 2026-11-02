// Optional main-process/Node host adapter. Never import this from a renderer.
const { createHash, timingSafeEqual } = require('node:crypto');
const FAIL = 'Protected device key is unavailable. Use verified offline recovery; no plaintext fallback was used.';
const MAX = 16 * 1024;
function scope(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'appId,keyVersion,vaultId' ||
      ![value.appId, value.vaultId].every(v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v)) ||
      !Number.isSafeInteger(value.keyVersion) || value.keyVersion < 1) throw Error(FAIL);
  return { appId: value.appId, vaultId: value.vaultId, keyVersion: value.keyVersion };
}
function bounded(value) {
  if (!(value instanceof Uint8Array) || !value.length || value.length > MAX) throw Error(FAIL);
  return Buffer.from(value);
}
function createWindowsDpapiProtector({ Dpapi, isPlatformSupported }) {
  if (isPlatformSupported !== true || typeof Dpapi?.protectData !== 'function' || typeof Dpapi?.unprotectData !== 'function') throw Error(FAIL);
  // CurrentUser alone can follow a roaming profile. Machine-only alone permits
  // other users on that machine. Nested protection requires both boundaries.
  return Object.freeze({
    protect(bytes, entropy) {
      let inner;
      try { inner = bounded(Dpapi.protectData(bytes, entropy, 'CurrentUser')); return bounded(Dpapi.protectData(inner, entropy, 'LocalMachine')); }
      catch { throw Error(FAIL); } finally { inner?.fill(0); }
    },
    unprotect(bytes, entropy) {
      let inner;
      try { inner = bounded(Dpapi.unprotectData(bytes, entropy, 'LocalMachine')); return bounded(Dpapi.unprotectData(inner, entropy, 'CurrentUser')); }
      catch { throw Error(FAIL); } finally { inner?.fill(0); }
    }
  });
}
function createPlatformKeyringStore({ configured = false, platform = process.platform,
  withExclusiveProfileLock, localProtectedStorage, loadBinding = () => require('@napi-rs/keyring'),
  loadWindowsBinding = () => require('@primno/dpapi') }) {
  if (typeof withExclusiveProfileLock !== 'function') throw Error(FAIL);
  let binding, protector;
  function provider() {
    if (!configured || !['win32', 'darwin'].includes(platform)) throw Error(FAIL);
    if (platform === 'win32') {
      if (typeof localProtectedStorage?.read !== 'function' || typeof localProtectedStorage?.create !== 'function') throw Error(FAIL);
      protector ??= createWindowsDpapiProtector(loadWindowsBinding()); return null;
    }
    binding ??= loadBinding();
    if (typeof binding?.AsyncEntry !== 'function') throw Error(FAIL);
    return binding;
  }
  function identity(c) {
    const canonical = JSON.stringify(c), digest = createHash('sha256').update(canonical).digest('hex');
    // No dots in either component: avoids Windows service/user delimiter collisions.
    const service = 'TeacherVaultV1-' + createHash('sha256').update(c.appId).digest('hex');
    return { canonical, digest, service, account: 'scope-' + digest,
      entropy: createHash('sha256').update('TeacherVaultDeviceKeyV1\0' + canonical).digest() };
  }
  function entry(c) {
    const i = identity(c), native = provider();
    // Windows stores ONLY nested-DPAPI ciphertext in a fixed local SQLite table.
    // Never use Credential Manager's default Enterprise/roaming persistence.
    const credential = platform === 'win32' ? {
      getSecret: async () => { const value = await localProtectedStorage.read(i.digest); if (value === null) return null; const bytes = bounded(value); const copy = Array.from(bytes); bytes.fill(0); return copy; },
      setSecret: async bytes => { await localProtectedStorage.create(i.digest, bytes); }
    } : new native.AsyncEntry(i.service, i.account);
    return { ...i, credential };
  }
  async function read(c, e) {
    const raw = await e.credential.getSecret();
    if (raw === null) return null; // Locked/inaccessible rejects; never converted to absent.
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX || raw.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw Error(FAIL);
    let stored = Buffer.from(raw), clear;
    try {
      clear = platform === 'win32' ? protector.unprotect(stored, e.entropy) : bounded(stored);
      const p = JSON.parse(clear.toString('utf8'));
      if (!p || Object.keys(p).sort().join(',') !== 'appId,key,keyVersion,vaultId,version' || p.version !== 1 ||
          p.appId !== c.appId || p.vaultId !== c.vaultId || p.keyVersion !== c.keyVersion ||
          typeof p.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(p.key)) throw Error(FAIL);
      const key = Buffer.from(p.key, 'base64');
      if (key.length !== 32 || key.toString('base64') !== p.key) { key.fill(0); throw Error(FAIL); }
      return key;
    } finally { stored.fill(0); clear?.fill(0); raw.fill(0); }
  }
  async function available() { try { provider(); return true; } catch { return false; } }
  async function load(value) {
    const c = scope(value);
    try { return await withExclusiveProfileLock(async () => { const key = await read(c, entry(c)); if (!key) return null; const copy = new Uint8Array(key); key.fill(0); return copy; }); }
    catch { throw Error(FAIL); }
  }
  async function save(value, inputKey) {
    const c = scope(value);
    if (!(inputKey instanceof Uint8Array) || inputKey.length !== 32) throw Error(FAIL);
    const key = Buffer.from(inputKey);
    let attempted = false;
    try { return await withExclusiveProfileLock(async () => {
      const e = entry(c); const old = await read(c, e);
      if (old) { const equal = timingSafeEqual(old, key); old.fill(0); if (!equal) throw Error(FAIL); return { durability: 'os-store-readback' }; }
      let clear, stored, verified;
      try {
        clear = Buffer.from(JSON.stringify({ version: 1, ...c, key: Buffer.from(key).toString('base64') }));
        stored = platform === 'win32' ? protector.protect(clear, e.entropy) : bounded(clear);
        attempted = true; await e.credential.setSecret(stored);
        verified = await read(c, e);
        if (!verified || !timingSafeEqual(verified, key)) throw Error(FAIL);
        return { durability: 'os-store-readback' };
      } finally { clear?.fill(0); stored?.fill(0); verified?.fill(0); }
    }); } catch { const error = Error(FAIL); if (attempted) error.code = 'DEVICE_KEY_SAVE_UNCERTAIN'; throw error; }
    finally { key.fill(0); }
  }
  return Object.freeze({ available, load, save });
}
module.exports = { createPlatformKeyringStore, createWindowsDpapiProtector };
