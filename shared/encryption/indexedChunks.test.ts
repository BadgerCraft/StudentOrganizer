import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptBytes, generateMasterKey, EncryptionError, type EncryptionContext } from './index';
import { CHUNK_BYTES, MAX_STREAM_BYTES, createChunkManifest, sealChunk, finalizeChunkManifest, openSealedChunkIndex, describeSealedChunkIndex, closeSealedChunkIndex, openIndexedChunk, type SealedChunkIndex } from './chunks';
const scope: EncryptionContext = {appId:'servetrack',vaultId:'synthetic-indexed-vault',purpose:'attachment',recordId:'recording/fictional',revision:3,keyVersion:1};
// These cases intentionally use real WebCrypto. Intel CI exceeded Vitest's
// default 5 s while processing 32,768 commitments or queued key/scope operations.
// Keep all payloads/assertions and a bounded allowance; this is not a latency SLA.
const INDEXED_NATIVE_CRYPTO_TIMEOUT = 30000;
async function* sequence(values:string[]) {for(const value of values)yield value;}
async function fixture() {
  const master=generateMasterKey(),draft=await createChunkManifest(master,scope,5),ciphertext=await sealChunk(master,scope,draft.plan,0,new Uint8Array([1,2,3,4,5])),seal=await finalizeChunkManifest(master,scope,draft.plan,sequence([ciphertext]));
  return {master,draft,ciphertext,seal,index:await openSealedChunkIndex(master,scope,seal)};
}
afterEach(()=>vi.restoreAllMocks());
describe('final-seal-bound indexed chunks',()=>{
  it('authenticates actual first/last chunks and returns only an opaque proof and immutable copied metadata',async()=>{
    const master=generateMasterKey(),draft=await createChunkManifest(master,scope,CHUNK_BYTES+3),first=new Uint8Array(CHUNK_BYTES).fill(7),last=new Uint8Array([3,2,1]);
    const ciphertexts=[await sealChunk(master,scope,draft.plan,0,first),await sealChunk(master,scope,draft.plan,1,last)],seal=await finalizeChunkManifest(master,scope,draft.plan,sequence(ciphertexts)),index=await openSealedChunkIndex(master,scope,seal);
    expect(Reflect.ownKeys(index)).toEqual([]);expect(Object.isFrozen(index)).toBe(true);expect(JSON.stringify(index)).toBe('{}');
    const description=describeSealedChunkIndex(index);expect(description).toEqual({context:scope,plan:draft.plan});expect(Object.isFrozen(description.context)).toBe(true);expect(Object.isFrozen(description.plan)).toBe(true);expect(describeSealedChunkIndex(index)).not.toBe(description);
    expect(await openIndexedChunk(master,scope,index,1,ciphertexts[1])).toEqual(last);expect(await openIndexedChunk(master,scope,index,0,ciphertexts[0])).toEqual(first);
    await expect(openIndexedChunk(master,scope,index,0,ciphertexts[1])).rejects.toThrow(EncryptionError);await expect(openIndexedChunk(master,scope,index,1,ciphertexts[0])).rejects.toThrow(EncryptionError);closeSealedChunkIndex(index);
  },90000);
  it('rejects initial manifests, forged/serialized/copied/mutated proofs and altered description metadata',async()=>{
    const f=await fixture();await expect(openSealedChunkIndex(f.master,scope,f.draft.manifest)).rejects.toThrow(EncryptionError);
    for(const forged of [{},Object.freeze({}),{...f.index},structuredClone(f.index),{context:scope,plan:f.draft.plan},new Proxy(f.index,{})]) {
      await expect(openIndexedChunk(f.master,scope,forged as SealedChunkIndex,0,f.ciphertext)).rejects.toThrow(EncryptionError);expect(()=>describeSealedChunkIndex(forged as SealedChunkIndex)).toThrow(EncryptionError);
    }
    expect(()=>Object.assign(f.index,{verified:true})).toThrow();const description=describeSealedChunkIndex(f.index);expect(()=>Object.assign(description.plan,{fileId:crypto.randomUUID()})).toThrow();expect(()=>Object.assign(description.context,{revision:4})).toThrow();
    expect(await openIndexedChunk(f.master,scope,f.index,0,f.ciphertext)).toEqual(new Uint8Array([1,2,3,4,5]));
  });
  it('binds every scope field, master, position, file and exact committed ciphertext generation',async()=>{
    const f=await fixture();
    for(const changed of [{appId:'other'},{vaultId:'other'},{purpose:'backup'},{recordId:'other'},{revision:4},{keyVersion:2}]) {
      const wrong={...scope,...changed} as EncryptionContext;await expect(openSealedChunkIndex(f.master,wrong,f.seal)).rejects.toThrow(EncryptionError);await expect(openIndexedChunk(f.master,wrong,f.index,0,f.ciphertext)).rejects.toThrow(EncryptionError);
    }
    await expect(openSealedChunkIndex(generateMasterKey(),scope,f.seal)).rejects.toThrow(EncryptionError);await expect(openIndexedChunk(generateMasterKey(),scope,f.index,0,f.ciphertext)).rejects.toThrow(EncryptionError);
    for(const position of [-1,1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])await expect(openIndexedChunk(f.master,scope,f.index,position,f.ciphertext)).rejects.toThrow(EncryptionError);
    const alternate=await sealChunk(f.master,scope,f.draft.plan,0,new Uint8Array([1,2,3,4,5])),other=await createChunkManifest(f.master,scope,5),otherCipher=await sealChunk(f.master,scope,other.plan,0,new Uint8Array([1,2,3,4,5]));
    await expect(openIndexedChunk(f.master,scope,f.index,0,alternate)).rejects.toThrow(EncryptionError);await expect(openIndexedChunk(f.master,scope,f.index,0,otherCipher)).rejects.toThrow(EncryptionError);
    const decrypt=vi.spyOn(crypto.subtle,'decrypt');await expect(openIndexedChunk(f.master,scope,f.index,0,alternate)).rejects.toThrow(EncryptionError);expect(decrypt).not.toHaveBeenCalled();
  });
  it('checks committed ciphertext before use and rejects an authenticated wrong plaintext length',async()=>{
    const f=await fixture(),actualContext=JSON.parse(f.ciphertext).context,wrong=await encryptBytes(f.master,actualContext,new Uint8Array([1,2,3,4]));
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(wrong))),v=>v.toString(16).padStart(2,'0')).join('');
    const seal=await encryptBytes(f.master,scope,new TextEncoder().encode(JSON.stringify({format:'teacher-vault-sealed-chunks',version:1,plan:f.draft.plan,hashes:[digest]}))),index=await openSealedChunkIndex(f.master,scope,seal);
    await expect(openIndexedChunk(f.master,scope,index,0,wrong)).rejects.toThrow(EncryptionError);await expect(openIndexedChunk(f.master,scope,f.index,0,'x'.repeat(5000))).rejects.toThrow(EncryptionError);
  });
  it('supports empty and128GiB plans without allocating the file and validates final metadata bounds',async()=>{
    const master=generateMasterKey(),empty=await createChunkManifest(master,scope,0),emptySeal=await finalizeChunkManifest(master,scope,empty.plan,sequence([])),index=await openSealedChunkIndex(master,scope,emptySeal);expect(describeSealedChunkIndex(index).plan.chunkCount).toBe(0);await expect(openIndexedChunk(master,scope,index,0,'')).rejects.toThrow(EncryptionError);
    const draft=await createChunkManifest(master,scope,MAX_STREAM_BYTES),hashes=Array(draft.plan.chunkCount).fill('0'.repeat(64)),seal=await encryptBytes(master,scope,new TextEncoder().encode(JSON.stringify({format:'teacher-vault-sealed-chunks',version:1,plan:draft.plan,hashes}))),max=await openSealedChunkIndex(master,scope,seal);
    expect(describeSealedChunkIndex(max).plan.chunkCount).toBe(32768);await expect(openIndexedChunk(master,scope,max,32768,'')).rejects.toThrow(EncryptionError);
    for(const changed of [{plan:{...draft.plan,totalBytes:MAX_STREAM_BYTES+1}},{hashes:[]},{hashes:['not-a-digest']},{version:2}]) {
      const bad=await encryptBytes(master,scope,new TextEncoder().encode(JSON.stringify({format:'teacher-vault-sealed-chunks',version:1,plan:draft.plan,hashes,...changed})));await expect(openSealedChunkIndex(master,scope,bad)).rejects.toThrow(EncryptionError);
    }
  },INDEXED_NATIVE_CRYPTO_TIMEOUT);
  it('owns key/scope inputs across awaits and retains no master key in the index',async()=>{
    const f=await fixture(),saved=new Uint8Array(f.master),expected={...scope},opening=openSealedChunkIndex(f.master,expected,f.seal);f.master.fill(0);expected.recordId='changed';const index=await opening;
    await expect(openIndexedChunk(f.master,scope,index,0,f.ciphertext)).rejects.toThrow(EncryptionError);const reading=openIndexedChunk(saved,scope,index,0,f.ciphertext);saved.fill(0);expect(await reading).toEqual(new Uint8Array([1,2,3,4,5]));
    closeSealedChunkIndex(index);closeSealedChunkIndex(index);expect(()=>describeSealedChunkIndex(index)).toThrow(EncryptionError);await expect(openIndexedChunk(new Uint8Array(32),scope,index,0,f.ciphertext)).rejects.toThrow(EncryptionError);
  },INDEXED_NATIVE_CRYPTO_TIMEOUT);
  it('revokes an in-flight hash seek and wipes plaintext if closed during AEAD decryption',async()=>{
    const f=await fixture(),digest=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(...args)=>{entered();await gate;return digest(...args);});
    const reading=openIndexedChunk(f.master,scope,f.index,0,f.ciphertext);await started;closeSealedChunkIndex(f.index);release();await expect(reading).rejects.toThrow(EncryptionError);vi.restoreAllMocks();
    const index=await openSealedChunkIndex(f.master,scope,f.seal),decrypt=crypto.subtle.decrypt.bind(crypto.subtle);let bytes:ArrayBuffer|undefined,releaseDecrypt!:()=>void,enteredDecrypt!:()=>void;const decryptGate=new Promise<void>(resolve=>releaseDecrypt=resolve),decryptStarted=new Promise<void>(resolve=>enteredDecrypt=resolve);
    vi.spyOn(crypto.subtle,'decrypt').mockImplementationOnce(async(...args)=>{bytes=await decrypt(...args);enteredDecrypt();await decryptGate;return bytes;});
    const pending=openIndexedChunk(f.master,scope,index,0,f.ciphertext);await decryptStarted;closeSealedChunkIndex(index);releaseDecrypt();await expect(pending).rejects.toThrow(EncryptionError);expect(new Uint8Array(bytes!).every(byte=>byte===0)).toBe(true);
  });
});
