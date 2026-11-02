import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { generateMasterKey, parseEnvelope, decryptBytes, type EncryptionContext } from '../../shared/encryption';
import { CHUNK_BYTES, createChunkManifest, sealChunk, finalizeChunkManifest, verifyChunkStream } from '../../shared/encryption/chunks';
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
});
