import { describe, expect, it } from 'vitest';
import { encryptBytes, generateMasterKey } from '../../shared/encryption';
import { EncryptedWorkspaceSession, WorkspaceLockedError, type EncryptedCheckpoint } from './encryptedWorkspace';
const scope={appId:'student-organizer',vaultId:'fictional-vault',keyVersion:1};
const validate=(v:unknown):asserts v is {version:1}=>{if((v as any)?.version!==1)throw Error('Invalid fixture');};
async function fixture(){const key=generateMasterKey();let data:EncryptedCheckpoint={revision:1,ciphertext:await encryptBytes(key,{...scope,purpose:'working-data',recordId:'workspace',revision:1},new TextEncoder().encode('{"version":1}'))};const store={read:async()=>structuredClone(data),commit:async(expected:number|null,next:EncryptedCheckpoint)=>{if(expected!==data.revision)throw Error('stale');data=structuredClone(next);}};const session=await EncryptedWorkspaceSession.open(store,scope,key,validate);key.fill(0);return{session,store};}
describe('main-owned transfer session primitives',()=>{
 it('seals copied input to a Drive identity and rejects context or payload substitution',async()=>{
  const{session}=await fixture(),input=new TextEncoder().encode('fictional primary bytes');const pending=session.sealExternal('transfer','drive-file-a',input);input.fill(0);const sealed=await pending;
  expect(sealed.ciphertext).not.toContain('fictional primary bytes');const expected={purpose:'transfer' as const,recordId:'drive-file-a',revision:sealed.revision};
  const opened=await session.openExternal(expected,sealed.ciphertext);expect(new TextDecoder().decode(opened)).toBe('fictional primary bytes');opened.fill(0);
  for(const patch of [{recordId:'drive-file-b'},{purpose:'backup' as const},{revision:2}])await expect(session.openExternal({...expected,...patch},sealed.ciphertext)).rejects.toThrow();
  const changed=JSON.parse(sealed.ciphertext);changed.context.vaultId='other-vault';await expect(session.openExternal(expected,JSON.stringify(changed))).rejects.toThrow();
  expect(session.getRevision()).toBe(1);
 });
 it('permits an explicitly selected authenticated historical version without changing working state',async()=>{const{session}=await fixture();const sealed=await session.sealExternal('backup','manual-file',new TextEncoder().encode('fictional backup'));await session.transact(()=>{});const result=await session.openExternal({purpose:'backup',recordId:'manual-file',revision:1},sealed.ciphertext);expect(new TextDecoder().decode(result)).toBe('fictional backup');expect(session.getRevision()).toBe(2);result.fill(0);});
 it('blocks queued or closed actions and never exposes working-data keys through the generic path',async()=>{const{session}=await fixture();await expect(session.sealExternal('working-data' as any,'workspace',new Uint8Array())).rejects.toThrow();const pending=session.sealExternal('transfer','queued',new TextEncoder().encode('fictional'));session.lock();await expect(pending).rejects.toBeInstanceOf(WorkspaceLockedError);await expect(session.openExternal({purpose:'transfer',recordId:'queued',revision:1},'{}')).rejects.toThrow();});
 it('takes an isolated copy of expected context before queued execution',async()=>{const{session}=await fixture();const sealed=await session.sealExternal('transfer','file-a',new Uint8Array([1,2,3]));const expected={purpose:'transfer' as const,recordId:'file-a',revision:1};const pending=session.openExternal(expected,sealed.ciphertext);expected.recordId='file-b';expect(await pending).toEqual(new Uint8Array([1,2,3]));});
});
