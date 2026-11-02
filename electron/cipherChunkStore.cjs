// Main-owned, ciphertext-only staging. Authentication remains the shared crypto verifier's job.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_BYTES = 128 * 1024 * 1024 * 1024;
const MAX_ENVELOPE = Math.ceil((CHUNK_BYTES + 16) / 3) * 4 + 4096;
const APP_ID = 0x54434348;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCHEMAS = [
  'CREATE TABLE vault_metadata(slot INTEGER PRIMARY KEY CHECK(slot=1),scope TEXT NOT NULL) STRICT',
  'CREATE TABLE files(file_id TEXT PRIMARY KEY,context TEXT NOT NULL,plan TEXT NOT NULL) STRICT',
  'CREATE TABLE chunks(file_id TEXT NOT NULL,idx INTEGER NOT NULL CHECK(idx>=0),digest TEXT NOT NULL,ciphertext BLOB NOT NULL,PRIMARY KEY(file_id,idx),FOREIGN KEY(file_id) REFERENCES files(file_id)) STRICT',
  'CREATE TABLE manifests(purpose TEXT NOT NULL,record_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),file_id TEXT NOT NULL,seal TEXT NOT NULL,PRIMARY KEY(purpose,record_id),FOREIGN KEY(file_id) REFERENCES files(file_id)) STRICT'
];
const message = 'Encrypted chunks could not be staged or published. Keep the original source and reopen the verified manifest before retrying.';
function failure(code = 'ENCRYPTED_CHUNKS_INVALID') { return Object.assign(new Error(message), { code }); }
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
function createCipherChunkStore({ directory, scope, DatabaseSync, parseEnvelope, verifyManifest, hooks = {} }) {
  if (!path.isAbsolute(directory) || !exact(scope, ['appId', 'vaultId', 'keyVersion']) || ![scope.appId, scope.vaultId].every(v => typeof v === 'string' && ID.test(v)) || !Number.isSafeInteger(scope.keyVersion) || scope.keyVersion < 1) throw failure();
  scope = Object.freeze({ ...scope });
  try { DatabaseSync ||= require('node:sqlite').DatabaseSync; parseEnvelope ||= require('./generated/encryption/shared/encryption/index.js').parseEnvelope; } catch { throw failure('ENCRYPTED_CHUNKS_RUNTIME_UNAVAILABLE'); }
  if (typeof DatabaseSync !== 'function' || typeof parseEnvelope !== 'function' || typeof verifyManifest !== 'function') throw failure();
  const filename = path.join(directory, 'chunks.sqlite');
  function paths(create) {
    try {
      if (create) { try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
      const dir = fs.lstatSync(directory); if (!dir.isDirectory() || dir.isSymbolicLink() || (process.platform !== 'win32' && dir.mode & 0o077)) throw failure();
      for (const name of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
        try { const st = fs.lstatSync(name); if (!st.isFile() || st.isSymbolicLink() || (process.platform !== 'win32' && st.mode & 0o077)) throw failure(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      return fs.existsSync(filename);
    } catch (e) { if (!create && e.code === 'ENOENT') return false; throw failure(); }
  }
  function open(create) {
    const existed = paths(create); if (!existed && !create) return null;
    if (!existed) { const fd = fs.openSync(filename, 'wx', 0o600); fs.closeSync(fd); }
    const db = new DatabaseSync(filename, { readOnly: !create, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    try {
      db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON');
      const mode = db.prepare(existed ? 'PRAGMA journal_mode' : 'PRAGMA journal_mode=WAL').get().journal_mode;
      if (mode !== 'wal' || db.prepare('PRAGMA synchronous').get().synchronous !== 2 || db.prepare('PRAGMA temp_store').get().temp_store !== 2) throw failure('ENCRYPTED_CHUNKS_DURABILITY_UNAVAILABLE');
      if (!existed) {
        db.exec('BEGIN IMMEDIATE');
        try { db.exec(SCHEMAS.join(';') + `;PRAGMA application_id=${APP_ID};PRAGMA user_version=1`); db.prepare('INSERT INTO vault_metadata VALUES(1,?)').run(JSON.stringify(scope)); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
      }
      attest(db);
      return db;
    } catch (e) { db.close(); throw e; }
  }
  function attest(db) {
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.sql).sort();
    if (db.prepare('PRAGMA application_id').get().application_id !== APP_ID || db.prepare('PRAGMA user_version').get().user_version !== 1 || JSON.stringify(schema) !== JSON.stringify([...SCHEMAS].sort())) throw failure();
    const metadata = db.prepare('SELECT slot,length(scope) AS bytes FROM vault_metadata LIMIT 2').all();
    if (metadata.length !== 1 || metadata[0].slot !== 1 || metadata[0].bytes > 2048 || db.prepare('SELECT scope FROM vault_metadata WHERE slot=1').get().scope !== JSON.stringify(scope)) throw failure();
  }
  function context(value) {
    if (!exact(value, ['appId', 'vaultId', 'purpose', 'recordId', 'revision', 'keyVersion']) || value.appId !== scope.appId || value.vaultId !== scope.vaultId || value.keyVersion !== scope.keyVersion || !['working-data', 'attachment', 'backup', 'transfer'].includes(value.purpose) || typeof value.recordId !== 'string' || !ID.test(value.recordId) || !Number.isSafeInteger(value.revision) || value.revision < 1) throw failure();
    return { appId: value.appId, vaultId: value.vaultId, purpose: value.purpose, recordId: value.recordId, revision: value.revision, keyVersion: value.keyVersion };
  }
  function file(input) {
    if (!exact(input, ['context', 'plan'])) throw failure();
    const c = context(input.context), p = input.plan;
    if (!exact(p, ['format', 'version', 'fileId', 'chunkBytes', 'totalBytes', 'chunkCount']) || p.format !== 'teacher-vault-chunks' || p.version !== 1 || !UUID.test(p.fileId) || p.chunkBytes !== CHUNK_BYTES || !Number.isSafeInteger(p.totalBytes) || p.totalBytes < 0 || p.totalBytes > MAX_BYTES || p.chunkCount !== Math.ceil(p.totalBytes / CHUNK_BYTES)) throw failure();
    const plan = { format: p.format, version: 1, fileId: p.fileId, chunkBytes: CHUNK_BYTES, totalBytes: p.totalBytes, chunkCount: p.chunkCount };
    return { context: c, plan };
  }
  function loadFile(db, id) {
    const sizes = db.prepare('SELECT length(context) AS a,length(plan) AS b FROM files WHERE file_id=?').get(id);
    if (!sizes || sizes.a > 2048 || sizes.b > 1024) throw failure();
    const row = db.prepare('SELECT context,plan FROM files WHERE file_id=?').get(id);
    const verified = file({ context: JSON.parse(row.context), plan: JSON.parse(row.plan) }); if (verified.plan.fileId !== id) throw failure(); return verified;
  }
  function chunk(db, f, index) {
    const sizes = db.prepare('SELECT length(ciphertext) AS bytes,digest FROM chunks WHERE file_id=? AND idx=?').get(f.plan.fileId, index);
    if (!sizes || !Number.isSafeInteger(sizes.bytes) || sizes.bytes < 1 || sizes.bytes > MAX_ENVELOPE || !/^[a-f0-9]{64}$/.test(sizes.digest)) throw failure();
    const raw = db.prepare('SELECT ciphertext FROM chunks WHERE file_id=? AND idx=?').get(f.plan.fileId, index).ciphertext;
    if (!(raw instanceof Uint8Array)) throw failure(); const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (hash(text) !== sizes.digest) throw failure(); validateChunk(f, index, text); return text;
  }
  function validateChunk(f, index, ciphertext) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= f.plan.chunkCount || typeof ciphertext !== 'string' || Buffer.byteLength(ciphertext) > MAX_ENVELOPE) throw failure();
    const p = f.plan, c = f.context;
    const expectedId = 'chunk/' + hash(JSON.stringify(['teacher-vault-chunk-v1', c.appId, c.vaultId, c.purpose, c.recordId, c.revision, c.keyVersion, p, index]));
    const e = parseEnvelope(ciphertext), expected = { ...c, recordId: expectedId };
    if (JSON.stringify(e.context) !== JSON.stringify(expected)) throw failure();
  }
  function transact(db, action) {
    let attempted = false;
    return Promise.resolve().then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = await action(); if (hooks.beforeCommit) hooks.beforeCommit(); attempted = true; db.exec('COMMIT'); if (hooks.afterCommit) hooks.afterCommit(); paths(false); return result; }
      catch (e) { try { db.exec('ROLLBACK'); } catch {} if (attempted) throw failure('ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN'); if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure(); }
    });
  }
  async function stage(input, index, ciphertext) {
    const f = file(input); validateChunk(f, index, ciphertext); let db;
    try {
      db = open(true); await transact(db, () => {
        const prior = db.prepare('SELECT context,plan FROM files WHERE file_id=?').get(f.plan.fileId);
        if (prior && (prior.context !== JSON.stringify(f.context) || prior.plan !== JSON.stringify(f.plan))) throw failure();
        if (!prior) db.prepare('INSERT INTO files VALUES(?,?,?)').run(f.plan.fileId, JSON.stringify(f.context), JSON.stringify(f.plan));
        const existing = db.prepare('SELECT digest FROM chunks WHERE file_id=? AND idx=?').get(f.plan.fileId, index);
        if (existing) { if (existing.digest !== hash(ciphertext) || chunk(db, f, index) !== ciphertext) throw failure(); return; }
        db.prepare('INSERT INTO chunks VALUES(?,?,?,?)').run(f.plan.fileId, index, hash(ciphertext), Buffer.from(ciphertext));
      });
    } catch (e) { if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure(); } finally { if (db) { try { db.close(); } catch { throw failure('ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN'); } } }
  }
  async function publish(input, seal, expectedRevision) {
    const f = file(input);
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw failure();
    if (f.context.revision !== (expectedRevision === null ? 1 : expectedRevision + 1) || typeof seal !== 'string' || Buffer.byteLength(seal) > 4 * 1024 * 1024 || JSON.stringify(parseEnvelope(seal).context) !== JSON.stringify(f.context)) throw failure();
    let db;
    try {
      db = open(true); await transact(db, async () => {
        const prior = db.prepare('SELECT revision FROM manifests WHERE purpose=? AND record_id=?').get(f.context.purpose, f.context.recordId);
        if ((prior?.revision ?? null) !== expectedRevision) throw failure('ENCRYPTED_CHUNKS_STALE');
        const existing = db.prepare('SELECT context,plan FROM files WHERE file_id=?').get(f.plan.fileId);
        if (!existing && f.plan.chunkCount === 0) db.prepare('INSERT INTO files VALUES(?,?,?)').run(f.plan.fileId, JSON.stringify(f.context), JSON.stringify(f.plan));
        const stored = loadFile(db, f.plan.fileId); if (JSON.stringify(stored) !== JSON.stringify(f)) throw failure();
        if (db.prepare('SELECT count(*) AS n FROM chunks WHERE file_id=?').get(f.plan.fileId).n !== f.plan.chunkCount) throw failure();
        async function* source() { for (let i = 0; i < f.plan.chunkCount; i++) yield chunk(db, f, i); }
        // The trusted main-process verifier must authenticate the final seal and every chunk.
        const verified = await verifyManifest(f.context, seal, source());
        if (!exact(verified, ['totalBytes', 'plan']) || verified.totalBytes !== f.plan.totalBytes || JSON.stringify(file({ context: f.context, plan: verified.plan }).plan) !== JSON.stringify(f.plan)) throw failure();
        db.prepare('INSERT INTO manifests VALUES(?,?,?,?,?) ON CONFLICT(purpose,record_id) DO UPDATE SET revision=excluded.revision,file_id=excluded.file_id,seal=excluded.seal').run(f.context.purpose, f.context.recordId, f.context.revision, f.plan.fileId, seal);
      });
    } catch (e) { if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure(); } finally { if (db) { try { db.close(); } catch { throw failure('ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN'); } } }
  }
  async function read(purpose, recordId) {
    if (!['working-data', 'attachment', 'backup', 'transfer'].includes(purpose) || typeof recordId !== 'string' || !ID.test(recordId)) throw failure(); let db;
    try {
      db = open(false); if (!db) return null;
      const size = db.prepare('SELECT length(seal) AS n FROM manifests WHERE purpose=? AND record_id=?').get(purpose, recordId); if (!size) return null; if (size.n > 4 * 1024 * 1024) throw failure();
      const row = db.prepare('SELECT revision,file_id,seal FROM manifests WHERE purpose=? AND record_id=?').get(purpose, recordId); const f = loadFile(db, row.file_id);
      if (f.context.purpose !== purpose || f.context.recordId !== recordId || f.context.revision !== row.revision || JSON.stringify(parseEnvelope(row.seal).context) !== JSON.stringify(f.context)) throw failure();
      return { ...f, seal: row.seal };
    } catch (e) { if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure(); } finally { db?.close(); }
  }
  async function* chunks(input) {
    const f = file(input); let db;
    try { db = open(false); if (!db || JSON.stringify(loadFile(db, f.plan.fileId)) !== JSON.stringify(f)) throw failure(); for (let i = 0; i < f.plan.chunkCount; i++) yield chunk(db, f, i); }
    catch (e) { if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure(); } finally { db?.close(); }
  }
  async function readChunkAt(input, index) {
    // Input must be the authenticated descriptor from the shared final-seal
    // index. This adapter validates bounded ciphertext transport, not AEAD.
    const f = file(input);
    if (!Number.isSafeInteger(index) || index < 0 || index >= f.plan.chunkCount) throw failure();
    let db, begun = false;
    try {
      db = open(false); if (!db) throw failure();
      // Keep schema, length preflight and BLOB fetch in one SQLite snapshot, so
      // another connection cannot enlarge the selected row between the checks.
      db.exec('BEGIN'); begun = true; attest(db);
      if (JSON.stringify(loadFile(db, f.plan.fileId)) !== JSON.stringify(f)) throw failure();
      const ciphertext = chunk(db, f, index);
      db.exec('COMMIT'); begun = false; return ciphertext;
    } catch (e) {
      if (begun) { try { db.exec('ROLLBACK'); } catch {} }
      if (e?.code?.startsWith('ENCRYPTED_CHUNKS_')) throw e; throw failure();
    } finally { if (db) { try { db.close(); } catch { throw failure(); } } }
  }
  return Object.freeze({ stage, publish, read, chunks, readChunkAt });
}
module.exports = { createCipherChunkStore };
