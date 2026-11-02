// Main-only structured host. Keys never cross IPC; working objects and the root
// use the reviewed shared formats. The checkpoint provider owns OS-head receipts.
const { createHash, randomUUID } = require('node:crypto');
const { StructuredWorkspace, measureRecord } = require('./structuredWorkspace.cjs');
const { recordsFromBundle, bundleFromRecords, bundleViewFromRecords, recordChangesFromLegacyDelta } = require('./studentOrganizerRecords.cjs');
const { exportWorkspaceArchive, importWorkspaceArchive } = require('./structuredWorkspaceArchive.cjs');
const { readRootView, verifyRootView } = require('./encryptionRootValidation.cjs');
const { prepareOfflineRecovery, copyOfflineRecoveryGraph, offlineProofDetails, preflightOfflineProof } = require('./offlineRecovery.cjs');
const { preflightStartupRecords } = require('./startupBudget.cjs');
const APP_ID = 'student-organizer';
const fail = (code = 'ENCRYPTION_HOST_LOCKED') => Object.assign(new Error('The protected action was not verified. Reopen the verified workspace before retrying an uncertain write.'), { code });
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = record => JSON.stringify([record.namespace, record.table || '', record.key]);
const equalBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((value, index) => value === b[index]);
function sourceHash(bundle) {
  const digest = createHash('sha256');
  const records = [...recordsFromBundle(bundle)].map(record => ({ id: identity(record), measurement: measureRecord(record.value) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const record of records) digest.update(JSON.stringify([record.id, record.measurement.bytes, record.measurement.contentHash]) + '\n');
  return digest.digest('hex');
}
function createStructuredEncryptionHost({ directory, vaultId, deviceId, keyVersion = 1, keyStore, workspaceStore, rawStore = workspaceStore, createChunkStore, activationGate = () => false, withFreshEnrollment, cryptoRuntime, validationRuntime, structuredRuntime = StructuredWorkspace, startupLimits = {} }) {
  if (typeof vaultId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(vaultId) || typeof deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(deviceId) || !Number.isSafeInteger(keyVersion) || keyVersion < 1 || !keyStore || !workspaceStore || typeof createChunkStore !== 'function' || typeof withFreshEnrollment !== 'function') throw fail('ENCRYPTION_HOST_CONFIG');
  const scope = Object.freeze({ appId: APP_ID, vaultId, keyVersion });
  const api = cryptoRuntime || { ...require('./generated/encryption/shared/encryption/index.js'), ...require('./generated/encryption/src/security/encryptedWorkspace.js') };
  const validation = validationRuntime || require('./generated/encryption/src/security/mainBundleValidation.js');
  const cache = validation.createMainBundleValidationCache();
  let measurements = new WeakMap();
  let session = null, preparation = null, snapshot = null, records = null, backupCatalog = [], safetyRoots = new Map(), epoch = 0, transferEpoch = 0, queue = Promise.resolve(), receiverVerified = false, archiveReview = null;
  const tokens = new WeakMap();
  function closePreparation() { preparation?.migration.close(); preparation?.key.fill(0); preparation = null; }
  function closeArchiveReview() { archiveReview?.workspace.lock(); archiveReview = null; }
  function lock() { epoch++; transferEpoch++; session?.lock(); session = null; snapshot = null; records = null; backupCatalog = []; safetyRoots = new Map(); receiverVerified = false; closeArchiveReview(); closePreparation(); cache.clear(); measurements = new WeakMap(); }
  function run(action) {
    const entered = epoch;
    const task = queue.then(async () => {
      const current = () => { if (entered !== epoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); }; current();
      try { const result = await action(current); current(); return result; }
      catch (error) {
        // A failed engine read/export can lock its private key. Reflect that
        // state in the host instead of retaining an apparently unlocked shell.
        if (session) { try { session.getRevision(); } catch { lock(); } }
        if (error?.code === 'STRUCTURED_WORKSPACE_READ_LIMIT') throw fail('ENCRYPTION_CAPACITY_LIMIT');
        if (typeof error?.code === 'string' && /^(ENCRYPTION_|DEVICE_KEY_|ENCRYPTED_STORAGE_)[A-Z_]+$/.test(error.code)) throw error; throw fail();
      }
    }); queue = task.catch(() => {}); return task;
  }
  async function activation(current) { if (await activationGate() !== true) { lock(); throw fail('ENCRYPTION_ACTIVATION_REQUIRED'); } current(); }
  function options(key, current, recoveryWrapperHash) { return { scope, key, checkpointStore: workspaceStore, createChunkStore, assertCurrent: current, ...(startupLimits.maxRecordBytes ? { maxReadRecordBytes: startupLimits.maxRecordBytes } : {}), ...(startupLimits.maxAllBytes ? { maxReadAllBytes: startupLimits.maxAllBytes } : {}), ...(recoveryWrapperHash ? { recoveryWrapperHash } : {}) }; }
  function measureSelection(selected) { return preflightStartupRecords(selected, { ...startupLimits, measurements }); }
  function selectedBundle(value) {
    const selected = [];
    for (const record of recordsFromBundle(value)) {
      if (record.namespace === 'recovery' && record.table === 'backup-content') {
        // Lazy history is not part of startup's aggregate, but each legacy body
        // must remain readable for a verified manual recovery/export.
        preflightStartupRecords([record], { ...startupLimits, maxAllBytes: undefined });
      } else selected.push(record);
    }
    measureSelection(selected); return selected;
  }
  function currentSelection() {
    const selected = new Map(records || []);
    for (const [id, value] of safetyRoots) {
      const record = { namespace: 'metadata', key: (id.startsWith('snapshot/') ? 'internal-backup/' : 'internal-safety/') + value.id, value };
      selected.set(identity(record), record);
    }
    return selected;
  }
  function preflightChanges(changes, base = currentSelection()) {
    const selected = new Map(base);
    for (const change of changes) {
      if (change.namespace === 'recovery' && change.table === 'backup-content') {
        if (change.deleted !== true) preflightStartupRecords([{ namespace: change.namespace, table: change.table, key: change.key, value: change.value }], { ...startupLimits, maxAllBytes: undefined });
        continue;
      }
      if (change.deleted === true) selected.delete(identity(change));
      else selected.set(identity(change), { namespace: change.namespace, ...(change.table === undefined ? {} : { table: change.table }), key: change.key, value: change.value });
    }
    measureSelection(selected.values());
  }
  function safetyRecord(root, id = randomUUID()) { return { namespace: 'metadata', key: 'internal-safety/' + id, value: Object.freeze({ id, createdAt: new Date().toISOString(), revision: root.revision, ciphertext: root.ciphertext }) }; }
  async function preflightOpened(opened, current, extra = []) {
    const view = await readRootView(opened, scope, api, current); current();
    const selected = [...view.records, ...view.controls.map(item => ({ namespace: 'metadata', key: (item.id.startsWith('snapshot/') ? 'internal-backup/' : 'internal-safety/') + item.value.id, value: item.value })), ...extra];
    measureSelection(selected); return view;
  }
  async function enroll(key, current) {
    await rawStore.initialize(); current();
    const existing = await keyStore.load(scope);
    try { current(); if (existing && !equalBytes(existing, key)) throw fail('ENCRYPTION_DEVICE_KEY_MISMATCH'); if (!existing) await keyStore.save(scope, key); } finally { existing?.fill(0); }
    current(); const verified = await keyStore.load(scope);
    try { current(); if (!equalBytes(verified, key)) throw fail('ENCRYPTION_DEVICE_KEY_MISMATCH'); } finally { verified?.fill(0); }
  }
  function accept(value, startupRecords) {
    snapshot = value;
    if (startupRecords) {
      // Use the validator's detached, frozen current rows as the accepted
      // baseline. Reusing the pre-validation aliases would rehash unchanged
      // photo/document rows on the first edit after every reopen.
      records = new Map([...recordsFromBundle(value)].map(record => [identity(record), record]));
      for (const record of startupRecords) if (record.namespace === 'recovery' && record.table === 'backups') records.set(identity(record), record);
      backupCatalog = bundleViewFromRecords(startupRecords).backupCatalog;
    } else {
      const next = new Map([...recordsFromBundle(value)].map(record => [identity(record), record]));
      // Backup bodies are native-owned and never part of a renderer view.
      for (const [id, record] of records || []) if (record.namespace === 'recovery' && record.table === 'backups') next.set(id, record);
      records = next;
    }
  }
  async function startupRecords(opened, current, rememberSafety = true) {
    const view = await readRootView(opened, scope, api, current); current();
    if (rememberSafety) safetyRoots = new Map(view.controls.map(item => [item.id, item.value]));
    return view.records;
  }
  async function loadSession(key, current) {
    const opened = await structuredRuntime.open(options(key, current));
    try {
      const wrapper = await rawStore.readAux('recovery-wrapper'); current();
      if (typeof wrapper !== 'string' || hash(wrapper) !== opened.getRecoveryWrapperHash()) throw fail('ENCRYPTION_RECOVERY_WRAPPER_INVALID');
      const loaded = await startupRecords(opened, current), view = bundleViewFromRecords(loaded);
      const checked = await cache.initialize(view.bundle); current(); session = opened; accept(checked, loaded);
    } catch (error) { opened.lock(); throw error; }
  }
  function applyChanges(changes) {
    if (!Array.isArray(changes) || changes.length > 2000000) throw fail();
    const next = new Map(records), seen = new Set(), owned = [];
    for (const input of changes) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail();
      const change = structuredClone(input), expected = change.deleted === true ? ['namespace', ...(change.table === undefined ? [] : ['table']), 'key', 'deleted'] : ['namespace', ...(change.table === undefined ? [] : ['table']), 'key', 'value'];
      if (Object.keys(change).sort().join('|') !== expected.sort().join('|') || !['primary', 'recovery', 'storage', 'metadata'].includes(change.namespace) || typeof change.key !== 'string' || !change.key || (['primary', 'recovery'].includes(change.namespace) !== (typeof change.table === 'string'))) throw fail();
      // Native backup actions own history. A renderer view has no authority to
      // invent metadata/body pairs or delete dated versions through autosave.
      if (change.namespace === 'recovery' && ['backups', 'backup-content'].includes(change.table)) throw fail();
      if (change.namespace === 'metadata' && change.key.startsWith('internal-')) throw fail();
      const id = identity(change); if (seen.has(id)) throw fail(); seen.add(id);
      if (change.deleted === true) { if (!next.delete(id)) throw fail(); }
      else next.set(id, { namespace: change.namespace, ...(change.table === undefined ? {} : { table: change.table }), key: change.key, value: change.value });
      owned.push(change);
    }
    return { changes: owned, candidate: bundleViewFromRecords([...next.values()]).bundle };
  }
  async function external(purpose, recordId, bytes, current) {
    const key = await keyStore.load(scope);
    try { current(); if (!session || !key) throw fail(); return { revision: session.getRevision(), ciphertext: await api.encryptBytes(key, { ...scope, purpose, recordId, revision: session.getRevision() }, bytes) }; }
    finally { key?.fill(0); }
  }
  async function openExternal(purpose, recordId, revision, ciphertext, current) {
    const key = await keyStore.load(scope);
    try { current(); if (!key || (!session && !receiverVerified)) throw fail(); return await api.decryptBytes(key, { ...scope, purpose, recordId, revision }, ciphertext); }
    finally { key?.fill(0); }
  }
  async function verifyArchiveRoot(opened, current, actor) {
    return (await verifyRootView(opened, scope, api, validation, current, actor)).snapshot;
  }
  function metadata(value, exportedAt = value.primary.exportedAt) { return { exportedAt, totalRecords: Object.values(value.primary.tables).reduce((sum, rows) => sum + rows.length, 0), tableCount: Object.keys(value.primary.tables).length }; }
  return Object.freeze({
    status: () => ({ ...scope, state: session ? 'unlocked' : preparation ? 'preparing' : 'locked', revision: session?.getRevision() ?? null }), lock,
    invalidateTransferContext: () => { transferEpoch++; },
    captureTransferContext: () => { if (!session) throw fail(); const token = Object.freeze({}); tokens.set(token, { epoch, transferEpoch }); return token; },
    assertTransferContext: async token => { const state = token && typeof token === 'object' ? tokens.get(token) : null; if (await activationGate() !== true || !session || !state || state.epoch !== epoch || state.transferEpoch !== transferEpoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); },
    prepareMigration: value => run(async current => {
      if (session || preparation) throw fail();
      const binding = typeof workspaceStore.readForPreparation === 'function'
        ? await workspaceStore.readForPreparation()
        : { kind: 'fresh', checkpoint: await workspaceStore.read() };
      current(); if (!binding || Object.keys(binding).sort().join('|') !== 'checkpoint|kind' || binding.checkpoint !== null || !['fresh', 'pending'].includes(binding.kind)) throw fail();
      const checked = await cache.initialize(value); current(); const source = sourceHash(checked); const key = api.generateMasterKey(); let migration;
      try {
        const existing = await keyStore.load(scope);
        try {
          current();
          if (existing && (!(existing instanceof Uint8Array) || existing.length !== 32)) throw fail('DEVICE_KEY_UNAVAILABLE');
          if (binding.kind === 'pending' && !existing) throw fail('DEVICE_KEY_ENROLLMENT_REQUIRED');
          if (binding.kind === 'fresh' && existing) throw fail('ENCRYPTION_RECONCILIATION_REQUIRED');
          // Only independently proven empty pending enrollment can retain its
          // protected master and start a new recovery/device-proof ceremony.
          if (existing) key.set(existing);
        } finally { existing?.fill(0); }
        const recoveryCode = await api.generateRecoveryCode(), wrappedKey = await api.wrapMasterKey(key, recoveryCode, APP_ID, vaultId, keyVersion);
        const descriptor = { sourceHash: source }, validate = candidate => { if (!candidate || Object.keys(candidate).join('|') !== 'sourceHash' || !/^[a-f0-9]{64}$/.test(candidate.sourceHash)) throw fail(); };
        migration = await api.WorkspaceMigration.prepare({ withReadLock: read => read(descriptor) }, scope, key, wrappedKey, deviceId, validate); current();
        preparation = { key: new Uint8Array(key), migration, source, wrappedKey, recoveryVerified: false, deviceVerified: false }; migration = null;
        return { recoveryCode, wrappedKey, ...scope };
      } finally { key.fill(0); migration?.close(); }
    }),
    verifyRecovery: code => run(async current => { if (!preparation) throw fail(); const selected = preparation; selected.recoveryVerified = false; await selected.migration.verifyRecovery(code); current(); selected.recoveryVerified = true; }),
    createDeviceChallenge: target => run(async current => { if (!preparation) throw fail(); preparation.deviceVerified = false; const result = await preparation.migration.createDeviceChallenge(target); current(); return result; }),
    verifyDeviceResponse: (target, response) => run(async current => { if (!preparation) throw fail(); const selected = preparation; selected.deviceVerified = false; await selected.migration.verifyDeviceResponse(target, response); current(); selected.deviceVerified = true; }),
    completeMigration: value => run(async current => {
      const selected = preparation; if (!selected?.recoveryVerified || !selected.deviceVerified) throw fail();
      await activation(current); const checked = await cache.initialize(value); current(); if (sourceHash(checked) !== selected.source) { lock(); throw fail('ENCRYPTION_SOURCE_CHANGED'); }
      selectedBundle(checked); current();
      try {
        const assertProof = () => { current(); if (preparation !== selected || !selected.recoveryVerified || !selected.deviceVerified) throw fail(); };
        const opened = await withFreshEnrollment(assertProof, async () => {
          // The native activation capability publishes the independent protected
          // intent marker BEFORE any key, database, wrapper or chunk artifact.
          assertProof(); await enroll(selected.key, assertProof); await rawStore.saveAux('recovery-wrapper', selected.wrappedKey); assertProof();
          return structuredRuntime.create(options(selected.key, assertProof, hash(selected.wrappedKey)), recordsFromBundle(checked));
        });
        try { current(); const loaded = await startupRecords(opened, current), view = bundleViewFromRecords(loaded); const verifiedView = await cache.initialize(view.bundle); current(); session = opened; accept(verifiedView, loaded); return { revision: opened.getRevision() }; } catch (error) { opened.lock(); throw error; }
      } catch (error) { lock(); throw error; } finally { closePreparation(); }
    }),
    unlock: () => run(async current => { await activation(current); if (session || preparation) throw fail(); const key = await keyStore.load(scope); try { if (!key) throw fail(); await loadSession(key, current); return { revision: session.getRevision() }; } finally { key?.fill(0); } }),
    read: () => run(async current => { await activation(current); if (!session || !snapshot) throw fail(); return { revision: session.getRevision(), snapshot: structuredClone(snapshot) }; }),
    listBackups: () => run(async current => { await activation(current); if (!session) throw fail(); return structuredClone([...backupCatalog, ...[...safetyRoots].map(([id, value]) => ({ id, createdAt: value.createdAt, reason: value.reason || 'before-restore' }))]); }),
    assertHistoricalAuthority: actor => run(async current => {
      await activation(current); if (!session) throw fail();
      for (const backup of backupCatalog) {
        const json = await session.readRecord({ namespace: 'recovery', table: 'backup-content', key: backup.id }); current();
        if (typeof json !== 'string') throw fail();
        const checked = await validation.validateMainBundleIntegrity({ ...snapshot, primary: JSON.parse(json), recovery: { ...snapshot.recovery, backups: [] } }); current();
        await validation.assertMainFullWorkspaceAuthority(checked, actor); current();
      }
    }),
    exportArchive: (write, actor) => run(async current => {
      await activation(current); if (!session || typeof write !== 'function' || typeof actor !== 'string') throw fail();
      const root = await workspaceStore.read(); current(); const sourceHead = workspaceStore.getTrustedHead?.();
      if (!root || root.revision !== session.getRevision() || !sourceHead || sourceHead.revision !== root.revision || sourceHead.hash !== hash(root.ciphertext)) throw fail('ENCRYPTION_RECONCILIATION_REQUIRED');
      const recoveryWrapper = await rawStore.readAux('recovery-wrapper'); current(); const key = await keyStore.load(scope);
      try {
        if (!key) throw fail();
        const result = await exportWorkspaceArchive({ workspace: session, root, scope, recoveryWrapper, sourceHead, key, write, assertCurrent: current, verifyRoot: opened => verifyArchiveRoot(opened, current, actor), cryptoRuntime: api }); current();
        return { revision: root.revision, archiveId: result.archiveId };
      } finally { key?.fill(0); }
    }),
    previewArchive: (read, actor, receiver = false) => run(async current => {
      await activation(current); closeArchiveReview(); if (preparation || typeof read?.[Symbol.asyncIterator] !== 'function' || receiver && session || !receiver && !session) throw fail();
      if (receiver && await rawStore.read() !== null) throw fail(); current();
      const wrapper = await rawStore.readAux('recovery-wrapper'); current(); if (typeof wrapper !== 'string') throw fail();
      let candidates = null, mainView = null, imported;
      try {
        imported = await importWorkspaceArchive({ read, scope, purpose: 'backup', createChunkStore, assertCurrent: current, cryptoRuntime: api,
          getKey: async header => {
            current(); if (header.recoveryWrapper !== wrapper) throw fail('ENCRYPTION_RECOVERY_WRAPPER_INVALID'); const key = await keyStore.load(scope); current(); if (!key) throw fail(); return key;
          },
          verifyRoot: async opened => {
            const checked = await verifyArchiveRoot(opened, current, receiver ? undefined : actor); current();
            if (!mainView) mainView = checked;
            if (receiver) {
              if (candidates === null) candidates = checked.primary.tables.users.filter(user => user.deletedAt === null).map(user => ({ id: user.id, name: user.displayName || user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.id }));
              const permitted = [];
              for (const candidate of candidates) { try { await verifyArchiveRoot(opened, current, candidate.id); current(); permitted.push(candidate); } catch (error) { current(); } }
              candidates = permitted;
            }
          }
        }); current();
        if (!mainView || receiver && !candidates?.length) throw fail('ENCRYPTION_TEACHER_REQUIRED');
        const handle = Object.freeze({}); archiveReview = { ...imported, handle, epoch, receiver, actor: receiver ? null : actor, view: mainView, operators: candidates || [] }; imported = null;
        return { handle, metadata: metadata(mainView, archiveReview.createdAt), operators: structuredClone(archiveReview.operators), snapshot: structuredClone(mainView) };
      } finally { imported?.workspace.lock(); }
    }),
    authorizeArchive: (handle, actor) => run(async current => {
      await activation(current); const selected = archiveReview;
      if (!selected || selected.handle !== handle || selected.epoch !== epoch || !selected.receiver || !selected.operators.some(user => user.id === actor)) throw fail('ENCRYPTION_REVIEW_EXPIRED');
      await selected.workspace.visitArchiveGraph(selected.root, { onRoot: opened => verifyArchiveRoot(opened, current, actor), onObject: async () => {}, onChunk: async () => {} }, current); current();
      selected.actor = actor; return { metadata: metadata(selected.view, selected.createdAt), operators: structuredClone(selected.operators) };
    }),
    applyArchive: (handle, expectedRevision, actor) => run(async current => {
      await activation(current); const selected = archiveReview;
      if (!selected || selected.handle !== handle || selected.epoch !== epoch || typeof actor !== 'string' || selected.actor !== actor || selected.receiver !== (expectedRevision === null)) throw fail('ENCRYPTION_REVIEW_EXPIRED');
      if (expectedRevision !== null && (!session || session.getRevision() !== expectedRevision)) throw fail('ENCRYPTION_REVISION_CONFLICT');
      if (expectedRevision === null && (session || await rawStore.read() !== null)) throw fail('ENCRYPTION_REVISION_CONFLICT'); current();
      // Recheck every retained root under the final bound operator. Imported
      // chunks are immutable staging only until this one protected root commit.
      await selected.workspace.visitArchiveGraph(selected.root, { onRoot: opened => verifyArchiveRoot(opened, current, actor), onObject: async () => {}, onChunk: async () => {} }, current); current();
      const guard = () => { current(); if (archiveReview !== selected || selected.actor !== actor) throw fail('ENCRYPTION_REVIEW_EXPIRED'); };
      const previous = expectedRevision === null ? null : await workspaceStore.read(); guard();
      if (expectedRevision !== null && (!previous || previous.revision !== expectedRevision)) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const safety = previous ? safetyRecord(previous) : null;
      await preflightOpened(selected.workspace, guard, safety ? [safety] : []); guard();
      let opened;
      try {
        if (expectedRevision === null) {
          const key = await keyStore.load(scope);
          try {
            guard(); if (!key || typeof structuredRuntime.importAuthenticatedCheckpoint !== 'function') throw fail();
            opened = await withFreshEnrollment(guard, () => structuredRuntime.importAuthenticatedCheckpoint(options(key, guard, hash(selected.recoveryWrapper)), selected.root, guard));
          } finally { key?.fill(0); }
          guard(); session = opened; opened = null;
        } else {
          if (typeof session.importAuthenticatedCheckpoint !== 'function') throw fail();
          await session.importAuthenticatedCheckpoint(expectedRevision, selected.root, { namespace: 'metadata', key: safety.key }, guard); guard();
        }
        const loaded = await startupRecords(session, current), view = bundleViewFromRecords(loaded), checked = await cache.initialize(view.bundle); current(); accept(checked, loaded);
        const result = { revision: session.getRevision() }; closeArchiveReview(); return result;
      } catch (error) { opened?.lock(); lock(); throw error; }
    }),
    applyOfflineRecovery: (proof, actor) => run(async current => {
      if (typeof actor !== 'string' || !actor) throw fail('ENCRYPTION_RECOVERY_PROOF_INVALID');
      await activation(current);
      if (session || preparation || archiveReview || await rawStore.read() !== null) throw fail('ENCRYPTION_FRESH_DEVICE_REQUIRED'); current();
      const details = offlineProofDetails(proof, actor);
      const guard = () => { current(); proof.assertAuthorized(actor); };
      try {
        if (Object.keys(scope).some(key => scope[key] !== details.scope[key])) throw fail('ENCRYPTION_RECOVERY_PROOF_INVALID'); guard();
        await preflightOfflineProof(proof, actor, { ...startupLimits, measurements }); guard();
        const opened = await withFreshEnrollment(guard, async () => {
          // Original plaintext sources are never opened or converted by this
          // path. Only a fully authenticated encrypted graph is copied.
          await enroll(details.key, guard); await rawStore.saveAux('recovery-wrapper', details.recoveryWrapper); guard();
          const copied = await copyOfflineRecoveryGraph(proof, actor, { createChunkStore, assertCurrent: guard });
          try {
            guard(); return await structuredRuntime.importAuthenticatedCheckpoint(options(details.key, guard, hash(details.recoveryWrapper)), copied.root, guard);
          } finally { copied.workspace.lock(); }
        });
        try {
          guard(); const loaded = await startupRecords(opened, guard), view = bundleViewFromRecords(loaded), checked = await cache.initialize(view.bundle); guard(); session = opened; accept(checked, loaded); return { revision: opened.getRevision() };
        } catch (error) { opened.lock(); throw error; }
      } catch (error) { lock(); throw error; } finally { details.key.fill(0); }
    }),
    createBackup: (reason, expectedRevision) => run(async current => {
      await activation(current); if (!session || session.getRevision() !== expectedRevision || !['automatic', 'manual', 'before-restore', 'before-sync'].includes(reason)) throw fail();
      const options = snapshot.recovery.options[0] || { automatic: true, intervalHours: 24, retain: 7 }, now = new Date();
      const pinned = [...safetyRoots].filter(([id]) => id.startsWith('snapshot/')).map(([id, value]) => ({ ...value, publicId: id }));
      const previous = [...backupCatalog, ...pinned].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      if (reason === 'automatic' && (!options.automatic || previous && now.getTime() - Date.parse(previous.createdAt) < options.intervalHours * 3600000)) return { revision: expectedRevision, backup: null };
      const primaryHash = measureRecord(snapshot.primary.tables).contentHash;
      if (reason === 'automatic' && previous) {
        let previousHash = previous.primaryHash;
        if (!previousHash) { const json = await session.readRecord({ namespace: 'recovery', table: 'backup-content', key: previous.id }); current(); previousHash = measureRecord(JSON.parse(json).tables).contentHash; }
        if (previousHash === primaryHash) return { revision: expectedRevision, backup: null };
      }
      const previousRoot = await workspaceStore.read(); current(); if (!previousRoot || previousRoot.revision !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const backup = { id: randomUUID(), createdAt: now.toISOString(), reason }, saved = Object.freeze({ ...backup, primaryHash, revision: previousRoot.revision, ciphertext: previousRoot.ciphertext });
      const changes = [{ namespace: 'metadata', key: 'internal-backup/' + backup.id, value: saved }];
      const expired = reason === 'automatic' ? [...backupCatalog.filter(item => item.reason === 'automatic'), ...pinned.filter(item => item.reason === 'automatic'), backup].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(options.retain) : [];
      for (const item of expired) {
        if (item.publicId) changes.push({ namespace: 'metadata', key: 'internal-backup/' + item.id, deleted: true });
        else changes.push(...recordChangesFromLegacyDelta([{ namespace: 'recovery', table: 'backups', key: item.id, deleted: true }]));
      }
      preflightChanges(changes); current();
      try {
        await session.commitDelta(expectedRevision, changes, current); current();
        for (const item of expired) { records.delete(identity({ namespace: 'recovery', table: 'backups', key: item.id })); if (item.publicId) safetyRoots.delete(item.publicId); }
        backupCatalog = backupCatalog.filter(item => !expired.some(old => old.id === item.id));
        // New dated versions pin the immutable accepted root. They never stringify
        // the primary photo/document payload or copy every older backup body.
        safetyRoots.set('snapshot/' + backup.id, saved);
        return { revision: session.getRevision(), backup: { ...backup, id: 'snapshot/' + backup.id } };
      } catch (error) { lock(); throw error; }
    }),
    previewStoredBackup: (id, actor) => run(async current => {
      await activation(current); if (!session || typeof id !== 'string') throw fail();
      const safety = safetyRoots.get(id);
      if (safety) {
        const historical = { revision: safety.revision, ciphertext: safety.ciphertext }, key = await keyStore.load(scope); let opened;
        try {
          if (!key) throw fail();
          opened = await structuredRuntime.open({ ...options(key, current, session.getRecoveryWrapperHash()), checkpointStore: { read: async () => historical, commit: async () => { throw fail(); } } }); current();
          const loaded = await startupRecords(opened, current, false), view = bundleViewFromRecords(loaded), checked = await validation.validateMainBundleIntegrity(view.bundle); current();
          await validation.assertMainFullWorkspaceAuthority(checked, actor); current();
          for (const item of view.backupCatalog) {
            const json = await opened.readRecord({ namespace: 'recovery', table: 'backup-content', key: item.id }); current();
            const historical = await validation.validateMainBundleIntegrity({ ...checked, primary: JSON.parse(json) }); current();
            await validation.assertMainFullWorkspaceAuthority(historical, actor); current();
          }
          return { snapshot: checked, historicalCheckpoint: historical };
        } finally { key?.fill(0); opened?.lock(); }
      }
      if (!backupCatalog.some(item => item.id === id)) throw fail();
      const json = await session.readRecord({ namespace: 'recovery', table: 'backup-content', key: id }); current();
      const checked = await validation.validateMainBundleIntegrity({ ...snapshot, primary: JSON.parse(json), recovery: { ...snapshot.recovery, backups: [] } }); current(); return { snapshot: checked };
    }),
    restoreCheckpoint: (expectedRevision, historicalCheckpoint, actor) => run(async current => {
      await activation(current); if (!session || session.getRevision() !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      if (typeof actor !== 'string' || !actor) throw fail('ENCRYPTION_TEACHER_REQUIRED');
      const previous = await workspaceStore.read(); current(); if (!previous || previous.revision !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const safety = safetyRecord(previous), key = await keyStore.load(scope); let historical;
      try {
        if (!key) throw fail(); historical = await structuredRuntime.open({ ...options(key, current, session.getRecoveryWrapperHash()), checkpointStore: { read: async () => historicalCheckpoint } }); current();
        await historical.visitArchiveGraph(historicalCheckpoint, { onRoot: opened => verifyArchiveRoot(opened, current, actor), onObject: async () => {}, onChunk: async () => {} }, current); current();
        await preflightOpened(historical, current, [safety]); current();
        await session.restoreCheckpoint(expectedRevision, structuredClone(historicalCheckpoint), { namespace: 'metadata', key: safety.key }, current); current();
        const loaded = await startupRecords(session, current), view = bundleViewFromRecords(loaded), checked = await cache.initialize(view.bundle); current(); accept(checked, loaded); return { revision: session.getRevision() };
      } catch (error) { lock(); throw error; } finally { historical?.lock(); key?.fill(0); }
    }),
    restoreBundle: (expectedRevision, value, { preserveHistory = false } = {}) => run(async current => {
      await activation(current); if (!session || session.getRevision() !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const checked = await validation.validateMainBundleIntegrity(value); current();
      const previous = await workspaceStore.read(); current();
      if (!previous || previous.revision !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const target = new Map([...recordsFromBundle(checked)].map(record => [identity(record), record])), existing = await session.list(); current();
      const changes = [];
      for (const record of existing) {
        if (record.namespace === 'metadata' && record.key.startsWith('internal-')) continue;
        if (preserveHistory && record.namespace === 'recovery' && ['backups', 'backup-content'].includes(record.table)) continue;
        if (!target.has(identity(record))) changes.push({ ...record, deleted: true });
      }
      for (const record of target.values()) {
        if (preserveHistory && record.namespace === 'recovery' && ['backups', 'backup-content'].includes(record.table)) throw fail();
        changes.push(record);
      }
      // The old root references all its already durable immutable objects. Its
      // encrypted safety reference is published atomically WITH the replacement
      // root through the protected-head coordinator, not a second best-effort file.
      changes.push(safetyRecord(previous));
      preflightChanges(changes); current();
      try {
        await session.commitDelta(expectedRevision, changes, current); current();
        const loaded = await startupRecords(session, current), view = bundleViewFromRecords(loaded), verified = await cache.initialize(view.bundle); current(); accept(verified, loaded);
        return { revision: session.getRevision() };
      } catch (error) { lock(); throw error; }
    }),
    commitDelta: (expectedRevision, changes) => run(async current => {
      await activation(current); if (!session || session.getRevision() !== expectedRevision) throw fail('ENCRYPTION_REVISION_CONFLICT');
      const active = session, candidate = applyChanges(changes), checked = await cache.validateCandidate(candidate.candidate); current();
      preflightChanges(candidate.changes); current();
      try { await active.commitDelta(expectedRevision, candidate.changes, current); current(); accept(checked); return { revision: active.getRevision() }; }
      catch (error) { lock(); throw error; }
    }),
    // Explicit full-snapshot compatibility only; normal autosaves use commitDelta.
    commit: (expectedRevision, value) => run(async current => {
      await activation(current); if (!session || session.getRevision() !== expectedRevision) throw fail();
      const checked = await cache.initialize(value); current(); if (checked.recovery.backups.length) throw fail(); const next = new Map([...recordsFromBundle(checked)].map(record => [identity(record), record])), changes = [];
      for (const [id, previous] of records) if (!next.has(id) && !(previous.namespace === 'recovery' && previous.table === 'backups')) changes.push({ namespace: previous.namespace, ...(previous.table ? { table: previous.table } : {}), key: previous.key, deleted: true });
      for (const [id, record] of next) if (!records.has(id) || measureRecord(record.value).contentHash !== measureRecord(records.get(id).value).contentHash) changes.push(record);
      preflightChanges(changes); current();
      try { await session.commitDelta(expectedRevision, changes, current); current(); accept(checked); return { revision: session.getRevision() }; } catch (error) { lock(); throw error; }
    }),
    exportEncrypted: (purpose, recordId) => run(async current => {
      await activation(current); if (!session || !['backup', 'transfer'].includes(purpose)) throw fail();
      // Compatibility export is deliberately bounded. The streaming native-file
      // route is required for larger workspaces; never export a startup view that
      // silently omits its dated history.
      const full = [];
      for (const descriptor of await session.list()) {
        if (descriptor.namespace === 'metadata' && descriptor.key.startsWith('internal-')) throw fail('ENCRYPTION_STREAMING_BACKUP_REQUIRED');
        full.push({ ...descriptor, value: await session.readRecord(descriptor) }); current();
      }
      const bundle = bundleFromRecords(full);
      if (measureRecord(bundle).bytes > api.MAX_PLAINTEXT_BYTES) throw fail('ENCRYPTION_STREAMING_BACKUP_REQUIRED');
      const bytes = new TextEncoder().encode(JSON.stringify(bundle)); try { const result = await external(purpose, recordId, bytes, current); current(); return result; } finally { bytes.fill(0); }
    }),
    sealTransfer: (id, json) => run(async current => {
      await activation(current); if (!session || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id) || typeof json !== 'string') throw fail();
      const bytes = new TextEncoder().encode(json); try { const result = await external('transfer', 'drive/' + id, bytes, current); current(); return result; } finally { bytes.fill(0); }
    }),
    openTransfer: (id, ciphertext, selection) => run(async current => {
      await activation(current); if (!session || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id) || typeof ciphertext !== 'string' || !selection || !/^[1-9][0-9]{0,29}$/.test(selection.version) || typeof selection.sha256Checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(selection.sha256Checksum) || hash(ciphertext) !== selection.sha256Checksum.toLowerCase()) throw fail();
      const envelope = api.parseEnvelope(ciphertext), bytes = await openExternal('transfer', 'drive/' + id, envelope.context.revision, ciphertext, current);
      try { current(); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    }),
    previewBackup: ciphertext => run(async current => {
      await activation(current); if (!session) throw fail(); const envelope = api.parseEnvelope(ciphertext); if (envelope.context.purpose !== 'backup') throw fail();
      const bytes = await openExternal('backup', envelope.context.recordId, envelope.context.revision, ciphertext, current);
      try { const checked = await validation.validateMainBundleIntegrity(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); current(); return checked; } finally { bytes.fill(0); }
    }),
    enrollFromRecovery: (code, wrapper, challenge) => run(async current => {
      await activation(current); if (session || preparation || await workspaceStore.read() !== null || challenge?.deviceId !== deviceId || challenge.context?.appId !== APP_ID || challenge.context?.vaultId !== vaultId || challenge.context?.keyVersion !== keyVersion) throw fail();
      const key = await api.recoverMasterKey(code, wrapper, APP_ID, vaultId, keyVersion);
      try {
        const ciphertext = await api.answerEnrollmentChallenge(key, challenge); current(); await enroll(key, current);
        await rawStore.saveAux('recovery-wrapper', wrapper); current(); await rawStore.saveAux('enrollment-response', JSON.stringify({ deviceId, ciphertext })); current(); receiverVerified = true;
        return { deviceId, ciphertext };
      } finally { key.fill(0); }
    })
  });
}
module.exports = { createStructuredEncryptionHost, sourceHash, prepareOfflineRecovery };
