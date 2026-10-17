import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { openUnifiedMarking } from './helpers/unifiedMarking';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { decodeCapturePackage } from '../shared/capturePackage';
const origin = 'http://127.0.0.1:4232';
const server = await createServer({ server: { host:'127.0.0.1',port:4232,strictPort:true,watch:null,hmr:false } });
await server.listen();
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors:string[]=[], external:string[]=[];
 page.on('pageerror',e=>errors.push(e.message)); await page.route('**/*',route=>{if(route.request().url().startsWith(origin)||route.request().url().startsWith('blob:'))return route.continue();external.push(route.request().url());return route.abort();});
 await page.goto(origin);await installFictionalClassroom(page);await page.locator('[data-testid^="select-teacher-"]').first().click();
 const original=new Uint8Array(await readFile('/tmp/capture-phone-e2e.zip')),late=new Uint8Array(await readFile('/tmp/capture-phone-latework-e2e.zip'));
 const initial=await decodeCapturePackage(original),addition=await decodeCapturePackage(late);
 assert.equal(initial.manifest.assignmentId,addition.manifest.assignmentId);assert.notEqual(initial.manifest.packageId,addition.manifest.packageId);
 const rows=(table:string):Promise<any[]>=>page.evaluate(async table=>{const p='/src/db/database.ts';return (await import(p)).db.table(table).toArray();},table);
 async function open(){await openUnifiedMarking(page);}
 async function idle(){await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled===false);}
 async function upload(bytes:Uint8Array){await idle();await page.getByTestId('capture-zip').setInputFiles({name:'completed.zip',mimeType:'application/zip',buffer:Buffer.from(bytes)});}
 async function saved(id:string){await page.getByTestId(`capture-set-${id}`).getByText(/^Saved to /).waitFor();await idle();}
 await open();await upload(original);await page.getByTestId(`capture-set-${initial.submissions[0].id}`).click();
 const studentButton=page.locator('[data-testid^="capture-student-"]').first(),studentTestId=(await studentButton.getAttribute('data-testid'))!;
 await studentButton.click();await page.getByTestId('capture-confirm').click();await page.getByTestId('image-markup').waitFor();
 page.on('dialog',dialog=>void dialog.accept());
 await open(); await upload(original); await saved(initial.submissions[0].id);
 const root=(await rows('captureAttachments'))[0];
 const attempt=(await rows('markingAttempts'))[0];assert.ok(attempt.captureSources);
 const oldSession=await page.evaluate(async attemptId=>{const d='/src/db/database.ts',m='/src/marking/markingService.ts',i='/src/services/identityService.ts';const {db}=await import(d),identity=await import(i),userId=identity.getActiveTeacherId(),device=await db.devices.where('userId').equals(userId).first(),service=new(await import(m)).MarkingService(db),actor={userId,deviceId:device.id,epoch:identity.getIdentityEpoch()};const session=await service.openSession(attemptId,actor);session.draft.overallFeedback='Fictional feedback retained before late pages';session.draft.imageFeedback[0].annotations.push({id:'preserved-comment',kind:'comment',points:[{x:.2,y:.3}],color:'red',width:.01,text:'Keep this original annotation',criterionId:null,level:''});return service.saveDraft(session.id,session.draft,session.version,actor);},attempt.id);
 const marks=await rows('categoryResults'),official=await rows('studentAssessments'),commits=await rows('markingCommits');
 await open();await upload(late);await page.getByTestId(`capture-set-${addition.submissions[0].id}`).click();await page.getByTestId(studentTestId).click();await page.getByTestId('capture-append-target').selectOption(root.id);
 // Fail the actual append receipt write: all draft/page changes must roll back.
 await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value:any,key?:IDBValidKey){if(this.name==='captureImportReceipts'){IDBObjectStore.prototype.add=add;throw new DOMException('Fictional full disk','QuotaExceededError');}return key===undefined?add.call(this,value):add.call(this,value,key);};});
 await page.getByTestId('capture-confirm').click();await page.getByRole('alert').filter({hasText:'selection is retained'}).waitFor();
 assert.deepEqual((await rows('markingAttempts'))[0],attempt);assert.deepEqual((await rows('markingSessions'))[0],oldSession);assert.equal((await rows('captureImportReceipts')).length,1);
 await page.getByTestId('capture-confirm').dblclick();await page.getByTestId('image-markup').waitFor();await open();await upload(late);await saved(addition.submissions[0].id);
 const changed=(await rows('markingAttempts'))[0],session=(await rows('markingSessions'))[0],sources=await rows('captureAttachments');
 assert.equal((await rows('markingAttempts')).length,1);assert.equal(changed.id,attempt.id);assert.deepEqual(changed.imagePages.slice(0,attempt.imagePages.length),attempt.imagePages);assert.equal(changed.imagePages.length,attempt.imagePages.length+addition.submissions[0].pages.length);
 assert.deepEqual(session.draft.imageFeedback.slice(0,oldSession.draft.imageFeedback.length),oldSession.draft.imageFeedback);assert.equal(session.draft.overallFeedback,oldSession.draft.overallFeedback);assert.deepEqual(session.draft.judgments,oldSession.draft.judgments);
 assert.equal(sources.find(a=>a.packageId===addition.manifest.packageId).rootAttachmentId,root.id);assert.equal(sources.find(a=>a.id===root.id).contentHash,root.contentHash);assert.deepEqual(sources.find(a=>a.id===root.id).manifest,root.manifest);
 const stale=await page.evaluate(async old=>{const d='/src/db/database.ts',m='/src/marking/markingService.ts',i='/src/services/identityService.ts';const {db}=await import(d),identity=await import(i),userId=identity.getActiveTeacherId(),device=await db.devices.where('userId').equals(userId).first();try{await new(await import(m)).MarkingService(db).saveDraft(old.id,old.draft,old.version,{userId,deviceId:device.id,epoch:identity.getIdentityEpoch()});return 'unexpected save';}catch(e){return String(e);}},oldSession);assert.match(stale,/changed elsewhere/);
 await page.reload();const teacher=page.locator('[data-testid^="select-teacher-"]').first();if(await teacher.isVisible())await teacher.click();await open();await upload(late);await saved(addition.submissions[0].id);assert.equal((await rows('captureImportReceipts')).length,2);assert.deepEqual((await rows('markingAttempts'))[0],changed);
 // Actual backup validator/restore retains association and annotations in an isolated DB.
 const restored=await page.evaluate(async()=>{const d='/src/db/database.ts',p='/src/services/portabilityService.ts';const {db,OntarioTeacherDB}=await import(d),{PortabilityService}=await import(p);const json=await new PortabilityService(db).createFullBackupJSON();const isolated=new OntarioTeacherDB(`fictional-late-restore-${crypto.randomUUID()}`);try{await new PortabilityService(isolated).restoreFromJSON(json);return {attempts:await isolated.markingAttempts.toArray(),sessions:await isolated.markingSessions.toArray(),receipts:await isolated.captureImportReceipts.toArray()};}finally{await isolated.delete();}});
 assert.deepEqual(restored.attempts,[changed]);assert.deepEqual(restored.sessions,[session]);assert.equal(restored.receipts.length,2);assert.deepEqual(await rows('categoryResults'),marks);assert.deepEqual(await rows('studentAssessments'),official);assert.deepEqual(await rows('markingCommits'),commits);
 // The same late package can also contain a new student's independently matched work.
 assert.equal(addition.submissions.length,2);await page.getByTestId(`capture-set-${addition.submissions[1].id}`).click();
 const otherStudent=page.locator('[data-testid^="capture-student-"]');
 const otherId=(await otherStudent.evaluateAll((buttons,used)=>buttons.map(b=>b.getAttribute('data-testid')!).find(id=>id!==used),studentTestId))!;
 await page.getByTestId(otherId).click();await page.getByTestId('capture-append-target').selectOption('');await page.getByTestId('capture-confirm').click();await page.getByTestId('image-markup').waitFor();await open();await upload(late);await saved(addition.submissions[1].id);
 const lateNew=(await rows('captureAttachments')).find(a=>a.submissionId===addition.submissions[1].id);assert.ok(lateNew);assert.notEqual(lateNew.classEnrollmentId,root.classEnrollmentId);assert.equal(lateNew.rootAttachmentId,lateNew.id);assert.equal((await rows('markingAttempts')).length,2);
 await upload(late);await saved(addition.submissions[0].id);await saved(addition.submissions[1].id);assert.equal((await rows('captureImportReceipts')).length,3);
 assert.deepEqual(await rows('categoryResults'),marks);assert.deepEqual(await rows('studentAssessments'),official);assert.deepEqual(await rows('markingCommits'),commits);
 await page.screenshot({path:'/tmp/capture-latework-matching.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS actual phone late-work ZIP → explicit same-submission append; immutable original source; atomic quota rollback/retry/double confirmation; old page IDs/bytes/annotations/judgments preserved; stale editor rejected; reload/reimport deduplicated; backup/restore retains provenance; unchanged official marks/history; zero external requests.');
} finally {await browser.close();await server.close();}
