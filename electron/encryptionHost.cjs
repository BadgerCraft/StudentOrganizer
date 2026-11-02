// Prerequisite main-process host. No app startup/IPC or activation is wired here.
// The constructor's fixed scope, device identity, validation and activation gate are main-owned.
const path = require('node:path');
const { createEncryptionKeyStore } = require('./encryptionKeyStore.cjs');
const { createEncryptedVaultStore } = require('./encryptedVaultStore.cjs');
const APP_ID = 'student-organizer';
const SAFE_MESSAGE = 'Encrypted workspace action did not complete. Keep the original workspace and reopen verified recovery before retrying.';
function error(code = 'ENCRYPTION_HOST_LOCKED') { return Object.assign(new Error(SAFE_MESSAGE), { code }); }
function runtime() {
  return { ...require('./generated/encryption/shared/encryption/index.js'), ...require('./generated/encryption/src/security/encryptedWorkspace.js') };
}
function same(a, b) { if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; }
function createEncryptionHost({ directory, vaultId, deviceId, keyVersion = 1, safeStorage, platform = process.platform, validateSnapshot, activationGate = () => false, keyStore, workspaceStore, cryptoRuntime, syncDirectory }) {
  if (!path.isAbsolute(directory) || typeof vaultId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(vaultId) || typeof deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(deviceId) || !Number.isSafeInteger(keyVersion) || keyVersion < 1 || typeof validateSnapshot !== 'function' || typeof activationGate !== 'function') throw error('ENCRYPTION_HOST_CONFIG');
  const scope = Object.freeze({ appId: APP_ID, vaultId, keyVersion });
  const api = cryptoRuntime || runtime();
  const keys = keyStore || createEncryptionKeyStore({ directory: path.join(directory, 'keys'), safeStorage, platform });
  const durabilityReady = Boolean(workspaceStore) || platform === 'darwin' || (platform === 'win32' && typeof syncDirectory === 'function');
  const store = workspaceStore || createEncryptedVaultStore({ directory: path.join(directory, 'working'), scope, platform, syncDirectory });
  let session = null, preparation = null, epoch = 0, queue = Promise.resolve();
  function closePreparation() { preparation?.migration.close(); preparation?.key.fill(0); preparation = null; }
  function lock() { epoch++; session?.lock(); session = null; closePreparation(); }
  function validate(value) { validateSnapshot(value); return structuredClone(value); }
  function source(value) { const snapshot = validate(value); return { withReadLock: async read => read(structuredClone(snapshot)) }; }
  function run(action) {
    const entered = epoch;
    const pending = queue.then(async () => {
      if (entered !== epoch) throw error();
      const assertCurrent = () => { if (entered !== epoch) throw error(); };
      try { const value = await action(assertCurrent); assertCurrent(); return value; }
      catch (cause) { if (typeof cause?.code === 'string' && (cause.code.startsWith('DEVICE_KEY_') || cause.code.startsWith('ENCRYPTED_STORAGE_'))) throw cause; throw error(cause?.code === 'ENCRYPTION_ACTIVATION_REQUIRED' ? cause.code : undefined); }
    });
    queue = pending.catch(() => {}); return pending;
  }
  async function ensureEnrollment(inputKey, current) {
    const key = new Uint8Array(inputKey);
    try {
    const existing = await keys.load(scope);
    try {
      current();
      if (existing) { if (!same(existing, key)) throw error('ENCRYPTION_DEVICE_KEY_MISMATCH'); }
      else { await keys.save(scope, key); }
    } finally { existing?.fill(0); }
    current(); const reopened = await keys.load(scope); try { current(); if (!same(reopened, key)) throw error(); } finally { reopened?.fill(0); }
    } finally { key.fill(0); }
  }
  async function requireActivation() { if (await activationGate() !== true) { session?.lock(); session = null; throw error('ENCRYPTION_ACTIVATION_REQUIRED'); } }
  function status() { return { appId: APP_ID, vaultId, keyVersion, state: session ? 'unlocked' : preparation ? 'preparing' : 'locked', revision: session ? session.getRevision() : null }; }
  return Object.freeze({
    status, lock,
    prepareMigration: snapshot => run(async current => {
      if (session || preparation || await store.read() !== null) throw error();
      const initialSource = source(snapshot);
      let key = await keys.load(scope) || api.generateMasterKey(), migration;
      try {
        const recoveryCode = await api.generateRecoveryCode();
        const wrappedKey = await api.wrapMasterKey(key, recoveryCode, APP_ID, vaultId, keyVersion);
        migration = await api.WorkspaceMigration.prepare(initialSource, scope, key, wrappedKey, deviceId, validateSnapshot);
        current(); preparation = { key: new Uint8Array(key), migration, recoveryVerified: false, deviceVerified: false }; migration = null;
        return { recoveryCode, wrappedKey, appId: APP_ID, vaultId, keyVersion };
      } finally { key.fill(0); migration?.close(); }
    }),
    verifyRecovery: code => run(async current => { if (!preparation) throw error(); preparation.recoveryVerified = false; const candidate = preparation; await candidate.migration.verifyRecovery(code); current(); candidate.recoveryVerified = true; }),
    createDeviceChallenge: targetDeviceId => run(async current => { if (!preparation) throw error(); preparation.deviceVerified = false; const challenge = await preparation.migration.createDeviceChallenge(targetDeviceId); current(); return challenge; }),
    verifyDeviceResponse: (targetDeviceId, ciphertext) => run(async current => { if (!preparation) throw error(); preparation.deviceVerified = false; const candidate = preparation; await candidate.migration.verifyDeviceResponse(targetDeviceId, ciphertext); current(); candidate.deviceVerified = true; }),
    completeMigration: snapshot => run(async current => {
      if (!preparation || !preparation.recoveryVerified || !preparation.deviceVerified) throw error(); await requireActivation(); current();
      if (!durabilityReady) throw error('ENCRYPTED_STORAGE_DURABILITY_UNAVAILABLE');
      const candidate = preparation, latestSource = source(snapshot);
      try {
        await ensureEnrollment(candidate.key, current); current();
        await candidate.migration.convert(latestSource, store); current();
        const opened = await api.EncryptedWorkspaceSession.open(store, scope, candidate.key, validateSnapshot);
        try { current(); session = opened; } catch (e) { opened.lock(); throw e; }
        return { revision: session.getRevision() };
      } finally { if (preparation === candidate) closePreparation(); else candidate.key.fill(0); }
    }),
    unlock: () => run(async current => {
      await requireActivation(); current(); if (session || preparation) throw error(); const key = await keys.load(scope); if (!key) throw error();
      try {
        const opened = await api.EncryptedWorkspaceSession.open(store, scope, key, validateSnapshot);
        try { current(); session = opened; return { revision: opened.getRevision() }; } catch (e) { opened.lock(); throw e; }
      } finally { key.fill(0); }
    }),
    read: () => run(async current => { await requireActivation(); current(); if (!session) throw error(); return { revision: session.getRevision(), snapshot: session.read() }; }),
    commit: (expectedRevision, snapshot) => run(async current => {
      await requireActivation(); current(); if (!session || !Number.isSafeInteger(expectedRevision) || session.getRevision() !== expectedRevision) throw error();
      const candidate = validate(snapshot), active = session;
      try { await active.transact(draft => { for (const k of Object.keys(draft)) delete draft[k]; Object.assign(draft, candidate); }); current(); return { revision: active.getRevision() }; }
      catch (e) { if (session === active) { active.lock(); session = null; } throw e; }
    }),
    exportEncrypted: (purpose, recordId) => run(async current => { await requireActivation(); current(); if (!session || !['backup', 'transfer'].includes(purpose)) throw error(); const result = await session.exportEncrypted(purpose, recordId); current(); return result; }),
    enrollFromRecovery: (code, wrappedKey, challenge) => run(async current => {
      await requireActivation(); current(); if (session || preparation || !challenge || challenge.deviceId !== deviceId || challenge.context?.appId !== APP_ID || challenge.context?.vaultId !== vaultId || challenge.context?.keyVersion !== keyVersion) throw error();
      const key = await api.recoverMasterKey(code, wrappedKey, APP_ID, vaultId, keyVersion);
      try { const response = await api.answerEnrollmentChallenge(key, challenge); current(); await ensureEnrollment(key, current); current(); return { deviceId, ciphertext: response }; } finally { key.fill(0); }
    })
  });
}
module.exports = { createEncryptionHost };
