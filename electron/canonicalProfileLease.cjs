// Main/Node-only: a stable application-owned registry, independent of movable
// ciphertext workspaces. Root selection is trusted host configuration, not data
// recovered from a workspace header or an authorization boolean.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createSqliteProtectedKeyStore } = require('./sqliteProtectedKeyStore.cjs');
const activeLeases = new AsyncLocalStorage(), queues = new Map();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const fail = (code = 'CANONICAL_PROFILE_UNAVAILABLE') => Object.assign(Error('The canonical protected profile or selected workspace changed or is unavailable. Reopen its verified location; no replacement profile or receipt was adopted.'), { code });
function scope(value) {
  if (!value || Object.keys(value).sort().join('|') !== 'appId|keyVersion|vaultId' || ![value.appId,value.vaultId].every(x => typeof x === 'string' && ID.test(x)) || !Number.isSafeInteger(value.keyVersion) || value.keyVersion < 1) throw fail();
  return Object.freeze({ appId: value.appId, vaultId: value.vaultId, keyVersion: value.keyVersion });
}
function physical(filename, directory = true) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.length > 32768) throw fail();
  try {
    const stat = fs.lstatSync(filename, { bigint: true });
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.ino <= 0n || stat.dev < 0n || process.platform !== 'win32' && (stat.mode & 0o077n || typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))) throw fail();
    return Object.freeze({ path: fs.realpathSync.native(filename), dev: stat.dev, ino: stat.ino });
  } catch { throw fail(); }
}
const same = (a,b) => a.path === b.path && a.dev === b.dev && a.ino === b.ino;
function contains(parent, child) {
  let current = child.path;
  for (let count = 0; count < 2048; count++) {
    const stat = fs.statSync(current, { bigint: true });
    if (stat.dev === parent.dev && stat.ino === parent.ino) return true;
    const next = path.dirname(current); if (next === current) return false; current = next;
  }
  throw fail();
}
function childDirectory(filename) {
  try { fs.mkdirSync(filename, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw fail(); }
  return physical(filename);
}
async function serialized(key, waitMilliseconds, assertCurrent, action) {
  if (activeLeases.getStore()?.active) throw fail('CANONICAL_PROFILE_NESTED_LEASE');
  const previous = queues.get(key) || Promise.resolve(); let entered = false, cancelled = false, timer;
  const pending = previous.then(() => {
    if (cancelled) throw fail('CANONICAL_PROFILE_BUSY'); assertCurrent(); entered = true; clearTimeout(timer); return action();
  });
  const settled = pending.then(() => {}, () => {}); queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  const timeout = new Promise((_,reject) => { timer = setTimeout(() => { if (!entered) { cancelled = true; reject(fail('CANONICAL_PROFILE_BUSY')); } }, waitMilliseconds); });
  try { return await Promise.race([pending, timeout]); }
  finally { if (!entered) cancelled = true; clearTimeout(timer); }
}
function createCanonicalProfileLease({ canonicalProfileRoot, scope: requested, DatabaseSync, waitMilliseconds = 1000 }) {
  const fixed = scope(requested), root = physical(canonicalProfileRoot);
  if (!Number.isSafeInteger(waitMilliseconds) || waitMilliseconds < 1 || waitMilliseconds > 30000) throw fail();
  const digest = createHash('sha256').update(JSON.stringify(fixed)).digest('hex');
  const namespacePath = path.join(root.path, 'canonical-encryption-v1'), registryPath = path.join(namespacePath, digest), registryFile = path.join(registryPath, 'profile-keys.sqlite');
  const queueKey = root.dev + ':' + root.ino + ':' + digest;
  let namespaceIdentity = null, registryIdentity = null, store = null, commitGuard = null;
  function assertRoot() { if (!same(root, physical(canonicalProfileRoot))) throw fail('CANONICAL_PROFILE_CONTEXT_CHANGED'); }
  function registry() {
    assertRoot(); const namespace = childDirectory(namespacePath), directory = childDirectory(registryPath);
    if (namespaceIdentity && !same(namespaceIdentity,namespace) || registryIdentity && !same(registryIdentity,directory)) throw fail('CANONICAL_PROFILE_CONTEXT_CHANGED');
    namespaceIdentity = namespace; registryIdentity = directory;
    store ||= createSqliteProtectedKeyStore({ directory: registryPath, scope: fixed, DatabaseSync, hooks: { beforeCommit: () => { if (!commitGuard) throw fail(); commitGuard(); } } }); return store;
  }
  function forWorkspace(workspaceDirectory) {
    assertRoot(); const workspace = physical(workspaceDirectory);
    if (contains(root,workspace) || contains(workspace,root)) throw fail('CANONICAL_PROFILE_LOCATION_OVERLAP');
    const binding = Object.freeze({}); let closed = false;
    function assertCurrent() {
      if (closed) throw fail('CANONICAL_PROFILE_CONTEXT_CHANGED'); assertRoot();
      if (!same(workspace,physical(workspaceDirectory))) throw fail('CANONICAL_PROFILE_CONTEXT_CHANGED');
    }
    function assertHeld(held, actionRequired = true, storeAssertionRequired = true) {
      assertCurrent();
      if (!held?.active || actionRequired && !held.actionActive || held.binding !== binding || held.scopeKey !== queueKey || !same(held.namespace,physical(namespacePath)) || !same(held.registry,physical(registryPath)) || !same(held.file,physical(registryFile,false))) throw fail('CANONICAL_PROFILE_LEASE_REQUIRED');
      if (storeAssertionRequired) held.store.assertProfileLease();
    }
    function assertProfileLease() { assertHeld(activeLeases.getStore()); }
    async function withExclusiveProfileLock(action) {
      if (typeof action !== 'function') throw fail(); assertCurrent();
      return serialized(queueKey,waitMilliseconds,assertCurrent,async () => {
        const current = registry();
        let held;
        try { return await current.withExclusiveProfileLock(async () => {
          held = { active: true, actionActive: true, binding, scopeKey: queueKey, namespace: physical(namespacePath), registry: physical(registryPath), file: physical(registryFile,false), store: current };
          // The registry invokes this private hook after its callback ALS scope
          // has ended, while its actual SQLite transaction is still held. It
          // checks location/revocation only and grants no public lease access.
          commitGuard = () => assertHeld(held,false,false);
          try { return await activeLeases.run(held,async () => { assertProfileLease(); const result = await action(); assertProfileLease(); return result; }); }
          finally { held.actionActive = false; }
        }); } finally { if (held) held.active = false; commitGuard = null; }
      });
    }
    return Object.freeze({
      scope: fixed, assertCurrent, assertProfileLease, withExclusiveProfileLock,
      read: async slot => { assertProfileLease(); const value = await store.read(slot); assertProfileLease(); return value; },
      create: async (slot,bytes) => { assertProfileLease(); await store.create(slot,bytes); assertProfileLease(); },
      close: () => { closed = true; },
      initialize: () => withExclusiveProfileLock(async () => {})
    });
  }
  return Object.freeze({ scope: fixed, forWorkspace });
}
module.exports = { createCanonicalProfileLease };
