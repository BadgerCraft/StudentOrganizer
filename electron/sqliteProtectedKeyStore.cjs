// Fixed-path ciphertext-only key registry. Native protection is a separate adapter.
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const APP_ID = 0x54564b53, VERSION = 1, LIMIT = 16384;
const SCHEMA = 'CREATE TABLE protected_key(app_id TEXT NOT NULL,vault_id TEXT NOT NULL,key_version INTEGER NOT NULL CHECK(key_version>0),slot TEXT NOT NULL,protected BLOB NOT NULL CHECK(length(protected)>0 AND length(protected)<=16384),PRIMARY KEY(app_id,vault_id,key_version,slot)) STRICT';
const MESSAGE = 'Protected key storage is unavailable. Reopen verified recovery; no plaintext fallback was used.';
const fail = (code = 'PROTECTED_KEY_STORAGE_INVALID') => Object.assign(Error(MESSAGE), { code });
function createSqliteProtectedKeyStore({ directory, scope, DatabaseSync, hooks = {} }) {
  if (!path.isAbsolute(directory) || !scope || Object.keys(scope).sort().join(',') !== 'appId,keyVersion,vaultId' || ![scope.appId, scope.vaultId].every(x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(x)) || !Number.isSafeInteger(scope.keyVersion) || scope.keyVersion < 1) throw fail();
  scope = Object.freeze({ ...scope });
  try { DatabaseSync ??= require('node:sqlite').DatabaseSync; } catch { throw fail('PROTECTED_KEY_RUNTIME_UNAVAILABLE'); }
  if (typeof DatabaseSync !== 'function') throw fail('PROTECTED_KEY_RUNTIME_UNAVAILABLE');
  const filename = path.join(directory, 'profile-keys.sqlite'), leases = new AsyncLocalStorage();
  let running = false;
  function paths() {
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const parent = fs.lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== 'win32' && (parent.mode & 0o077))) throw fail();
    for (const name of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
      try { const s = fs.lstatSync(name); if (!s.isFile() || s.isSymbolicLink() || (process.platform !== 'win32' && (s.mode & 0o077))) throw fail(); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    if (!fs.existsSync(filename)) { try { fs.closeSync(fs.openSync(filename, 'wx', 0o600)); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  }
  function attest(db) {
    const objects = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    if (objects.length !== 1 || objects[0].name !== 'protected_key' || objects[0].type !== 'table' || objects[0].sql !== SCHEMA || db.prepare('PRAGMA application_id').get().application_id !== APP_ID || db.prepare('PRAGMA user_version').get().user_version !== VERSION) throw fail();
  }
  function open() {
    paths(); const db = new DatabaseSync(filename, { allowExtension: false, enableDoubleQuotedStringLiterals: false });
    try {
      db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF');
      const objects = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
      if (!objects.length && db.prepare('PRAGMA application_id').get().application_id === 0 && db.prepare('PRAGMA user_version').get().user_version === 0) {
        if (db.prepare('PRAGMA journal_mode=WAL').get().journal_mode !== 'wal') throw fail();
        // A clean/rolled-back schema enrollment may be retried; never delete a file.
        db.exec('BEGIN IMMEDIATE');
        try {
          const now = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
          if (!now.length) { db.exec(`${SCHEMA}; PRAGMA application_id=${APP_ID}; PRAGMA user_version=${VERSION}`); hooks.beforeSchemaCommit?.(); }
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      }
      if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' || db.prepare('PRAGMA synchronous').get().synchronous !== 2 || db.prepare('PRAGMA busy_timeout').get().timeout !== 1000 || db.prepare('PRAGMA temp_store').get().temp_store !== 2 || db.prepare('PRAGMA trusted_schema').get().trusted_schema !== 0) throw fail();
      attest(db); return db;
    } catch (e) { db.close(); throw e; }
  }
  function lease(slot) {
    const value = leases.getStore();
    if (!value?.active || typeof slot !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(slot)) throw fail('PROTECTED_KEY_LEASE_REQUIRED');
    return value.db;
  }
  async function read(slot) {
    try {
      const db = lease(slot), p = [scope.appId, scope.vaultId, scope.keyVersion, slot];
      const row = db.prepare('SELECT length(protected) AS bytes FROM protected_key WHERE app_id=? AND vault_id=? AND key_version=? AND slot=?').get(...p);
      if (!row) return null;
      if (!Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > LIMIT) throw fail();
      const bytes = db.prepare('SELECT protected FROM protected_key WHERE app_id=? AND vault_id=? AND key_version=? AND slot=?').get(...p).protected;
      if (!(bytes instanceof Uint8Array) || bytes.length !== row.bytes) throw fail();
      return new Uint8Array(bytes);
    } catch (e) { if (e.code === 'PROTECTED_KEY_LEASE_REQUIRED') throw e; throw fail(); }
  }
  async function create(slot, input) {
    const db = lease(slot);
    if (!(input instanceof Uint8Array) || !input.length || input.length > LIMIT) throw fail();
    const bytes = Buffer.from(input);
    try { db.prepare('INSERT INTO protected_key VALUES(?,?,?,?,?)').run(scope.appId, scope.vaultId, scope.keyVersion, slot, bytes); hooks.afterCreate?.(); }
    catch { throw fail('PROTECTED_KEY_CREATE_REJECTED'); } finally { bytes.fill(0); }
  }
  async function withExclusiveProfileLock(fn) {
    if (typeof fn !== 'function' || running || leases.getStore()?.active) throw fail('PROTECTED_KEY_PROFILE_BUSY');
    running = true; let db, value, begun = false, attempted = false;
    try {
      db = open(); db.exec('BEGIN IMMEDIATE'); begun = true; attest(db); value = { db, active: true };
      const result = await leases.run(value, fn);
      hooks.beforeCommit?.(); attempted = true; db.exec('COMMIT'); begun = false;
      value.active = false; hooks.afterCommit?.(); return result;
    } catch (e) {
      if (begun && db) { try { db.exec('ROLLBACK'); } catch {} }
      if (attempted) throw fail('PROTECTED_KEY_COMMIT_UNCERTAIN');
      throw fail(e?.code === 'PROTECTED_KEY_PROFILE_BUSY' ? e.code : 'PROTECTED_KEY_STORAGE_INVALID');
    } finally { if (value) value.active = false; running = false; if (db) { try { db.close(); } catch { throw fail(attempted ? 'PROTECTED_KEY_COMMIT_UNCERTAIN' : 'PROTECTED_KEY_STORAGE_INVALID'); } } }
  }
  return Object.freeze({ read, create, assertProfileLease: () => { lease('profile-lease-assertion'); }, withExclusiveProfileLock, initialize: () => withExclusiveProfileLock(async () => {}) });
}
module.exports = { createSqliteProtectedKeyStore };
