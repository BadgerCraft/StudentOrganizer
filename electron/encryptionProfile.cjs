// Main-owned profile. Public device IDs are hashes of separately OS-protected random seeds.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { createPlatformKeyringStore } = require('./platformKeyringStore.cjs');
const { createSqliteProtectedKeyStore } = require('./sqliteProtectedKeyStore.cjs');
const APP_ID = 'student-organizer';
const fail = code => Object.assign(new Error('Protected local device identity is unavailable. Use supported encrypted-backup recovery; do not copy a device profile or open the original workspace as an automatic fallback.'), { code: code || 'DEVICE_KEY_UNAVAILABLE' });
function createEncryptionProfile({ directory, platform = process.platform, activationGate = () => false, createProvider = createPlatformKeyringStore, createStorage = createSqliteProtectedKeyStore, loadBinding, loadWindowsBinding }) {
  if (!path.isAbsolute(directory)) throw fail();
  let provisional = randomBytes(32), deviceId = null, closed = false;
  function assertOpen() { if (closed) throw fail(); }
  function remember(next) { if (deviceId && deviceId !== next) throw fail('DEVICE_KEY_CONTEXT_CHANGED'); deviceId = next; return next; }
  const stores = new Map(), registries = new Map();
  const deviceScope = Object.freeze({ appId: APP_ID + '-device', vaultId: 'local-installation', keyVersion: 1 });
  function profileStore(scope) {
    assertOpen(); const key = JSON.stringify(scope); if (!registries.has(key)) registries.set(key, createStorage({ directory, scope })); return registries.get(key);
  }
  function provider(scope) {
    assertOpen();
    const key = JSON.stringify(scope); if (stores.has(key)) return stores.get(key);
    const localProtectedStorage = profileStore(scope);
    const store = createProvider({ configured: true, platform, withExclusiveProfileLock: localProtectedStorage.withExclusiveProfileLock, localProtectedStorage, loadBinding, loadWindowsBinding });
    stores.set(key, store); return store;
  }
  function id(seed) { return 'device-' + createHash('sha256').update('student-organizer-device-v1\0').update(seed).digest('hex'); }
  async function allowed() { if (await activationGate() !== true) throw fail('ENCRYPTION_ACTIVATION_REQUIRED'); assertOpen(); }
  async function loadDeviceIdentity({ create = false } = {}) {
    assertOpen(); const exists = fs.existsSync(path.join(directory, 'profile-keys.sqlite'));
    if (!exists && !create) return { deviceId: remember(id(provisional)), enrolled: false };
    await allowed(); const store = provider(deviceScope); let seed = await store.load(deviceScope);
    try {
      assertOpen();
      if (!seed) {
        if (!create) throw fail('DEVICE_KEY_ENROLLMENT_REQUIRED');
        await store.save(deviceScope, provisional); assertOpen(); seed = await store.load(deviceScope); assertOpen();
        if (!seed) throw fail();
      }
      return { deviceId: remember(id(seed)), enrolled: true };
    } finally { seed?.fill(0); }
  }
  function vaultKeys(scope) {
    if (scope?.appId !== APP_ID) throw fail();
    const expected = Object.freeze({ appId: scope.appId, vaultId: scope.vaultId, keyVersion: scope.keyVersion });
    return Object.freeze({
      available: () => provider(expected).available(),
      load: async requested => {
        if (JSON.stringify(requested) !== JSON.stringify(expected)) throw fail();
        // Preparation cannot create persistent native material or query OS secrets.
        if (!fs.existsSync(path.join(directory, 'profile-keys.sqlite'))) return null;
        await allowed(); const key = await provider(expected).load(expected);
        try { assertOpen(); return key; } catch (e) { key?.fill(0); throw e; }
      },
      save: async (requested, key) => {
        if (JSON.stringify(requested) !== JSON.stringify(expected)) throw fail();
        if (!(key instanceof Uint8Array) || key.length !== 32) throw fail();
        const owned = new Uint8Array(key);
        try {
          await allowed(); const identity = await loadDeviceIdentity({ create: true });
          if (!deviceId || identity.deviceId !== deviceId) throw fail();
          const result = await provider(expected).save(expected, owned); assertOpen(); return result;
        } finally { owned.fill(0); }
      }
    });
  }
  function close() { closed = true; provisional?.fill(0); provisional = null; deviceId = null; stores.clear(); registries.clear(); }
  return Object.freeze({ loadDeviceIdentity, vaultKeys, profileStore, available: () => provider(deviceScope).available(), close });
}
module.exports = { createEncryptionProfile };
