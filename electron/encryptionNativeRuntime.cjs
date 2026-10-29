// Main-owned assembly. Default activation is off; a renderer cannot change it.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createEncryptionProfile } = require('./encryptionProfile.cjs');
const { createSqliteEncryptedVaultStore, inspectSqliteVaultDescriptor } = require('./sqliteEncryptedVaultStore.cjs');
const { createProtectedRevisionLedger } = require('./protectedRevisionLedger.cjs');
const { createPendingEncryptedCommit } = require('./pendingEncryptedCommit.cjs');
const { createApplicationProtectionMarker } = require('./applicationProtectionMarker.cjs');
const { createCipherChunkStore } = require('./cipherChunkStore.cjs');
const APP = 'student-organizer';
const fail = (code = 'ENCRYPTION_RUNTIME_LOCKED') => Object.assign(Error('Protected startup could not verify its saved state. Keep the original workspace and use verified encrypted recovery; no plaintext fallback was used.'), { code });
async function createNativeEncryptionRuntime({ directory, platform = process.platform, activationGate = () => false, createHost,
  createProfile = createEncryptionProfile, profileOptions = {}, createStore = createSqliteEncryptedVaultStore,
  inspectDescriptor = inspectSqliteVaultDescriptor, createLedger = createProtectedRevisionLedger,
  createChunks = createCipherChunkStore, createMarker = createApplicationProtectionMarker, cryptoRuntime, DatabaseSync, loadLedgerBinding = () => require('./generated/windowsCredentialLedger.node'), loadMacBinding }) {
  if (!path.isAbsolute(directory) || typeof createHost !== 'function' || typeof activationGate !== 'function') throw fail();
  const working = path.join(directory, 'working'), keyDirectory = path.join(directory, 'device-keys');
  const profile = createProfile({ ...profileOptions, directory: keyDirectory, platform, activationGate });
  const marker = createMarker({ appId: APP, platform, loadWindowsBinding: loadLedgerBinding, loadMacBinding });
  const api = cryptoRuntime || require('./generated/encryption/shared/encryption/index.js');
  let selected = { appId: APP, vaultId: randomUUID(), keyVersion: 1 }, identity = null, host = null, raw = null, coordinated = null, closed = false, epoch = 0;
  let mode = 'legacy', initializationError = null, freshAuthority = null, activationReady = false, enrollmentResponse = null, explicitLegacyReturn = false;
  function open() { if (closed) throw fail(); }
  function present(filename) { try { fs.lstatSync(filename); return true; } catch (e) { return e.code !== 'ENOENT'; } }
  function workspaceArtifacts() { return ['workspace.sqlite', 'workspace.sqlite-wal', 'workspace.sqlite-shm', 'workspace.sqlite-journal'].some(name => present(path.join(working, name))); }
  function protectedArtifacts() {
    const markers = [[working, 'workspace.sqlite'], [keyDirectory, 'profile-keys.sqlite'], [path.join(directory, 'chunks'), 'chunks.sqlite']];
    return markers.some(([base, name]) => ['', '-wal', '-shm', '-journal'].some(suffix => present(path.join(base, name + suffix))));
  }
  function ensureRoot() {
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = fs.lstatSync(directory); if (!st.isDirectory() || st.isSymbolicLink() || (process.platform !== 'win32' && st.mode & 0o077)) throw fail();
  }
  async function allowed() { open(); if (await activationGate() !== true) throw fail('ENCRYPTION_ACTIVATION_REQUIRED'); }
  function lockNow() { epoch++; freshAuthority = null; host?.lock(); }
  function hostScope() { return { appId: selected.appId, vaultId: selected.vaultId, keyVersion: selected.keyVersion }; }
  async function withFreshEnrollment(assertCurrent, action) {
    await allowed(); if (typeof assertCurrent !== 'function' || typeof action !== 'function' || freshAuthority) throw fail();
    const entered = epoch; assertCurrent();
    await marker.markProtected(() => { open(); if (entered !== epoch) throw fail(); assertCurrent(); });
    assertCurrent(); ensureRoot();
    freshAuthority = () => { open(); if (entered !== epoch) throw fail(); assertCurrent(); };
    try { return await action(); } finally { freshAuthority = null; }
  }
  function assertFresh() {
    open(); if (freshAuthority) return freshAuthority();
    if (typeof host?.assertFreshEnrollment !== 'function' || host.assertFreshEnrollment() !== undefined) throw fail();
  }
  async function ensureProtectionIntent() { if (!await marker.read()) await marker.markProtected(assertFresh); }
  function assembleStore() {
    if (coordinated) return coordinated;
    if (!identity) throw fail(); const scope = hostScope();
    raw = createStore({ directory: working, scope, deviceId: identity.deviceId, DatabaseSync });
    const profileStore = profile.profileStore(scope);
    const ledger = createLedger({ scope, platform, assertProfileLease: profileStore.assertProfileLease, loadWindowsBinding: loadLedgerBinding, loadMacBinding });
    const protocol = createPendingEncryptedCommit({ scope, ledger, candidates: raw, withExclusiveProfileLock: profileStore.withExclusiveProfileLock,
      assertFreshEnrollment: assertFresh });
    let trustedHead = null;
    async function read() {
      open();
      // Preparation reads an untouched legacy source without creating key/profile artifacts.
      if (mode === 'legacy' && !protectedArtifacts()) return null;
      await allowed(); const result = await protocol.reconcile();
      if (result.status === 'enrollment-required') {
        if (freshAuthority) { freshAuthority(); return null; }
        if (typeof host?.assertFreshEnrollment === 'function' && host.assertFreshEnrollment() === undefined) return null;
        throw fail('ENCRYPTION_ENROLLMENT_REQUIRED');
      }
      if (result.status !== 'durable' || !result.head) throw fail('ENCRYPTION_RECONCILIATION_REQUIRED');
      const checkpoint = await raw.read();
      if (!checkpoint || checkpoint.revision !== result.head.revision || createHash('sha256').update(checkpoint.ciphertext, 'utf8').digest('hex') !== result.head.hash) throw fail('ENCRYPTED_STORAGE_STALE');
      trustedHead = result.head; return checkpoint;
    }
    async function commit(expectedRevision, next) {
      await allowed(); if (expectedRevision === null) await ensureProtectionIntent(); ensureRoot();
      let expected = null;
      if (expectedRevision !== null) {
        const check = await protocol.reconcile(); if (check.status !== 'durable' || !check.head || check.head.revision !== expectedRevision) throw fail('ENCRYPTED_STORAGE_STALE');
        expected = check.head;
      }
      const result = await protocol.commit(expected, next);
      if (result.status !== 'durable') { lockNow(); throw fail(result.status === 'uncertain' ? 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' : 'ENCRYPTED_STORAGE_STALE'); }
      trustedHead = result.head;
    }
    coordinated = Object.freeze({ read, commit, initialize: async () => { await allowed(); await ensureProtectionIntent(); ensureRoot(); await raw.initialize(); },
      readAux: kind => raw.readAux(kind), saveAux: (kind, value) => raw.saveAux(kind, value),
      getTrustedHead: () => trustedHead, reconcile: protocol.reconcile,
      inspectEmptyEnrollment: assertCurrent => profileStore.withExclusiveProfileLock(async () => {
        assertCurrent(); const state = await ledger.read(); assertCurrent(); const checkpoint = await raw.read(); assertCurrent();
        if (checkpoint !== null || state && (state.head !== null || state.pending !== null)) throw fail('ENCRYPTION_RECONCILIATION_REQUIRED');
      }) });
    return coordinated;
  }
  function getHost(create = true) {
    open(); if (host || !create) return host;
    if (initializationError || !identity) throw fail(); const scope = hostScope(), store = assembleStore();
    host = createHost({ directory, vaultId: scope.vaultId, keyVersion: scope.keyVersion, deviceId: identity.deviceId,
      keyStore: profile.vaultKeys(scope), workspaceStore: store, rawStore: raw, activationGate, withFreshEnrollment,
      createChunkStore: (verifyManifest, assertPublication) => { if (typeof verifyManifest !== 'function' || typeof assertPublication !== 'function') throw fail(); return createChunks({ directory: path.join(directory, 'chunks'), scope, DatabaseSync, verifyManifest, hooks: { beforeCommit: assertPublication } }); } });
    return host;
  }
  function status() {
    return { appId: APP, mode, activationReady: activationReady && initializationError === null && identity !== null,
      deviceId: identity?.deviceId ?? null, vaultId: selected.vaultId, keyVersion: selected.keyVersion,
      ...(enrollmentResponse ? { enrollmentResponse } : {}), ...(initializationError ? { lockedReason: initializationError } : {}) };
  }
  async function refreshMode() {
    open(); const artifacts = protectedArtifacts(); let protectionRequired = true; initializationError = null;
    lockNow(); host = null; coordinated = null; raw = null; activationReady = false; enrollmentResponse = null;
    try {
      const policy = await activationGate(); if (policy !== true && policy !== false) throw fail();
      const configured = policy === true; protectionRequired = artifacts || configured;
      if (configured) {
        protectionRequired = true; const marked = await marker.read(); protectionRequired = artifacts || marked;
        if (marked && !artifacts) throw fail('ENCRYPTION_CONTEXT_MISSING');
        if (!marked && artifacts) throw fail('ENCRYPTION_PROTECTION_MARKER_MISSING');
      }
      if (workspaceArtifacts()) {
        const descriptor = inspectDescriptor({ directory: working, expectedAppId: APP, DatabaseSync });
        // Metadata is a selector only. OS identity and authenticated crypto establish authority.
        selected = { appId: APP, vaultId: descriptor.vaultId, keyVersion: descriptor.keyVersion };
        mode = 'encrypted'; identity = await profile.loadDeviceIdentity({ create: false });
        if (!identity.enrolled || identity.deviceId !== descriptor.deviceId) throw fail('DEVICE_KEY_CONTEXT_CHANGED');
        const inspected = createStore({ directory: working, scope: hostScope(), deviceId: identity.deviceId, DatabaseSync });
        const checkpoint = await inspected.read();
        if (checkpoint === null) {
          mode = 'enrollment-pending';
          if (explicitLegacyReturn) { const entered = epoch; await assembleStore().inspectEmptyEnrollment(() => { open(); if (entered !== epoch) throw fail(); }); mode = 'legacy'; }
          const saved = await inspected.readAux('enrollment-response');
          if (saved !== null) {
            const value = JSON.parse(saved), c = api.parseEnvelope(value.ciphertext).context;
            if (Object.keys(value).sort().join(',') !== 'ciphertext,deviceId' || value.deviceId !== identity.deviceId || c.appId !== APP || c.vaultId !== selected.vaultId || c.keyVersion !== selected.keyVersion || c.purpose !== 'transfer' || c.revision !== 0 || !c.recordId.startsWith('enrollment/' + identity.deviceId + '/') || !c.recordId.endsWith('/response') || JSON.stringify(value) !== saved) throw fail();
            enrollmentResponse = value;
          }
        }
      } else {
        if (artifacts) throw fail('ENCRYPTION_CONTEXT_MISSING');
        mode = 'legacy'; identity = await profile.loadDeviceIdentity({ create: false });
      }
      activationReady = configured && await profile.available() === true;
    } catch (e) { initializationError = e?.code || 'ENCRYPTION_RUNTIME_LOCKED'; mode = protectionRequired ? 'encrypted' : 'legacy'; lockNow(); }
    return status();
  }
  async function enrollFromRecovery(code, wrappedKey, challenge) {
    await allowed(); const entered = epoch;
    if (workspaceArtifacts() || !identity || host?.status?.().state === 'preparing') throw fail();
    const context = api.parseEnvelope(wrappedKey).context;
    if (context.appId !== APP || context.purpose !== 'recovery-key' || context.recordId !== 'master-key' || context.revision !== 0 || challenge?.deviceId !== identity.deviceId || challenge?.context?.appId !== APP || challenge.context.vaultId !== context.vaultId || challenge.context.keyVersion !== context.keyVersion) throw fail();
    let recovered;
    try {
      recovered = await api.recoverMasterKey(code, wrappedKey, APP, context.vaultId, context.keyVersion);
      await api.answerEnrollmentChallenge(recovered, challenge);
      if (entered !== epoch || workspaceArtifacts()) throw fail(); ensureRoot();
      host?.lock(); host = null; coordinated = null; raw = null; selected = { appId: APP, vaultId: context.vaultId, keyVersion: context.keyVersion };
      const result = await withFreshEnrollment(() => { open(); if (entered !== epoch) throw fail(); }, () => getHost().enrollFromRecovery(code, wrappedKey, challenge));
      await raw.saveAux('recovery-wrapper', wrappedKey); await raw.saveAux('enrollment-response', JSON.stringify({ deviceId: result.deviceId, ciphertext: result.ciphertext }));
      mode = 'enrollment-pending'; enrollmentResponse = result; return result;
    } finally { recovered?.fill(0); }
  }
  async function cancelEnrollment() {
    open(); const entered = epoch;
    const current = () => { open(); if (entered !== epoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); };
    await allowed(); current();
    if (mode !== 'enrollment-pending' || initializationError || !workspaceArtifacts()) throw fail();
    getHost(); current();
    // Read-only inspection: cancellation must never resume a pending publication.
    await coordinated.inspectEmptyEnrollment(current); current();
    lockNow(); host = null; coordinated = null; raw = null;
    explicitLegacyReturn = true; mode = 'legacy'; return null;
  }
  await refreshMode();
  return Object.freeze({ getHost, status, refreshMode, enrollFromRecovery, cancelEnrollment, lockNow,
    prepareLaunch: refreshMode, requireProtection: () => { open(); lockNow(); explicitLegacyReturn = false; if (mode === 'legacy') mode = 'enrollment-pending'; return status(); },
    close: () => { if (!closed) { lockNow(); closed = true; profile.close(); } } });
}
module.exports = { createNativeEncryptionRuntime };
