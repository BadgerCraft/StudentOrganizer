import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as cryptoRuntime from '../../shared/encryption';
import * as chunkRuntime from '../../shared/encryption/chunks';
const require = createRequire(import.meta.url), { StructuredWorkspace } = require('../../electron/structuredWorkspace.cjs'), { createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs');
const { exportWorkspaceArchive,importWorkspaceArchive } = require('../../electron/structuredWorkspaceArchive.cjs');
const directories: string[] = []; const hash = (v: string) => createHash('sha256').update(v).digest('hex');
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir,{recursive:true,force:true}); });
async function directory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'fictional-archive-')); directories.push(dir); return dir; }
async function fixture() {
  const dir = await directory(), key = cryptoRuntime.generateMasterKey(), scope = { appId:'student-organizer',vaultId:'synthetic-archive',keyVersion:1 };
  const code = await cryptoRuntime.generateRecoveryCode(), recoveryWrapper = await cryptoRuntime.wrapMasterKey(key,code,scope.appId,scope.vaultId);
  let root: any = null;
  const createStore = (target: string) => (verifyManifest: unknown, beforeCommit: () => void) => createCipherChunkStore({directory:target,scope,parseEnvelope:cryptoRuntime.parseEnvelope,verifyManifest,hooks:{beforeCommit}});
  const options = {scope,key,cryptoRuntime,chunkRuntime,recoveryWrapperHash:hash(recoveryWrapper),createChunkStore:createStore(dir),checkpointStore:{read:async()=>structuredClone(root),commit:async(expected: number|null,next: any)=>{if((root?.revision??null)!==expected)throw Error('stale');root=structuredClone(next);}}};
  const session = await StructuredWorkspace.create(options,[{namespace:'primary',table:'students',key:'student-fictional',value:{id:'student-fictional',text:'old fictional work'}},{namespace:'recovery',table:'backup-content',key:'legacy',value:'Exact legacy dated history '.repeat(8000)}]);
  const initial = structuredClone(root);
  const backupId=crypto.randomUUID();
  await session.commitDelta(1,[{namespace:'primary',table:'students',key:'student-fictional',value:{id:'student-fictional',text:'new fictional work'}},{namespace:'metadata',key:'internal-backup/'+backupId,value:{id:backupId,createdAt:new Date().toISOString(),reason:'manual',primaryHash:'a'.repeat(64),revision:initial.revision,ciphertext:initial.ciphertext}}]);
  await session.restoreCheckpoint(2,initial,{namespace:'metadata',key:'internal-safety/'+crypto.randomUUID()});
  const verifyRoot = async (opened: any) => { const records = await opened.list(); expect(records.length).toBeGreaterThan(0); for (const record of records) expect(await opened.readRecord(record)).not.toBeUndefined(); };
  const exportOptions = {workspace:session,root:structuredClone(root),scope,recoveryWrapper,key,sourceHead:{revision:root.revision,hash:hash(root.ciphertext)},assertCurrent:()=>{},verifyRoot,cryptoRuntime};
  const target = async(extra: any={}) => ({read:undefined,scope,purpose:'backup',getKey:async()=>new Uint8Array(key),createChunkStore:createStore(await directory()),assertCurrent:()=>{},verifyRoot,cryptoRuntime,chunkRuntime,...extra});
  return {key,scope,session,root:()=>root,options,code,recoveryWrapper,exportOptions,target};
}
async function exported(f: any,extra: any={}) { const wire: Buffer[]=[]; const metadata=await exportWorkspaceArchive({...f.exportOptions,write:async(bytes: Uint8Array)=>{wire.push(Buffer.from(bytes));},...extra});return{wire,metadata}; }
async function* source(wire: Uint8Array[]) { for(const part of wire) for(let at=0;at<part.length;at+=64123)yield part.subarray(at,at+64123); }
function parse(wire: Buffer[]) { return Buffer.concat(wire).toString().trimEnd().split('\n').map(line=>JSON.parse(line)); }
function encode(values: any[]) { return values.map(value=>Buffer.from(JSON.stringify(value)+'\n')); }
describe('complete streamed immutable workspace archive',()=>{
  it('roundtrips complete dated/safety root graphs and exact history strings without current-root publication',async()=>{
    const f=await fixture(), out=await exported(f); expect(out.metadata.roots).toBe(3);expect(out.metadata.objects).toBeGreaterThan(5);
    expect(Buffer.concat(out.wire).toString()).not.toContain('old fictional work');
    let returnedKey: Uint8Array|undefined;const target=await f.target({getKey:async(header: any)=>{returnedKey=await cryptoRuntime.recoverMasterKey(f.code,header.recoveryWrapper,header.scope.appId,header.scope.vaultId,header.scope.keyVersion);return returnedKey;}});
    const imported=await importWorkspaceArchive({...target,read:source(out.wire)});expect(returnedKey!.every(v=>v===0)).toBe(true);
    expect(imported.root).toEqual(f.root());expect(Object.isFrozen(imported.root)).toBe(true);expect(Object.isFrozen(imported.sourceHead)).toBe(true);expect(imported.workspace.getRevision()).toBe(3);
    expect(await imported.workspace.readRecord({namespace:'recovery',table:'backup-content',key:'legacy'})).toBe('Exact legacy dated history '.repeat(8000));
    const root2: any[]=[];await imported.workspace.visitArchiveGraph(imported.root,{onRoot:async(opened: any)=>root2.push((await opened.readRecord({namespace:'primary',table:'students',key:'student-fictional'})).text),onObject:async()=>{},onChunk:async()=>{}});
    expect(root2).toContain('new fictional work');expect(root2).toContain('old fictional work');imported.workspace.lock();expect(f.session.getRevision()).toBe(3);
  },30000);
  it('adopts a higher source clock at fresh/local +1 and retains source refs across edits and restores',async()=>{
    const f=await fixture();let selected: any;
    for(let revision=3;revision<8;revision++) {
      const changes:any[]=[{namespace:'primary',table:'students',key:'student-fictional',value:{id:'student-fictional',text:'source revision '+(revision+1)}}];
      if(revision===6) {const id=crypto.randomUUID();changes.push({namespace:'metadata',key:'internal-backup/'+id,value:{id,createdAt:new Date().toISOString(),reason:'manual',primaryHash:'a'.repeat(64),revision:selected.revision,ciphertext:selected.ciphertext}});}
      await f.session.commitDelta(revision,changes);if(revision===5)selected=structuredClone(f.root());
    }
    const out=await exported(f,{root:f.root(),sourceHead:{revision:8,hash:hash(f.root().ciphertext)}}), target=await f.target();
    const verified=await importWorkspaceArchive({...target,read:source(out.wire)});let receiverRoot: any=null;const revisions:number[]=[];
    const receiverOptions={scope:f.scope,key:f.key,recoveryWrapperHash:hash(f.recoveryWrapper),cryptoRuntime,chunkRuntime,createChunkStore:target.createChunkStore,checkpointStore:{read:async()=>structuredClone(receiverRoot),commit:async(expected:number|null,next:any)=>{expect(expected).toBe(receiverRoot?.revision??null);expect(next.revision).toBe((receiverRoot?.revision??0)+1);revisions.push(next.revision);receiverRoot=structuredClone(next);}}};
    const receiver=await StructuredWorkspace.importAuthenticatedCheckpoint(receiverOptions,verified.root);
    expect(receiver.getRevision()).toBe(1);expect(receiver.getObjectRevisionCeiling()).toBe(8);expect((await receiver.readRecord({namespace:'primary',table:'students',key:'student-fictional'})).text).toBe('source revision 8');
    await receiver.commitDelta(1,[{namespace:'primary',table:'students',key:'student-fictional',value:{id:'student-fictional',text:'receiver edit'}}]);expect(receiver.getObjectRevisionCeiling()).toBe(8);
    await receiver.restoreCheckpoint(2,selected,{namespace:'metadata',key:'internal-safety/'+crypto.randomUUID()});expect(receiver.getRevision()).toBe(3);expect((await receiver.readRecord({namespace:'primary',table:'students',key:'student-fictional'})).text).toBe('source revision 6');
    await receiver.importAuthenticatedCheckpoint(3,verified.root,{namespace:'metadata',key:'internal-safety/'+crypto.randomUUID()});expect(receiver.getRevision()).toBe(4);expect(receiver.getObjectRevisionCeiling()).toBe(8);
    const graph=await receiver.visitArchiveGraph(receiverRoot,{onRoot:async()=>{},onObject:async()=>{},onChunk:async()=>{}});expect(graph.roots).toBeGreaterThan(2);expect(revisions).toEqual([1,2,3,4]);
    const future=JSON.parse(new TextDecoder().decode(await cryptoRuntime.decryptBytes(f.key,{...f.scope,purpose:'working-data',recordId:'workspace',revision:8},verified.root.ciphertext)));future.objectRevisionCeiling=9;
    const futureCheckpoint={revision:9,ciphertext:await cryptoRuntime.encryptBytes(f.key,{...f.scope,purpose:'working-data',recordId:'workspace',revision:9},new TextEncoder().encode(JSON.stringify(future)))};
    await expect(receiver.restoreCheckpoint(4,futureCheckpoint,{namespace:'metadata',key:'internal-safety/'+crypto.randomUUID()})).rejects.toThrow();expect(receiverRoot.revision).toBe(4);verified.workspace.lock();
  },30000);
  it('streams an actual multi-chunk historical body with bounded transport pieces',async()=>{
    const f=await fixture(), body='fictional '.repeat(600000);await f.session.commitDelta(3,[{namespace:'recovery',table:'backup-content',key:'legacy',value:body}]);
    let largestWrite=0;const wire:Buffer[]=[];const meta=await exportWorkspaceArchive({...f.exportOptions,root:f.root(),sourceHead:{revision:4,hash:hash(f.root().ciphertext)},write:async(bytes:Uint8Array)=>{largestWrite=Math.max(largestWrite,bytes.length);wire.push(Buffer.from(bytes));}});
    expect(largestWrite).toBeLessThan(8*1024*1024);expect(parse(wire).filter(v=>v.type==='chunk').some(v=>v.index===1)).toBe(true);expect(meta.bytes).toBeGreaterThan(body.length);
    const restored=await importWorkspaceArchive({...await f.target(),read:source(wire)});let total=0;await restored.workspace.readRecordStream({namespace:'recovery',table:'backup-content',key:'legacy'},async(bytes:Uint8Array)=>{total+=bytes.length;});expect(total).toBe(new TextEncoder().encode(JSON.stringify(body)).length);restored.workspace.lock();
  },30000);
  it('rejects truncated, reordered, duplicate and corrupted streams without returning a preview',async()=>{
    const f=await fixture(), out=await exported(f), values=parse(out.wire);const chunk=values.findIndex(v=>v.type==='chunk');
    for(const mutate of [(v:any[])=>v.slice(0,-1),(v:any[])=>v.concat([v.at(-1)]),(v:any[])=>{v[chunk].ciphertext=v[chunk].ciphertext.slice(0,-1)+'x';return v;},(v:any[])=>{v.splice(chunk,0,v[chunk]);return v;},(v:any[])=>{[v[chunk],v[chunk-1]]=[v[chunk-1],v[chunk]];return v;}]){
      await expect(importWorkspaceArchive({...await f.target(),read:source(encode(mutate(structuredClone(values))))})).rejects.toMatchObject({code:'ENCRYPTION_ARCHIVE_INVALID'});
    }
    const truncated=out.wire.map(Buffer.from);truncated[truncated.length-1]=truncated.at(-1)!.subarray(0,-1);await expect(importWorkspaceArchive({...await f.target(),read:source(truncated)})).rejects.toThrow();
    expect(f.session.getRevision()).toBe(3);
  },30000);
  it('can retry an intact archive in the SAME immutable target after hash, tag, seal, truncation and transformed-cipher failures',async()=>{
    const f=await fixture(),out=await exported(f),original=parse(out.wire),chunkIndex=original.findIndex(v=>v.type==='chunk'),objectIndex=chunkIndex-1;
    for(const scenario of ['hash','tag','seal','truncated','transformed']) {
      const values=structuredClone(original),object=values[objectIndex],frame=values[chunkIndex];let badCipher:string|undefined;
      if(scenario==='hash'||scenario==='tag') {
        const envelope=JSON.parse(frame.ciphertext);envelope.ciphertext=(envelope.ciphertext[0]==='A'?'B':'A')+envelope.ciphertext.slice(1);frame.ciphertext=JSON.stringify(envelope);badCipher=frame.ciphertext;
        if(scenario==='tag') {
          const plain=await cryptoRuntime.decryptBytes(f.key,object.context,object.seal),seal=JSON.parse(new TextDecoder().decode(plain));plain.fill(0);seal.hashes[0]=hash(frame.ciphertext);
          object.seal=await cryptoRuntime.encryptBytes(f.key,object.context,new TextEncoder().encode(JSON.stringify(seal)));
        }
      } else if(scenario==='seal') object.seal=values.find((v,i)=>i!==objectIndex&&v.type==='object').seal;
      else if(scenario==='transformed') {
        const plain=await chunkRuntime.openChunk(f.key,object.context,object.plan,0,frame.ciphertext);
        try {frame.ciphertext=await chunkRuntime.sealChunk(f.key,object.context,object.plan,0,plain);badCipher=frame.ciphertext;} finally {plain.fill(0);}
      }
      const target=await f.target(),factory=target.createChunkStore,staged:string[]=[];
      target.createChunkStore=(verify:any,guard:any)=>{const store=factory(verify,guard);return {...store,stage:async(file:any,index:number,ciphertext:string)=>{staged.push(ciphertext);return store.stage(file,index,ciphertext);}};};
      const broken=scenario==='truncated'?values.slice(0,chunkIndex+1):values;
      await expect(importWorkspaceArchive({...target,read:source(encode(broken))})).rejects.toMatchObject({code:'ENCRYPTION_ARCHIVE_INVALID'});
      if(badCipher)expect(staged).not.toContain(badCipher);
      const restored=await importWorkspaceArchive({...target,read:source(out.wire)});expect(restored.workspace.getRevision()).toBe(3);expect((await restored.workspace.readRecord({namespace:'primary',table:'students',key:'student-fictional'})).text).toBe('old fictional work');restored.workspace.lock();
      const repeated=await importWorkspaceArchive({...target,read:source(out.wire)});expect(repeated.workspace.getRevision()).toBe(3);repeated.workspace.lock();
    }
    expect(f.session.getRevision()).toBe(3);
  },30000);
  it('binds scope, wrapper, source head and archive purpose and never falls back to plaintext',async()=>{
    const f=await fixture(), out=await exported(f), values=parse(out.wire);
    await expect(importWorkspaceArchive({...await f.target({scope:{...f.scope,appId:'other-app'}}),read:source(out.wire)})).rejects.toThrow();
    await expect(importWorkspaceArchive({...await f.target({purpose:'transfer'}),read:source(out.wire)})).rejects.toThrow();
    await expect(importWorkspaceArchive({...await f.target({expectedSourceHead:{revision:2,hash:'0'.repeat(64)}}),read:source(out.wire)})).rejects.toThrow();
    values[0].archiveId=crypto.randomUUID();await expect(importWorkspaceArchive({...await f.target(),read:source(encode(values))})).rejects.toThrow();
    await expect(importWorkspaceArchive({...await f.target(),read:source([Buffer.from('{"plaintext":"fictional"}\n')])})).rejects.toThrow();
    const wrongWrapper=await cryptoRuntime.wrapMasterKey(f.key,f.code,f.scope.appId,f.scope.vaultId);await expect(exported(f,{recoveryWrapper:wrongWrapper})).rejects.toThrow();
  },30000);
  it('requires complete graph closure even when a valid final seal is forged by a fixture key holder',async()=>{
    const f=await fixture(), out=await exported(f), values=parse(out.wire);const first=values.findIndex(v=>v.type==='object'),end=values.findIndex((v,i)=>i>first&&v.type==='object-end');values.splice(first,end-first+1);
    const footer=values.pop(),h=values[0],clear=await cryptoRuntime.decryptBytes(f.key,{...f.scope,purpose:'backup',recordId:'archive/'+h.archiveId,revision:h.root.revision},footer.seal);const meta=JSON.parse(new TextDecoder().decode(clear));clear.fill(0);
    meta.streamHash=hash(Buffer.concat(encode(values)).toString());meta.frames=values.length;meta.objects--;footer.seal=await cryptoRuntime.encryptBytes(f.key,{...f.scope,purpose:'backup',recordId:'archive/'+h.archiveId,revision:h.root.revision},new TextEncoder().encode(JSON.stringify(meta)));
    await expect(importWorkspaceArchive({...await f.target(),read:source(encode([...values,footer]))})).rejects.toThrow();
  },30000);
  it('enforces bounds and revokes held exports/imports before completion',async()=>{
    const f=await fixture(), out=await exported(f);await expect(exported(f,{maxArchiveBytes:100})).rejects.toThrow();
    await expect(importWorkspaceArchive({...await f.target({maxArchiveBytes:100}),read:source(out.wire)})).rejects.toThrow();
    let revoked=false,writes=0;await expect(exported(f,{assertCurrent:()=>{if(revoked)throw Error('revoked');},write:async()=>{writes++;revoked=true;}})).rejects.toThrow();expect(writes).toBe(1);
    let imported=false;await expect(importWorkspaceArchive({...await f.target({assertCurrent:()=>{if(imported)throw Error('revoked');},getKey:async()=>{imported=true;return new Uint8Array(f.key);}}),read:source(out.wire)})).rejects.toThrow();expect(f.session.getRevision()).toBe(3);
  },30000);
});
