// Private, branded code-only recovery proofs. No proof key or filesystem path is
// exposed through IPC; callers receive detached review metadata and opaque IDs.
const { importWorkspaceArchive, exportWorkspaceArchive } = require('./structuredWorkspaceArchive.cjs');
const { verifyRootView, readRootView } = require('./encryptionRootValidation.cjs');
const { preflightStartupRecords } = require('./startupBudget.cjs');
const proofs = new WeakMap();
const fail = () => Object.assign(Error('The fresh-device recovery source was not verified. Keep the complete encrypted backup and recovery code.'), { code: 'ENCRYPTION_RECOVERY_PROOF_INVALID' });
function runtimes(input) {
  return { api: input.cryptoRuntime || require('./generated/encryption/shared/encryption/index.js'), validation: input.validationRuntime || require('./generated/encryption/src/security/mainBundleValidation.js') };
}
function checkedProof(proof, actor) {
  const state = proof && typeof proof === 'object' ? proofs.get(proof) : null;
  if (!state || state.closed || typeof actor !== 'string' || !actor || state.actor !== actor) throw fail(); state.guard(); return state;
}
async function prepareOfflineRecovery(input) {
  if (typeof input.code !== 'string' || input.code.length > 256 || typeof input.assertCurrent !== 'function' || typeof input.createPrivateChunkStore !== 'function') throw fail();
  const { api, validation } = runtimes(input), guard = input.assertCurrent;
  let master, selectedScope, imported, mainView, operators = null;
  try {
    imported = await importWorkspaceArchive({ read: input.read, purpose: 'backup', assertCurrent: guard, cryptoRuntime: api,
      getKey: async header => {
        guard(); if (header.scope.appId !== 'student-organizer') throw fail();
        const recovered = await api.recoverMasterKey(input.code, header.recoveryWrapper, header.scope.appId, header.scope.vaultId, header.scope.keyVersion);
        try { guard(); selectedScope = Object.freeze({ ...header.scope }); master = new Uint8Array(recovered); return new Uint8Array(recovered); } finally { recovered.fill(0); }
      },
      createChunkStore: (verifyManifest, assertPublication) => {
        guard(); if (!selectedScope) throw fail(); return input.createPrivateChunkStore(selectedScope, verifyManifest, assertPublication);
      },
      verifyRoot: async opened => {
        const verified = await verifyRootView(opened, selectedScope, api, validation, guard); guard();
        if (!mainView) mainView = verified.snapshot;
        if (operators === null) operators = verified.snapshot.primary.tables.users.filter(user => user.deletedAt === null).map(user => ({ id: user.id, name: user.displayName || user.name || [user.firstName,user.lastName].filter(Boolean).join(' ') || user.id }));
        const permitted = [];
        for (const user of operators) {
          try { await verifyRootView(opened, selectedScope, api, validation, guard, user.id); guard(); permitted.push(user); }
          catch { guard(); }
        }
        operators = permitted;
      }
    }); guard();
    if (!master || !mainView || !operators?.length) throw fail();
    const state = { ...imported, key: master, guard, api, validation, operators, actor: null, closed: false,
      metadata: { exportedAt: imported.createdAt, totalRecords: Object.values(mainView.primary.tables).reduce((sum, rows) => sum + rows.length, 0), tableCount: Object.keys(mainView.primary.tables).length } };
    const review = () => { if (state.closed) throw fail(); guard(); return structuredClone({ metadata: state.metadata, operators: state.operators }); };
    const proof = Object.freeze({
      scope: selectedScope,
      publicReview: review,
      authorize: async actor => {
        if (state.closed || typeof actor !== 'string' || !operators.some(user => user.id === actor)) throw fail(); guard(); state.actor = null;
        await state.workspace.visitArchiveGraph(state.root, { onRoot: opened => verifyRootView(opened, selectedScope, api, validation, guard, actor), onObject: async () => {}, onChunk: async () => {} }, guard); guard();
        if (state.closed) throw fail(); state.actor = actor; return review();
      },
      assertAuthorized: actor => { checkedProof(proof, actor); },
      close: () => { if (!state.closed) { state.closed = true; state.actor = null; state.key.fill(0); state.workspace.lock(); } }
    });
    proofs.set(proof, state); imported = null; master = null; return proof;
  } catch { throw fail(); } finally { imported?.workspace.lock(); master?.fill(0); }
}
// One copied 64-KiB ciphertext piece is queued. The existing archive importer
// authenticates every chunk before staging it in the destination immutable store.
function bytePipe() {
  let queued = null, waiting = null, ended = false, error = null;
  function failPipe(cause) { if (error) return; error = cause; ended = true; queued?.reject(cause); waiting?.reject(cause); queued = waiting = null; }
  return {
    read: {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (error) return Promise.reject(error);
        if (queued) { const item = queued; queued = null; item.resolve(); return Promise.resolve({ value: item.value, done: false }); }
        if (ended) return Promise.resolve({ done: true });
        return new Promise((resolve,reject) => { waiting = { resolve,reject }; });
      },
      return() { failPipe(fail()); return Promise.resolve({ done: true }); }
    },
    write: async bytes => {
      for (let at = 0; at < bytes.length; at += 65536) {
        if (error || ended) throw error || fail(); const value = new Uint8Array(bytes.subarray(at,at + 65536));
        await new Promise((resolve,reject) => {
          if (waiting) { const reader = waiting; waiting = null; reader.resolve({ value, done: false }); resolve(); }
          else queued = { value, resolve, reject };
        });
      }
    },
    end: () => { ended = true; if (waiting) { const reader = waiting; waiting = null; reader.resolve({ done: true }); } },
    fail: failPipe
  };
}
async function copyOfflineRecoveryGraph(proof, actor, { createChunkStore, assertCurrent }) {
  const state = checkedProof(proof, actor), pipe = bytePipe();
  const guard = () => { assertCurrent(); checkedProof(proof, actor); };
  const producer = exportWorkspaceArchive({ workspace: state.workspace, root: state.root, scope: proof.scope, recoveryWrapper: state.recoveryWrapper, sourceHead: state.sourceHead, key: state.key, write: pipe.write, assertCurrent: guard,
    verifyRoot: opened => verifyRootView(opened, proof.scope, state.api, state.validation, guard, actor), cryptoRuntime: state.api
  }).then(value => { pipe.end(); return { value }; }, error => { pipe.fail(error); return { error }; });
  let copied;
  try {
    copied = await importWorkspaceArchive({ read: pipe.read, scope: proof.scope, purpose: 'backup', getKey: async () => { guard(); return new Uint8Array(state.key); }, createChunkStore, assertCurrent: guard,
      verifyRoot: opened => verifyRootView(opened, proof.scope, state.api, state.validation, guard, actor), cryptoRuntime: state.api });
    const result = await producer; if (result.error) throw result.error; guard(); return copied;
  } catch (error) { pipe.fail(error); await producer; copied?.workspace.lock(); throw error; }
}
function offlineProofDetails(proof, actor) {
  const state = checkedProof(proof, actor);
  return { scope: proof.scope, recoveryWrapper: state.recoveryWrapper, root: state.root, key: new Uint8Array(state.key) };
}
async function preflightOfflineProof(proof, actor, options) {
  const state = checkedProof(proof, actor), guard = () => { checkedProof(proof, actor); };
  const view = await readRootView(state.workspace, proof.scope, state.api, guard); guard();
  const selected = [...view.records, ...view.controls.map(item => ({ namespace: 'metadata', key: (item.id.startsWith('snapshot/') ? 'internal-backup/' : 'internal-safety/') + item.value.id, value: item.value }))];
  preflightStartupRecords(selected, options);
  for (const backup of view.backupCatalog) {
    const value = await state.workspace.readRecord({ namespace: 'recovery', table: 'backup-content', key: backup.id }); guard();
    preflightStartupRecords([{ namespace: 'recovery', table: 'backup-content', key: backup.id, value }], { ...options, maxAllBytes: undefined });
  }
  guard();
}
module.exports = { prepareOfflineRecovery, copyOfflineRecoveryGraph, offlineProofDetails, preflightOfflineProof };
