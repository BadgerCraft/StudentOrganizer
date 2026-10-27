import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {installFictionalClassroom} from './helpers/classroomFixture';
import {openUnifiedMarking} from './helpers/unifiedMarking';
import {showFinalOverview} from './helpers/classroomMarkingUi';
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});await server.listen();
const address=server.httpServer!.address() as any,origin=`http://127.0.0.1:${address.port}`;
let activePage:any;let activeErrors:any;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'}),results:any={};
try{
const p=await browser.newPage({viewport:{width:1440,height:1000}});activePage=p;const errors:string[]=[];activeErrors=errors;p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>void d.accept());
await p.route('**/*',r=>r.request().url().startsWith(origin)||r.request().url().startsWith('blob:')?r.continue():r.abort());
await p.goto(origin);await installFictionalClassroom(p);await p.locator('[data-testid^="select-teacher-"]').first().click();
const {assessmentId,rubricId}=await openUnifiedMarking(p,{phone:false});
const ids=await p.evaluate(async({assessmentId,rubricId})=>{
const dp='/src/db/database.ts',ip='/src/services/identityService.ts',mp='/src/marking/markingService.ts',pp='/src/marking/importImages.ts';const {db}=await import(dp),identity=await import(ip),s=new(await import(mp)).MarkingService(db);
const userId=identity.getActiveTeacherId(),device=await db.devices.where('userId').equals(userId).first(),actor={userId,deviceId:device.id,epoch:identity.getIdentityEpoch()};
const c=document.createElement('canvas');c.width=600;c.height=800;c.getContext('2d')!.fillRect(0,0,600,800);const f=new File([await(await fetch(c.toDataURL())).blob()],'Fictional-runtime.png',{type:'image/png'});
const {pages}=await(await import(pp)).parseMarkingImages([f]);const ctx=await s.getContext(assessmentId,actor);const attempt=await s.importImageAttempt(assessmentId,rubricId,pages,ctx.enrollments[0].id,actor),session=await s.openSession(attempt.id,actor);return {attempt:attempt.id,session:session.id};
},{assessmentId,rubricId});
await p.getByRole('button',{name:'Marking queue',exact:true}).click();await p.getByTestId(`marking-session-open-${ids.attempt}`).click();
const surface=p.getByTestId('image-annotation-surface');await surface.waitFor({state:'visible'});
// Image decode rejection is isolated; explicit Retry does not alter the transform.
await p.evaluate(()=>{const original=window.createImageBitmap.bind(window);let once=true;window.createImageBitmap=async(...args:any[])=>{if(once){once=false;throw new Error('Fictional transient codec failure');}return original(...args as [any]);};});
await p.getByRole('button',{name:'Rotate clockwise',exact:true}).click();await p.getByRole('alert').filter({hasText:'Fictional transient codec failure'}).waitFor();
assert.ok(await p.getByRole('button',{name:'Back to Organizer',exact:true}).isVisible());
await p.getByRole('button',{name:'Retry image preview',exact:true}).click();await surface.waitFor({state:'visible'});console.log('decode rejection isolated');results.decodeRejection={isolated:true,recoveredWithExplicitRetry:true};
console.log('Starting quota test');
await showFinalOverview(p);
// A quota-style draft failure must keep the draft and expose a working Retry.
await p.evaluate(async()=>{const path='/src/marking/markingService.ts';const proto=(await import(path)).MarkingService.prototype,original=proto.saveDraft;let once=true;proto.saveDraft=async function(...args:any[]){if(once){once=false;throw new DOMException('Fictional storage quota exhausted','QuotaExceededError');}return original.apply(this,args);};});
await p.getByLabel('Overall student-facing feedback',{exact:false}).fill('Fictional unsaved recovery text');await p.getByTestId('marking-save-status').filter({hasText:'Not saved'}).waitFor();
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).inputValue(),'Fictional unsaved recovery text');await p.getByRole('button',{name:'Retry save',exact:true}).click();await p.getByTestId('marking-save-status').filter({hasText:'Saved locally'}).waitFor();results.quotaRejection={draftRetained:true,retrySucceeded:true};
console.log('Quota recovered');
// A failed refresh preserves the mounted editor and draft, with an explicit Retry.
await p.evaluate(async()=>{const mp='/src/marking/markingService.ts',dp='/src/db/database.ts';const proto=(await import(mp)).MarkingService.prototype,original=proto.getContext;(window as any).restoreReviewContext=()=>{proto.getContext=original;};proto.getContext=async function(){throw new Error('Fictional temporary read failure');};const {db}=await import(dp);const a=await db.assessments.get((await db.markingAttempts.toArray())[0].assessmentId);await db.assessments.update(a.id,{title:a.title+' read-check'});});
await p.getByRole('alert').filter({hasText:'Fictional temporary read failure'}).waitFor();
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).inputValue(),'Fictional unsaved recovery text');
await p.evaluate(()=>(window as any).restoreReviewContext());
await p.getByRole('button',{name:'Retry loading marking',exact:true}).click();
await p.getByRole('alert').filter({hasText:'Fictional temporary read failure'}).waitFor({state:'hidden'});
await p.getByTestId('final-grading-workspace').waitFor({state:'visible'});
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).inputValue(),'Fictional unsaved recovery text');
results.contextReadFailure={reasonVisible:true,retrySucceeded:true,editorAndDraftRetained:true};
// A staged crop cannot disappear through tabs, modes, or Back.
await p.getByRole('button',{name:'Annotation and evidence',exact:true}).click();await surface.waitFor({state:'visible'});
await p.getByRole('button',{name:'Edit crop',exact:true}).click();
await p.getByTestId('crop-handle-top-left').focus();await p.keyboard.press('ArrowRight');
await p.getByRole('button',{name:'Archive',exact:true}).click();
assert.ok(await p.getByRole('button',{name:'Apply crop',exact:true}).isVisible());
await p.getByRole('button',{name:'Back to Organizer',exact:true}).click();
assert.ok(await p.getByRole('button',{name:'Cancel crop',exact:true}).isVisible());
await p.getByRole('button',{name:'Cancel crop',exact:true}).click();
results.stagedCrop={tabsAndBackBlocked:true};
// A malformed refresh retains the existing valid final editor and unsaved draft owner.
await showFinalOverview(p);
await p.evaluate(async id=>{const path='/src/db/database.ts';const {db}=await import(path);const a=await db.markingAttempts.get(id);(window as any).savedReviewAttempt=structuredClone(a);a.documents=null;await db.markingAttempts.put(a);},ids.attempt);
await p.getByRole('alert').filter({hasText:'This submission could not refresh safely'}).waitFor();
assert.equal(await p.getByTestId('final-grading-workspace').isVisible(),true,'malformed refresh retains the actual final-stage editor');
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).inputValue(),'Fictional unsaved recovery text');
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).isDisabled(),true);
await p.evaluate(async()=>{const path='/src/db/database.ts';await (await import(path)).db.markingAttempts.put((window as any).savedReviewAttempt);});
await p.getByRole('alert').filter({hasText:'This submission could not refresh safely'}).waitFor({state:'hidden'});
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).isEnabled(),true);
results.malformedActiveAttempt={editorRetained:true,changesBlocked:true,recoveredWithoutRemount:true};
// Denied context stays quarantined through retries, including an obsolete successful read.
await p.evaluate(async()=>{const mp='/src/marking/markingService.ts',dp='/src/db/database.ts',ap='/src/services/authHelper.ts',ip='/src/services/identityService.ts';const module=await import(mp),proto=module.MarkingService.prototype,original=proto.getContext,{db}=await import(dp),identity=await import(ip),{AuthorizationError}=await import(ap);const userId=identity.getActiveTeacherId(),device=await db.devices.where('userId').equals(userId).first(),a=(await db.markingAttempts.toArray())[0];const good=await original.call(new module.MarkingService(db),a.assessmentId,{userId,deviceId:device.id,epoch:identity.getIdentityEpoch()});(window as any).restoreReviewContext=()=>{proto.getContext=original;};(window as any).holdNextReviewRead=false;proto.getContext=async function(){if((window as any).holdNextReviewRead){(window as any).holdNextReviewRead=false;await new Promise(resolve=>{(window as any).releaseOldReviewRead=resolve;});return good;}throw new AuthorizationError('Fictional denied read');};await db.assessments.update(a.assessmentId,{title:good.assessment.title+' denial-check'});});
await p.getByRole('alert').filter({hasText:'Fictional denied read'}).waitFor();
await p.evaluate(()=>(window as any).holdNextReviewRead=true);await p.getByRole('button',{name:'Retry loading marking',exact:true}).click();
await p.waitForFunction(()=>typeof (window as any).releaseOldReviewRead==='function');assert.equal(await p.getByTestId('image-markup').count(),0);assert.equal(await p.getByTestId('final-grading-workspace').count(),0,'denied read unmounts the active final workspace');assert.equal(await p.getByLabel('Overall student-facing feedback').count(),0);
await p.getByRole('button',{name:'Retry loading marking',exact:true}).click();await p.getByRole('alert').filter({hasText:'Fictional denied read'}).waitFor();
await p.evaluate(()=>(window as any).releaseOldReviewRead());await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
assert.equal(await p.getByTestId('image-markup').count(),0,'obsolete successful read cannot reveal quarantined context');assert.equal(await p.getByTestId('final-grading-workspace').count(),0,'obsolete successful read cannot reveal final grades or feedback');
await p.evaluate(()=>(window as any).restoreReviewContext());await p.getByRole('button',{name:'Retry loading marking',exact:true}).click();await p.getByTestId('final-grading-workspace').waitFor({state:'visible'});
assert.equal(await p.getByLabel('Overall student-facing feedback',{exact:false}).inputValue(),'Fictional unsaved recovery text');results.deniedContext={hiddenDuringRetry:true,obsoleteSuccessIgnored:true,draftRecoveredAfterAuthorizedRead:true};
await p.getByRole('button',{name:'Annotation and evidence',exact:true}).click();await surface.waitFor({state:'visible'});

// Inject a malformed persisted history record directly, bypassing the otherwise strict writer.
await p.evaluate(async id=>{const path='/src/db/database.ts';const {db}=await import(path);const session=await db.markingSessions.get(id);(window as any).savedReviewSession=structuredClone(session);session.draft.imageFeedback[0].annotations=null;await db.markingSessions.put(session);const attempt=await db.markingAttempts.get(session.attemptId);await db.classEnrollments.update(attempt.classEnrollmentId,{enrollmentStatus:'withdrawn'});},ids.session);
await p.getByText('Historical records',{exact:true}).click();await p.getByRole('button',{name:'Former students',exact:true}).click();await p.getByText(/^Revision 1 ·/).click();await p.getByRole('alert').filter({hasText:'This saved revision could not be displayed'}).waitFor();
assert.ok(await p.getByRole('button',{name:'Back to Organizer',exact:true}).isVisible());assert.equal(errors.length,0);results.malformedHistory={rootRetained:true,localFailureVisible:true,productionWriterWouldReject:true};
await p.screenshot({path:'/tmp/desktop-photo-history-recovery.png'});
const corruptBefore=await p.evaluate(async id=>{const path='/src/db/database.ts';return JSON.stringify(await (await import(path)).db.markingSessions.get(id));},ids.session);
await p.getByRole('button',{name:'Retry display',exact:true}).click();
const corruptAfter=await p.evaluate(async id=>{const path='/src/db/database.ts';return JSON.stringify(await (await import(path)).db.markingSessions.get(id));},ids.session);assert.equal(corruptAfter,corruptBefore,'retry must not mutate malformed originals');
await p.evaluate(async()=>{const path='/src/db/database.ts';const {db}=await import(path);await db.markingSessions.put((window as any).savedReviewSession);});await p.getByRole('alert').filter({hasText:'This saved revision could not be displayed'}).waitFor({state:'hidden'});results.malformedHistory.recoveredWithoutReload=true;
await writeFile('/tmp/desktop-photo-recovery-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}catch(e){console.error('REVIEW FAILURE',e);console.error('BROWSER ERRORS',activeErrors);console.error('BODY',await activePage?.locator('body').innerText());await activePage?.screenshot({path:'/tmp/desktop-photo-recovery-debug.png'});throw e;}finally{await browser.close();await server.close();}
