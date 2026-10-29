import { saveDatedBackup } from '../security/datedBackups';
import { lockEncryptedRuntime, protectedStorageBoundary } from '../security/encryptedRuntime';
import { unwrapEncryption, type NativeDatedBackup } from '../security/encryptionBridge';
import { rendererStorageMode } from '../security/rendererStorageMode';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { getIdentityEpoch } from '../services/identityService';
import { applySnapshot, assertWorkspaceAccess, readSnapshot, type Snapshot } from './snapshot';
import { DEFAULT_OPTIONS, getRecoveryOptions, recoveryStore, updateRecoveryOptions, type RecoveryOptions, type RecoveryOptionsPatch } from './backupStore';
import { finishSync, previewSync, publishFirstSnapshot, requireDriveProtection, unwrap, type DriveStatus, type RemoteSnapshot, type SyncPreview } from './driveSync';
import { ConflictReview } from './ConflictReview';
import { RecoveryActionError, recoveryCode, recoveryGuidance, type RecoveryAction } from './recoveryGuidance';
import { automaticBackupStatus, runAutomaticBackup } from './automaticBackup';
type OptionsContext={database:OntarioTeacherDB;userId:string|undefined;protectedMode:boolean;epoch:number};
type OptionsObservation={context:OptionsContext;sequence:number;value?:RecoveryOptions;failed?:true};
type PendingOptions={context:OptionsContext;value:RecoveryOptions;afterReadSequence:number|null};
const sameOptions=(a:RecoveryOptions,b:RecoveryOptions)=>a.automatic===b.automatic&&a.intervalHours===b.intervalHours&&a.retain===b.retain;
export function useAutomaticBackups(database:OntarioTeacherDB,userId?:string) {
 useEffect(()=>{
  if(!userId)return;let active=true,busy=false;
  const run=async()=>{if(busy||!active)return;busy=true;try{await runAutomaticBackup(database,userId);}finally{busy=false;}};
  void run();const timer=window.setInterval(run,60000);return()=>{active=false;clearInterval(timer);};
 },[database,userId]);
}
export function BackupSyncSettings({database,userId,onBusyChange}:{database:OntarioTeacherDB;userId?:string;onBusyChange?:(busy:boolean)=>void}) {
 const protectedMode=rendererStorageMode()!=='legacy';
 const automaticError=useSyncExternalStore(automaticBackupStatus.subscribe,automaticBackupStatus.getSnapshot);
 const legacyBackups=useLiveQuery(()=>protectedMode?[]:recoveryStore.backups.orderBy('createdAt').reverse().toArray(),[protectedMode])??[];
 const [nativeBackups,setNativeBackups]=useState<NativeDatedBackup[]>([]);
 const backups=protectedMode?nativeBackups:legacyBackups;
 const identityEpoch=getIdentityEpoch();
 const optionsContext=useMemo<OptionsContext>(()=>({database,userId,protectedMode,epoch:identityEpoch}),[database,userId,protectedMode,identityEpoch]);
 const optionsContextRef=useRef(optionsContext);optionsContextRef.current=optionsContext;
 const optionsReadSequence=useRef(0),[optionsRefresh,setOptionsRefresh]=useState(0);
 const observedRead=useLiveQuery(async():Promise<OptionsObservation>=>{
   const sequence=++optionsReadSequence.current;
   try{return{context:optionsContext,sequence,value:await getRecoveryOptions()};}
   catch{return{context:optionsContext,sequence,failed:true};}
 },[optionsContext,optionsRefresh]);
 const [latestRead,setLatestRead]=useState<OptionsObservation|null>(null);
 useEffect(()=>{if(observedRead?.context===optionsContext&&getIdentityEpoch()===optionsContext.epoch)setLatestRead(previous=>previous?.context===optionsContext&&previous.sequence>=observedRead.sequence?previous:observedRead);},[observedRead,optionsContext]);
 const currentRead=latestRead?.context===optionsContext?latestRead:null;
 const observedOptions=currentRead?.value,optionsReadFailed=currentRead?.failed===true;
 const [pendingOptions,setPendingOptions]=useState<PendingOptions|null>(null);
 const pending=pendingOptions?.context===optionsContext?pendingOptions:null;
 const options=pending?.value??observedOptions??DEFAULT_OPTIONS;
 useEffect(()=>{
   // A later authoritative read can supersede our saved row without ever
   // emitting that exact row. Equality alone would mask external changes forever.
   if(pending&&observedOptions&&pending.afterReadSequence!==null&&(currentRead!.sequence>pending.afterReadSequence||sameOptions(pending.value,observedOptions)))setPendingOptions(previous=>previous===pending?null:previous);
 },[pending,observedOptions,currentRead]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState<ReturnType<typeof recoveryGuidance>|null>(null);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 const errorRef=useRef<HTMLDivElement>(null);
 const [restore,setRestore]=useState<(NativeDatedBackup & {json?:string})|null>(null),[status,setStatus]=useState<DriveStatus>({configured:false,connected:false});
 useEffect(()=>{if(error&&!busy)errorRef.current?.scrollIntoView({block:'nearest'});},[error,busy,backups.length,status.connected]);
 const [restoreToken,setRestoreToken]=useState('');
 const refreshBackups=async()=>{if(!protectedMode)return;const native=window.desktopEncryption;if(!native)throw new Error('Encrypted backup catalog unavailable.');const items=await protectedStorageBoundary(async()=>unwrapEncryption(await native.listBackups()));if(alive.current)setNativeBackups(items);};
 const [versions,setVersions]=useState<RemoteSnapshot[]>([]),[preview,setPreview]=useState<SyncPreview|null>(null),[choices,setChoices]=useState<Record<string,'local'|'remote'>>({});
 const [refreshRequired,setRefreshRequired]=useState(false),[versionsLoaded,setVersionsLoaded]=useState(false);
 const [consent,setConsent]=useState(false);const busyRef=useRef(false);const alive=useRef(true);const bridge=window.desktopOrganizerDrive;
 useEffect(()=>{if(protectedMode)void refreshBackups().catch(cause=>{if(alive.current)setError(recoveryGuidance('backup',cause));});},[protectedMode,userId]);
 const checkStatus=async()=>{if(bridge){const next=await unwrap(bridge.status());if(protectedMode&&next.protection!=='encrypted-v1'){setStatus({...next,configured:false,connected:false});throw new RecoveryActionError('Protected sync requires the encrypted native transport.','setup','unchanged');}setStatus(next);if(!next.connected){setPreview(null);setVersionsLoaded(false);}}else setStatus({configured:false,connected:false});};
 useEffect(()=>{alive.current=true;setStatus({configured:false,connected:false});setVersions([]);setVersionsLoaded(false);setPreview(null);setConsent(false);void checkStatus().catch(e=>{if(alive.current)setError(recoveryGuidance('status',e));});return()=>{alive.current=false;void bridge?.disconnect().catch(()=>{});};},[bridge,userId]);
 const run=async(kind:RecoveryAction,action:()=>Promise<void>,isCurrent=()=>true)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);setMessage('');try{if(['connect','refresh','preview','publish','apply'].includes(kind)){if(!bridge)throw new RecoveryActionError('Native encrypted sync is unavailable.','setup');await requireDriveProtection(bridge);}await action();}catch(e){if(alive.current&&isCurrent()){setError(recoveryGuidance(kind,e));if(kind==='publish'||kind==='apply'){setRefreshRequired(true);setPreview(null);setChoices({});}try{await checkStatus();}catch{/* Keep the actionable original error visible. */}}}finally{busyRef.current=false;if(alive.current)setBusy(false);}};
 const changeOptions=(patch:RecoveryOptionsPatch)=>{
   if(busyRef.current||!userId||!observedOptions||optionsReadFailed)return;
   const context=optionsContext,isCurrent=()=>alive.current&&optionsContextRef.current===context&&getIdentityEpoch()===context.epoch;
   setPendingOptions({context,value:{...options,...patch},afterReadSequence:null});
   void run('options',async()=>{
     if(!isCurrent())return;
     try{
       const saved=await updateRecoveryOptions(patch);
       if(isCurrent()){
         setPendingOptions({context,value:saved,afterReadSequence:optionsReadSequence.current});
         // Explicitly start a post-commit observation. An already-running live
         // query may have captured older values before this acknowledgment.
         setOptionsRefresh(value=>value+1);
       }
     }catch(cause){if(isCurrent()){setPendingOptions(null);setOptionsRefresh(value=>value+1);throw cause;}}
   },isCurrent);
 };
 const refresh=async()=>{if(bridge){setVersionsLoaded(false);setPreview(null);setChoices({});setVersions(await unwrap(bridge.list()));setVersionsLoaded(true);setRefreshRequired(false);setPreview(null);setChoices({});}};
 return <section aria-label="Backup and personal sync" className="space-y-5 rounded-xl border border-slate-300 p-5">
  <h2 className="text-lg font-semibold">Backups & personal sync</h2>
  <p>Both computers keep working offline. Dated local backups stay on this computer; they cannot protect against loss of this device. Export a separate copy for that.</p>
  {!observedOptions&&!pending&&!optionsReadFailed?<p role="status">Loading backup settings…</p>:null}
  {optionsReadFailed&&<div role="alert" className="rounded border border-amber-500 p-3 space-y-2"><p>Latest saved backup settings could not be read.</p><p>{pending?.afterReadSequence!==null&&pending?'The update was committed, but its latest readback is unconfirmed. Shown values may have been changed elsewhere.':'Saved values are unavailable; no default settings are shown as saved.'} Read the saved settings again before making another change.</p><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>setOptionsRefresh(value=>value+1)}>Read saved settings again</button></div>}
  {(observedOptions||pending)&&<><label className="flex items-center gap-2"><input type="checkbox" checked={options.automatic} disabled={busy||!userId||optionsReadFailed} onChange={e=>changeOptions({automatic:e.target.checked})}/>Automatic local backups</label>
  <div className="flex flex-wrap gap-4">
   <label>Save changed work at most once every <select aria-label="Backup interval" value={options.intervalHours} disabled={busy||!userId||optionsReadFailed} onChange={e=>changeOptions({intervalHours:Number(e.target.value)})}>{[1,6,24].map(n=><option key={n} value={n}>{n} hour{n===1?'':'s'}</option>)}</select></label>
   <label>Keep <select aria-label="Automatic backup versions" value={options.retain} disabled={busy||!userId||optionsReadFailed} onChange={e=>changeOptions({retain:Number(e.target.value)})}>{[7,14,30].map(n=><option key={n}>{n}</option>)}</select> automatic versions</label>
  </div>
  </>}
  <p className="text-sm">Runs while the app is open, starting when a teacher is selected. Unchanged snapshots are skipped. Manual and pre-restore/pre-sync safety versions are retained separately. {protectedMode?'Dated backups are held inside this encrypted workspace; encrypted file export provides a separate copy. The retained original workspace and earlier exported files are not retroactively encrypted.':'Backups are not encrypted by this app.'}</p>
  <button className="rounded-lg border bg-blue-600 text-white px-4 py-2" disabled={busy||!userId} onClick={()=>void run('backup',async()=>{await saveDatedBackup(database,userId!,'manual');await refreshBackups();setMessage('Dated backup saved on this computer.');})}>Save a backup now</button>
  {protectedMode&&<button className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run('backup',refreshBackups)}>Refresh dated backups</button>}
  {automaticError&&<p role="status">Automatic backup needs attention. {recoveryGuidance('backup',new Error(automaticError)).next} Use Save a backup now after resolving the issue.</p>}
  <ul className="max-h-64 overflow-auto space-y-2">{backups.map(item=><li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span>{new Date(item.createdAt).toLocaleString()} · {item.reason}</span><button disabled={busy||!userId} className="rounded border px-3 py-2" onClick={()=>void run('restore',async()=>{setRestoreToken('');if(protectedMode){const native=window.desktopEncryption;if(!native)throw new Error('Encrypted restore unavailable.');const checked=await protectedStorageBoundary(async()=>unwrapEncryption(await native.previewStoredBackup(item.id)));setRestoreToken(checked.token);}setRestore(item);})}>Review restore</button></li>)}</ul>
  {backups.length===0&&<p>No dated local backups yet.</p>}
  {restore&&<div role="alertdialog" aria-label="Confirm dated backup restore" className="rounded-lg border border-amber-500 p-4 space-y-3"><h3 className="font-semibold">Replace this computer’s records?</h3><p>Restore {new Date(restore.createdAt).toLocaleString()}. Newer local edits will be replaced. {protectedMode?'A native encrypted safety version is committed with the replacement; the workspace then reopens securely.':'A safety backup is saved first.'} Drive files are not changed.</p><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>{setRestore(null);setRestoreToken('');}}>Cancel</button> <button disabled={busy||!userId} className="rounded border px-3 py-2" onClick={()=>void run('restore',async()=>{
    if(protectedMode){const native=window.desktopEncryption;if(!native||!restoreToken)throw new Error('Review the encrypted backup again.');try{await protectedStorageBoundary(async()=>unwrapEncryption(await native.applyStoredBackup(restoreToken)));}finally{lockEncryptedRuntime();}return;}
    const epoch=getIdentityEpoch();await assertWorkspaceAccess(database,userId!,epoch);
    try{new PortabilityService(database).validateBackupJSON(restore.json!);}catch{throw new RecoveryActionError('Invalid local backup.','invalid','unchanged');}const expected=await readSnapshot(database);
    await saveDatedBackup(database,userId!,'before-restore');
    // Remove obsolete ancestry before replacing records. A bookkeeping failure must stop restore,
    // not leave restored records paired with an old checkpoint after Settings closes.
    try{await recoveryStore.state.delete('sync');}catch{throw new RecoveryActionError('Sync checkpoint could not be cleared; restore not started.','storage','unchanged');}
    await applySnapshot(database,JSON.parse(restore.json!) as Snapshot,expected,userId!,epoch);setRestore(null);setPreview(null);setMessage('Backup restored. Reopen your class. Review Drive versions before the next sync.');
  })}>Confirm restore</button></div>}
  <div className="border-t pt-4 space-y-3"><h3 className="font-semibold">Optional personal Drive sync</h3>
   <p>Sync shares a full workspace snapshot, including work, photos, marks and notes, with your own Google Drive. No other provider is used. Each upload is a new dated version; existing Drive versions are never overwritten or deleted by this app. {protectedMode&&'Protected mode sends authenticated encrypted versions only. Plaintext Drive versions are not loaded or sent by this path.'}</p>
   {protectedMode&&status.protection!=='encrypted-v1'&&<p role="status">Encrypted personal sync is unavailable in this native session. Keep sync off until the compatible encrypted adapter and separate setup/device checks are verified. Plaintext sync is blocked.</p>}
   {!status.configured?<p role="status">Personal sync is unavailable until its separate desktop OAuth setup and privacy review are approved and configured. Capture-download access does not enable backup uploads. Local backups and file export remain available. Keep sync off until separate approved setup and real-device testing are complete. After approved setup, choose Check setup again.</p>:<>
    <label className="flex gap-2"><input type="checkbox" checked={consent} disabled={busy||status.connected} onChange={e=>setConsent(e.target.checked)}/>I choose to send this workspace to my personal Drive for this session.</label>
    {!status.connected&&<p role="status">Drive is disconnected. Local work can continue offline. To sync after approved setup, choose session consent and Connect personal Drive. If access expired, connect again and refresh versions before reviewing.</p>}
    {!status.connected?<button disabled={busy||!consent||!userId} className="rounded border px-3 py-2" onClick={()=>void run('connect',async()=>{if(bridge){setStatus(await unwrap(bridge.connect()));try{await refresh();}catch(error){throw new RecoveryActionError('Connected; list failed.',recoveryCode(error),'connected');}}})}>Connect personal Drive</button>:<div className="flex gap-2"><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void run('refresh',refresh)}>Refresh Drive versions</button><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void run('disconnect',async()=>{if(bridge)setStatus(await unwrap(bridge.disconnect()));setVersions([]);setVersionsLoaded(false);setPreview(null);setConsent(false);})}>Disconnect</button></div>}
    {status.connected&&versionsLoaded&&versions.length===0&&<button disabled={busy||!userId||refreshRequired} className="rounded border px-3 py-2" onClick={()=>void run('publish',async()=>{if(bridge){await publishFirstSnapshot(database,userId!,bridge);try{await refresh();}catch(error){throw new RecoveryActionError('Upload verified but version refresh failed.',recoveryCode(error),'published');}setMessage('First verified Drive version saved. On the second computer, start with the same exported workspace before merging.');}})}>Save first Drive version</button>}
    <ul className="space-y-2">{versions.map(v=><li key={v.id} className="flex gap-2 items-center"><span>{new Date(v.modifiedTime).toLocaleString()}</span><button className="rounded border px-3 py-2" disabled={busy||!userId||refreshRequired||!versionsLoaded} onClick={()=>void run('preview',async()=>{if(bridge){setPreview(await previewSync(database,userId!,v,bridge));setChoices({});}})}>Review merge</button></li>)}</ul>
   </>}
   {preview&&<div className="space-y-3"><h4 className="font-semibold">Review separate changes and conflicts</h4><p>{preview.plan.conflicts.length} conflicting records. Separate changes are combined. The full result is validated before applying; a failed or stale preview changes nothing.</p>
    <p>{preview.plan.conflicts.filter(c=>choices[c.key]).length} of {preview.plan.conflicts.length} choices made. A local safety backup is saved before applying.</p>
    {preview.plan.conflicts.map(c=><ConflictReview key={c.key} conflict={c} snapshot={preview.plan.local} choice={choices[c.key]} onChoose={choice=>setChoices({...choices,[c.key]:choice})}/>)}
    <button className="rounded border px-3 py-2" disabled={busy||!status.connected||!versionsLoaded||refreshRequired||preview.plan.conflicts.some(c=>!choices[c.key])} onClick={()=>void run('apply',async()=>{if(bridge){await finishSync(database,preview,choices,bridge);try{await refresh();}catch(error){throw new RecoveryActionError('Merge and upload verified but list refresh failed.',recoveryCode(error),'merged-published');}setMessage('Merged locally and saved a verified new Drive version.');}})}>Apply reviewed merge & save version</button> <button disabled={busy} className="rounded border px-3 py-2" onClick={()=>setPreview(null)}>Cancel review</button>
   </div>}
   {refreshRequired&&<p role="status">Before another upload, refresh Drive versions and inspect the latest entry. A failed response can hide a completed upload. Do not create a duplicate version merely because the previous result was uncertain.</p>}
   <button className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run('status',checkStatus)}>Check setup again</button>
  </div>
  {busy&&<p role="status">Working…</p>}{message&&<p role="status">{message}</p>}{error&&<div ref={errorRef} role="alert" className="rounded border border-amber-500 p-3 space-y-2"><p className="font-semibold">{error.title}</p><p>{error.state}</p><p>{error.next}</p></div>}
 </section>;
}
