// Ciphertext-only transactional provider; the main process supplies fixed scope and path.
// Builtin availability and actual packaged Windows behavior must be verified before activation.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_BYTES = 180 * 1024 * 1024;
const APP_ID = 0x54564c54;
const SCHEMA = 'CREATE TABLE checkpoint(slot INTEGER PRIMARY KEY CHECK(slot=1), revision INTEGER NOT NULL CHECK(revision>0), ciphertext TEXT NOT NULL) STRICT';
const META_SCHEMA = 'CREATE TABLE vault_metadata(slot INTEGER PRIMARY KEY CHECK(slot=1), app_id TEXT NOT NULL, vault_id TEXT NOT NULL, key_version INTEGER NOT NULL, device_id TEXT NOT NULL) STRICT';
const SAFETY_SCHEMA = 'CREATE TABLE safety_backup(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), ciphertext TEXT NOT NULL) STRICT';
const STAGED_SCHEMA = 'CREATE TABLE staged_checkpoint(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), hash TEXT NOT NULL, ciphertext TEXT NOT NULL) STRICT';
const AUX_SCHEMA = 'CREATE TABLE vault_aux(kind TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT';
const MESSAGE = 'Encrypted checkpoint could not be committed or verified. Reopen the verified saved version; do not blindly retry.';
function failure(code = 'ENCRYPTED_STORAGE_INVALID') { return Object.assign(new Error(MESSAGE), { code }); }
function createSqliteEncryptedVaultStore({ directory, scope, maxBytes = MAX_BYTES, DatabaseSync, parseEnvelope, deviceId = 'unbound-device', hooks = {} }) {
  if (!path.isAbsolute(directory) || !scope || Object.keys(scope).sort().join(',') !== 'appId,keyVersion,vaultId' || ![scope.appId, scope.vaultId].every(v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v)) || !Number.isSafeInteger(scope.keyVersion) || scope.keyVersion < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_BYTES) throw failure();
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(deviceId)) throw failure();
  scope = Object.freeze({ ...scope });
  try { DatabaseSync = DatabaseSync || require('node:sqlite').DatabaseSync; parseEnvelope = parseEnvelope || require('./generated/encryption/shared/encryption/index.js').parseEnvelope; } catch { throw failure('ENCRYPTED_STORAGE_RUNTIME_UNAVAILABLE'); }
  if (typeof DatabaseSync !== 'function' || typeof parseEnvelope !== 'function') throw failure('ENCRYPTED_STORAGE_RUNTIME_UNAVAILABLE');
  const filename = path.join(directory, 'workspace.sqlite');
  function checkPaths(create = false) {
    try {
      if (create) { try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
      const parent = fs.lstatSync(directory); if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== 'win32' && (parent.mode & 0o077) !== 0)) throw failure();
      for (const file of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
        try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw failure(); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      return fs.existsSync(filename);
    } catch (e) { if (!create && e.code === 'ENOENT') return false; throw failure(); }
  }
  function valid(next) {
    if (!next || Object.keys(next).sort().join(',') !== 'ciphertext,revision' || !Number.isSafeInteger(next.revision) || next.revision < 1 || typeof next.ciphertext !== 'string' || Buffer.byteLength(next.ciphertext) > maxBytes) throw failure();
    const e = parseEnvelope(next.ciphertext), c = e.context;
    if (c.appId !== scope.appId || c.vaultId !== scope.vaultId || c.keyVersion !== scope.keyVersion || c.purpose !== 'working-data' || c.recordId !== 'workspace' || c.revision !== next.revision) throw failure();
    return { revision: next.revision, ciphertext: next.ciphertext };
  }
  function schema(db) {
    if (db.prepare('PRAGMA application_id').get().application_id !== APP_ID || db.prepare('PRAGMA user_version').get().user_version !== 3) throw failure();
    const rows = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    const expected = new Map([['checkpoint', SCHEMA], ['vault_metadata', META_SCHEMA], ['safety_backup', SAFETY_SCHEMA], ['staged_checkpoint', STAGED_SCHEMA], ['vault_aux', AUX_SCHEMA]]);
    if (rows.length !== 5 || rows.some(row => row.type !== 'table' || row.sql !== expected.get(row.name))) throw failure();
    const metadata = db.prepare('SELECT * FROM vault_metadata LIMIT 2').all();
    if (metadata.length !== 1 || metadata[0].slot !== 1 || metadata[0].app_id !== scope.appId || metadata[0].vault_id !== scope.vaultId || metadata[0].key_version !== scope.keyVersion || metadata[0].device_id !== deviceId) throw failure();
  }
  function configure(db, create) {
    db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF');
    const mode = create ? db.prepare('PRAGMA journal_mode=WAL').get().journal_mode : db.prepare('PRAGMA journal_mode').get().journal_mode;
    if (mode !== 'wal' || db.prepare('PRAGMA synchronous').get().synchronous !== 2 || db.prepare('PRAGMA temp_store').get().temp_store !== 2 || db.prepare('PRAGMA trusted_schema').get().trusted_schema !== 0) throw failure('ENCRYPTED_STORAGE_DURABILITY_UNAVAILABLE');
  }
  function row(db) {
    const sizes = db.prepare('SELECT slot,revision,length(CAST(ciphertext AS BLOB)) AS bytes FROM checkpoint LIMIT 2').all();
    if (!sizes.length) return null;
    if (sizes.length !== 1 || sizes[0].slot !== 1 || !Number.isSafeInteger(sizes[0].bytes) || sizes[0].bytes < 1 || sizes[0].bytes > maxBytes) throw failure();
    return valid(db.prepare('SELECT revision,ciphertext FROM checkpoint WHERE slot=1').get());
  }
  function open(create) {
    const exists = checkPaths(create); if (!exists && !create) return null;
    // Precreate only a new fixed-path file with exclusive/restrictive flags, never truncate.
    if (!exists) { const handle = fs.openSync(filename, 'wx', 0o600); fs.closeSync(handle); }
    const db = new DatabaseSync(filename, { readOnly: !create, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    try {
      configure(db, !exists);
      if (!exists) {
        // Schema enrollment is a separate FULL-synchronized transaction. A failed
        // first checkpoint then leaves a valid empty provider, not an orphan file.
        db.exec('BEGIN IMMEDIATE');
        try { db.exec(`${SCHEMA}; ${META_SCHEMA}; ${SAFETY_SCHEMA}; ${STAGED_SCHEMA}; ${AUX_SCHEMA}; PRAGMA application_id=${APP_ID}; PRAGMA user_version=3`); db.prepare('INSERT INTO vault_metadata VALUES(1,?,?,?,?)').run(scope.appId, scope.vaultId, scope.keyVersion, deviceId); db.exec('COMMIT'); }
        catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      }
      schema(db); return { db, fresh: !exists };
    } catch (e) { db.close(); throw e; }
  }
  async function read() {
    let opened;
    try { opened = open(false); if (!opened) return null; return row(opened.db); }
    catch { throw failure(); } finally { if (opened) { try { opened.db.close(); } catch { throw failure(); } } }
  }
  async function commit(expectedRevision, input, safety) {
    let opened, inTransaction = false, attemptedCommit = false;
    try {
      const next = valid(input);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw failure();
      if (next.revision !== (expectedRevision === null ? 1 : expectedRevision + 1)) throw failure();
      if (expectedRevision !== null && !checkPaths()) throw failure('ENCRYPTED_STORAGE_STALE');
      opened = open(true); const db = opened.db;
      db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      const current = row(db); if ((current?.revision ?? null) !== expectedRevision) throw failure('ENCRYPTED_STORAGE_STALE');
      if (safety !== undefined) {
        if (!current || !safety || Object.keys(safety).sort().join(',') !== 'ciphertext,id,revision' || typeof safety.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(safety.id) || safety.revision !== expectedRevision || typeof safety.ciphertext !== 'string' || Buffer.byteLength(safety.ciphertext) > maxBytes) throw failure();
        const envelope = parseEnvelope(safety.ciphertext), c = envelope.context;
        if (c.appId !== scope.appId || c.vaultId !== scope.vaultId || c.keyVersion !== scope.keyVersion || c.purpose !== 'backup' || c.recordId !== 'safety/' + safety.id || c.revision !== expectedRevision) throw failure();
        db.prepare('INSERT INTO safety_backup(id,revision,ciphertext) VALUES(?,?,?)').run(safety.id, safety.revision, safety.ciphertext);
      }
      db.prepare('INSERT INTO checkpoint(slot,revision,ciphertext) VALUES(1,?,?) ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,ciphertext=excluded.ciphertext').run(next.revision, next.ciphertext);
      if (JSON.stringify(row(db)) !== JSON.stringify(next)) throw failure();
      if (hooks.beforeCommit) hooks.beforeCommit();
      attemptedCommit = true; db.exec('COMMIT'); inTransaction = false;
      if (hooks.afterCommit) hooks.afterCommit();
      checkPaths();
    } catch (cause) {
      if (inTransaction && opened) { try { opened.db.exec('ROLLBACK'); } catch { /* The caller must reopen after any uncertain outcome. */ } }
      if (attemptedCommit) throw failure('ENCRYPTED_STORAGE_COMMIT_UNCERTAIN');
      if (typeof cause?.code === 'string' && cause.code.startsWith('ENCRYPTED_STORAGE_')) throw failure(cause.code);
      throw failure();
    } finally { if (opened) { try { opened.db.close(); } catch { throw failure(attemptedCommit ? 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' : undefined); } } }
  }
  const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
  function operationId(id) { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw failure(); }
  function staged(db, id) {
    operationId(id);
    const size = db.prepare('SELECT length(CAST(ciphertext AS BLOB)) AS bytes FROM staged_checkpoint WHERE id=?').get(id);
    if (!size) return null;
    if (!Number.isSafeInteger(size.bytes) || size.bytes < 1 || size.bytes > maxBytes) throw failure();
    const stored = db.prepare('SELECT revision,hash,ciphertext FROM staged_checkpoint WHERE id=?').get(id);
    const next = valid({ revision: stored.revision, ciphertext: stored.ciphertext }); if (stored.hash !== digest(next.ciphertext)) throw failure(); return next;
  }
  async function writeTransaction(task) {
    let opened, transaction = false, attempted = false;
    try { opened = open(true); opened.db.exec('BEGIN IMMEDIATE'); transaction = true; const result = task(opened.db); attempted = true; opened.db.exec('COMMIT'); transaction = false; return result; }
    catch (cause) { if (opened && transaction) { try { opened.db.exec('ROLLBACK'); } catch {} } throw failure(attempted ? 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' : typeof cause?.code === 'string' && cause.code.startsWith('ENCRYPTED_STORAGE_') ? cause.code : undefined); }
    finally { if (opened) { try { opened.db.close(); } catch { throw failure(attempted ? 'ENCRYPTED_STORAGE_COMMIT_UNCERTAIN' : undefined); } } }
  }
  async function stage(id, input) {
    operationId(id); const next = valid(input);
    return writeTransaction(db => {
      const previous = staged(db, id); if (previous) { if (previous.revision !== next.revision || previous.ciphertext !== next.ciphertext) throw failure('ENCRYPTED_STORAGE_STAGED_CONFLICT'); return; }
      db.prepare('INSERT INTO staged_checkpoint(id,revision,hash,ciphertext) VALUES(?,?,?,?)').run(id, next.revision, digest(next.ciphertext), next.ciphertext);
    });
  }
  async function readStaged(id) { let opened; try { opened = open(false); return opened ? staged(opened.db, id) : null; } catch { throw failure(); } finally { if (opened) opened.db.close(); } }
  async function publish(id, baseHead, input) {
    operationId(id); const next = valid(input);
    if (baseHead !== null && (!baseHead || Object.keys(baseHead).sort().join(',') !== 'hash,revision' || !Number.isSafeInteger(baseHead.revision) || baseHead.revision < 1 || typeof baseHead.hash !== 'string' || !/^[a-f0-9]{64}$/.test(baseHead.hash))) throw failure();
    if (next.revision !== (baseHead?.revision ?? 0) + 1) throw failure();
    return writeTransaction(db => {
      const exact = staged(db, id); if (!exact || exact.revision !== next.revision || exact.ciphertext !== next.ciphertext) throw failure('ENCRYPTED_STORAGE_STAGED_CONFLICT');
      const current = row(db);
      if (current?.revision === next.revision && current.ciphertext === next.ciphertext) return;
      if ((current?.revision ?? null) !== (baseHead?.revision ?? null) || (current && digest(current.ciphertext) !== baseHead.hash)) throw failure('ENCRYPTED_STORAGE_STALE');
      db.prepare('INSERT INTO checkpoint(slot,revision,ciphertext) VALUES(1,?,?) ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,ciphertext=excluded.ciphertext').run(next.revision, next.ciphertext);
    });
  }
  async function saveAux(kind, value) {
    if (!['recovery-wrapper', 'enrollment-response'].includes(kind) || typeof value !== 'string' || Buffer.byteLength(value) > 16384) throw failure();
    if (kind === 'recovery-wrapper') {
      const c = parseEnvelope(value).context;
      if (c.appId !== scope.appId || c.vaultId !== scope.vaultId || c.keyVersion !== scope.keyVersion || c.purpose !== 'recovery-key' || c.recordId !== 'master-key' || c.revision !== 0) throw failure();
    } else {
      const response = JSON.parse(value), c = parseEnvelope(response.ciphertext).context;
      if (Object.keys(response).sort().join(',') !== 'ciphertext,deviceId' || response.deviceId !== deviceId || c.appId !== scope.appId || c.vaultId !== scope.vaultId || c.keyVersion !== scope.keyVersion || c.purpose !== 'transfer' || c.revision !== 0 || !c.recordId.startsWith('enrollment/' + deviceId + '/') || !c.recordId.endsWith('/response') || JSON.stringify({ deviceId: response.deviceId, ciphertext: response.ciphertext }) !== value) throw failure();
    }
    return writeTransaction(db => { db.prepare('INSERT INTO vault_aux(kind,value) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET value=excluded.value').run(kind, value); });
  }
  async function readAux(kind) {
    if (!['recovery-wrapper', 'enrollment-response'].includes(kind)) throw failure(); let opened;
    try { opened = open(false); if (!opened) return null; const row = opened.db.prepare('SELECT value FROM vault_aux WHERE kind=?').get(kind); if (!row) return null; if (typeof row.value !== 'string' || Buffer.byteLength(row.value) > 16384) throw failure(); return row.value; }
    catch { throw failure(); } finally { if (opened) opened.db.close(); }
  }
  async function initialize() { let opened; try { opened = open(true); } catch (cause) { throw failure(); } finally { if (opened) opened.db.close(); } }
  async function listSafety() { let opened; try { opened = open(false); return opened ? opened.db.prepare('SELECT id,revision FROM safety_backup ORDER BY rowid DESC').all() : []; } catch { throw failure(); } finally { if (opened) opened.db.close(); } }
  return Object.freeze({ read, commit, initialize, stage, readStaged, publish, current: read, saveAux, readAux, commitWithSafety: (expected, next, safety) => commit(expected, next, safety), listSafety });
}
function inspectSqliteVaultDescriptor({ directory, expectedAppId, DatabaseSync }) {
  const filename = path.join(directory, 'workspace.sqlite'); let db;
  try {
    if (!path.isAbsolute(directory) || typeof expectedAppId !== 'string') throw failure();
    for (const file of [directory, filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
      try { const stat = fs.lstatSync(file); if (stat.isSymbolicLink() || (file === directory ? !stat.isDirectory() : !stat.isFile()) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw failure(); }
      catch (e) { if ((file.endsWith('-wal') || file.endsWith('-shm') || file.endsWith('-journal')) && e.code === 'ENOENT') continue; throw e; }
    }
    DatabaseSync = DatabaseSync || require('node:sqlite').DatabaseSync;
    db = new DatabaseSync(filename, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF');
    if (db.prepare('PRAGMA application_id').get().application_id !== APP_ID || db.prepare('PRAGMA user_version').get().user_version !== 3) throw failure();
    const expected = new Map([['checkpoint', SCHEMA], ['vault_metadata', META_SCHEMA], ['safety_backup', SAFETY_SCHEMA], ['staged_checkpoint', STAGED_SCHEMA], ['vault_aux', AUX_SCHEMA]]);
    const shapes = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    if (shapes.length !== 5 || shapes.some(row => row.type !== 'table' || row.sql !== expected.get(row.name))) throw failure();
    const rows = db.prepare('SELECT * FROM vault_metadata LIMIT 2').all();
    if (rows.length !== 1 || rows[0].slot !== 1 || rows[0].app_id !== expectedAppId || typeof rows[0].vault_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(rows[0].vault_id) || !Number.isSafeInteger(rows[0].key_version) || rows[0].key_version < 1 || typeof rows[0].device_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(rows[0].device_id)) throw failure();
    return { appId: expectedAppId, vaultId: rows[0].vault_id, keyVersion: rows[0].key_version, deviceId: rows[0].device_id };
  } catch { throw failure(); } finally { if (db) db.close(); }
}
module.exports = { createSqliteEncryptedVaultStore, inspectSqliteVaultDescriptor };
