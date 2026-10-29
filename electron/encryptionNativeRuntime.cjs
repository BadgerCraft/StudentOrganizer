// Main-owned assembly. Default activation is off; a renderer cannot change it.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');
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
  createChunks = createCipherChunkStore, createMarker = createApplicationProtectionMarker, prepareOfflineRecovery = input => require('./structuredEncryptionHost.cjs').prepareOfflineRecovery(input), cryptoRuntime, DatabaseSync, loadLedgerBinding = () => require('./generated/windowsCredentialLedger.node'), loadMacBinding }) {
  if (!path.isAbsolute(directory) || typeof createHost !== 'function' || typeof activationGate !== 'function') throw fail();
  const working = path.join(directory, 'working'), keyDirectory = path.join(directory, 'device-keys');
  const profile = createProfile({ ...profileOptions, directory: keyDirectory, platform, activationGate });
  const marker = createMarker({ appId: APP, platform, loadWindowsBinding: loadLedgerBinding, loadMacBinding });
  const api = cryptoRuntime || { ...require('./generated/encryption/shared/encryption/index.js'), ...require('./generated/encryption/src/security/encryptedWorkspace.js') };
  let selected = { appId: APP, vaultId: randomUUID(), keyVersion: 1 }, identity = null, host = null, raw = null, coordinated = null, closed = false, epoch = 0;
  let offlineReview = null, offlinePreparation = null;
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
  function disposeOffline(selected) {
    if (!selected) return;
    selected.proof?.close();
    // Only a generated child of the main-owned staging directory is removed.
    // Abandoned staging contains ciphertext only and is never a working root.
    if (selected.stagingDirectory) fs.promises.rm(selected.stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
  function revokeOffline() { const selected = offlineReview; offlineReview = null; offlinePreparation = null; disposeOffline(selected); }
  function lockNow() { epoch++; freshAuthority = null; revokeOffline(); host?.lock(); }
  function hostScope() { return { appId: selected.appId, vaultId: selected.vaultId, keyVersion: selected.keyVersion }; }
  async function enrollEmptyReceipt(scope, current, requireAbsent = false, allowCreate = false) {
    const artifactsBeforeLease = protectedArtifacts(), registry = profile.profileStore(scope);
    const state = await registry.withExclusiveProfileLock(async () => {
      current(); const ledger = createLedger({ scope, platform, assertProfileLease: registry.assertProfileLease, loadWindowsBinding: loadLedgerBinding, loadMacBinding });
      const existing = await ledger.read(); current();
      if (existing === null) {
        if (artifactsBeforeLease || !allowCreate) throw fail('ENCRYPTION_ENROLLMENT_RECEIPT_MISSING');
        await ledger.compareAndSwap(null, { head: null, pending: null }); current(); return 'enrolled';
      }
      return existing.head === null && existing.pending === null && !requireAbsent ? 'empty' : 'established';
    }); current();
    if (state === 'established') throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED');
  }
  async function withFreshEnrollment(assertCurrent, action) {
    await allowed(); if (typeof assertCurrent !== 'function' || typeof action !== 'function' || freshAuthority) throw fail();
    const entered = epoch; assertCurrent();
    const marked = await marker.read(); open(); if (entered !== epoch) throw fail(); assertCurrent();
    await marker.markProtected(() => { open(); if (entered !== epoch) throw fail(); assertCurrent(); });
    assertCurrent(); ensureRoot();
    const current = () => { open(); if (entered !== epoch) throw fail(); assertCurrent(); };
    await enrollEmptyReceipt(hostScope(), current, false, !marked); current();
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
    async function readForPreparation() {
      open(); const entered = epoch, current = () => { open(); if (entered !== epoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); };
      if (mode !== 'legacy' || initializationError) throw fail('ENCRYPTION_ENROLLMENT_REQUIRED');
      if (!protectedArtifacts()) {
        const policy = await activationGate(); current();
        if (policy !== true && policy !== false) throw fail();
        // The staged default-off binary cannot activate. Once configured, OS
        // presence discovery is mandatory even for prospective preparation.
        if (policy && await marker.read()) throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED'); current();
        if (protectedArtifacts()) throw fail('ENCRYPTION_CONTEXT_CHANGED');
        return { kind: 'fresh', checkpoint: null };
      }
      if (!explicitLegacyReturn) throw fail('ENCRYPTION_ENROLLMENT_REQUIRED');
      await allowed(); current(); await coordinated.inspectEmptyEnrollment(current); current();
      return { kind: 'pending', checkpoint: null };
    }
    coordinated = Object.freeze({ read, readForPreparation, commit, initialize: async () => { await allowed(); await ensureProtectionIntent(); ensureRoot(); await raw.initialize(); },
      readAux: kind => raw.readAux(kind), saveAux: (kind, value) => raw.saveAux(kind, value),
      getTrustedHead: () => trustedHead, reconcile: protocol.reconcile,
      inspectEmptyEnrollment: assertCurrent => profileStore.withExclusiveProfileLock(async () => {
        assertCurrent(); const state = await ledger.read(); assertCurrent(); const checkpoint = await raw.read(); assertCurrent();
        if (checkpoint !== null || state === null || state.head !== null || state.pending !== null) throw fail('ENCRYPTION_RECONCILIATION_REQUIRED');
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
          const entered = epoch; await assembleStore().inspectEmptyEnrollment(() => { open(); if (entered !== epoch) throw fail(); });
          mode = explicitLegacyReturn ? 'legacy' : 'enrollment-pending';
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
  async function assertFreshRecovery(current) {
    current(); await allowed(); current();
    if (mode !== 'legacy' || initializationError || !identity || identity.enrolled || protectedArtifacts() || host?.status?.().state === 'preparing') throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED');
    const marked = await marker.read(); current();
    if (marked || protectedArtifacts()) throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED');
  }
  function privateStagingDirectory() {
    ensureRoot(); const base = path.join(directory, 'recovery-staging');
    try { fs.mkdirSync(base, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = fs.lstatSync(base); if (!st.isDirectory() || st.isSymbolicLink() || (process.platform !== 'win32' && st.mode & 0o077)) throw fail();
    // The ciphertext store creates this generated private child lazily.
    return path.join(base, randomUUID());
  }
  async function prepareRecoveryFile(code, read) {
    open(); if (offlinePreparation || offlineReview?.applying) throw fail('ENCRYPTION_BUSY');
    const entered = epoch, preparation = {}; offlinePreparation = preparation;
    const current = () => { open(); if (entered !== epoch || offlinePreparation !== preparation && offlineReview?.token !== preparation) throw fail('ENCRYPTION_CONTEXT_CHANGED'); };
    let proof = null, stagingDirectory = null;
    const old = offlineReview; offlineReview = null; disposeOffline(old);
    try {
      await assertFreshRecovery(current); current();
      if (typeof code !== 'string' || typeof read?.[Symbol.asyncIterator] !== 'function' || typeof prepareOfflineRecovery !== 'function') throw fail();
      stagingDirectory = privateStagingDirectory(); current();
      proof = await prepareOfflineRecovery({ code, read, assertCurrent: current,
        createPrivateChunkStore: (scope, verifyManifest, assertPublication) => {
          current(); if (scope?.appId !== APP || typeof verifyManifest !== 'function' || typeof assertPublication !== 'function') throw fail();
          return createChunks({ directory: stagingDirectory, scope, DatabaseSync, verifyManifest, hooks: { beforeCommit: () => { current(); assertPublication(); } } });
        } }); current();
      if (!proof || proof.scope?.appId !== APP || typeof proof.publicReview !== 'function' || typeof proof.authorize !== 'function' || typeof proof.assertAuthorized !== 'function' || typeof proof.close !== 'function') throw fail();
      const review = structuredClone(proof.publicReview()), handle = Object.freeze({});
      offlineReview = { handle, proof, stagingDirectory, epoch: entered, token: preparation, actor: null };
      proof = null; stagingDirectory = null;
      return { handle, ...review };
    } finally {
      if (offlinePreparation === preparation) offlinePreparation = null;
      disposeOffline({ proof, stagingDirectory });
    }
  }
  function selectedRecovery(handle, actor) {
    open(); const selected = offlineReview;
    if (!selected || selected.handle !== handle || selected.epoch !== epoch || (actor !== undefined && selected.actor !== actor)) throw fail('ENCRYPTION_REVIEW_EXPIRED');
    return selected;
  }
  async function authorizeOfflineRecovery(handle, actor) {
    const selected = selectedRecovery(handle), entered = epoch;
    if (selected.applying) throw fail('ENCRYPTION_BUSY');
    const current = () => { open(); if (entered !== epoch || offlineReview !== selected) throw fail('ENCRYPTION_REVIEW_EXPIRED'); };
    await assertFreshRecovery(current); if (typeof actor !== 'string') throw fail();
    const result = await selected.proof.authorize(actor); current(); selected.proof.assertAuthorized(actor); selected.actor = actor;
    return { handle, ...structuredClone(result) };
  }
  async function applyOfflineRecovery(handle, actor) {
    if (typeof actor !== 'string') throw fail('ENCRYPTION_REVIEW_EXPIRED');
    const selected = selectedRecovery(handle, actor), entered = epoch;
    if (selected.applying) throw fail('ENCRYPTION_BUSY'); selected.applying = true;
    const current = () => { open(); if (entered !== epoch || offlineReview !== selected) throw fail('ENCRYPTION_REVIEW_EXPIRED'); };
    let intent = false;
    try {
      await assertFreshRecovery(current); selected.proof.assertAuthorized(actor); current();
      // No keys or live metadata are provisioned by preview. The explicit apply
      // installs sticky OS intent before the first actual profile lease/artifact.
      intent = true;
      await marker.markProtected(current); current(); ensureRoot();
      // This remains a genuinely fresh recovery path: a preexisting empty
      // receipt is rejected too. Resume belongs to the explicit setup path.
      await enrollEmptyReceipt(selected.proof.scope, current, true, true); current();
      host?.lock(); host = null; coordinated = null; raw = null;
      selected.proof.assertAuthorized(actor);
      selected.scope = Object.freeze({ appId: APP, vaultId: selected.proof.scope.vaultId, keyVersion: selected.proof.scope.keyVersion });
      // This adoption is main-only and follows complete archive authentication
      // plus explicit operator choice and confirmation. Headers alone never select it.
      const adopted = selected.scope;
      mode = 'enrollment-pending'; explicitLegacyReturn = false;
      selectedScope(adopted);
      const target = getHost(); if (typeof target.applyOfflineRecovery !== 'function') throw fail();
      const result = await target.applyOfflineRecovery(selected.proof, actor); current();
      if (result?.revision !== 1) throw fail('ENCRYPTION_RECOVERY_UNCONFIRMED');
      mode = 'encrypted'; offlineReview = null; return result;
    } catch (error) {
      if (intent) { initializationError = 'ENCRYPTION_RECOVERY_UNCONFIRMED'; mode = 'encrypted'; activationReady = false; lockNow(); }
      throw error;
    } finally { if (offlineReview === selected) offlineReview = null; disposeOffline(selected); }
  }
  function selectedScope(scope) { selected = { appId: APP, vaultId: scope.vaultId, keyVersion: scope.keyVersion }; }
  function cancelOfflineRecovery() { open(); if (offlinePreparation || offlineReview?.applying) lockNow(); else revokeOffline(); return null; }
  async function enrollFromRecovery(code, wrappedKey, challenge) {
    open(); const entered = epoch;
    const current = () => { open(); if (entered !== epoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); };
    await allowed(); current();
    const pending = (mode === 'enrollment-pending' || mode === 'legacy' && explicitLegacyReturn) && workspaceArtifacts();
    if (initializationError || !identity || host?.status?.().state === 'preparing' || workspaceArtifacts() && !pending) throw fail();
    if (pending) { getHost(); await coordinated.inspectEmptyEnrollment(current); current(); }
    else { if (protectedArtifacts() || await marker.read()) throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED'); current(); }
    const context = api.parseEnvelope(wrappedKey).context;
    if (context.appId !== APP || context.purpose !== 'recovery-key' || context.recordId !== 'master-key' || context.revision !== 0 || challenge?.deviceId !== identity.deviceId || challenge?.context?.appId !== APP || challenge.context.vaultId !== context.vaultId || challenge.context.keyVersion !== context.keyVersion || pending && (context.vaultId !== selected.vaultId || context.keyVersion !== selected.keyVersion)) throw fail();
    let recovered, retained;
    try {
      recovered = await api.recoverMasterKey(code, wrappedKey, APP, context.vaultId, context.keyVersion); current();
      await api.answerEnrollmentChallenge(recovered, challenge); current();
      if (pending) {
        retained = await profile.vaultKeys(hostScope()).load(hostScope()); current();
        if (!retained) throw fail('DEVICE_KEY_ENROLLMENT_REQUIRED');
        if (retained.length !== 32 || !timingSafeEqual(retained, recovered)) throw fail('DEVICE_KEY_CONTEXT_CHANGED');
        await coordinated.inspectEmptyEnrollment(current); current();
      } else if (protectedArtifacts()) throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED');
      host?.lock(); host = null; coordinated = null; raw = null;
      selected = { appId: APP, vaultId: context.vaultId, keyVersion: context.keyVersion };
      const result = await withFreshEnrollment(current, () => getHost().enrollFromRecovery(code, wrappedKey, challenge)); current();
      // The host owns confirmed auxiliary writes under the same proof guard.
      mode = 'enrollment-pending'; explicitLegacyReturn = false; enrollmentResponse = result; return result;
    } finally { recovered?.fill(0); retained?.fill(0); }
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
  return Object.freeze({ getHost, status, refreshMode, enrollFromRecovery, cancelEnrollment, prepareRecoveryFile, authorizeOfflineRecovery, applyOfflineRecovery, cancelOfflineRecovery, lockNow,
    prepareLaunch: refreshMode, requireProtection: () => { open(); lockNow(); explicitLegacyReturn = false; if (mode === 'legacy') mode = 'enrollment-pending'; return status(); },
    close: () => { if (!closed) { lockNow(); closed = true; profile.close(); } } });
}
module.exports = { createNativeEncryptionRuntime };
