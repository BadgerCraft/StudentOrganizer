import { decryptBytes, encryptBytes, EncryptionError, type EncryptionContext } from './index';

/** Chunk boundaries are part of the format, not an arbitrary transport framing choice. */
export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_STREAM_BYTES = 128 * 1024 * 1024 * 1024;
export interface ChunkPlan { format: 'teacher-vault-chunks'; version: 1; fileId: string; chunkBytes: typeof CHUNK_BYTES; totalBytes: number; chunkCount: number }
function fail(): never { throw new EncryptionError(); }
function validate(value: unknown): ChunkPlan {
  const v = value as ChunkPlan;
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join('|') !== 'chunkBytes|chunkCount|fileId|format|totalBytes|version' || v.format !== 'teacher-vault-chunks' || v.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.fileId) || v.chunkBytes !== CHUNK_BYTES || !Number.isSafeInteger(v.totalBytes) || v.totalBytes < 0 || v.totalBytes > MAX_STREAM_BYTES || v.chunkCount !== Math.ceil(v.totalBytes / CHUNK_BYTES)) fail();
  return { format: v.format, version: 1, fileId: v.fileId, chunkBytes: CHUNK_BYTES, totalBytes: v.totalBytes, chunkCount: v.chunkCount };
}
function size(plan: ChunkPlan, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= plan.chunkCount) fail();
  return Math.min(CHUNK_BYTES, plan.totalBytes - index * CHUNK_BYTES);
}
async function chunkContext(scope: EncryptionContext, plan: ChunkPlan, index: number): Promise<EncryptionContext> {
  const encoded = new TextEncoder().encode(JSON.stringify(['teacher-vault-chunk-v1', scope.appId, scope.vaultId, scope.purpose, scope.recordId, scope.revision, scope.keyVersion, plan, index]));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), b => b.toString(16).padStart(2, '0')).join('');
  return { ...scope, recordId: 'chunk/' + hash };
}
/** Persist manifest and chunks in an encrypted staging area; publish only after complete seal. */
export async function createChunkManifest(master: Uint8Array, scope: EncryptionContext, totalBytes: number): Promise<{ manifest: string; plan: ChunkPlan }> {
  const plan = validate({ format: 'teacher-vault-chunks', version: 1, fileId: crypto.randomUUID(), chunkBytes: CHUNK_BYTES, totalBytes, chunkCount: Math.ceil(totalBytes / CHUNK_BYTES) });
  return { manifest: await encryptBytes(master, scope, new TextEncoder().encode(JSON.stringify(plan))), plan };
}
export async function openChunkManifest(master: Uint8Array, scope: EncryptionContext, manifest: string): Promise<ChunkPlan> {
  try {
    if (typeof manifest !== 'string' || manifest.length > 16384) fail();
    return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decryptBytes(master, scope, manifest))));
  } catch { return fail(); }
}
export async function sealChunk(master: Uint8Array, scope: EncryptionContext, value: ChunkPlan, index: number, data: Uint8Array): Promise<string> {
  const plan = validate(value); if (data.length !== size(plan, index)) fail();
  return encryptBytes(master, await chunkContext(scope, plan, index), data);
}
export async function openChunk(master: Uint8Array, scope: EncryptionContext, value: ChunkPlan, index: number, ciphertext: string): Promise<Uint8Array> {
  const plan = validate(value), expected = size(plan, index);
  if (typeof ciphertext !== 'string' || ciphertext.length > Math.ceil((expected + 16) / 3) * 4 + 4096) fail();
  const data = await decryptBytes(master, await chunkContext(scope, plan, index), ciphertext);
  if (data.length !== expected) { data.fill(0); fail(); } return data;
}
async function digest(ciphertext: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ciphertext))), b => b.toString(16).padStart(2, '0')).join('');
}
/** Final content commitment: never publish the draft manifest as a complete artifact. */
export async function finalizeChunkManifest(master: Uint8Array, scope: EncryptionContext, value: ChunkPlan, source: AsyncIterable<string>): Promise<string> {
  const plan = validate(value), hashes: string[] = []; let index = 0;
  for await (const ciphertext of source) {
    if (index >= plan.chunkCount) fail();
    const verified = await openChunk(master, scope, plan, index, ciphertext); verified.fill(0);
    hashes.push(await digest(ciphertext)); index++;
  }
  if (index !== plan.chunkCount) fail();
  return encryptBytes(master, scope, new TextEncoder().encode(JSON.stringify({ format: 'teacher-vault-sealed-chunks', version: 1, plan, hashes })));
}
async function openSeal(master: Uint8Array, scope: EncryptionContext, manifest: string): Promise<{ plan: ChunkPlan; hashes: string[] }> {
  try {
    if (typeof manifest !== 'string' || manifest.length > 4 * 1024 * 1024) fail();
    const sealed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await decryptBytes(master, scope, manifest)));
    if (!sealed || Object.keys(sealed).sort().join('|') !== 'format|hashes|plan|version' || sealed.format !== 'teacher-vault-sealed-chunks' || sealed.version !== 1) fail();
    const plan = validate(sealed.plan);
    if (!Array.isArray(sealed.hashes) || sealed.hashes.length !== plan.chunkCount || !sealed.hashes.every((hash: unknown) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) fail();
    return { plan, hashes: sealed.hashes };
  } catch { return fail(); }
}
/**
 * Sequential full-file verifier. Each sink call receives authenticated bytes, but the
 * complete artifact is trusted ONLY when this function resolves. Never publish early
 * or stage these bytes in plaintext files. Abort/discard staging on rejection.
 */
export async function verifyChunkStream(master: Uint8Array, scope: EncryptionContext, manifest: string, source: AsyncIterable<string>, sink: (chunk: Uint8Array, index: number) => Promise<void>): Promise<number> {
  const { plan, hashes } = await openSeal(master, scope, manifest); let index = 0;
  for await (const encrypted of source) {
    if (index >= plan.chunkCount) fail();
    if (typeof encrypted !== 'string' || encrypted.length > Math.ceil((size(plan, index) + 16) / 3) * 4 + 4096 || await digest(encrypted) !== hashes[index]) fail();
    const data = await openChunk(master, scope, plan, index, encrypted);
    try { await sink(data, index); } finally { data.fill(0); }
    index++;
  }
  if (index !== plan.chunkCount) fail(); return plan.totalBytes;
}
