import { describe, expect, it } from 'vitest';
import { generateMasterKey, EncryptionError, type EncryptionContext } from './index';
import { CHUNK_BYTES, MAX_STREAM_BYTES, createChunkManifest, openChunkManifest, sealChunk, openChunk, finalizeChunkManifest, verifyChunkStream } from './chunks';
const scope: EncryptionContext = { appId: 'servetrack', vaultId: 'synthetic-vault', purpose: 'attachment', recordId: 'recording/fixture', revision: 1, keyVersion: 1 };
async function* sequence(items: string[]) { for (const item of items) yield item; }
describe('bounded authenticated chunk stream', () => {
  it('binds manifest, position, length and file identity, rejecting reorder, duplicate, truncation and cross-file mix', async () => {
    const master = generateMasterKey(), a = await createChunkManifest(master, scope, CHUNK_BYTES + 3), b = await createChunkManifest(master, scope, CHUNK_BYTES + 3);
    const first = new Uint8Array(CHUNK_BYTES).fill(7), last = new Uint8Array([1,2,3]);
    const chunks = [await sealChunk(master, scope, a.plan, 0, first), await sealChunk(master, scope, a.plan, 1, last)];
    const finalManifest = await finalizeChunkManifest(master, scope, a.plan, sequence(chunks));
    const replacement = await sealChunk(master, scope, a.plan, 1, new Uint8Array([9,9,9]));
    const other = await sealChunk(master, scope, b.plan, 1, last);
    const received: number[] = []; const sink = async (data: Uint8Array, index: number) => { received.push(data.length); expect(data[0]).toBe(index ? 1 : 7); };
    expect(await verifyChunkStream(master, scope, finalManifest, sequence(chunks), sink)).toBe(CHUNK_BYTES + 3);
    expect(received).toEqual([CHUNK_BYTES,3]);
    for (const bad of [[chunks[1],chunks[0]], [chunks[0],chunks[0]], [chunks[0]], [...chunks,chunks[1]], [chunks[0],other], [chunks[0],replacement]]) {
      await expect(verifyChunkStream(master, scope, finalManifest, sequence(bad), async()=>{})).rejects.toThrow(EncryptionError);
    }
    await expect(openChunk(master, { ...scope, revision: 2 }, a.plan, 0, chunks[0])).rejects.toThrow(EncryptionError);
    await expect(openChunk(master, scope, { ...a.plan, totalBytes: CHUNK_BYTES + 2 }, 1, chunks[1])).rejects.toThrow(EncryptionError);
    await expect(sealChunk(master, scope, a.plan, 1, new Uint8Array(4))).rejects.toThrow(EncryptionError);
    expect(await openChunkManifest(master, scope, a.manifest)).toEqual(a.plan);
    await expect(verifyChunkStream(master,scope,a.manifest,sequence(chunks),async()=>{})).rejects.toThrow(EncryptionError);
    await expect(finalizeChunkManifest(master,scope,a.plan,sequence([chunks[0]]))).rejects.toThrow(EncryptionError);
  }, 30000);
  it('supports bounded plans for actual20GiB/32GiB consumer limits without allocating entire files', async () => {
    const master = generateMasterKey();
    for (const totalBytes of [0, 20*1024**3, 100*1024**3, MAX_STREAM_BYTES]) {
      const { manifest, plan } = await createChunkManifest(master, scope, totalBytes);
      expect((await openChunkManifest(master, scope, manifest)).totalBytes).toBe(totalBytes);
      expect(plan.chunkCount).toBe(Math.ceil(totalBytes/CHUNK_BYTES));
      if (totalBytes===0) expect(await verifyChunkStream(master,scope,await finalizeChunkManifest(master,scope,plan,sequence([])),sequence([]),async()=>{})).toBe(0);
    }
    for (const totalBytes of [-1, 1.5, MAX_STREAM_BYTES+1, NaN]) await expect(createChunkManifest(master,scope,totalBytes)).rejects.toThrow(EncryptionError);
  });
});
