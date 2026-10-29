import { createCropEditor } from './cropEditor';
import { CaptureDB, listBatchSummaries, deleteSavedBatch, openLateWork, emptyBatch, recoverBatch, save, readPhoto, appendPages, movePage, removePage, saveGroup, completeBatch, exportBatch, exportSavedBatch, defaultEdits, type Batch, type Page } from './store';
import { drawCapturePreview } from '../../../shared/capturePreview';
import { inspectMarkingImage } from '../../../src/marking/importImages';
import { transferStatus, captureTransferStatus, acceptedReceipt, transferZip } from './native';
import './style.css';
const root = document.querySelector<HTMLDivElement>('#app')!;
if (window.CaptureNative) document.documentElement.classList.add('native-app');
root.innerHTML = `
<header><div><p class="eyebrow">Student Organizer · fictional-data pilot</p><h1>Phone capture</h1></div><button id="theme" aria-label="Switch to light mode">Light mode</button></header>
<p id="status" role="status" aria-live="polite">Opening local assignments…</p>
<fieldset id="controls" disabled>
<nav aria-label="Capture navigation"><button id="home">Home</button><button id="new">New assignment</button></nav>
<section id="home-view" aria-labelledby="home-title"><h2 id="home-title">Saved assignments</h2><p>Resume a student’s pages or open a completed package to transfer it.</p><div id="home-list"></div></section>
<section id="editor-view" aria-labelledby="task-title">
<div class="task-heading"><p id="step" class="eyebrow"></p><h2 id="task-title" tabindex="-1"></h2><p id="phase"></p></div>
<p id="local-status" role="status"></p>
<details id="package-details"><summary>Assignment &amp; saved packages</summary><label>Saved assignments<select id="archive"></select></label><section id="assignment-history" aria-label="Linked assignment history"></section><button id="delete" class="danger">Delete this package</button></details>
<p id="late-work-help" class="notice" hidden>Capture only the new work or additional pages. The completed package stays unchanged. On desktop, choose the student and explicitly append to their existing draft. Finalized or archived marking cannot receive appended pages.</p>
<section id="setup"><label>Assignment name<input id="assignment" maxlength="120" placeholder="Class · assignment name" autocomplete="off"></label><button id="name" class="primary">Save assignment name</button></section>
<section id="intake" aria-label="Capture this student’s pages"><button id="native-camera" class="primary">Start continuous camera</button><label id="browser-camera" class="file-action">Take a photo (browser)<input id="camera" type="file" accept="image/jpeg,image/png" capture="environment"></label><label class="file-action">Import photos for this student<input id="files" type="file" accept="image/jpeg,image/png" multiple></label><p>Keep capturing pages for this student, then preview and label the set.</p><details><summary>Capture limits &amp; camera help</summary><p>Up to 40 students × 10 pages; 8 MB / 20 megapixels per photo; 800 megapixels and 256 MB per assignment including retained originals. Cancel the native camera when ready to Preview. Camera cancellation keeps saved pages.</p></details><button id="preview" class="primary">Preview this student</button></section>
<section id="pages" aria-label="Current student pages"></section>
<section id="label-section"><label>Student name label<input id="label" maxlength="120" required aria-describedby="label-help" autocomplete="off"></label><p id="label-help">Required label only. Choose the actual student on desktop; no automatic matching.</p><div class="actions"><button id="save-group" class="primary">Save &amp; Finish</button><button id="resume">Back — take more photos</button></div><button id="discard-draft" class="danger">Discard current student draft</button></section>
<section id="saved-summary"><h3 id="groups-title">Saved students</h3><section id="groups" aria-label="Saved student groups"></section></section>
<section id="complete-action"><p>When every student’s set is saved, finish the assignment on this device.</p><button id="done" class="primary">All done — complete locally</button></section>
<section id="delivery" aria-label="Transfer completed assignment"><h3>Transfer to your computer</h3><p>Export a ZIP backup or deliberately send to private Drive. On desktop, match each label to a student yourself.</p><button id="export" class="primary">Export local ZIP</button><section aria-label="Drive delivery for this package"><h3>Private Drive</h3><p id="delivery-status" role="status" aria-live="polite"></p><p id="delivery-detail"></p><button id="drive-queue">Transfer completed ZIP to private Drive</button><button id="drive-settings">Private Drive settings</button><p id="transfer-status"></p></section><button id="late-work">Add late work</button></section>
</section></fieldset>
<footer><details><summary>Privacy &amp; keeping your photos</summary><p>No AI processing. Originals stay on this device until you explicitly delete the assignment. Browser storage can be cleared: export and verify a local ZIP backup. Completing an assignment does not upload it.</p></details></footer>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function applyTheme(light:boolean) {
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  el('theme').textContent = light ? 'Dark mode' : 'Light mode';
  el('theme').setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} mode`);
}
applyTheme(localStorage.getItem('capture-theme') === 'light');
el('theme').onclick = () => { const light = document.documentElement.dataset.theme !== 'light'; applyTheme(light); localStorage.setItem('capture-theme', light ? 'light' : 'dark'); };
const db = new CaptureDB(); let batch = emptyBatch(), busy = false; let renderGeneration = 0; let view: 'home'|'editor' = localStorage.getItem('capture-view') === 'editor' ? 'editor' : 'home';
const status = (message:string) => { el('status').textContent = message; };
async function persist(next:Batch) { batch = await save(db,next); status(`Saved locally · ${batch.groups.length} student group(s), ${batch.pages.length} current page(s).`); }
async function render() {
  const generation = ++renderGeneration;
  const archived = await listBatchSummaries(db);
  if (generation !== renderGeneration) return;
  el('home-view').hidden = view !== 'home'; el('editor-view').hidden = view !== 'editor';
  localStorage.setItem('capture-view', view);
  el('home-list').replaceChildren();
  if (!archived.length) { const empty = document.createElement('p'); empty.textContent = 'No saved assignments yet. Choose New assignment to start.'; el('home-list').append(empty); }
  for (const item of archived) {
    const card = document.createElement('article'); const title = document.createElement('h3'); title.textContent = item.assignment || 'Unnamed assignment';
    const local = document.createElement('p'); local.textContent = `${item.completed ? 'Completed and saved on this device' : 'Draft saved on this device'}${item.parentBatchId ? ' · late work' : ''}`;
    const open = document.createElement('button'); open.textContent = item.completed ? 'Open completed package' : 'Resume draft'; open.dataset.batchId = item.id;
    open.onclick = () => void run(async () => { await preserveDraftName(); const saved = await db.batches.get(item.id); if (!saved) throw new Error('This package was deleted. Refresh Home.'); batch = recoverBatch(saved); view = 'editor'; if (!batch.completed) await drainNative(); });
    card.append(title, local, open); el('home-list').append(card);
  }
  const select = el<HTMLSelectElement>('archive'); select.replaceChildren();
  for (const item of archived) select.add(new Option(`${item.assignment || 'Unnamed assignment'}${item.parentBatchId ? ' · late work' : ''}${item.completed ? ' · completed' : ' · in progress'} (${item.id.slice(0,8)})`,item.id));
  if (!archived.some(a => a.id === batch.id)) select.add(new Option('New assignment',batch.id)); select.value = batch.id;
  if (archived.some(item => item.id === batch.id)) localStorage.setItem('capture-selected-batch', batch.id);
  el<HTMLButtonElement>('delete').disabled = !archived.some(a => a.id === batch.id);
  el<HTMLButtonElement>('late-work').hidden = !batch.completed;
  const related = archived.filter(item => item.assignmentId === batch.assignmentId);
  el<HTMLButtonElement>('late-work').textContent = related.some(item => item.parentBatchId && !item.completed) ? 'Continue late work' : 'Add late work';
  el('late-work-help').hidden = !batch.parentBatchId;
  el('assignment-history').replaceChildren();
  if (batch.parentBatchId || related.length > 1) {
    const title = document.createElement('h2'); title.textContent = 'Linked assignment packages'; el('assignment-history').append(title);
    for (const item of related) {
      const button = document.createElement('button'); button.textContent = `${item.parentBatchId ? 'Late work' : 'Original package'} · ${item.completed ? 'completed' : 'draft'} (${item.id.slice(0,8)})`;
      button.dataset.batchId = item.id; button.disabled = item.id === batch.id;
      button.onclick = () => void run(async () => { await preserveDraftName(); const saved = await db.batches.get(item.id); if (saved) batch = recoverBatch(saved); else throw new Error('This linked package was deleted. Reload to refresh the list.'); });
      el('assignment-history').append(button);
    }
    if (batch.parentBatchId && !related.some(item => item.id === batch.parentBatchId)) {
      const note = document.createElement('p'); note.textContent = 'The earlier local package was deleted. This late-work package is retained independently.'; el('assignment-history').append(note);
    }
  }
  el<HTMLInputElement>('assignment').value = batch.assignment;
  el<HTMLInputElement>('assignment').disabled = batch.completed || !!batch.parentBatchId || !!batch.pages.length || !!batch.groups.length;
  el<HTMLButtonElement>('name').disabled = el<HTMLInputElement>('assignment').disabled;
  const setup = !batch.assignment;
  el('task-title').textContent = setup ? 'Name this assignment' : batch.assignment;
  el('step').textContent = batch.completed ? 'Complete · transfer' : setup ? 'Assignment setup' : batch.stage === 'preview' ? 'Preview & label' : 'Capture · one student at a time';
  // A saved name becomes secondary context; keep renaming in package details.
  if (setup) el('editor-view').insertBefore(el('setup'), el('intake'));
  else el('package-details').append(el('setup'));
  el('setup').hidden = batch.completed || !!batch.pages.length || !!batch.groups.length || !!batch.parentBatchId;
  el('delivery').hidden = !batch.completed;
  el('saved-summary').hidden = !batch.groups.length || batch.stage === 'preview' || !!batch.pages.length;
  el('complete-action').hidden = batch.completed || !batch.groups.length || batch.stage === 'preview' || !!batch.pages.length;
  el('groups-title').textContent = `${batch.groups.length} saved student set${batch.groups.length === 1 ? '' : 's'}`;
  el('phase').textContent = setup ? 'Use your class and assignment name to keep this batch recognizable.' : batch.completed ? 'Completed on this device · ready for deliberate export or transfer' : batch.stage === 'preview' ? 'Preview, edit, then label this student’s page set' : 'Capture pages for one student';
  el('intake').hidden = setup || batch.completed || batch.stage === 'preview'; el('label-section').hidden = batch.completed || batch.stage !== 'preview';
  el<HTMLInputElement>('label').value = batch.draftLabel;
  el('native-camera').hidden = !window.CaptureNative?.startCamera;
  el('name').classList.toggle('primary', setup);
  el<HTMLButtonElement>('native-camera').disabled = !window.CaptureNative?.startCamera || !batch.assignment || batch.pages.length >= 10 || batch.groups.length >= 40;
  el('browser-camera').hidden = !!window.CaptureNative?.startCamera;
  for (const id of ['camera','files','preview']) el<HTMLInputElement>(id).disabled = !batch.assignment;
  el('native-camera').classList.toggle('primary', !batch.pages.length);
  el<HTMLButtonElement>('preview').hidden = !batch.pages.length;
  el<HTMLButtonElement>('preview').disabled = !batch.assignment || !batch.pages.length;
  el<HTMLButtonElement>('done').disabled = batch.completed || !batch.groups.length || !!batch.pages.length || !!batch.draftLabel;
  el<HTMLButtonElement>('export').disabled = !batch.completed;
  el('local-status').textContent = batch.completed ? 'Completed and saved on this device. Drive delivery is confirmed separately below.' : batch.revision > 0 ? `Draft saved on this device · ${batch.groups.length} student group(s), ${batch.pages.length} current page(s).` : 'Not saved yet. Enter an assignment name to start.';
  renderTransfer();
  el('pages').replaceChildren();
  for (const [index,p] of batch.pages.entries()) {
    const article = document.createElement('article'); article.classList.toggle('capture-thumbnail', batch.stage !== 'preview'); const heading = document.createElement('h2'); heading.textContent = `Page ${index+1}`;
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label',`Preview of page ${index+1}`); article.append(heading,canvas);
    void drawCapturePreview(canvas,p.bytes,p.mime,p.edits).catch(() => { if (generation === renderGeneration) status('Photo preview failed. Original remains saved; remove this photo or retry.'); });
    const button = (title:string, action:()=>Promise<void>) => { const b=document.createElement('button'); b.textContent=title; b.onclick=()=>void run(action); article.append(b); return b; };
    if (batch.stage === 'preview') {
      button('Rotate 90°',()=>editPage(index,{ ...p, edits:{ ...p.edits, rotation: ((p.edits.rotation+90)%360) as Page['edits']['rotation'] } }));
      button('Move up',()=>persist(movePage(batch,index,-1))).disabled=index===0;
      button('Move down',()=>persist(movePage(batch,index,1))).disabled=index===batch.pages.length-1;
      button('Remove photo',()=>persist(removePage(batch,index)));
      const cropDetails = document.createElement('details');
      const cropSummary = document.createElement('summary'); cropSummary.textContent = 'Crop photo';
      cropDetails.append(cropSummary, createCropEditor(p, crop => void run(() => editPage(index,{...p,edits:{...p.edits,crop}}))));
      article.append(cropDetails);
      button('Restore original view',()=>editPage(index,{...p,edits:defaultEdits()}));
    }
    el('pages').append(article);
  }
  el('groups').replaceChildren();
  for (const group of batch.groups) {const item=document.createElement('article');const text=document.createElement('p');text.textContent=`${group.label} · ${group.pages.length} page(s)`;item.append(text);if (!batch.completed) {const b=document.createElement('button');b.textContent='Reopen group';b.disabled=!!batch.pages.length;b.onclick=()=>void run(()=>persist({...batch,groups:batch.groups.filter(g=>g.id!==group.id),pages:group.pages,draftLabel:group.label,stage:'preview', editingGroupId:group.id,draftGroupId:group.id}));item.append(b);}el('groups').append(item);}
}
async function preserveDraftName() {
  if (view !== 'editor' || el<HTMLInputElement>('assignment').disabled) return;
  const assignment = el<HTMLInputElement>('assignment').value.trim();
  if (assignment !== batch.assignment) await persist({...batch, assignment});
}
async function editPage(index:number,page:Page) { await persist({...batch,pages:batch.pages.map((p,i)=>i===index?page:p)}); }
async function run(action:()=>Promise<void>) {
  if (busy) return;
  const previousTask = `${view}:${batch.id}:${batch.completed}:${batch.stage}:${!!batch.assignment}`;
  const focused = document.activeElement as HTMLElement | null;
  busy=true;el<HTMLFieldSetElement>('controls').disabled=true;
  const startingBatchId=batch.id, label=el<HTMLInputElement>('label').value, name=el<HTMLInputElement>('assignment').value; let failed=false;
  try {if (!batch.completed && label!==batch.draftLabel) await persist({...batch,draftLabel:label}); await action();}
  catch(error) {failed=true;status(`Not completed: ${error instanceof Error?error.message:String(error)} Saved photos remain; retry.`);}
  finally {try{await render();if(failed&&batch.id===startingBatchId){el<HTMLInputElement>('label').value=label;if(!el<HTMLInputElement>('assignment').disabled)el<HTMLInputElement>('assignment').value=name;}}catch(error){status(`Could not refresh saved assignments: ${String(error)}. Saved photos remain; reload to recover.`);}finally{
    busy=false;el<HTMLFieldSetElement>('controls').disabled=false;
    const nextTask = `${view}:${batch.id}:${batch.completed}:${batch.stage}:${!!batch.assignment}`;
    if (failed) el('status').scrollIntoView({block:'nearest'});
    else if (previousTask !== nextTask) {
      const heading = el(view === 'home' ? 'home-title' : 'task-title');
      heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true});
      heading.scrollIntoView({block:'start'});
    } else if (focused?.isConnected && focused.getClientRects().length) focused.focus({preventScroll:true});
    else if (focused && focused !== document.body) el('task-title').focus({preventScroll:true});
  }}
}
async function preparePhoto(file:File,id?:string):Promise<Page> {
  let photo=await readPhoto(file); inspectMarkingImage(photo.bytes);
  await drawCapturePreview(document.createElement('canvas'),photo.bytes,photo.mime,photo.edits);
  if(id)photo={...photo,id};return photo;
}
async function persistPhoto(photo:Page){
  if([...batch.pages,...batch.groups.flatMap(g=>g.pages),...batch.removed].some(p=>p.id===photo.id))return;
  await persist(appendPages(batch,[photo]));
}
async function intake(file:File,id?:string){await persistPhoto(await preparePhoto(file,id));}
for (const id of ['files','camera']) el<HTMLInputElement>(id).onchange=event=> {const input=event.target as HTMLInputElement;const files=Array.from(input.files??[]);input.value='';if(files.length)void run(async()=>{for(const file of files)await intake(file);});};
el('name').onclick=()=> {const name=el<HTMLInputElement>('assignment').value.trim();void run(async()=> {if(!name)throw new Error('Enter an assignment name.');await persist({...batch,assignment:name});});};
el('preview').onclick=()=>void run(async()=>{if(!batch.pages.length)throw new Error('Capture at least one photo.');await persist({...batch,stage:'preview'});});
el('resume').onclick=()=>void run(()=>persist({...batch,stage:'capture'}));
el('discard-draft').onclick=()=>{if(confirm('Discard this student draft? Its original photos remain in this assignment until you delete the assignment.'))void run(async()=>{await drainNative();await persist({...batch,removed:[...batch.removed,...batch.pages],pages:[],draftLabel:'',editingGroupId:undefined,draftGroupId:crypto.randomUUID(),stage:'capture'});localStorage.removeItem('capture-camera-batch');});};
el('save-group').onclick=()=>void run(async()=>{await drainNative();await persist(saveGroup(batch));localStorage.removeItem('capture-camera-batch');});
el('done').onclick=()=> {if(confirm('Complete this package on this device? Saved student groups will be frozen and originals retained. Sending to Drive is a separate step.'))void run(async()=>{await drainNative();const completed=completeBatch(batch);status('Checking all photos and the completed ZIP before freezing. Keep this screen open…');await exportBatch({...completed,revision:completed.revision+1});await persist(completed);});};
el('late-work').onclick=()=>{if(confirm('Open a separate late-work package for this assignment? The completed package stays unchanged.'))void run(async()=>{batch=await openLateWork(db,batch);await drainNative();status('Opened linked late-work draft. Capture only the new student work or additional pages.');});};
el('home').onclick=()=>void run(async()=>{await preserveDraftName();view='home';status('Home · saved assignments. Packages remain on this device.');});
el('new').onclick=()=>void run(async()=>{await preserveDraftName();const next=await save(db,emptyBatch());batch=next;view='editor';status('New assignment saved locally. Enter its name.');});
el<HTMLSelectElement>('archive').onchange=event=>{const id=(event.target as HTMLSelectElement).value;void run(async()=>{await preserveDraftName();const saved=await db.batches.get(id);if(saved)batch=recoverBatch(saved);});};
el('delete').onclick=()=>{if(confirm('Permanently delete this package and its local originals? Linked late-work packages, downloaded copies and Drive copies remain separate. Export and verify your ZIP first.'))void run(async()=>{await deleteSavedBatch(db,batch,()=>{if(window.CaptureNative?.deleteAssignment)acceptedReceipt(window.CaptureNative.deleteAssignment(batch.id,batch.captureId));});batch=emptyBatch();await persist(batch);});};
el('export').onclick=()=>void run(async()=>{const bytes=await exportSavedBatch(db,batch);if(window.CaptureNative){status(await transferZip(window.CaptureNative,bytes,batch,'local'));return;}const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=`capture-${batch.captureId}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('ZIP download requested. Verify the saved file. Local originals retained.');});
el('drive-queue').onclick=()=>void run(async()=>{if(!window.CaptureNative)throw new Error('Native transfer unavailable.');status(await transferZip(window.CaptureNative,await exportSavedBatch(db,batch),batch,'drive'));});
el('drive-settings').onclick=()=>window.CaptureNative?.requestDriveSetup();
for (const id of ['assignment','label']) el<HTMLInputElement>(id).addEventListener('input',()=>{el('local-status').textContent='Unsaved changes on this screen. Choose Save or Home to keep them on this device.';});
function renderTransfer() {
  const settings=transferStatus(window.CaptureNative), delivery=captureTransferStatus(window.CaptureNative,batch.captureId,batch.revision);
  const titles = { NOT_QUEUED:'Not sent to Drive', QUEUED:'Queued — Drive delivery not yet confirmed', UPLOADING:'Uploading — Drive delivery not yet confirmed', RETRY:'Retry needed — Drive delivery not confirmed', NEEDS_AUTH:'Reconnect Drive — delivery not confirmed', BLOCKED:'Transfer blocked — Drive delivery not confirmed', PAUSED:'Transfer paused — Drive delivery not confirmed', COMPLETE:'Verified on Drive', UNAVAILABLE:'Drive delivery not confirmed' };
  el('delivery-status').textContent=batch.completed?titles[delivery.state]:'Draft only — finish with All done before sending to Drive';
  el('delivery-status').dataset.state=batch.completed?delivery.state:'DRAFT';
  el('delivery-detail').textContent=batch.completed ? `${delivery.message}${delivery.state==='RETRY' ? ' Your local copy is retained. Retry the transfer; an expired upload session does not confirm delivery.' : ''}` : 'Saving pages or completing a package does not upload it. Local originals are retained.';
  el('transfer-status').textContent=settings.summary;
  const button=el<HTMLButtonElement>('drive-queue');
  button.disabled=!batch.completed||!settings.available||!settings.enabled||['QUEUED','UPLOADING','COMPLETE'].includes(delivery.state);
  button.textContent=delivery.state==='RETRY'?'Retry Drive transfer':'Transfer completed ZIP to private Drive';
  el<HTMLButtonElement>('drive-settings').disabled=!window.CaptureNative;
}
function refreshTransfer(){if(!busy)renderTransfer();}
window.addEventListener('focus',refreshTransfer);document.addEventListener('visibilitychange',refreshTransfer);setInterval(refreshTransfer,3000);
el('native-camera').onclick=()=>void run(async()=>{if(window.CaptureNative?.startCamera){status(acceptedReceipt(window.CaptureNative.startCamera(batch.id,batch.draftGroupId,10-batch.pages.length)));localStorage.setItem('capture-camera-batch',batch.id);}});
let pendingNative=false, pendingPreview=false;
async function drainNative() {
  const bridge=window.CaptureNative;
  if(!bridge?.getPendingCaptures||!bridge.readPendingCapture)return;
  const items=JSON.parse(bridge.getPendingCaptures(batch.id,batch.draftGroupId)) as {id:string}[];
  if(!Array.isArray(items))throw new Error('Native camera recovery is unavailable. Reopen the assignment and retry.');
  for(const item of items){
    const value=JSON.parse(bridge.readPendingCapture(item.id,batch.id,batch.draftGroupId)) as {id:string,dataUrl?:string,error?:string};
    if(!value.dataUrl){if(bridge.discardPendingCapture && confirm('This interrupted capture cannot be read. Omit it from this student group while retaining the native original?')){acceptedReceipt(bridge.discardPendingCapture(item.id,batch.id,batch.draftGroupId));continue;}throw new Error(value.error??'Native photo could not be recovered.');}
    const match=/^data:(image\/(?:jpeg|png));base64,(.*)$/.exec(value.dataUrl);
    if(!match)throw new Error('Native photo could not be recovered.');
    const raw=atob(match[2]); const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    let photo:Page;
    try{photo=await preparePhoto(new File([bytes],`${item.id}.jpg`,{type:match[1]}),item.id);}
    catch(error){if(bridge.discardPendingCapture && confirm('This recovered photo is invalid or cannot be decoded. Omit it from this group while retaining the native original?')){acceptedReceipt(bridge.discardPendingCapture(item.id,batch.id,batch.draftGroupId));continue;}throw error;}
    // Storage/quota errors must retry, never offer to discard a valid original.
    await persistPhoto(photo);
    if(bridge.acknowledgeCapture)acceptedReceipt(bridge.acknowledgeCapture(item.id,batch.id,batch.draftGroupId));
  }
  if(pendingPreview && batch.pages.length && !batch.completed){await persist({...batch,stage:'preview'});pendingPreview=false;}
}
async function recoverNative(){if(busy){pendingNative=true;return;}await run(drainNative);}
window.addEventListener('capture-photo',()=>void recoverNative());
window.addEventListener('capture-preview',()=>{pendingPreview=true;void recoverNative();});
setInterval(()=>{if(pendingNative&&!busy){pendingNative=false;void recoverNative();}},500);
window.addEventListener('beforeunload',event=>{if(busy||el<HTMLInputElement>('label').value!==batch.draftLabel||(!el<HTMLInputElement>('assignment').disabled&&el<HTMLInputElement>('assignment').value.trim()!==batch.assignment)){event.preventDefault();event.returnValue='';}});
try {const rows=await listBatchSummaries(db);const selected=rows.find(b=>b.id===localStorage.getItem('capture-camera-batch'))??rows.find(b=>b.id===localStorage.getItem('capture-selected-batch'))??rows.find(b=>!b.completed)??rows[0];batch=selected?recoverBatch(await db.batches.get(selected.id)??emptyBatch()):emptyBatch();await render();el<HTMLFieldSetElement>('controls').disabled=false;status('Opened local assignments. Saved pages and groups retained.');if(batch.assignment&&!batch.completed)await recoverNative();}
catch(error){status(`Local storage could not open: ${String(error)}. No changes made.`);}
