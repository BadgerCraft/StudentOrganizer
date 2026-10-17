import { CaptureDB, listBatchSummaries, deleteSavedBatch, openLateWork, emptyBatch, recoverBatch, save, readPhoto, appendPages, movePage, removePage, saveGroup, completeBatch, exportBatch, exportSavedBatch, defaultEdits, type Batch, type Page } from './store';
import { drawCapturePreview } from '../../../shared/capturePreview';
import { inspectMarkingImage } from '../../../src/marking/importImages';
import { transferStatus, acceptedReceipt, transferZip } from './native';
import './style.css';
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<h1>Phone capture</h1><p>Fictional-data pilot · no AI processing</p><p class="notice">Name an assignment, capture one student’s pages, then Preview and label the set. Originals stay here until you explicitly delete the assignment. Keep a local ZIP backup: browser storage can be cleared.</p><p id="status" role="status" aria-live="polite">Opening local assignments…</p><fieldset id="controls" disabled>
<label>Saved assignments<select id="archive"></select></label><button id="new">New assignment</button><button id="delete">Delete this package</button><button id="late-work">Add late work</button><section id="assignment-history" aria-label="Linked assignment history"></section><p id="late-work-help" hidden>Capture only the new work or additional pages. The completed package stays unchanged. On desktop, choose the student and explicitly append to their existing draft. Finalized or archived marking cannot receive appended pages.</p>
<label>Assignment name<input id="assignment" maxlength="120" placeholder="Fictional leaf study"></label><button id="name">Save assignment name</button>
<p id="phase"></p><section id="intake"><button id="native-camera">Start continuous camera</button><label id="browser-camera">Take a photo (browser)<input id="camera" type="file" accept="image/jpeg,image/png" capture="environment"></label><label>Import photos for this student<input id="files" type="file" accept="image/jpeg,image/png" multiple></label><small>Up to 40 students × 10 pages; 8 MB / 20 megapixels per photo; 800 megapixels and 256 MB per assignment including retained originals. Cancel the native camera when ready to Preview. Camera cancellation keeps saved pages.</small><button id="preview">Preview this student</button></section>
<section id="pages" aria-label="Current student pages"></section><section id="label-section"><label>Student name label<input id="label" maxlength="120"></label><small>This is a label only. Choose the actual student on desktop.</small><button id="save-group">Save student group</button><button id="resume">Take more photos</button><button id="discard-draft">Discard current student draft</button></section>
<section id="groups" aria-label="Saved student groups"></section><button id="done">All done — freeze assignment</button><button id="export">Export local ZIP</button><button id="drive-queue">Transfer completed ZIP to private Drive</button><button id="drive-settings">Private Drive settings</button><p id="transfer-status"></p></fieldset>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const db = new CaptureDB(); let batch = emptyBatch(), busy = false; let renderGeneration = 0;
const status = (message:string) => { el('status').textContent = message; };
async function persist(next:Batch) { batch = await save(db,next); status(`Saved locally · ${batch.groups.length} student group(s), ${batch.pages.length} current page(s).`); }
async function render() {
  const generation = ++renderGeneration;
  const archived = await listBatchSummaries(db);
  if (generation !== renderGeneration) return;
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
      button.onclick = () => void run(async () => { const saved = await db.batches.get(item.id); if (saved) batch = recoverBatch(saved); else throw new Error('This linked package was deleted. Reload to refresh the list.'); });
      el('assignment-history').append(button);
    }
    if (batch.parentBatchId && !related.some(item => item.id === batch.parentBatchId)) {
      const note = document.createElement('p'); note.textContent = 'The earlier local package was deleted. This late-work package is retained independently.'; el('assignment-history').append(note);
    }
  }
  el<HTMLInputElement>('assignment').value = batch.assignment;
  el<HTMLInputElement>('assignment').disabled = batch.completed || !!batch.parentBatchId || !!batch.pages.length || !!batch.groups.length;
  el<HTMLButtonElement>('name').disabled = el<HTMLInputElement>('assignment').disabled;
  el('phase').textContent = batch.completed ? 'Completed assignment · ready for deliberate export or transfer' : batch.stage === 'preview' ? 'Preview, edit, then label this student’s page set' : 'Capture pages for one student';
  el('intake').hidden = batch.completed || batch.stage === 'preview'; el('label-section').hidden = batch.completed || batch.stage !== 'preview';
  el<HTMLInputElement>('label').value = batch.draftLabel;
  el<HTMLButtonElement>('native-camera').disabled = !window.CaptureNative?.startCamera || !batch.assignment || batch.pages.length >= 10 || batch.groups.length >= 40;
  el('browser-camera').hidden = !!window.CaptureNative?.startCamera;
  for (const id of ['camera','files','preview']) el<HTMLInputElement>(id).disabled = !batch.assignment;
  el<HTMLButtonElement>('done').disabled = batch.completed || !batch.groups.length || !!batch.pages.length || !!batch.draftLabel;
  el<HTMLButtonElement>('export').disabled = !batch.completed;
  const transfer = transferStatus(window.CaptureNative);
  el('transfer-status').textContent = transfer.summary;
  el<HTMLButtonElement>('drive-queue').disabled = !batch.completed || !transfer.available || !transfer.enabled;
  el<HTMLButtonElement>('drive-settings').disabled = !window.CaptureNative;
  el('pages').replaceChildren();
  for (const [index,p] of batch.pages.entries()) {
    const article = document.createElement('article'); const heading = document.createElement('h2'); heading.textContent = `Page ${index+1}`;
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label',`Preview of page ${index+1}`); article.append(heading,canvas);
    void drawCapturePreview(canvas,p.bytes,p.mime,p.edits).catch(() => { if (generation === renderGeneration) status('Photo preview failed. Original remains saved; remove this photo or retry.'); });
    const button = (title:string, action:()=>Promise<void>) => { const b=document.createElement('button'); b.textContent=title; b.onclick=()=>void run(action); article.append(b); return b; };
    if (batch.stage === 'preview') {
      button('Rotate 90°',()=>editPage(index,{ ...p, edits:{ ...p.edits, rotation: ((p.edits.rotation+90)%360) as Page['edits']['rotation'] } }));
      button('Move up',()=>persist(movePage(batch,index,-1))).disabled=index===0;
      button('Move down',()=>persist(movePage(batch,index,1))).disabled=index===batch.pages.length-1;
      button('Remove photo',()=>persist(removePage(batch,index)));
      const crop = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent='Crop edges (% of original photo)'; crop.append(legend);
      const values = [p.edits.crop.x*100,p.edits.crop.y*100,(1-p.edits.crop.x-p.edits.crop.width)*100,(1-p.edits.crop.y-p.edits.crop.height)*100];
      const inputs = ['Left','Top','Right','Bottom'].map((name,i)=> { const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='number';input.min='0';input.max='95';input.step='1';input.value=String(Math.round(values[i]));label.append(input);crop.append(label);return input; });article.append(crop);
      button('Apply crop',async()=> {const [left,top,right,bottom]=inputs.map(input=>Number(input.value)/100);if (![left,top,right,bottom].every(v=>Number.isFinite(v)&&v>=0&&v<1)||left+right>=1||top+bottom>=1) throw new Error('Crop must leave some of the photo visible.');await editPage(index,{...p,edits:{...p.edits,crop:{x:left,y:top,width:1-left-right,height:1-top-bottom}}});});
      button('Restore original view',()=>editPage(index,{...p,edits:defaultEdits()}));
    }
    el('pages').append(article);
  }
  el('groups').replaceChildren();
  for (const group of batch.groups) {const item=document.createElement('article');const text=document.createElement('p');text.textContent=`${group.label} · ${group.pages.length} page(s)`;item.append(text);if (!batch.completed) {const b=document.createElement('button');b.textContent='Reopen group';b.disabled=!!batch.pages.length;b.onclick=()=>void run(()=>persist({...batch,groups:batch.groups.filter(g=>g.id!==group.id),pages:group.pages,draftLabel:group.label,stage:'preview', editingGroupId:group.id,draftGroupId:group.id}));item.append(b);}el('groups').append(item);}
}
async function editPage(index:number,page:Page) { await persist({...batch,pages:batch.pages.map((p,i)=>i===index?page:p)}); }
async function run(action:()=>Promise<void>) {
  if (busy) return; busy=true;el<HTMLFieldSetElement>('controls').disabled=true;
  const label=el<HTMLInputElement>('label').value; let failed=false;
  try {if (!batch.completed && label!==batch.draftLabel) await persist({...batch,draftLabel:label}); await action();}
  catch(error) {failed=true;status(`Not completed: ${error instanceof Error?error.message:String(error)} Saved photos remain; retry.`);}
  finally {try{await render();if(failed)el<HTMLInputElement>('label').value=label;}catch(error){status(`Could not refresh saved assignments: ${String(error)}. Saved photos remain; reload to recover.`);}finally{busy=false;el<HTMLFieldSetElement>('controls').disabled=false;}}
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
el('done').onclick=()=> {if(confirm('All done? This freezes all saved student groups. Originals will remain here.'))void run(async()=>{await drainNative();const completed=completeBatch(batch);status('Checking all photos and the completed ZIP before freezing. Keep this screen open…');await exportBatch({...completed,revision:completed.revision+1});await persist(completed);});};
el('late-work').onclick=()=>{if(confirm('Open a separate late-work package for this assignment? The completed package stays unchanged.'))void run(async()=>{batch=await openLateWork(db,batch);await drainNative();status('Opened linked late-work draft. Capture only the new student work or additional pages.');});};
el('new').onclick=()=>void run(async()=>{batch=emptyBatch();await persist(batch);});
el<HTMLSelectElement>('archive').onchange=event=>{const id=(event.target as HTMLSelectElement).value;void run(async()=>{const saved=await db.batches.get(id);if(saved)batch=recoverBatch(saved);});};
el('delete').onclick=()=>{if(confirm('Permanently delete this package and its local originals? Linked late-work packages, downloaded copies and Drive copies remain separate. Export and verify your ZIP first.'))void run(async()=>{await deleteSavedBatch(db,batch,()=>{if(window.CaptureNative?.deleteAssignment)acceptedReceipt(window.CaptureNative.deleteAssignment(batch.id,batch.captureId));});batch=emptyBatch();await persist(batch);});};
el('export').onclick=()=>void run(async()=>{const bytes=await exportSavedBatch(db,batch);if(window.CaptureNative){status(await transferZip(window.CaptureNative,bytes,batch,'local'));return;}const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=`capture-${batch.captureId}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('ZIP download requested. Verify the saved file. Local originals retained.');});
el('drive-queue').onclick=()=>void run(async()=>{if(!window.CaptureNative)throw new Error('Native transfer unavailable.');status(await transferZip(window.CaptureNative,await exportSavedBatch(db,batch),batch,'drive'));});
el('drive-settings').onclick=()=>window.CaptureNative?.requestDriveSetup();
function refreshTransfer(){if(busy)return;const t=transferStatus(window.CaptureNative);el('transfer-status').textContent=t.summary;el<HTMLButtonElement>('drive-queue').disabled=!batch.completed||!t.available||!t.enabled;}
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
window.addEventListener('beforeunload',event=>{if(busy||el<HTMLInputElement>('label').value!==batch.draftLabel){event.preventDefault();event.returnValue='';}});
try {const rows=await listBatchSummaries(db);const selected=rows.find(b=>b.id===localStorage.getItem('capture-camera-batch'))??rows.find(b=>b.id===localStorage.getItem('capture-selected-batch'))??rows.find(b=>!b.completed)??rows[0];batch=selected?recoverBatch(await db.batches.get(selected.id)??emptyBatch()):emptyBatch();await render();el<HTMLFieldSetElement>('controls').disabled=false;status('Opened local assignments. Saved pages and groups retained.');if(batch.assignment&&!batch.completed)await recoverNative();}
catch(error){status(`Local storage could not open: ${String(error)}. No changes made.`);}
