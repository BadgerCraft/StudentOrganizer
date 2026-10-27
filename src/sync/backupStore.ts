import Dexie, { type Table } from 'dexie';
import type { OntarioTeacherDB } from '../db/database';
import { assertWorkspaceAccess, dataSignature, readSnapshot, type Snapshot } from './snapshot';
import { getIdentityEpoch } from '../services/identityService';
export interface SavedBackup { id:string; createdAt:string; reason:'automatic'|'manual'|'before-restore'|'before-sync'; json:string }
export interface RecoveryOptions { id:'options'; automatic:boolean; intervalHours:number; retain:number }
export interface SyncState { id:'sync'; lastRemoteId?:string; base?:Snapshot }
export class RecoveryStore extends Dexie {
  backups!:Table<SavedBackup,string>; options!:Table<RecoveryOptions,string>; state!:Table<SyncState,string>;
  constructor(name='OntarioTeacherRecovery') { super(name); this.version(1).stores({backups:'id,createdAt,reason',options:'id',state:'id'}); }
}
export const recoveryStore=new RecoveryStore();
export const DEFAULT_OPTIONS:RecoveryOptions={id:'options',automatic:true,intervalHours:24,retain:7};
export async function getRecoveryOptions(store=recoveryStore):Promise<RecoveryOptions> {return await store.options.get('options') ?? DEFAULT_OPTIONS;}
export async function saveRecoveryOptions(options:RecoveryOptions,store=recoveryStore):Promise<void> {
  if(![1,6,24].includes(options.intervalHours)||![7,14,30].includes(options.retain)||typeof options.automatic!=='boolean') throw new Error('Choose a supported backup schedule.');
  await store.options.put({...options,id:'options'});
}
export async function saveBackup(database:OntarioTeacherDB,userId:string,reason:SavedBackup['reason'],store=recoveryStore,now=new Date()):Promise<SavedBackup|null> {
  const epoch=getIdentityEpoch(); await assertWorkspaceAccess(database,userId,epoch);
  const snapshot=await readSnapshot(database), options=await getRecoveryOptions(store);
  const previous=await store.backups.orderBy('createdAt').last();
  if(reason==='automatic') {
    if(!options.automatic) return null;
    if(previous && (now.getTime()-Date.parse(previous.createdAt)<options.intervalHours*3600000 || dataSignature(JSON.parse(previous.json))===dataSignature(snapshot))) return null;
  }
  await assertWorkspaceAccess(database,userId,epoch);
  const backup:SavedBackup={id:crypto.randomUUID(),createdAt:now.toISOString(),reason,json:JSON.stringify(snapshot)};
  await store.transaction('rw',store.backups,async()=>{
    await store.backups.add(backup);
    // Only automatic versions expire. Manual and safety snapshots remain available.
    if(reason==='automatic') {
      const automatic=(await store.backups.where('reason').equals('automatic').sortBy('createdAt')).reverse();
      await store.backups.bulkDelete(automatic.slice(options.retain).map(item=>item.id));
    }
  });
  return backup;
}
