// Native-only transport framing. Every encrypted item retains the reviewed AEAD/chunk v1 format.
const { createHash, randomUUID } = require('node:crypto');
const { StructuredWorkspace } = require('./structuredWorkspace.cjs');
const FORMAT = 'student-organizer-encrypted-archive';
const MAX_FRAME_BYTES = 32 * 1024 * 1024, MAX_ARCHIVE_BYTES = 16 * 1024 ** 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => Object.assign(Error('The complete encrypted archive was not verified. Keep the current workspace and choose a complete verified archive.'), { code: 'ENCRYPTION_ARCHIVE_INVALID' });
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
function limit(input) { const value = input ?? MAX_ARCHIVE_BYTES; if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ARCHIVE_BYTES) throw fail(); return value; }
function runtime(input) { return input || require('./generated/encryption/shared/encryption/index.js'); }
function header(value, expectedScope, expectedPurpose = 'backup', expectedHead) {
  if (!exact(value, ['type','format','version','archiveId','scope','purpose','createdAt','root','recoveryWrapper','sourceHead']) || (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) || value.type !== 'header' || value.format !== FORMAT || value.version !== 1 || !UUID.test(value.archiveId) || !exact(value.scope, ['appId','vaultId','keyVersion']) || ![value.scope.appId,value.scope.vaultId].every(v => typeof v === 'string' && ID.test(v)) || !Number.isSafeInteger(value.scope.keyVersion) || value.scope.keyVersion < 1 || !['backup','transfer'].includes(value.purpose) || value.purpose !== expectedPurpose || !exact(value.root, ['revision','ciphertext']) || !Number.isSafeInteger(value.root.revision) || value.root.revision < 1 || typeof value.root.ciphertext !== 'string' || Buffer.byteLength(value.root.ciphertext) > 24 * 1024 * 1024 || typeof value.recoveryWrapper !== 'string' || Buffer.byteLength(value.recoveryWrapper) > 16384 || !exact(value.sourceHead, ['revision','hash']) || value.sourceHead.revision !== value.root.revision || value.sourceHead.hash !== hash(value.root.ciphertext)) throw fail();
  if (expectedScope && (!exact(expectedScope,['appId','vaultId','keyVersion']) || Object.keys(expectedScope).some(key => expectedScope[key] !== value.scope[key]))) throw fail();
  if (expectedHead && (!exact(expectedHead,['revision','hash']) || expectedHead.revision !== value.sourceHead.revision || expectedHead.hash !== value.sourceHead.hash)) throw fail();
  return Object.freeze({ ...value, scope:Object.freeze({...value.scope}), root:Object.freeze({...value.root}), sourceHead:Object.freeze({...value.sourceHead}) });
}
const context = h => ({ ...h.scope, purpose: h.purpose, recordId: 'archive/' + h.archiveId, revision: h.root.revision });
function wrapper(api, h) {
  const actual = api.parseEnvelope(h.recoveryWrapper).context, expected = { ...h.scope, purpose: 'recovery-key', recordId: 'master-key', revision: 0 };
  if (Object.keys(expected).some(key => actual[key] !== expected[key])) throw fail();
}
async function* frames(source, maxBytes, assertCurrent) {
  let parts = [], size = 0, total = 0;
  for await (const bytes of source) {
    assertCurrent(); if (!(bytes instanceof Uint8Array) || bytes.length > 1024 * 1024 || (total += bytes.length) > maxBytes) throw fail();
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset), end = newline < 0 ? bytes.length : newline + 1, piece = bytes.subarray(offset,end);
      size += piece.length; if (size > MAX_FRAME_BYTES) throw fail(); parts.push(Buffer.from(piece)); offset = end;
      if (newline >= 0) {
        const raw = Buffer.concat(parts, size); parts = []; size = 0;
        const text = decoder.decode(raw.subarray(0,-1)); let value; try { value = JSON.parse(text); } catch { throw fail(); }
        if (JSON.stringify(value) !== text) throw fail(); yield { value, raw }; assertCurrent();
      }
    }
  }
  assertCurrent(); if (size) throw fail();
}
async function exportWorkspaceArchive(input) {
  const api = runtime(input.cryptoRuntime), guard = input.assertCurrent, maxBytes = limit(input.maxArchiveBytes);
  if (!input.workspace || typeof input.workspace.visitArchiveGraph !== 'function' || typeof guard !== 'function' || typeof input.write !== 'function' || typeof input.verifyRoot !== 'function' || !(input.key instanceof Uint8Array) || input.key.length !== 32) throw fail();
  const h = header({ type:'header', format:FORMAT, version:1, archiveId:randomUUID(), scope:{...input.scope}, purpose:input.purpose || 'backup', createdAt:new Date().toISOString(), root:structuredClone(input.root), recoveryWrapper:input.recoveryWrapper, sourceHead:structuredClone(input.sourceHead) }, input.scope, input.purpose || 'backup');
  const key = new Uint8Array(input.key);
  let framesCount = 0, bytes = 0, active = false; const digest = createHash('sha256');
  async function write(value, sealed = false) {
    guard(); const raw = Buffer.from(JSON.stringify(value) + '\n'); bytes += raw.length; if (raw.length > MAX_FRAME_BYTES || bytes > maxBytes) throw fail();
    if (!sealed) { digest.update(raw); framesCount++; } await input.write(raw); guard();
  }
  try {
    wrapper(api,h); guard(); if (input.workspace.getRevision() !== h.root.revision || input.workspace.getRecoveryWrapperHash() !== hash(h.recoveryWrapper)) throw fail(); await write(h);
    const graph = await input.workspace.visitArchiveGraph(h.root, {
      onRoot: async (opened, checkpoint) => { guard(); await input.verifyRoot(opened, checkpoint); guard(); },
      onObject: async descriptor => { if (active) await write({type:'object-end'}); await write({type:'object',...descriptor}); active = true; },
      onChunk: async (ciphertext,index) => write({type:'chunk',index,ciphertext})
    },guard);
    if (active) await write({type:'object-end'});
    const metadata = { format:FORMAT, version:1, archiveId:h.archiveId, headerHash:hash(JSON.stringify(h)), streamHash:digest.digest('hex'), frames:framesCount, objects:graph.objects, roots:graph.roots, sourceHead:h.sourceHead, recoveryWrapperHash:hash(h.recoveryWrapper) };
    const plain = encoder.encode(JSON.stringify(metadata)); let seal;
    try { seal = await api.encryptBytes(key,context(h),plain); guard(); } finally { plain.fill(0); }
    await write({type:'footer',seal},true); return { archiveId:h.archiveId, scope:h.scope, root:h.root, sourceHead:h.sourceHead, bytes, objects:graph.objects, roots:graph.roots };
  } catch { throw fail(); } finally { key.fill(0); }
}
// Exactly one ciphertext is in flight. Shared verification authenticates the final-seal
// hash and AEAD before its plaintext sink acknowledges staging that ciphertext.
function verifiedWriter(chunks,key,file,seal,store,guard) {
  let pending = null, current = null, waiter = null, ended = false, failure = null;
  const reject = error => {
    failure = error; ended = true; pending?.reject(error); current?.reject(error); waiter?.reject(error); pending = current = waiter = null;
  };
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (failure) return Promise.reject(failure);
      if (pending) { current = pending; pending = null; return Promise.resolve({value:current.ciphertext,done:false}); }
      if (ended) return Promise.resolve({done:true});
      return new Promise((resolve,reject) => { waiter = {resolve,reject}; });
    }
  };
  const completion = chunks.verifyChunkStream(key,file.context,seal,source,async(_plain,index) => {
    guard(); if (!current || current.index !== index || failure) throw fail();
    await store.stage(file,index,current.ciphertext); guard();
    const accepted = current; current = null; accepted.resolve();
  }).then(value => ({ok:true,value}),error => { reject(error); return {ok:false,error}; });
  return {
    feed(ciphertext,index) {
      if (failure || ended || current || pending) return Promise.reject(failure || fail());
      return new Promise((resolve,reject) => {
        const entry = {ciphertext,index,resolve,reject};
        if (waiter) { const waiting = waiter; waiter = null; current = entry; waiting.resolve({value:ciphertext,done:false}); } else pending = entry;
      });
    },
    async finish() {
      if (pending || current) throw fail(); ended = true;
      if (waiter) { const waiting = waiter; waiter = null; waiting.resolve({done:true}); }
      const result = await completion; if (!result.ok) throw result.error; return result.value;
    },
    async cancel() { reject(fail()); await completion; }
  };
}
async function importWorkspaceArchive(input) {
  const api = runtime(input.cryptoRuntime), chunks = input.chunkRuntime || require('./generated/encryption/shared/encryption/chunks.js'), guard = input.assertCurrent, maxBytes = limit(input.maxArchiveBytes);
  if (typeof guard !== 'function' || typeof input.getKey !== 'function' || typeof input.createChunkStore !== 'function' || typeof input.verifyRoot !== 'function') throw fail();
  const digest = createHash('sha256'), imported = new Map(); let h, key, store, active, framesCount = 0, metadataBudget = 0, footer, opened;
  try {
    for await (const {value,raw} of frames(input.read,maxBytes,guard)) {
      guard(); if (footer) throw fail();
      if (!h) {
        h = header(value,input.scope,input.purpose || 'backup',input.expectedSourceHead); wrapper(api,h);
        const received = await input.getKey(structuredClone(h));
        try { guard(); if (!(received instanceof Uint8Array) || received.length !== 32) throw fail(); key = new Uint8Array(received); } finally { received?.fill?.(0); }
        store = input.createChunkStore(async (c,seal,source) => {
          guard(); const totalBytes = await chunks.verifyChunkStream(key,c,seal,source,async () => { guard(); }); guard(); const clear = await api.decryptBytes(key,c,seal);
          try { guard(); return {totalBytes,plan:JSON.parse(decoder.decode(clear)).plan}; } finally { clear.fill(0); }
        },guard);
      } else if (value?.type === 'object') {
        if (active || !exact(value,['type','context','plan','seal']) || imported.has(value.context?.recordId) || value.context?.purpose !== 'working-data' || value.context?.revision !== 1 || Object.keys(h.scope).some(k => value.context?.[k] !== h.scope[k])) throw fail();
        // The store validates all context/plan fields and exact AEAD chunk bindings before staging/publication.
        if (!Number.isSafeInteger(value.plan?.chunkCount) || value.plan.chunkCount < 0 || value.plan.chunkCount > 32768) throw fail();
        const file = {context:value.context,plan:value.plan};
        active = {file,seal:value.seal,index:0,writer:verifiedWriter(chunks,key,file,value.seal,store,guard)};
      } else if (value?.type === 'chunk') {
        if (!active || !exact(value,['type','index','ciphertext']) || value.index !== active.index || typeof value.ciphertext !== 'string') throw fail();
        await active.writer.feed(value.ciphertext,value.index); guard(); active.index++;
      } else if (value?.type === 'object-end') {
        if (!active || !exact(value,['type']) || active.index !== active.file.plan.chunkCount) throw fail();
        await active.writer.finish(); guard();
        const prior = await store.read('working-data',active.file.context.recordId); guard();
        if (prior) {
          if (JSON.stringify(prior) !== JSON.stringify({...active.file,seal:active.seal})) throw fail();
          await chunks.verifyChunkStream(key,active.file.context,active.seal,store.chunks(active.file),async()=>{guard();}); guard();
        } else { await store.publish(active.file,active.seal,null); guard(); }
        metadataBudget += active.file.context.recordId.length + 192; if (metadataBudget > 64 * 1024 * 1024) throw fail();
        imported.set(active.file.context.recordId,hash(JSON.stringify({...active.file,seal:active.seal}))); active = null;
      } else if (value?.type === 'footer') {
        if (active || !exact(value,['type','seal']) || typeof value.seal !== 'string' || Buffer.byteLength(value.seal) > 16384) throw fail(); footer = value; continue;
      } else throw fail();
      digest.update(raw); framesCount++;
    }
    if (!h || !footer || active) throw fail();
    const clear = await api.decryptBytes(key,context(h),footer.seal); let metadata;
    try { guard(); if (clear.length > 8192) throw fail(); metadata = JSON.parse(decoder.decode(clear)); } finally { clear.fill(0); }
    if (!exact(metadata,['format','version','archiveId','headerHash','streamHash','frames','objects','roots','sourceHead','recoveryWrapperHash']) || metadata.format !== FORMAT || metadata.version !== 1 || metadata.archiveId !== h.archiveId || metadata.headerHash !== hash(JSON.stringify(h)) || metadata.streamHash !== digest.digest('hex') || metadata.frames !== framesCount || metadata.objects !== imported.size || !Number.isSafeInteger(metadata.roots) || metadata.roots < 1 || JSON.stringify(metadata.sourceHead) !== JSON.stringify(h.sourceHead) || metadata.recoveryWrapperHash !== hash(h.recoveryWrapper)) throw fail();
    opened = await StructuredWorkspace.open({ scope:h.scope,key,checkpointStore:{read:async()=>h.root},chunkStore:store,cryptoRuntime:api,chunkRuntime:chunks,recoveryWrapperHash:hash(h.recoveryWrapper) }); guard();
    const encountered = new Set();
    const graph = await opened.visitArchiveGraph(h.root,{
      onRoot: async (root,checkpoint) => { guard(); await input.verifyRoot(root,checkpoint); guard(); },
      onObject: async descriptor => { if (imported.get(descriptor.context.recordId) !== hash(JSON.stringify(descriptor))) throw fail(); encountered.add(descriptor.context.recordId); },
      onChunk: async()=>{guard();}
    },guard);
    if (graph.objects !== imported.size || encountered.size !== imported.size || graph.roots !== metadata.roots) throw fail(); guard();
    const workspace = opened; opened = null; return Object.freeze({root:h.root,scope:h.scope,recoveryWrapper:h.recoveryWrapper,sourceHead:h.sourceHead,archiveId:h.archiveId,createdAt:h.createdAt,workspace});
  } catch { throw fail(); } finally { await active?.writer?.cancel(); opened?.lock(); key?.fill(0); }
}
module.exports = { exportWorkspaceArchive,importWorkspaceArchive,MAX_FRAME_BYTES,MAX_ARCHIVE_BYTES };
