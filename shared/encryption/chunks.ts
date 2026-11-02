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

/** Opaque in-memory proof of an authenticated final seal; never serialize or persist it. */
declare const sealedChunkIndexBrand: unique symbol;
export interface SealedChunkIndex { readonly [sealedChunkIndexBrand]: true }
export interface SealedChunkDescription { readonly context: Readonly<EncryptionContext>; readonly plan: Readonly<ChunkPlan> }
interface IndexedSealState { context: Readonly<EncryptionContext>; plan: Readonly<ChunkPlan>; hashes: readonly string[]; closed: boolean }
const sealedIndexes = new WeakMap<object, IndexedSealState>();
function indexedState(index: SealedChunkIndex): IndexedSealState {
  if (!index || typeof index !== 'object') fail();
  const state = sealedIndexes.get(index); if (!state || state.closed) fail(); return state;
}
function copyMaster(master: Uint8Array): Uint8Array { if (!(master instanceof Uint8Array) || master.length !== 32) fail(); return new Uint8Array(master); }
function matchesIndexedContext(expected: EncryptionContext, actual: Readonly<EncryptionContext>): void {
  if (!expected || typeof expected !== 'object' || Object.keys(expected).sort().join('|') !== 'appId|keyVersion|purpose|recordId|revision|vaultId' || (Object.keys(actual) as (keyof EncryptionContext)[]).some(key => expected[key] !== actual[key])) fail();
}
/**
 * Authenticate the existing final seal once. Draft manifests are not accepted.
 * The proof retains only frozen scope/plan/commitment metadata, never a master key.
 */
export async function openSealedChunkIndex(master: Uint8Array, expected: EncryptionContext, finalSeal: string): Promise<SealedChunkIndex> {
  const scope = { ...expected }, owned = copyMaster(master);
  try {
    const sealed = await openSeal(owned, scope, finalSeal);
    // openSeal/decryptBytes already validated every expected context field.
    const context = Object.freeze({ appId: scope.appId, vaultId: scope.vaultId, purpose: scope.purpose, recordId: scope.recordId, revision: scope.revision, keyVersion: scope.keyVersion });
    const index = Object.freeze(Object.create(null)) as SealedChunkIndex;
    sealedIndexes.set(index, { context, plan: Object.freeze({ ...sealed.plan }), hashes: Object.freeze([...sealed.hashes]), closed: false });
    return index;
  } catch { return fail(); } finally { owned.fill(0); }
}
/** Fresh immutable metadata for a bounded ciphertext lookup; this description is not a proof. */
export function describeSealedChunkIndex(index: SealedChunkIndex): SealedChunkDescription {
  const state = indexedState(index); return Object.freeze({ context: Object.freeze({ ...state.context }), plan: Object.freeze({ ...state.plan }) });
}
/** Idempotent for a known proof. Closing also revokes pending indexed reads before plaintext return. */
export function closeSealedChunkIndex(index: SealedChunkIndex): void {
  if (!index || typeof index !== 'object') fail(); const state = sealedIndexes.get(index); if (!state) fail();
  state.closed = true; state.hashes = [];
}
/**
 * Verify one exact final-seal ciphertext generation before returning at most 4 MiB.
 * This does not verify availability/integrity of other chunks or authorize publication.
 * The caller must close the proof when its native key/context lease ends.
 */
export async function openIndexedChunk(master: Uint8Array, expected: EncryptionContext, index: SealedChunkIndex, position: number, ciphertext: string): Promise<Uint8Array> {
  const state = indexedState(index), scope = { ...expected }; matchesIndexedContext(scope, state.context);
  const expectedBytes = size(state.plan, position), expectedHash = state.hashes[position], owned = copyMaster(master);
  let data: Uint8Array | undefined;
  try {
    if (typeof ciphertext !== 'string' || ciphertext.length > Math.ceil((expectedBytes + 16) / 3) * 4 + 4096 || await digest(ciphertext) !== expectedHash) fail();
    if (indexedState(index) !== state) fail();
    data = await openChunk(owned, state.context, state.plan, position, ciphertext);
    if (indexedState(index) !== state) fail();
    const verified = data; data = undefined; return verified;
  } catch { return fail(); } finally { data?.fill(0); owned.fill(0); }
}
