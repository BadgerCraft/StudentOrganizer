// Purpose-specific personal backup transport. Tokens remain memory-only; uploads are immutable.
const { createHash, randomUUID } = require('node:crypto');
const { boundedBody, DriveError } = require('./captureDrive.cjs');
const API='https://www.googleapis.com/drive/v3/';
const MAX_BYTES=100*1024*1024;
const syncError=(message,code='unknown')=>Object.assign(new DriveError(message),{code});
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id);
function createOrganizerDrive({configured,authorize,fetchImpl=fetch,now=Date.now}) {
 let access=null,active=null,listed=new Map();
 const status=()=>({configured:configured(),connected:!!access&&access.expiresAt>now()});
 const disconnect=()=>{active?.abort();access=null;listed.clear();return status();};
 async function operation(fn){
  if(active)throw new DriveError('Another sync action is running. Wait before retrying.');
  const controller=new AbortController();active=controller;const timer=setTimeout(()=>controller.abort(),300000);
  try{const result=await fn(controller.signal);controller.signal.throwIfAborted();return result;}catch(error){if(error instanceof DriveError)throw error;throw syncError('Sync could not finish. Check the connection, then refresh Drive versions before another upload.','network');}
  finally{clearTimeout(timer);if(active===controller)active=null;}
 }
 async function request(path,signal,init={},limit=1024*1024){
  if(!configured()||!access||access.expiresAt<=now()){access=null;throw syncError('Sync access expired or setup is unavailable. Check setup and connect again.','auth');}
  const response=await fetchImpl(API+path,{...init,headers:{...init.headers,Authorization:`Bearer ${access.token}`},redirect:'error',signal});
  if(response.status===401)access=null;
  if(!response.ok){await response.body?.cancel();throw syncError(response.status===401?'Drive access expired. Reconnect, then refresh versions.':response.status===403?'Drive denied access. Use the approved account and a permitted private version; do not broaden access to bypass this check.':'Drive did not complete this action. Refresh versions before another upload.',response.status===401?'auth':response.status===403?'permission':'network');}
  return {body:await boundedBody(response,limit,signal),response};
 }
 async function json(path,signal,init){return JSON.parse((await request(path,signal,init)).body.toString('utf8'));}
 async function owner(signal){const data=await json('about?fields=user(permissionId)',signal);if(!idOK(data.user?.permissionId))throw new DriveError('Cannot verify your Drive account.');return data.user.permissionId;}
 async function verify(id,signal){
  if(!idOK(id))throw new DriveError('Invalid version identity.');
  const own=await owner(signal),m=await json(`files/${id}?fields=id,name,mimeType,parents,owners(permissionId),ownedByMe,shared,trashed,size,sha256Checksum,version,appProperties`,signal);
  const p=await json(`files/${id}/permissions?pageSize=100&fields=nextPageToken,permissions(id,type,role,deleted)`,signal);
  if(m.id!==id||m.appProperties?.studentOrganizerPurpose!=='personal-sync-v1'||m.mimeType!=='application/json'||!/^StudentOrganizer-[0-9T.Z_-]+-[a-f0-9-]+\.json$/.test(m.name)||m.ownedByMe!==true||m.shared!==false||m.trashed!==false||m.owners?.length!==1||m.owners[0].permissionId!==own||m.parents?.length!==1||p.nextPageToken||p.permissions?.length!==1||p.permissions[0].id!==own||p.permissions[0].role!=='owner'||p.permissions[0].type!=='user'||p.permissions[0].deleted===true||!/^\d+$/.test(m.size)||Number(m.size)>MAX_BYTES||Number(m.size)<1||!/^[a-f0-9]{64}$/i.test(m.sha256Checksum))throw syncError('This version is shared, moved, oversized, or cannot be verified as your private backup.','permission');
  // Only the personal root is allowed; no inherited shared-folder access.
  const root=await json('files/root?fields=id',signal);if(m.parents[0]!==root.id)throw syncError('This version moved outside your personal Drive root.','permission');
  return m;
 }
 async function download(id,signal){
  const before=await verify(id,signal),bytes=(await request(`files/${id}?alt=media`,signal,{},MAX_BYTES)).body,after=await verify(id,signal);
  if(before.version!==after.version||before.sha256Checksum!==after.sha256Checksum||bytes.length!==Number(before.size)||createHash('sha256').update(bytes).digest('hex')!==before.sha256Checksum.toLowerCase())throw new DriveError('Drive bytes changed or were interrupted. Refresh before retrying.');
  const text=bytes.toString('utf8');JSON.parse(text);return {json:text};
 }
 return {status,disconnect,
 connect:()=>operation(async signal=>{access=null;listed.clear();if(!configured())throw syncError('Personal sync setup has not been approved/configured. Use Settings local backup or export until separate setup is approved.','setup');const candidate=await authorize(signal);signal.throwIfAborted();if(!candidate?.token||!Number.isFinite(candidate.expiresAt)||candidate.expiresAt<=now())throw syncError('No usable sync access was granted. Reconnect only with the approved account and session consent.','auth');access=candidate;try{await owner(signal);}catch(e){access=null;throw e;}return status();}),
 list:()=>operation(async signal=>{
  await owner(signal);const files=[];let page;const seen=new Set();
  for(let n=0;n<100;n++){
   const query="trashed = false and 'root' in parents and 'me' in owners and appProperties has { key='studentOrganizerPurpose' and value='personal-sync-v1' }";
   const result=await json(`files?spaces=drive&corpora=user&pageSize=100&q=${encodeURIComponent(query)}&fields=nextPageToken,incompleteSearch,files(id,name,modifiedTime)&orderBy=modifiedTime%20desc${page?'&pageToken='+encodeURIComponent(page):''}`,signal);
   if(result.incompleteSearch||!Array.isArray(result.files))throw new DriveError('Drive returned an incomplete version list.');
   for(const f of result.files)if(!idOK(f.id)||typeof f.name!=='string'||typeof f.modifiedTime!=='string')throw new DriveError('Invalid Drive version list.');
   files.push(...result.files);if(!result.nextPageToken){listed=new Map(files.map(f=>[f.id,f]));return files;}
   page=result.nextPageToken;if(typeof page!=='string'||page.length>2000||seen.has(page))throw new DriveError('Invalid Drive page.');seen.add(page);
  }throw new DriveError('Too many Drive versions. Review them in Drive before syncing.');
 }),
 download:id=>operation(async signal=>{if(!listed.has(id))throw new DriveError('Refresh and choose a listed version.');return download(id,signal);}),
 upload:text=>operation(async signal=>{
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)throw syncError('Backup exceeds the supported sync size (100 MB). Use local export.','invalid');
  const parsed=JSON.parse(text);if(parsed?.schemaVersion!==5||parsed.version!==2||!parsed.tables)throw syncError('Unsupported snapshot format.','invalid');
  await owner(signal);
  // Generate a new identity for every version: never update or delete an existing backup.
  const generated=await json('files/generateIds?count=1&space=drive&type=files',signal);const id=generated.ids?.[0];if(!idOK(id))throw new DriveError('Could not allocate a backup identity.');
  const name='StudentOrganizer-'+new Date(now()).toISOString().replace(/:/g,'_')+'-'+randomUUID()+'.json';
  const metadata={id,name,mimeType:'application/json',parents:['root'],appProperties:{studentOrganizerPurpose:'personal-sync-v1'}};
  // Resumable initiation supports large snapshots; never follow a renderer-supplied URL.
  if(!access||access.expiresAt<=now())throw syncError('Sync access expired. Reconnect and refresh versions.','auth');
  try {
   const start=await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',{
    method:'POST',headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(Buffer.byteLength(text))},body:JSON.stringify(metadata),redirect:'error',signal});
   if(start.status===401)access=null;
   if(!start.ok){await start.body?.cancel();throw syncError('Upload initiation was not confirmed. Refresh versions before another upload.',start.status===401?'auth':start.status===403?'permission':'uncertain');}
   const location=start.headers.get('location');await start.body?.cancel();
   let session;try{session=new URL(location);}catch{throw new DriveError('Drive returned an invalid upload session. No snapshot bytes were sent.');}
   if(session.origin!=='https://www.googleapis.com'||session.pathname!=='/upload/drive/v3/files'||session.username||session.password||session.hash||session.searchParams.get('uploadType')!=='resumable'||!session.searchParams.get('upload_id'))throw new DriveError('Drive returned an untrusted upload session. No snapshot bytes were sent.');
   signal.throwIfAborted();if(!access||access.expiresAt<=now())throw syncError('Sync access expired. Reconnect and refresh versions.','auth');
   const response=await fetchImpl(session.href,{method:'PUT',headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(text))},body:text,redirect:'error',signal});
   if(response.status===401)access=null;
   if(!response.ok){await response.body?.cancel();throw syncError('Upload outcome was not confirmed. Refresh versions before another upload.',response.status===401?'auth':response.status===403?'permission':'uncertain');}
   await boundedBody(response,1024*1024,signal);
  } catch(error) { if(error instanceof DriveError)throw error;throw syncError('Upload outcome is uncertain. Refresh Drive versions and inspect the newest version before another upload.','uncertain'); }
  let verified;try{verified=await download(id,signal);if(verified.json!==text)throw new Error('mismatch');}catch(error){throw syncError('Uploaded backup could not be verified. Refresh versions and inspect the newest version before another upload.',['auth','permission'].includes(error.code)?error.code:'uncertain');}
  listed.set(id,{id,name,modifiedTime:new Date(now()).toISOString()});return {id};
 })};
}
module.exports={createOrganizerDrive,MAX_BYTES};
