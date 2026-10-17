import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { CaptureDB, listBatchSummaries, deleteSavedBatch, openLateWork, MAX_BYTES, appendPages, emptyBatch, recoverBatch, exportBatch, exportSavedBatch, movePage, removePage, saveGroup, completeBatch, defaultEdits, readPhoto, save, type Batch, type Page } from '../src/store';
const databases:CaptureDB[]=[];
const database=()=>{const db=new CaptureDB(`capture-test-${crypto.randomUUID()}`);databases.push(db);return db;};
// Valid 1×1 PNG, fictional generated fixture.
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const page=(id=crypto.randomUUID()):Page=>({id,label:'',originalName:'fictional.png',mime:'image/png',bytes:png.slice(),edits:defaultEdits()});
const batch=():Batch=>({...emptyBatch(),assignment:'Fictional leaves'});
const group=(b:Batch,label='Fictional Avery')=>saveGroup({...b,stage:'preview',draftLabel:label});
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(databases.splice(0).map(d=>d.delete()));});
describe('grouped capture lifecycle',()=>{
 it('persists interrupted capture, edits, duplicate labels and a frozen package; retains originals after export',async()=>{
  const db=database();let b=await save(db,appendPages(batch(),[page(),page()]));const originals=b.pages.map(p=>p.bytes.slice());
  db.close();await db.open();b=recoverBatch((await db.batches.get(b.id))!);expect(b.pages).toHaveLength(2);
  b=await save(db,{...movePage(b,1,-1),stage:'preview',draftLabel:'Fictional Avery'});
  b=await save(db,{...b,pages:b.pages.map((p,i)=>i? p:{...p,edits:{rotation:90,crop:{x:.1,y:.1,width:.8,height:.8}}})});
  b=await save(db,saveGroup(b));b=await save(db,group(appendPages(b,[page()])));
  expect(b.groups[0].id).not.toBe(b.groups[1].id);expect(b.groups.map(g=>g.label)).toEqual(['Fictional Avery','Fictional Avery']);
  await expect(exportSavedBatch(db,b)).rejects.toThrow('All done');b=await save(db,completeBatch(b));
  const first=await exportSavedBatch(db,b), second=await exportSavedBatch(db,b);expect(first).toEqual(second);
  const files=unzipSync(first),manifest=JSON.parse(strFromU8(files['manifest.json']));expect(manifest.version).toBe(2);expect(manifest.submissions).toHaveLength(2);expect(manifest.submissions[0].pages[0].edits.rotation).toBe(90);
  expect(b.groups[0].pages[0].bytes).toEqual(originals[1]);expect(await db.batches.get(b.id)).toEqual(b);
  await expect(save(db,{...b,assignment:'changed'})).rejects.toThrow('frozen');
 });
 it('requires preview and name, prevents unfinished All done, and keeps removed originals',()=>{
  const b=appendPages(batch(),[page(),page()]);expect(()=>saveGroup(b)).toThrow('Preview');expect(()=>completeBatch(b)).toThrow('Save');
  const removed=removePage(b,0);expect(removed.removed[0]).toEqual(b.pages[0]);expect(removed.pages).toHaveLength(1);expect(b.pages).toHaveLength(2);
  expect(()=>saveGroup({...removed,stage:'preview',draftLabel:'  '})).toThrow('name');
  const g=group(removed);expect(completeBatch(g).completed).toBe(true);expect(()=>appendPages(completeBatch(g),[page()])).toThrow('frozen');
 });
 it('keeps stable group identity when reopening and edits never modify original bytes',()=>{
  const b=group(appendPages(batch(),[page()]));const g=b.groups[0];const edited=saveGroup({...b,groups:[],pages:g.pages,editingGroupId:g.id,stage:'preview',draftLabel:'Fictional revised'});expect(edited.groups[0].id).toBe(g.id);expect(edited.editingGroupId).toBeUndefined();expect(edited.groups[0].pages[0].bytes).toEqual(png);
 });
 it('retains legacy flat pages and label hints with identity edits without deleting them',()=>{
  const old={id:'local-batch',captureId:'old-capture',classId:'old',assignment:'Old fictional',pages:[{...page(),edits:undefined,label:'Old label'}],revision:4};
  const recovered=recoverBatch(old as unknown as Batch);expect(recovered.id).toBe('local-batch');expect(recovered.pages[0].label).toBe('Old label');expect(recovered.pages[0].edits).toEqual(defaultEdits());expect(recovered.completed).toBe(false);
 });
 it('accepts 40 distinct ten-page groups, rejects student/page/retained-byte overflow',()=>{
  let b=batch();for(let i=0;i<40;i++)b=group(appendPages(b,Array.from({length:10},()=>page())),`Fictional ${i}`);
  expect(b.groups.flatMap(g=>g.pages)).toHaveLength(400);expect(()=>appendPages(b,[page()])).toThrow('40 students');
  expect(()=>appendPages(batch(),Array.from({length:11},()=>page()))).toThrow('10 pages');
  expect(()=>appendPages({...batch(),removed:[{...page(),bytes:new Uint8Array(MAX_BYTES)}]},[page()])).toThrow('256 MB');
 });
});
describe('atomic local storage and recovery',()=>{
 it('rolls back quota failure and permits retry without caller mutation',async()=>{
  const db=database(),old=await save(db,appendPages(batch(),[page()]));const put=db.batches.put.bind(db.batches);
  vi.spyOn(db.batches,'put').mockImplementationOnce((...args)=>put(...args).then(()=>{Dexie.currentTransaction!.abort();throw new Error('Quota exceeded');}));
  await expect(save(db,group(old))).rejects.toThrow();expect(await db.batches.get(old.id)).toEqual(old);expect((await save(db,group(old))).groups).toHaveLength(1);
 });
 it('allows only one double-confirm/save winner and rejects stale export',async()=>{
  const db=database(),old=await save(db,appendPages(batch(),[page()]));const outcomes=await Promise.allSettled([save(db,group(old)),save(db,group(old))]);expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
  await expect(exportSavedBatch(db,old)).rejects.toThrow('another tab');
 });
 it('new assignments retain previous and completed batches on restart',async()=>{
  const db=database();const first=await save(db,completeBatch(group(appendPages(batch(),[page()]))));const next=await save(db,batch());expect(next.id).not.toBe(first.id);db.close();await db.open();expect(await db.batches.count()).toBe(2);expect((await db.batches.get(first.id))?.completed).toBe(true);
 });
 it('rejects unsupported/empty/oversized photos and preserves valid bytes',async()=>{
  expect((await readPhoto(new File([png],'fictional.png'))).bytes).toEqual(png);
  await expect(readPhoto(new File([],'empty.png'))).rejects.toThrow('1 byte');await expect(readPhoto(new File([new Uint8Array(8*1024*1024+1)],'huge.png'))).rejects.toThrow('8 MB');await expect(readPhoto(new File(['bad'],'bad.jpg'))).rejects.toThrow('JPEG or PNG');
 });
});

describe('retained archive listing and deliberate deletion',()=>{
 it('lists only summaries while retaining all original bytes in saved assignments',async()=>{
  const db=database();const first=await save(db,appendPages(batch(),[page()]));const second=await save(db,completeBatch(group(appendPages(batch(),[page()]))));
  const summaries=await listBatchSummaries(db);expect(summaries).toHaveLength(2);
  expect(summaries.every(row=>Object.keys(row).sort().join(',')==='assignment,assignmentId,completed,id')).toBe(true);
  expect(await db.batches.get(first.id)).toEqual(first);expect(await db.batches.get(second.id)).toEqual(second);
 });
 it('blocks stale deletion before native deletion, then allows only the current revision',async()=>{
  const db=database();const old=await save(db,appendPages(batch(),[page()]));const newer=await save(db,group(old));const native=vi.fn();
  await expect(deleteSavedBatch(db,old,native)).rejects.toThrow('another tab');expect(native).not.toHaveBeenCalled();expect(await db.batches.get(old.id)).toEqual(newer);
  await deleteSavedBatch(db,newer,native);expect(native).toHaveBeenCalledOnce();expect(await db.batches.get(old.id)).toBeUndefined();
 });
 it('retains IndexedDB originals after native failure or an aborted delete transaction',async()=>{
  const db=database();const saved=await save(db,appendPages(batch(),[page()]));
  await expect(deleteSavedBatch(db,saved,()=>{throw new Error('Native storage unavailable');})).rejects.toThrow('Native storage');expect(await db.batches.get(saved.id)).toEqual(saved);
  const remove=db.batches.delete.bind(db.batches);vi.spyOn(db.batches,'delete').mockImplementationOnce((...args)=>remove(...args).then(()=>{Dexie.currentTransaction!.abort();throw new Error('Simulated disk failure');}));
  await expect(deleteSavedBatch(db,saved)).rejects.toThrow();expect(await db.batches.get(saved.id)).toEqual(saved);
  await deleteSavedBatch(db,saved);expect(await db.batches.get(saved.id)).toBeUndefined();
 });
});

describe('immutable completed packages and linked late work',()=>{
 const completed=async(db:CaptureDB)=>save(db,completeBatch(group(appendPages(batch(),[page(),page()]))));
 it('creates an empty linked draft, exports only new labelled pages, and preserves original ZIP bytes',async()=>{
  const db=database(),original=await completed(db),oldZip=await exportSavedBatch(db,original);
  let late=await openLateWork(db,original);
  expect(late).toMatchObject({assignmentId:original.assignmentId,assignment:original.assignment,parentBatchId:original.id,completed:false,pages:[],groups:[],removed:[]});
  expect(late.id).not.toBe(original.id);expect(late.captureId).not.toBe(original.captureId);expect(late.draftGroupId).not.toBe(original.draftGroupId);
  const additional=page();late=await save(db,group(appendPages(late,[additional]),original.groups[0].label));
  late=await save(db,group(appendPages(late,[page()]),'Fictional late student'));
  late=await save(db,completeBatch(late));const manifest=JSON.parse(strFromU8(unzipSync(await exportSavedBatch(db,late))['manifest.json']));
  expect(manifest.assignmentId).toBe(original.assignmentId);expect(manifest.packageId).not.toBe(original.captureId);expect(manifest.submissions).toHaveLength(2);
  expect(manifest.submissions[0].pages.map((p:{id:string})=>p.id)).toEqual([additional.id]);
  expect(manifest.submissions.every((g:{id:string})=>!original.groups.some(old=>old.id===g.id))).toBe(true);
  expect(await db.batches.get(original.id)).toEqual(original);expect(await exportSavedBatch(db,original)).toEqual(oldZip);
 });
 it('reuses exactly one draft across concurrent clicks, restart and requests from another completed supplement',async()=>{
  const db=database(),original=await completed(db);
  const [first,duplicate]=await Promise.all([openLateWork(db,original),openLateWork(db,original)]);expect(duplicate.id).toBe(first.id);expect(await db.batches.count()).toBe(2);
  const saved=await save(db,appendPages(first,[page()]));db.close();await db.open();expect(await openLateWork(db,original)).toEqual(saved);
  const done=await save(db,completeBatch(group(saved)));const next=await openLateWork(db,done);expect(next.id).not.toBe(first.id);expect(next.groups).toEqual([]);expect(next.parentBatchId).toBe(done.id);
  expect((await openLateWork(db,original)).id).toBe(next.id);expect(await db.batches.count()).toBe(3);
 });
 it('rolls back quota failure while creating a draft and leaves retry safe',async()=>{
  const db=database(),original=await completed(db),zip=await exportSavedBatch(db,original);const add=db.batches.add.bind(db.batches);
  vi.spyOn(db.batches,'add').mockImplementationOnce((...args)=>add(...args).then(()=>{Dexie.currentTransaction!.abort();throw new Error('Fictional quota failure');}));
  await expect(openLateWork(db,original)).rejects.toThrow('quota');expect(await db.batches.count()).toBe(1);expect(await exportSavedBatch(db,original)).toEqual(zip);
  await openLateWork(db,original);expect(await db.batches.count()).toBe(2);
 });
 it('rejects stale source and stale draft writes while retaining photos and locked assignment identity',async()=>{
  const db=database(),original=await completed(db);
  await expect(openLateWork(db,{...original,revision:original.revision-1})).rejects.toThrow('another tab');
  await expect(openLateWork(db,{...original,captureId:'wrong'})).rejects.toThrow('another tab');expect(await db.batches.count()).toBe(1);
  const late=await openLateWork(db,original),saved=await save(db,appendPages(late,[page()]));
  await expect(save(db,appendPages(late,[page()]))).rejects.toThrow('another tab');
  await expect(save(db,{...saved,assignment:'Different assignment'})).rejects.toThrow('original assignment name');
  await expect(save(db,{...saved,assignmentId:crypto.randomUUID()})).rejects.toThrow('identities');
  await expect(save(db,{...saved,parentBatchId:undefined})).rejects.toThrow('identities');expect(await db.batches.get(saved.id)).toEqual(saved);
 });
 it('deletes original and supplemental packages independently, preserving orphan recovery/export',async()=>{
  const db=database(),original=await completed(db);let late=await openLateWork(db,original);late=await save(db,completeBatch(group(appendPages(late,[page()]))));const lateZip=await exportSavedBatch(db,late);
  const native=vi.fn();await deleteSavedBatch(db,original,()=>native(original.id,original.captureId));expect(native).toHaveBeenCalledWith(original.id,original.captureId);expect(await exportSavedBatch(db,late)).toEqual(lateZip);
  db.close();await db.open();expect(recoverBatch((await db.batches.get(late.id))!).parentBatchId).toBe(original.id);
  const next=await openLateWork(db,late);await deleteSavedBatch(db,next);expect(await exportSavedBatch(db,late)).toEqual(lateZip);
 });
 it('retains per-package page limits and refuses late work from unfinished packages',async()=>{
  const db=database(),draft=await save(db,batch());await expect(openLateWork(db,draft)).rejects.toThrow('Complete');
  const original=await completed(db),late=await openLateWork(db,original);
  expect(()=>appendPages(late,Array.from({length:11},()=>page()))).toThrow('10 pages');expect(()=>completeBatch(late)).toThrow('Save');
 });
});
