import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { getIdentityEpoch } from '../services/identityService';
import { applySnapshot, assertWorkspaceAccess, readSnapshot, type Snapshot } from './snapshot';
import { DEFAULT_OPTIONS, getRecoveryOptions, recoveryStore, saveBackup, saveRecoveryOptions, type SavedBackup } from './backupStore';
import { finishSync, previewSync, publishFirstSnapshot, unwrap, type DriveStatus, type RemoteSnapshot, type SyncPreview } from './driveSync';
import { ConflictReview } from './ConflictReview';
import { automaticBackupStatus, runAutomaticBackup } from './automaticBackup';
export function useAutomaticBackups(database:OntarioTeacherDB,userId?:string) {
 useEffect(()=>{
  if(!userId)return;let active=true,busy=false;
  const run=async()=>{if(busy||!active)return;busy=true;try{await runAutomaticBackup(database,userId);}finally{busy=false;}};
  void run();const timer=window.setInterval(run,60000);return()=>{active=false;clearInterval(timer);};
 },[database,userId]);
}
export function BackupSyncSettings({database,userId}:{database:OntarioTeacherDB;userId?:string}) {
 const automaticError=useSyncExternalStore(automaticBackupStatus.subscribe,automaticBackupStatus.getSnapshot);
 const backups=useLiveQuery(()=>recoveryStore.backups.orderBy('createdAt').reverse().toArray(),[])??[];
 const options=useLiveQuery(()=>getRecoveryOptions(),[])??DEFAULT_OPTIONS;
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [restore,setRestore]=useState<SavedBackup|null>(null),[status,setStatus]=useState<DriveStatus>({configured:false,connected:false});
 const [versions,setVersions]=useState<RemoteSnapshot[]>([]),[preview,setPreview]=useState<SyncPreview|null>(null),[choices,setChoices]=useState<Record<string,'local'|'remote'>>({});
 const [consent,setConsent]=useState(false);const busyRef=useRef(false);const alive=useRef(true);const bridge=window.desktopOrganizerDrive;
 useEffect(()=>{alive.current=true;bridge?.status().then(unwrapResult=>{if(alive.current&&unwrapResult.ok)setStatus(unwrapResult.value);});return()=>{alive.current=false;void bridge?.disconnect();};},[bridge,userId]);
 const run=async(action:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Recovery action failed.');}finally{busyRef.current=false;if(alive.current)setBusy(false);}};
 const refresh=async()=>{if(bridge){setVersions(await unwrap(bridge.list()));setPreview(null);setChoices({});}};
 return <section aria-label="Backup and personal sync" className="space-y-5 rounded-xl border border-slate-300 p-5">
  <h2 className="text-lg font-semibold">Backups & personal sync</h2>
  <p>Both computers keep working offline. Dated local backups stay on this computer; they cannot protect against loss of this device. Export a separate copy for that.</p>
  <label className="flex items-center gap-2"><input type="checkbox" checked={options.automatic} disabled={busy||!userId} onChange={e=>void run(()=>saveRecoveryOptions({...options,automatic:e.target.checked}))}/>Automatic local backups</label>
  <div className="flex flex-wrap gap-4">
   <label>Save changed work at most once every <select aria-label="Backup interval" value={options.intervalHours} disabled={busy} onChange={e=>void run(()=>saveRecoveryOptions({...options,intervalHours:Number(e.target.value)}))}>{[1,6,24].map(n=><option key={n} value={n}>{n} hour{n===1?'':'s'}</option>)}</select></label>
   <label>Keep <select aria-label="Automatic backup versions" value={options.retain} disabled={busy} onChange={e=>void run(()=>saveRecoveryOptions({...options,retain:Number(e.target.value)}))}>{[7,14,30].map(n=><option key={n}>{n}</option>)}</select> automatic versions</label>
  </div>
  <p className="text-sm">Runs while the app is open, starting when a teacher is selected. Unchanged snapshots are skipped. Manual and pre-restore/pre-sync safety versions are retained separately. Backups are not encrypted by this app.</p>
  <button className="rounded-lg border bg-blue-600 text-white px-4 py-2" disabled={busy||!userId} onClick={()=>void run(async()=>{await saveBackup(database,userId!,'manual');setMessage('Dated backup saved on this computer.');})}>Save a backup now</button>
  {automaticError&&<p role="status">Automatic backup needs attention: {automaticError}</p>}
  <ul className="max-h-64 overflow-auto space-y-2">{backups.map(item=><li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span>{new Date(item.createdAt).toLocaleString()} · {item.reason}</span><button disabled={busy||!userId} className="rounded border px-3 py-2" onClick={()=>setRestore(item)}>Review restore</button></li>)}</ul>
  {backups.length===0&&<p>No dated local backups yet.</p>}
  {restore&&<div role="alertdialog" aria-label="Confirm dated backup restore" className="rounded-lg border border-amber-500 p-4 space-y-3"><h3 className="font-semibold">Replace this computer’s records?</h3><p>Restore {new Date(restore.createdAt).toLocaleString()}. Newer local edits will be replaced. A safety backup is saved first. Drive files are not changed.</p><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>setRestore(null)}>Cancel</button> <button disabled={busy||!userId} className="rounded border px-3 py-2" onClick={()=>void run(async()=>{
    const epoch=getIdentityEpoch();await assertWorkspaceAccess(database,userId!,epoch);
    new PortabilityService(database).validateBackupJSON(restore.json);const expected=await readSnapshot(database);
    await saveBackup(database,userId!,'before-restore');await applySnapshot(database,JSON.parse(restore.json) as Snapshot,expected,userId!,epoch);
    await recoveryStore.state.delete('sync');setRestore(null);setPreview(null);setMessage('Backup restored. Reopen your class. Review Drive versions before the next sync.');
  })}>Confirm restore</button></div>}
  <div className="border-t pt-4 space-y-3"><h3 className="font-semibold">Optional personal Drive sync</h3>
   <p>Sync shares a full workspace snapshot, including work, photos, marks and notes, with your own Google Drive. No other provider is used. Each upload is a new dated version; existing Drive versions are never overwritten or deleted by this app.</p>
   {!status.configured?<p role="status">Personal sync is unavailable until its separate desktop OAuth setup and privacy review are approved and configured. Capture-download access does not enable backup uploads. Local backups and file export remain available.</p>:<>
    <label className="flex gap-2"><input type="checkbox" checked={consent} disabled={busy||status.connected} onChange={e=>setConsent(e.target.checked)}/>I choose to send this workspace to my personal Drive for this session.</label>
    {!status.connected?<button disabled={busy||!consent||!userId} className="rounded border px-3 py-2" onClick={()=>void run(async()=>{if(bridge){setStatus(await unwrap(bridge.connect()));await refresh();}})}>Connect personal Drive</button>:<div className="flex gap-2"><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void run(refresh)}>Refresh Drive versions</button><button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void run(async()=>{if(bridge)setStatus(await unwrap(bridge.disconnect()));setVersions([]);setPreview(null);setConsent(false);})}>Disconnect</button></div>}
    {status.connected&&versions.length===0&&<button disabled={busy||!userId} className="rounded border px-3 py-2" onClick={()=>void run(async()=>{if(bridge){await publishFirstSnapshot(database,userId!,bridge);await refresh();setMessage('First verified Drive version saved. On the second computer, start with the same exported workspace before merging.');}})}>Save first Drive version</button>}
    <ul className="space-y-2">{versions.map(v=><li key={v.id} className="flex gap-2 items-center"><span>{new Date(v.modifiedTime).toLocaleString()}</span><button className="rounded border px-3 py-2" disabled={busy||!userId} onClick={()=>void run(async()=>{if(bridge){setPreview(await previewSync(database,userId!,v,bridge));setChoices({});}})}>Review merge</button></li>)}</ul>
   </>}
   {preview&&<div className="space-y-3"><h4 className="font-semibold">Review separate changes and conflicts</h4><p>{preview.plan.conflicts.length} conflicting records. Separate changes are combined. The full result is validated before applying; a failed or stale preview changes nothing.</p>
    <p>{preview.plan.conflicts.filter(c=>choices[c.key]).length} of {preview.plan.conflicts.length} choices made. A local safety backup is saved before applying.</p>
    {preview.plan.conflicts.map(c=><ConflictReview key={c.key} conflict={c} snapshot={preview.plan.local} choice={choices[c.key]} onChoose={choice=>setChoices({...choices,[c.key]:choice})}/>)}
    <button className="rounded border px-3 py-2" disabled={busy||preview.plan.conflicts.some(c=>!choices[c.key])} onClick={()=>void run(async()=>{if(bridge){await finishSync(database,preview,choices,bridge);await refresh();setMessage('Merged locally and saved a verified new Drive version.');}})}>Apply reviewed merge & save version</button> <button disabled={busy} className="rounded border px-3 py-2" onClick={()=>setPreview(null)}>Cancel review</button>
   </div>}
  </div>
  {busy&&<p role="status">Working…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
