import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { generateMasterKey, parseEnvelope, decryptBytes, type EncryptionContext } from '../../shared/encryption';
import { CHUNK_BYTES, createChunkManifest, sealChunk, finalizeChunkManifest, verifyChunkStream, openSealedChunkIndex, describeSealedChunkIndex, openIndexedChunk, closeSealedChunkIndex } from '../../shared/encryption/chunks';
const require = createRequire(import.meta.url), { createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs'), { DatabaseSync } = require('node:sqlite');
const directories: string[] = [];
const scope = { appId: 'student-organizer', vaultId: 'synthetic-chunk-vault', keyVersion: 1 }, master = generateMasterKey();
const verifyManifest = async (context: EncryptionContext, seal: string, source: AsyncIterable<string>) => { const totalBytes = await verifyChunkStream(master, context, seal, source, async () => {}); const plain = await decryptBytes(master, context, seal); try { return { totalBytes, plan: JSON.parse(new TextDecoder().decode(plain)).plan }; } finally { plain.fill(0); } };
async function* sequence(values: string[]) { yield* values; }
async function fixture(options: Record<string, unknown> = {}) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-chunks-')); directories.push(directory); return { directory, store: createCipherChunkStore({ directory, scope, parseEnvelope, verifyManifest, ...options }) }; }
async function artifact(data: Uint8Array, revision = 1, recordId = 'fictional-file') {
  const context: EncryptionContext = { ...scope, purpose: 'backup', recordId, revision };
  const draft = await createChunkManifest(master, context, data.length), file = { context, plan: draft.plan }, chunks: string[] = [];
  for (let index = 0; index < draft.plan.chunkCount; index++) chunks.push(await sealChunk(master, context, draft.plan, index, data.subarray(index * CHUNK_BYTES, Math.min(data.length, (index + 1) * CHUNK_BYTES))));
  return { file, chunks, draft: draft.manifest, seal: await finalizeChunkManifest(master, context, draft.plan, sequence(chunks)) };
}
async function stage(store: any, a: Awaited<ReturnType<typeof artifact>>) { for (const [index, ciphertext] of a.chunks.entries()) await store.stage(a.file, index, ciphertext); }
function trackedDatabase(trace: { sql: string; args: unknown[] }[], afterGet?: (sql: string, args: unknown[]) => void) {
  return function Database(filename: string, options: object) {
    const db = new DatabaseSync(filename, options);
    return new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const stmt = target.prepare(sql);
        return new Proxy(stmt, { get(query, method) {
          if (method === 'get') return (...args: unknown[]) => { const result = query.get(...args); trace.push({ sql, args }); afterGet?.(sql,args); return result; };
          const value = Reflect.get(query,method,query); return typeof value === 'function' ? value.bind(query) : value;
        } });
      };
      const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
}
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
describe('ciphertext-only immutable SQLite chunk staging', () => {
  it('publishes only a fully authenticated stream, reopens and stores no plaintext canary', async () => {
    const { directory, store } = await fixture(); const data = new Uint8Array(CHUNK_BYTES + 3).fill(191); data.set(new TextEncoder().encode('FICTIONAL_UNENCRYPTED_MEDIA_CANARY'));
    const a = await artifact(data); await stage(store, a); await store.publish(a.file, a.seal, null);
    const reopened = createCipherChunkStore({ directory, scope, parseEnvelope, verifyManifest }); expect(await reopened.read('backup', 'fictional-file')).toEqual({ ...a.file, seal: a.seal });
    const received: Uint8Array[] = []; expect(await verifyChunkStream(master, a.file.context, a.seal, reopened.chunks(a.file), async bytes => { received.push(new Uint8Array(bytes)); })).toBe(data.length);
    expect(Buffer.concat(received.map(value => Buffer.from(value))).equals(Buffer.from(data))).toBe(true);
    for (const filename of await fs.readdir(directory)) expect((await fs.readFile(path.join(directory, filename))).includes(Buffer.from('FICTIONAL_UNENCRYPTED_MEDIA_CANARY'))).toBe(false);
  }, 30000);
  it('keeps the prior manifest when a later generation is incomplete or unauthenticated', async () => {
    const { store } = await fixture(); const first = await artifact(new Uint8Array([1, 2, 3])); await stage(store, first); await store.publish(first.file, first.seal, null);
    const next = await artifact(new Uint8Array(CHUNK_BYTES + 3).fill(12), 2); await store.stage(next.file, 0, next.chunks[0]);
    await expect(store.publish(next.file, next.seal, 1)).rejects.toThrow(); expect((await store.read('backup', 'fictional-file')).seal).toBe(first.seal);
    await store.stage(next.file, 1, next.chunks[1]); await expect(store.publish(next.file, next.draft, 1)).rejects.toThrow(); expect((await store.read('backup', 'fictional-file')).seal).toBe(first.seal);
  }, 30000);
  it('makes repeated identical staging idempotent but never overwrites a chunk generation', async () => {
    const { directory, store } = await fixture(); const a = await artifact(new Uint8Array([7, 8])); await stage(store, a); await stage(store, a);
    const replacement = await sealChunk(master, a.file.context, a.file.plan, 0, new Uint8Array([9, 9])); await expect(store.stage(a.file, 0, replacement)).rejects.toThrow();
    const db = new DatabaseSync(path.join(directory, 'chunks.sqlite')); expect(db.prepare('SELECT count(*) AS n FROM chunks').get().n).toBe(1); db.close();
    await store.publish(a.file, a.seal, null); await expect(store.publish(a.file, a.seal, null)).rejects.toMatchObject({ code: 'ENCRYPTED_CHUNKS_STALE' });
    const wrongScope = createCipherChunkStore({ directory, scope: { ...scope, appId: 'other-app' }, parseEnvelope, verifyManifest }); await expect(wrongScope.read('backup', 'fictional-file')).rejects.toThrow();
  });
  it('rejects a valid but different chunk encrypted for the same plan and position', async () => {
    const { store } = await fixture(); const a = await artifact(new Uint8Array([1, 2]));
    await store.stage(a.file, 0, await sealChunk(master, a.file.context, a.file.plan, 0, new Uint8Array([9, 9])));
    await expect(store.publish(a.file, a.seal, null)).rejects.toThrow(); expect(await store.read('backup', 'fictional-file')).toBeNull();
  });
  it('rejects tampered stored chunk bytes before verification or new publication', async () => {
    const { directory, store } = await fixture(); const a = await artifact(new Uint8Array([3, 4])); await stage(store, a);
    const db = new DatabaseSync(path.join(directory, 'chunks.sqlite')); db.prepare('UPDATE chunks SET ciphertext=?').run(Buffer.from('corrupt')); db.close();
    await expect(store.publish(a.file, a.seal, null)).rejects.toThrow(); await expect(async () => { for await (const ignored of store.chunks(a.file)) void ignored; }).rejects.toThrow();
    expect(await store.read('backup', 'fictional-file')).toBeNull();
  });
  it('rejects a stored file descriptor whose plan UUID differs from its primary identity', async () => {
    const { directory, store } = await fixture(); const a = await artifact(new Uint8Array()); await store.publish(a.file, a.seal, null);
    const db = new DatabaseSync(path.join(directory, 'chunks.sqlite')); db.prepare('UPDATE files SET plan=? WHERE file_id=?').run(JSON.stringify({ ...a.file.plan, fileId: crypto.randomUUID() }), a.file.plan.fileId); db.close();
    await expect(store.read('backup', 'fictional-file')).rejects.toThrow();
  });
  it('rolls back a failed first stage and preserves a committed chunk after lost acknowledgment', async () => {
    const a = await artifact(new Uint8Array([5])); const failed = await fixture({ hooks: { beforeCommit() { throw Error('synthetic failure'); } } });
    await expect(failed.store.stage(a.file, 0, a.chunks[0])).rejects.toThrow();
    const clean = createCipherChunkStore({ directory: failed.directory, scope, parseEnvelope, verifyManifest }); await clean.stage(a.file, 0, a.chunks[0]); await clean.publish(a.file, a.seal, null);
    const lost = await fixture({ hooks: { afterCommit() { throw Error('synthetic lost reply'); } } }); await expect(lost.store.stage(a.file, 0, a.chunks[0])).rejects.toMatchObject({ code: 'ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN' });
    const reopened = createCipherChunkStore({ directory: lost.directory, scope, parseEnvelope, verifyManifest }); await reopened.stage(a.file, 0, a.chunks[0]); await reopened.publish(a.file, a.seal, null);
  });
  it('reports a lost manifest acknowledgment without replaying or replacing the committed head', async () => {
    const { directory, store } = await fixture(); const a = await artifact(new Uint8Array([8, 9])); await stage(store, a);
    const lost = createCipherChunkStore({ directory, scope, parseEnvelope, verifyManifest, hooks: { afterCommit() { throw Error('synthetic manifest reply loss'); } } });
    await expect(lost.publish(a.file, a.seal, null)).rejects.toMatchObject({ code: 'ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN' });
    expect((await store.read('backup', 'fictional-file')).seal).toBe(a.seal);
    await expect(store.publish(a.file, a.seal, null)).rejects.toMatchObject({ code: 'ENCRYPTED_CHUNKS_STALE' });
  });
  it('allows only one independent publisher to win a shared expected revision', async () => {
    const { directory, store } = await fixture(); const first = await artifact(new Uint8Array([1])); await stage(store, first); await store.publish(first.file, first.seal, null);
    const left = await artifact(new Uint8Array([2]), 2), right = await artifact(new Uint8Array([3]), 2); await stage(store, left); await stage(store, right);
    const other = createCipherChunkStore({ directory, scope, parseEnvelope, verifyManifest });
    const results = await Promise.allSettled([store.publish(left.file, left.seal, 1), other.publish(right.file, right.seal, 1)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect([left.seal, right.seal]).toContain((await store.read('backup', 'fictional-file')).seal);
  });
  it('allows a main-owned context guard to cancel publication after asynchronous verification', async () => {
    const { directory, store } = await fixture(); const first = await artifact(new Uint8Array([1])); await stage(store, first); await store.publish(first.file, first.seal, null);
    const next = await artifact(new Uint8Array([2]), 2); await stage(store, next); let revoked = false;
    const guarded = createCipherChunkStore({ directory, scope, parseEnvelope, verifyManifest: async (...args: Parameters<typeof verifyManifest>) => { const bytes = await verifyManifest(...args); revoked = true; return bytes; }, hooks: { beforeCommit() { if (revoked) throw Error('synthetic actor changed'); } } });
    await expect(guarded.publish(next.file, next.seal, 1)).rejects.toThrow(); expect((await store.read('backup', 'fictional-file')).seal).toBe(first.seal);
  });
  it('rejects wrong context, positions, stale manifests, unsafe paths and untrusted verifier setup', async () => {
    const { directory, store } = await fixture(); const a = await artifact(new Uint8Array([5]));
    await expect(store.stage({ ...a.file, context: { ...a.file.context, appId: 'different-app' } }, 0, a.chunks[0])).rejects.toThrow();
    await expect(store.stage(a.file, 1, a.chunks[0])).rejects.toThrow();
    expect(() => createCipherChunkStore({ directory, scope, parseEnvelope })).toThrow();
    const unsafe = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-chunks-unsafe-')); directories.push(unsafe); await fs.mkdir(path.join(unsafe, 'store'), { mode: 0o700 });
    if (process.platform !== 'win32') { await fs.symlink(path.join(unsafe, 'store'), path.join(unsafe, 'link')); const symlink = createCipherChunkStore({ directory: path.join(unsafe, 'link'), scope, parseEnvelope, verifyManifest }); await expect(symlink.stage(a.file, 0, a.chunks[0])).rejects.toThrow(); }
  });
  it('supports empty sealed streams and plans 100 GiB without allocating that file', async () => {
    const { store } = await fixture(); const a = await artifact(new Uint8Array()); const different = { context: a.file.context, plan: { ...a.file.plan, fileId: crypto.randomUUID() } }; await expect(store.publish(different, a.seal, null)).rejects.toThrow(); await store.publish(a.file, a.seal, null); expect((await store.read('backup', 'fictional-file')).plan.chunkCount).toBe(0);
    const context: EncryptionContext = { ...scope, purpose: 'transfer', recordId: 'large-transfer', revision: 1 };
    const large = await createChunkManifest(master, context, 100 * 1024 ** 3); expect(large.plan.chunkCount).toBe(25600);
    // No committed chunks exist: publication must fail before invoking any supplied seal verifier.
    await expect(store.publish({ context, plan: large.plan }, large.manifest, null)).rejects.toThrow();
  });
  it('reads exactly one bounded ciphertext row using the authenticated immutable final-seal descriptor', async () => {
    const trace: {sql:string;args:unknown[]}[] = [], f = await fixture({ DatabaseSync: trackedDatabase(trace) }), data = new Uint8Array(CHUNK_BYTES+3).fill(17), a = await artifact(data);
    await stage(f.store,a); await f.store.publish(a.file,a.seal,null); const index = await openSealedChunkIndex(master,a.file.context,a.seal), descriptor = describeSealedChunkIndex(index); trace.length = 0;
    const ciphertext = await f.store.readChunkAt(descriptor,1); expect(ciphertext).toBe(a.chunks[1]); expect(await openIndexedChunk(master,a.file.context,index,1,ciphertext)).toEqual(data.subarray(CHUNK_BYTES));
    const blobs = trace.filter(item=>item.sql.startsWith('SELECT ciphertext FROM chunks')); expect(blobs).toHaveLength(1); expect(blobs[0].args).toEqual([a.file.plan.fileId,1]);
    for (const invalid of [-1,2,0.5,NaN,Infinity,'1']) await expect(f.store.readChunkAt(descriptor,invalid)).rejects.toThrow();
    await expect(f.store.readChunkAt({ ...descriptor, context:{...descriptor.context,appId:'other-app'} },1)).rejects.toThrow(); closeSealedChunkIndex(index);
  },90000);
  it('keeps length preflight and ciphertext fetch in one snapshot during concurrent row growth', async () => {
    const f = await fixture(), a = await artifact(new Uint8Array([7])); await stage(f.store,a); await f.store.publish(a.file,a.seal,null);
    const trace: {sql:string;args:unknown[]}[] = []; let changed = false;
    const reader = createCipherChunkStore({ directory:f.directory,scope,parseEnvelope,verifyManifest,DatabaseSync:trackedDatabase(trace,(sql,args)=>{
      if (changed || !sql.includes('length(ciphertext)')) return; changed = true;
      const db = new DatabaseSync(path.join(f.directory,'chunks.sqlite'));
      try { db.prepare('UPDATE chunks SET ciphertext=zeroblob(?) WHERE file_id=? AND idx=?').run(Math.ceil((CHUNK_BYTES+16)/3)*4+4097,args[0],args[1]); } finally { db.close(); }
    }) });
    expect(await reader.readChunkAt(a.file,0)).toBe(a.chunks[0]); expect(changed).toBe(true); trace.length=0;
    await expect(reader.readChunkAt(a.file,0)).rejects.toThrow(); expect(trace.some(item=>item.sql.startsWith('SELECT ciphertext FROM chunks'))).toBe(false);
  });
  it('does not inspect unrelated chunks, and requires shared indexed authentication after transport validation', async () => {
    const f = await fixture(), data = new Uint8Array(CHUNK_BYTES+2).fill(5), a = await artifact(data); await stage(f.store,a); await f.store.publish(a.file,a.seal,null);
    const index = await openSealedChunkIndex(master,a.file.context,a.seal), db = new DatabaseSync(path.join(f.directory,'chunks.sqlite'));
    try { db.prepare('UPDATE chunks SET ciphertext=? WHERE file_id=? AND idx=0').run(Buffer.from('unrelated corrupt row'),a.file.plan.fileId); } finally { db.close(); }
    const last = await f.store.readChunkAt(describeSealedChunkIndex(index),1); expect(await openIndexedChunk(master,a.file.context,index,1,last)).toEqual(data.subarray(CHUNK_BYTES));
    const alternate = await sealChunk(master,a.file.context,a.file.plan,1,new Uint8Array([9,9])), changed = new DatabaseSync(path.join(f.directory,'chunks.sqlite'));
    try { changed.prepare('UPDATE chunks SET ciphertext=?,digest=? WHERE file_id=? AND idx=1').run(Buffer.from(alternate),createHash('sha256').update(alternate).digest('hex'),a.file.plan.fileId); } finally { changed.close(); }
    expect(await f.store.readChunkAt(a.file,1)).toBe(alternate); await expect(openIndexedChunk(master,a.file.context,index,1,alternate)).rejects.toThrow(); closeSealedChunkIndex(index);
  },90000);
});
