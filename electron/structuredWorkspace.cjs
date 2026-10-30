// Typed logical-record workspace. Root metadata is encrypted and committed only after immutable objects.
const { createHash, randomUUID } = require('node:crypto');
const ROOT_FORMAT = 'student-organizer-object-workspace';
const ROOT_LIMIT = 16 * 1024 * 1024;
const MAX_RECORDS = 2000000;
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_SHARD_RECORDS = 8192;
const MAX_RECORD_BYTES = 128 * 1024 * 1024 * 1024;
const MATERIALIZED_RECORD_BYTES = 256 * 1024 * 1024;
const MATERIALIZED_ALL_BYTES = 512 * 1024 * 1024;
const MESSAGE = 'Encrypted workspace objects could not be committed or verified. Reopen the verified revision; do not repeat an uncertain write.';
const fail = (code = 'STRUCTURED_WORKSPACE_INVALID') => Object.assign(new Error(MESSAGE), { code });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function logical(change) {
  if (!change || !['primary', 'recovery', 'storage', 'metadata'].includes(change.namespace) || typeof change.key !== 'string' || !change.key || change.key.length > 4096 || (change.table !== undefined && (typeof change.table !== 'string' || !change.table || change.table.length > 200))) throw fail();
  if (['primary', 'recovery'].includes(change.namespace) !== (typeof change.table === 'string')) throw fail();
  return JSON.stringify([change.namespace, change.table || '', change.key]);
}
function parsedLogical(key) {
  if (typeof key !== 'string' || key.length > 9000) throw fail();
  const tuple = JSON.parse(key); if (!Array.isArray(tuple) || tuple.length !== 3) throw fail();
  const value = { namespace: tuple[0], ...(tuple[1] ? { table: tuple[1] } : {}), key: tuple[2] };
  if (logical(value) !== key) throw fail(); return value;
}
function* tokens(value, seen = new Set(), depth = 0) {
  if (depth > 128) throw fail();
  if (value === null || typeof value === 'boolean') { yield String(value); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw fail(); yield JSON.stringify(value); return; }
  if (typeof value === 'string') {
    yield '"';
    for (let at = 0; at < value.length;) {
      let end = Math.min(value.length, at + 8192);
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end++;
      yield JSON.stringify(value.slice(at, end)).slice(1, -1); at = end;
    }
    yield '"'; return;
  }
  if (!value || typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) throw fail();
  seen.add(value);
  if (Array.isArray(value)) {
    yield '['; for (let i = 0; i < value.length; i++) { if (i) yield ','; yield* tokens(value[i], seen, depth + 1); } yield ']';
  } else {
    yield '{'; let first = true; for (const key of Object.keys(value).sort()) { if (!first) yield ','; first = false; yield* tokens(key, seen, depth + 1); yield ':'; yield* tokens(value[key], seen, depth + 1); } yield '}';
  }
  seen.delete(value);
}
function measured(value, maxBytes) {
  const digest = createHash('sha256'); let bytes = 0;
  for (const token of tokens(value)) { const data = encoder.encode(token); bytes += data.length; if (bytes > maxBytes) throw fail('STRUCTURED_WORKSPACE_RECORD_TOO_LARGE'); digest.update(data); }
  return { bytes, contentHash: digest.digest('hex') };
}
async function* encoded(value, chunkBytes) {
  let output = new Uint8Array(chunkBytes), at = 0;
  try {
    for (const token of tokens(value)) {
      const data = encoder.encode(token); let offset = 0;
      while (offset < data.length) {
        const size = Math.min(output.length - at, data.length - offset); output.set(data.subarray(offset, offset + size), at); at += size; offset += size;
        if (at === output.length) { yield output; output = new Uint8Array(chunkBytes); at = 0; }
      }
    }
    if (at) yield output.subarray(0, at);
  } finally { output.fill(0); }
}
function capture(changes) {
  if (!Array.isArray(changes) || changes.length > MAX_RECORDS) throw fail(); const seen = new Set();
  return changes.map(change => {
    if (!exact(change, change?.deleted === true ? ['namespace', ...(change?.table === undefined ? [] : ['table']), 'key', 'deleted'] : ['namespace', ...(change?.table === undefined ? [] : ['table']), 'key', 'value'])) throw fail();
    const key = logical(change); if (seen.has(key)) throw fail(); seen.add(key);
    return { key, deleted: change.deleted === true, ...(change.deleted === true ? {} : { value: structuredClone(change.value) }) };
  });
}
function options(input) {
  if (!input || !exact(input.scope, ['appId', 'vaultId', 'keyVersion']) || ![input.scope.appId, input.scope.vaultId].every(v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(v)) || !Number.isSafeInteger(input.scope.keyVersion) || input.scope.keyVersion < 1 || !(input.key instanceof Uint8Array) || input.key.length !== 32 || !input.checkpointStore || (!input.chunkStore && typeof input.createChunkStore !== 'function')) throw fail();
  const crypto = input.cryptoRuntime || require('./generated/encryption/shared/encryption/index.js');
  const chunks = input.chunkRuntime || require('./generated/encryption/shared/encryption/chunks.js');
  const maxRecordBytes = input.maxRecordBytes ?? MAX_RECORD_BYTES;
  const maxReadRecordBytes = input.maxReadRecordBytes ?? MATERIALIZED_RECORD_BYTES, maxReadAllBytes = input.maxReadAllBytes ?? MATERIALIZED_ALL_BYTES;
  if (![maxReadRecordBytes, maxReadAllBytes].every((value,index) => Number.isSafeInteger(value) && value >= 1 && value <= (index ? MATERIALIZED_ALL_BYTES : MATERIALIZED_RECORD_BYTES))) throw fail();
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > MAX_RECORD_BYTES) throw fail();
  const config = { ...input, scope: Object.freeze({ ...input.scope }), key: new Uint8Array(input.key), cryptoRuntime: crypto, chunkRuntime: chunks, maxRecordBytes, maxReadRecordBytes, maxReadAllBytes, closed: false, operationGuard: () => {} };
  if (input.createChunkStore) {
    const assertPublication = () => { if (config.closed) throw fail('STRUCTURED_WORKSPACE_LOCKED'); config.operationGuard(); };
    try { config.chunkStore = input.createChunkStore(async (context, seal, source) => {
      assertPublication(); const totalBytes = await chunks.verifyChunkStream(config.key, context, seal, source, async () => {}); assertPublication();
      const clear = await crypto.decryptBytes(config.key, context, seal);
      try { assertPublication(); return { totalBytes, plan: JSON.parse(decoder.decode(clear)).plan }; } finally { clear.fill(0); }
    }, assertPublication); } catch { config.closed = true; config.key.fill(0); throw fail(); }
  }
  return config;
}
function rootContext(scope, revision) { return { ...scope, purpose: 'working-data', recordId: 'workspace', revision }; }
function reference(value, rootRevision, identity) {
  if (!exact(value, ['recordId', 'bytes', 'contentHash', 'sealHash', 'createdRevision']) || typeof value.recordId !== 'string' || !/^object\/[a-f0-9]{64}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.recordId) || !value.recordId.startsWith('object/' + hash(encoder.encode(identity)) + '/') || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_RECORD_BYTES || !['contentHash','sealHash'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) || !Number.isSafeInteger(value.createdRevision) || value.createdRevision < 1 || value.createdRevision > rootRevision) throw fail();
  return Object.freeze({ ...value });
}
const bucketFor = key => hash(encoder.encode(key)).slice(0, 2);
class StructuredWorkspace {
  #config; #revision; #buckets; #shards; #recordCount; #ceiling; #rootVersion; #epoch = 0; #queue = Promise.resolve(); #locked = false;
  constructor(config, revision, buckets, recordCount = 0, ceiling = revision, rootVersion = 2) { this.#config = config; this.#revision = revision; this.#buckets = buckets; this.#shards = new Map(); this.#recordCount = recordCount; this.#ceiling = ceiling; this.#rootVersion = rootVersion; }
  static async create(input, source) {
    const config = options(input); if (typeof input.recoveryWrapperHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.recoveryWrapperHash)) { config.key.fill(0); throw fail(); } config.recoveryWrapperHash = input.recoveryWrapperHash;
    const session = new StructuredWorkspace(config, 0, new Map()), guard = input.assertCurrent || (() => {}); config.operationGuard = guard;
    try {
      if (await config.checkpointStore.read() !== null) throw fail('STRUCTURED_WORKSPACE_STALE');
      const shards = new Map(); let count = 0;
      for await (const change of source) {
        session.#assert(); guard(); const [owned] = capture([change]); const bucket = bucketFor(owned.key), shard = shards.get(bucket) || new Map();
        if (owned.deleted || shard.has(owned.key) || ++count > MAX_RECORDS || shard.size >= MAX_SHARD_RECORDS) throw fail();
        shard.set(owned.key, await session.#storeObject(owned.key, owned.value, 1, config.maxRecordBytes, guard)); shards.set(bucket, shard);
      }
      const buckets = new Map(); for (const [bucket, shard] of shards) { buckets.set(bucket, await session.#storeShard(bucket, shard, 1, guard)); session.#shards.set(bucket, shard); }
      await session.#commitRoot(null, buckets, 1, count, guard); return session;
    } catch (cause) { session.lock(); throw cause; }
  }
  static async open(input) {
    const config = options(input); let clear;
    try {
      const saved = await config.checkpointStore.read(); if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 1 || typeof saved.ciphertext !== 'string' || saved.ciphertext.length > Math.ceil((ROOT_LIMIT + 16) / 3) * 4 + 4096) throw fail();
      clear = await config.cryptoRuntime.decryptBytes(config.key, rootContext(config.scope, saved.revision), saved.ciphertext);
      if (clear.length > ROOT_LIMIT) throw fail(); const root = JSON.parse(decoder.decode(clear));
      if (!exact(root, ['format','version','buckets','recoveryWrapperHash','recordCount', ...(root.version === 2 ? ['objectRevisionCeiling'] : [])]) || root.format !== ROOT_FORMAT || ![1,2].includes(root.version) || (root.version === 2 && (!Number.isSafeInteger(root.objectRevisionCeiling) || root.objectRevisionCeiling < saved.revision)) || !Number.isSafeInteger(root.recordCount) || root.recordCount < 0 || root.recordCount > MAX_RECORDS || typeof root.recoveryWrapperHash !== 'string' || !/^[a-f0-9]{64}$/.test(root.recoveryWrapperHash) || (input.recoveryWrapperHash !== undefined && input.recoveryWrapperHash !== root.recoveryWrapperHash) || !Array.isArray(root.buckets) || root.buckets.length > 256) throw fail();
      config.recoveryWrapperHash = root.recoveryWrapperHash;
      if (root.recordCount < root.buckets.length || root.recordCount > root.buckets.length * MAX_SHARD_RECORDS) throw fail();
      const buckets = new Map(); for (const item of root.buckets) { if (!exact(item, ['bucket','ref']) || typeof item.bucket !== 'string' || !/^[a-f0-9]{2}$/.test(item.bucket) || buckets.has(item.bucket)) throw fail(); buckets.set(item.bucket, reference(item.ref, root.version === 2 ? root.objectRevisionCeiling : saved.revision, 'shard/' + item.bucket)); }
      return new StructuredWorkspace(config, saved.revision, buckets, root.recordCount, root.version === 2 ? root.objectRevisionCeiling : saved.revision, root.version);
    } catch { config.closed = true; config.key.fill(0); throw fail(); } finally { clear?.fill(0); }
  }
  #assert(epoch = this.#epoch, guard = () => {}) { if (this.#locked || epoch !== this.#epoch) throw fail('STRUCTURED_WORKSPACE_LOCKED'); guard(); }
  lock() { this.#config.closed = true; this.#locked = true; this.#epoch++; this.#config.key.fill(0); this.#buckets.clear(); this.#shards.clear(); }
  getRevision() { this.#assert(); return this.#revision; }
  getObjectRevisionCeiling() { this.#assert(); return this.#ceiling; }
  getRecoveryWrapperHash() { this.#assert(); return this.#config.recoveryWrapperHash; }
  async #storeObject(identity, value, revision, maxBytes, guard) {
    const epoch = this.#epoch, { chunkRuntime: c, key: master, scope } = this.#config;
    const measurement = measured(value, maxBytes); this.#assert(epoch, guard);
    const recordId = 'object/' + hash(encoder.encode(identity)) + '/' + randomUUID(), context = { ...scope, purpose: 'working-data', recordId, revision: 1 };
    const generated = await c.createChunkManifest(master, context, measurement.bytes); this.#assert(epoch, guard); const file = { context, plan: generated.plan };
    let index = 0;
    for await (const plain of encoded(value, c.CHUNK_BYTES)) {
      try { this.#assert(epoch, guard); const sealed = await c.sealChunk(master, context, file.plan, index, plain); this.#assert(epoch, guard); await this.#config.chunkStore.stage(file, index, sealed); this.#assert(epoch, guard); index++; }
      finally { plain.fill(0); }
    }
    const seal = await c.finalizeChunkManifest(master, context, file.plan, this.#config.chunkStore.chunks(file)); this.#assert(epoch, guard);
    await this.#config.chunkStore.publish(file, seal, null); this.#assert(epoch, guard);
    return Object.freeze({ recordId, bytes: measurement.bytes, contentHash: measurement.contentHash, sealHash: hash(seal), createdRevision: revision });
  }
  #storeShard(bucket, entries, revision, guard) { return this.#storeObject('shard/' + bucket, { format: 'student-organizer-object-shard', version: 1, bucket, entries: [...entries].sort(([a],[b]) => a.localeCompare(b)).map(([key,ref]) => ({ key, ref })) }, revision, MAX_SHARD_BYTES, guard); }
  #root(buckets, recordCount, ceiling = this.#ceiling, version = this.#rootVersion) { return { format: ROOT_FORMAT, version, ...(version === 2 ? { objectRevisionCeiling:ceiling } : {}), recoveryWrapperHash: this.#config.recoveryWrapperHash, recordCount, buckets: [...buckets].sort(([a],[b]) => a.localeCompare(b)).map(([bucket,ref]) => ({ bucket, ref })) }; }
  async #commitRoot(expected, buckets, nextRevision, recordCount, guard, ceiling = Math.max(this.#ceiling, nextRevision)) {
    const epoch = this.#epoch; this.#assert(epoch, guard);
    const root = this.#root(buckets, recordCount, ceiling, 2);
    measured(root, ROOT_LIMIT); const pieces = []; let size = 0;
    for await (const piece of encoded(root, 256 * 1024)) { pieces.push(new Uint8Array(piece)); size += piece.length; }
    const plain = new Uint8Array(size); let offset = 0; for (const piece of pieces) { plain.set(piece, offset); offset += piece.length; piece.fill(0); }
    try {
      this.#assert(epoch, guard); const ciphertext = await this.#config.cryptoRuntime.encryptBytes(this.#config.key, rootContext(this.#config.scope, nextRevision), plain); this.#assert(epoch, guard);
      try { await this.#config.checkpointStore.commit(expected, { revision: nextRevision, ciphertext }); }
      catch { this.lock(); throw fail('STRUCTURED_WORKSPACE_COMMIT_UNCERTAIN'); }
      this.#assert(epoch, guard); this.#buckets = buckets; this.#revision = nextRevision; this.#recordCount = recordCount; this.#ceiling = ceiling; this.#rootVersion = 2;
    } finally { plain.fill(0); }
  }
  async #streamObject(ref, identity, maxBytes, sink, output) {
    const epoch = this.#epoch; reference(ref, this.#ceiling, identity); if (ref.bytes > maxBytes) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT');
    const descriptor = await this.#config.chunkStore.read('working-data', ref.recordId); this.#assert(epoch);
    if (!descriptor || descriptor.context.revision !== 1 || descriptor.context.recordId !== ref.recordId || descriptor.context.appId !== this.#config.scope.appId || descriptor.context.vaultId !== this.#config.scope.vaultId || descriptor.context.keyVersion !== this.#config.scope.keyVersion || descriptor.plan.totalBytes !== ref.bytes || hash(descriptor.seal) !== ref.sealHash) throw fail();
    if (output) await output.onObject(descriptor); this.#assert(epoch);
    const config = this.#config;
    async function* source() { let index = 0; for await (const ciphertext of config.chunkStore.chunks({ context: descriptor.context, plan: descriptor.plan })) { if (output) await output.onChunk(ciphertext, index); yield ciphertext; index++; } }
    const digest = createHash('sha256'); let size = 0;
    await this.#config.chunkRuntime.verifyChunkStream(this.#config.key, descriptor.context, descriptor.seal, source(), async (bytes,index) => { this.#assert(epoch); digest.update(bytes); size += bytes.length; await sink(bytes,index); this.#assert(epoch); });
    this.#assert(epoch); if (size !== ref.bytes || digest.digest('hex') !== ref.contentHash) throw fail(); return size;
  }
  async #readObject(ref, identity, maxBytes) {
    if (ref.bytes > maxBytes) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT');
    const pieces = []; let size = 0;
    try {
      await this.#streamObject(ref, identity, maxBytes, async bytes => { pieces.push(new Uint8Array(bytes)); size += bytes.length; });
      const clear = new Uint8Array(size); let offset = 0; for (const piece of pieces) { clear.set(piece, offset); offset += piece.length; piece.fill(0); }
      try { return JSON.parse(decoder.decode(clear)); } finally { clear.fill(0); }
    } finally { for (const piece of pieces) piece.fill(0); }
  }
  async #shard(bucket) {
    this.#assert(); if (this.#shards.has(bucket)) return this.#shards.get(bucket);
    const ref = this.#buckets.get(bucket); if (!ref) return new Map();
    const value = await this.#readObject(ref, 'shard/' + bucket, MAX_SHARD_BYTES);
    if (!exact(value, ['format','version','bucket','entries']) || value.format !== 'student-organizer-object-shard' || value.version !== 1 || value.bucket !== bucket || !Array.isArray(value.entries) || value.entries.length > MAX_SHARD_RECORDS) throw fail();
    const entries = new Map(); for (const item of value.entries) { if (!exact(item, ['key','ref']) || entries.has(item.key)) throw fail(); parsedLogical(item.key); if (bucketFor(item.key) !== bucket) throw fail(); entries.set(item.key, reference(item.ref, this.#ceiling, item.key)); }
    this.#shards.set(bucket, entries); return entries;
  }
  commitDelta(expectedRevision, changes, guard = () => {}) {
    let owned; try { if (typeof guard !== 'function') throw fail(); owned = capture(changes); } catch (cause) { return Promise.reject(cause); }
    const enteredEpoch = this.#epoch;
    const action = async () => {
      this.#config.operationGuard = guard; this.#assert(enteredEpoch, guard); if (expectedRevision !== this.#revision) throw fail('STRUCTURED_WORKSPACE_STALE');
      let recordCount = this.#recordCount;
      const buckets = new Map(this.#buckets), changedShards = new Map(), loadedShards = new Map(), revision = this.#revision + 1;
      try {
        if (this.#config.validateDelta) await this.#config.validateDelta(owned.map(item => ({ ...parsedLogical(item.key), ...(item.deleted ? { deleted: true } : { value: structuredClone(item.value) }) })));
        this.#assert(enteredEpoch, guard);
        for (const change of owned) {
          const bucket = bucketFor(change.key); let entries = changedShards.get(bucket);
          if (!entries) { entries = loadedShards.get(bucket); if (!entries) { entries = new Map(await this.#shard(bucket)); loadedShards.set(bucket, entries); } }
          if (change.deleted) { if (entries.delete(change.key)) { recordCount--; changedShards.set(bucket, entries); } continue; }
          const check = measured(change.value, this.#config.maxRecordBytes), prior = entries.get(change.key);
          if (prior && prior.bytes === check.bytes && prior.contentHash === check.contentHash) continue;
          if (!prior && ++recordCount > MAX_RECORDS) throw fail();
          entries.set(change.key, await this.#storeObject(change.key, change.value, revision, this.#config.maxRecordBytes, guard)); changedShards.set(bucket, entries); this.#assert(enteredEpoch, guard);
          if (entries.size > MAX_SHARD_RECORDS) throw fail();
        }
        for (const [bucket, entries] of changedShards) { if (!entries.size) buckets.delete(bucket); else buckets.set(bucket, await this.#storeShard(bucket, entries, revision, guard)); }
        await this.#commitRoot(this.#revision, buckets, revision, recordCount, guard); for (const [bucket, entries] of changedShards) this.#shards.set(bucket, entries);
        return { revision: this.#revision };
      } catch (cause) { this.lock(); throw cause; }
    };
    const pending = this.#queue.then(action); this.#queue = pending.catch(() => {}); return pending;
  }
  static async importAuthenticatedCheckpoint(input, sourceCheckpoint, guard = input.assertCurrent || (() => {})) {
    const config = options(input);
    if (typeof input.recoveryWrapperHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.recoveryWrapperHash)) { config.key.fill(0); throw fail(); }
    config.recoveryWrapperHash = input.recoveryWrapperHash; const session = new StructuredWorkspace(config,0,new Map());
    try { await session.#adopt(null,sourceCheckpoint,undefined,guard,true); return session; } catch (cause) { session.lock(); throw cause; }
  }
  restoreCheckpoint(expectedRevision, historicalCheckpoint, safetyRecord, guard = () => {}) { return this.#adopt(expectedRevision,historicalCheckpoint,safetyRecord,guard,false); }
  importAuthenticatedCheckpoint(expectedRevision, sourceCheckpoint, safetyRecord, guard = () => {}) { return this.#adopt(expectedRevision,sourceCheckpoint,safetyRecord,guard,true); }
  #adopt(expectedRevision, sourceCheckpoint, safetyRecord, guard, imported) {
    let historical, safetyKey;
    try {
      if (typeof guard !== 'function') throw fail(); historical = structuredClone(sourceCheckpoint);
      if (expectedRevision === null) { if (!imported || this.#revision !== 0 || safetyRecord !== undefined) throw fail(); }
      else {
        if (!exact(safetyRecord,['namespace','key']) || safetyRecord.namespace !== 'metadata' || !/^internal-safety\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(safetyRecord.key)) throw fail();
        safetyKey = logical(safetyRecord);
      }
    } catch (cause) { return Promise.reject(cause); }
    const enteredEpoch = this.#epoch;
    const action = async () => {
      let previous;
      this.#config.operationGuard = guard; this.#assert(enteredEpoch,guard); if ((expectedRevision ?? 0) !== this.#revision) throw fail('STRUCTURED_WORKSPACE_STALE');
      try {
        const current = await this.#config.checkpointStore.read(); this.#assert(enteredEpoch,guard);
        if (expectedRevision === null) { if (current !== null) throw fail('STRUCTURED_WORKSPACE_STALE'); }
        else {
          if (!current || current.revision !== this.#revision || typeof current.ciphertext !== 'string') throw fail('STRUCTURED_WORKSPACE_STALE');
          const clear = await this.#config.cryptoRuntime.decryptBytes(this.#config.key,rootContext(this.#config.scope,current.revision),current.ciphertext);
          try { this.#assert(enteredEpoch,guard); if (clear.length > ROOT_LIMIT || measured(JSON.parse(decoder.decode(clear)),ROOT_LIMIT).contentHash !== measured(this.#root(this.#buckets,this.#recordCount),ROOT_LIMIT).contentHash) throw fail(); } finally { clear.fill(0); }
        }
        previous = await StructuredWorkspace.open({ ...this.#config,checkpointStore:{read:async()=>historical},recoveryWrapperHash:this.#config.recoveryWrapperHash }); this.#assert(enteredEpoch,guard);
        if (!imported && (previous.#revision > this.#ceiling || previous.#ceiling > this.#ceiling)) throw fail();
        const revision = this.#revision + 1, ceiling = Math.max(previous.#ceiling,this.#ceiling,revision), buckets = new Map(previous.#buckets); let count = previous.#recordCount, entries, bucket;
        if (safetyKey) {
          bucket = bucketFor(safetyKey); entries = new Map(await previous.#shard(bucket)); this.#assert(enteredEpoch,guard);
          if (entries.has(safetyKey) || entries.size >= MAX_SHARD_RECORDS || count >= MAX_RECORDS) throw fail();
          const value = {id:parsedLogical(safetyKey).key.slice('internal-safety/'.length),createdAt:new Date().toISOString(),revision:current.revision,ciphertext:current.ciphertext};
          entries.set(safetyKey,await this.#storeObject(safetyKey,value,revision,this.#config.maxRecordBytes,guard)); this.#assert(enteredEpoch,guard);
          buckets.set(bucket,await this.#storeShard(bucket,entries,revision,guard)); count++;
        }
        await this.#commitRoot(expectedRevision,buckets,revision,count,guard,ceiling);
        this.#shards.clear(); if (entries) this.#shards.set(bucket,entries); return {revision:this.#revision};
      } catch (cause) { this.lock(); throw cause; } finally { previous?.lock(); }
    };
    const pending = this.#queue.then(action); this.#queue = pending.catch(()=>{}); return pending;
  }
  visitArchiveGraph(checkpoint, callbacks, guard = () => {}) {
    let selected;
    try { selected = structuredClone(checkpoint); if (!callbacks || !['onObject','onChunk','onRoot'].every(name => typeof callbacks[name] === 'function') || typeof guard !== 'function') throw fail(); } catch (cause) { return Promise.reject(cause); }
    return this.#scheduleRead(async () => {
      const epoch = this.#epoch, assert = () => this.#assert(epoch, guard), seenRoots = new Set(), seenObjects = new Map(), controls = new Map(); let budget = 0, roots = 0, objects = 0;
      const pending = [{ checkpoint: selected }];
      if (selected.revision !== this.#revision) throw fail();
      while (pending.length) {
        assert(); const item = pending.pop(); let saved = item.checkpoint, opened;
        if (!saved) {
          const value = await this.#readObject(item.ref, item.identity, MATERIALIZED_RECORD_BYTES); assert();
          if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision >= item.parentCeiling || typeof value.ciphertext !== 'string') throw fail();
          saved = { revision: value.revision, ciphertext: value.ciphertext };
        }
        const rootHash = hash(saved.ciphertext); if (seenRoots.has(rootHash)) continue; seenRoots.add(rootHash); budget += 128; if (budget > 64 * 1024 * 1024) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT');
        try {
          opened = await StructuredWorkspace.open({ ...this.#config, checkpointStore: { read: async () => saved }, recoveryWrapperHash: this.#config.recoveryWrapperHash }); assert();
          if (opened.#ceiling > this.#ceiling) throw fail();
          if (roots === 0 && measured(opened.#root(opened.#buckets, opened.#recordCount), ROOT_LIMIT).contentHash !== measured(this.#root(this.#buckets, this.#recordCount), ROOT_LIMIT).contentHash) throw fail();
          await callbacks.onRoot(opened, Object.freeze({ ...saved })); assert(); roots++;
          const output = {
            onObject: async descriptor => { assert(); await callbacks.onObject(descriptor); assert(); },
            onChunk: async (ciphertext,index) => { assert(); await callbacks.onChunk(ciphertext,index); assert(); }
          };
          async function emitted(ref, identity) {
            const signature = JSON.stringify([ref.bytes,ref.contentHash,ref.sealHash]);
            if (seenObjects.has(ref.recordId)) { if (seenObjects.get(ref.recordId) !== signature) throw fail(); return false; }
            seenObjects.set(ref.recordId, signature); budget += ref.recordId.length + signature.length + 128; if (budget > 64 * 1024 * 1024) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT');
            await opened.#streamObject(ref, identity, MAX_RECORD_BYTES, async () => {}, output); assert(); objects++; return true;
          }
          let count = 0;
          for (const [bucket,ref] of opened.#buckets) {
            await emitted(ref, 'shard/' + bucket);
            for (const [key,recordRef] of await opened.#shard(bucket)) {
              count++; const fresh = await emitted(recordRef, key), descriptor = parsedLogical(key);
              if (descriptor.namespace === 'metadata' && /^internal-(safety|backup)\//.test(descriptor.key)) {
                if (fresh) {
                  const value = await opened.#readObject(recordRef, key, MATERIALIZED_RECORD_BYTES); assert();
                  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision >= opened.#ceiling || typeof value.ciphertext !== 'string') throw fail();
                  controls.set(recordRef.recordId, value.revision); pending.push({ ref: recordRef, identity: key, parentCeiling: opened.#ceiling });
                } else if (controls.get(recordRef.recordId) >= opened.#ceiling) throw fail();
              }
            }
          }
          if (count !== opened.#recordCount) throw fail();
        } finally { opened?.lock(); }
      }
      assert(); return { roots, objects };
    });
  }
  #scheduleRead(action) {
    const epoch = this.#epoch;
    const pending = this.#queue.then(async () => { this.#assert(epoch); try { return await action(); } catch (cause) { this.lock(); throw cause; } });
    this.#queue = pending.catch(() => {}); return pending;
  }
  async #readRecord(key) { const ref = (await this.#shard(bucketFor(key))).get(key); return ref ? await this.#readObject(ref, key, Math.min(this.#config.maxRecordBytes, this.#config.maxReadRecordBytes)) : undefined; }
  readRecord(record) { let key; try { key = logical(record); } catch (cause) { return Promise.reject(cause); } return this.#scheduleRead(() => this.#readRecord(key)); }
  async #list() {
    const result = []; let metadataBytes = 0;
    for (const bucket of this.#buckets.keys()) for (const key of (await this.#shard(bucket)).keys()) { metadataBytes += encoder.encode(key).length + 128; if (metadataBytes > 64 * 1024 * 1024) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT'); result.push(parsedLogical(key)); if (result.length > MAX_RECORDS) throw fail(); }
    if (result.length !== this.#recordCount) throw fail();
    return result;
  }
  list() { return this.#scheduleRead(() => this.#list()); }
  readRecordStream(record, sink) { let key; try { key = logical(record); if (typeof sink !== 'function') throw fail(); } catch (cause) { return Promise.reject(cause); } return this.#scheduleRead(async () => { const ref = (await this.#shard(bucketFor(key))).get(key); return ref ? this.#streamObject(ref, key, this.#config.maxRecordBytes, sink) : undefined; }); }
  async #readSelection(keys) {
    let allocation = 0; const recordLimit = Math.min(this.#config.maxRecordBytes,this.#config.maxReadRecordBytes);
    // Authenticate every selected reference and budget the complete selection before any body read.
    for (const key of keys) {
      const ref = (await this.#shard(bucketFor(key))).get(key); if (!ref) throw fail();
      allocation += ref.bytes + encoder.encode(key).length + 128;
      if (ref.bytes > recordLimit || allocation > this.#config.maxReadAllBytes) throw fail('STRUCTURED_WORKSPACE_READ_LIMIT');
    }
    const result = []; for (const key of keys) result.push({...parsedLogical(key),value:await this.#readRecord(key)}); return result;
  }
  readSelected(records) {
    let keys;
    try {
      if (!Array.isArray(records) || records.length > MAX_RECORDS) throw fail(); const seen = new Set(); let metadataBytes = 0;
      keys = records.map(record => {
        if (!exact(record,['namespace',...(record?.table === undefined ? [] : ['table']),'key'])) throw fail();
        const key = logical(record); metadataBytes += encoder.encode(key).length + 128;
        if (seen.has(key) || metadataBytes > 64 * 1024 * 1024) throw fail(); seen.add(key); return key;
      });
    } catch (cause) { return Promise.reject(cause); }
    return this.#scheduleRead(()=>this.#readSelection(keys));
  }
  readAll() { return this.#scheduleRead(async()=>this.#readSelection((await this.#list()).map(logical))); }

}
module.exports = { StructuredWorkspace, structuredRecordKey: logical, measureRecord: value => measured(value, MAX_RECORD_BYTES), ROOT_LIMIT, MAX_RECORD_BYTES, MATERIALIZED_RECORD_BYTES, MATERIALIZED_ALL_BYTES };
