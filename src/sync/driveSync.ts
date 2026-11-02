import { saveDatedBackup } from '../security/datedBackups';
import { rendererStorageMode } from '../security/rendererStorageMode';
import { RecoveryActionError, type RecoveryCode } from './recoveryGuidance';
import type { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { getIdentityEpoch } from '../services/identityService';
import { recoveryStore, type RecoveryStore } from './backupStore';
import { applySnapshot, assertWorkspaceAccess, guardMergeRelationships, snapshotDigest, dataSignature, mergeSnapshots, readSnapshot, resolvePlan, type MergePlan, type Snapshot } from './snapshot';
export interface DriveStatus { configured:boolean; connected:boolean; protection?:'legacy'|'encrypted-v1'; workspaceUnlocked?:boolean }
export interface RemoteSnapshot { id:string; name:string; modifiedTime:string }
export interface DriveBridge {
  status():Promise<DriveResult<DriveStatus>>; connect():Promise<DriveResult<DriveStatus>>;
  list():Promise<DriveResult<RemoteSnapshot[]>>; download(id:string):Promise<DriveResult<{json:string}>>;
  upload(json:string):Promise<DriveResult<{id:string}>>; disconnect():Promise<DriveResult<DriveStatus>>;
}
export type DriveResult<T>={ok:true;value:T}|{ok:false;message:string;code?:RecoveryCode};
declare global { interface Window { desktopOrganizerDrive?:DriveBridge } }
export async function unwrap<T>(promise:Promise<DriveResult<T>>):Promise<T> {const r=await promise;if(!r.ok)throw new RecoveryActionError(r.message,r.code??'unknown');return r.value;}
/** Protected mode can never route a snapshot to the legacy plaintext sender. */
export async function requireDriveProtection(bridge:DriveBridge):Promise<void> {
  const mode=rendererStorageMode();
  if(mode==='legacy')return;
  if(mode!=='encrypted')throw new RecoveryActionError('Unlock the verified encrypted workspace before syncing.','auth','unchanged');
  const status=await unwrap(bridge.status());
  if(status.protection!=='encrypted-v1')throw new RecoveryActionError('Encrypted Drive setup is unavailable. Keep sync off; plaintext sync is blocked.','setup','unchanged');
  if(status.workspaceUnlocked!==true)throw new RecoveryActionError('Unlock the verified encrypted workspace before syncing.','auth','unchanged');
}
export interface SyncPreview { plan:MergePlan; remote:RemoteSnapshot; remoteJSON:string; epoch:number; userId:string }
export async function previewSync(database:OntarioTeacherDB,userId:string,remote:RemoteSnapshot,bridge:DriveBridge,store:RecoveryStore=recoveryStore):Promise<SyncPreview> {
  await requireDriveProtection(bridge);
  const epoch=getIdentityEpoch();await assertWorkspaceAccess(database,userId,epoch);
  const {json}=await unwrap(bridge.download(remote.id));
  try { new PortabilityService(database).validateBackupJSON(json); } catch { throw new RecoveryActionError('Invalid Drive backup.','invalid','unchanged'); }
  const target=JSON.parse(json) as Snapshot,local=await readSnapshot(database),state=await store.state.get('sync');
  // A local checkpoint is a base only when the selected remote is that exact version,
  // or carries a matching immutable ancestor identity and content digest.
  let base:Snapshot|null=null;
  if(state?.base&&state.lastRemoteId) {
    const digest=await snapshotDigest(state.base);
    const remoteHistory=[...(target.organizerSync?.ancestors??[]),{id:remote.id,digest:await snapshotDigest(target)}];
    const localHistory=[...(state.base.organizerSync?.ancestors??[]),{id:state.lastRemoteId,digest}];
    const shared=[...localHistory].reverse().find(candidate=>remoteHistory.some(entry=>entry.id===candidate.id&&entry.digest===candidate.digest));
    if(shared) {
      if(shared.id===state.lastRemoteId)base=state.base;
      else {
        // Concurrent uploads may share an older ancestor. The transport only downloads
        // listed private versions; verify its bytes against BOTH recorded fingerprints.
        const ancestor=await unwrap(bridge.download(shared.id));
        new PortabilityService(database).validateBackupJSON(ancestor.json);
        const parsed=JSON.parse(ancestor.json) as Snapshot;
        if(await snapshotDigest(parsed)!==shared.digest)throw new Error('The common Drive ancestor changed. Refresh versions; no changes were applied.');
        base=parsed;
      }
    }
  }
  const plan=guardMergeRelationships(database,mergeSnapshots(base,local,target,userId),target);
  await assertWorkspaceAccess(database,userId,epoch);
  return {plan,remote,remoteJSON:json,epoch,userId};
}
/** Foreground only. Remote files are immutable dated snapshots; no remote file is overwritten. */
export async function finishSync(database:OntarioTeacherDB,preview:SyncPreview,choices:Record<string,'local'|'remote'>,bridge:DriveBridge,store:RecoveryStore=recoveryStore):Promise<string> {
  await requireDriveProtection(bridge);
  await assertWorkspaceAccess(database,preview.userId,preview.epoch);
  // A remote choice is bound to verified immutable bytes, and local choices to the displayed revision.
  const remoteNow=await unwrap(bridge.download(preview.remote.id));
  if(remoteNow.json!==preview.remoteJSON)throw new Error('The selected Drive version changed. Refresh before syncing.');
  const current=await readSnapshot(database);
  if(dataSignature(current)!==dataSignature(preview.plan.local))throw new Error('Local work changed. Refresh before syncing.');
  const merged=resolvePlan(preview.plan,choices);
  new PortabilityService(database).validateBackupJSON(JSON.stringify(merged));
  await saveDatedBackup(database,preview.userId,'before-sync',store);
  await applySnapshot(database,merged,preview.plan.local,preview.userId,preview.epoch);
  // Persist locally first. Offline/upload failures leave merged work and a recovery snapshot intact.
  let uploaded=false;
  try {
  const actual=await readSnapshot(database);
  const state=await store.state.get('sync');
  const remote=JSON.parse(preview.remoteJSON) as Snapshot;
  const ancestors=[...(state?.base?.organizerSync?.ancestors??[]),...(remote.organizerSync?.ancestors??[]),{id:preview.remote.id,digest:await snapshotDigest(remote)}];
  if(state?.base&&state.lastRemoteId) ancestors.push({id:state.lastRemoteId,digest:await snapshotDigest(state.base)});
  actual.organizerSync={ancestors:Array.from(new Map(ancestors.filter(a=>typeof a.id==='string'&&typeof a.digest==='string'&&/^[a-f0-9]{64}$/.test(a.digest)).map(a=>[a.id,a])).values()).slice(-100)};
  await assertWorkspaceAccess(database,preview.userId,preview.epoch);
  await requireDriveProtection(bridge);
  const result=await unwrap(bridge.upload(JSON.stringify(actual)));uploaded=true;
  await store.state.put({id:'sync',lastRemoteId:result.id,base:actual});
  return result.id;
  } catch(error) { throw new RecoveryActionError('Local merge completed; Drive verification or checkpoint failed.',error instanceof RecoveryActionError?error.code:'unknown',uploaded?'merged-uploaded':'merged'); }
}
export async function publishFirstSnapshot(database:OntarioTeacherDB,userId:string,bridge:DriveBridge,store:RecoveryStore=recoveryStore):Promise<string> {
  await requireDriveProtection(bridge);
  const epoch=getIdentityEpoch();await assertWorkspaceAccess(database,userId,epoch);
  if((await unwrap(bridge.list())).length)throw new Error('Drive already has versions. Choose one to review and merge first.');
  const snapshot=await readSnapshot(database);
  new PortabilityService(database).validateBackupJSON(JSON.stringify(snapshot));
  await assertWorkspaceAccess(database,userId,epoch);
  await requireDriveProtection(bridge);
  const result=await unwrap(bridge.upload(JSON.stringify(snapshot)));
  try{await store.state.put({id:'sync',lastRemoteId:result.id,base:snapshot});}catch{throw new RecoveryActionError('Uploaded; checkpoint failed.','storage','uploaded');}
  return result.id;
}
