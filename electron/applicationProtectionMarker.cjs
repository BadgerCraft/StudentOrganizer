// Immutable app-level OS presence marker, independent of workspace paths/scope.
const { createHash } = require('node:crypto');
const fail = () => Object.assign(Error('The protected application marker could not be verified. Keep protected startup locked; no plaintext fallback was used.'), { code: 'APPLICATION_PROTECTION_UNCERTAIN' });
function createApplicationProtectionMarker({ appId, platform = process.platform, loadWindowsBinding, loadMacBinding = () => require('@napi-rs/keyring') }) {
  if (typeof appId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(appId)) throw fail();
  const digest = createHash('sha256').update('TeacherVaultApplicationProtectionV1\0' + appId).digest('hex');
  const bytes = Buffer.from(JSON.stringify({ format: 'teacher-vault-application-protection', version: 1, appId, protected: true }));
  let windows, mac;
  function backend() {
    if (platform === 'win32') {
      windows ??= loadWindowsBinding?.(); if (typeof windows?.read !== 'function' || typeof windows?.write !== 'function') throw fail();
      return { read: () => windows.read('TeacherVaultLedgerV1-' + digest), write: value => windows.write('TeacherVaultLedgerV1-' + digest, value) };
    }
    if (platform === 'darwin') {
      const binding = loadMacBinding(); if (typeof binding?.AsyncEntry !== 'function') throw fail();
      mac ??= new binding.AsyncEntry('TeacherVaultApplicationProtectionV1', 'app-' + digest);
      return { read: async () => { const value = await mac.getSecret(); if (value === null) return null; if (!Array.isArray(value) || value.length > 2048 || value.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw fail(); return Buffer.from(value); }, write: value => mac.setSecret(value) };
    }
    throw fail();
  }
  async function read() {
    try { const value = await backend().read(); if (value === null) return false; if (!(value instanceof Uint8Array) || !Buffer.from(value).equals(bytes)) throw fail(); return true; } catch { throw fail(); }
  }
  async function markProtected(assertCurrent) {
    if (typeof assertCurrent !== 'function') throw fail();
    try {
      if (assertCurrent() !== undefined) throw fail(); const present = await read(); if (assertCurrent() !== undefined) throw fail();
      // Concurrent cooperating writers can only publish these identical immutable bytes.
      // There is no mutable revision/CAS state or deletion operation in this provider.
      if (!present) { await backend().write(bytes); if (assertCurrent() !== undefined) throw fail(); }
      if (!await read()) throw fail(); if (assertCurrent() !== undefined) throw fail();
    } catch { throw fail(); }
  }
  return Object.freeze({ read, markProtected });
}
module.exports = { createApplicationProtectionMarker };
