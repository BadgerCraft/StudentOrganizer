import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { openUnifiedMarking } from './helpers/unifiedMarking';

const harness = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import '/src/index.css';
import{CaptureMatchingWorkspace}from'/src/capture/CaptureMatchingWorkspace.tsx';import{getActiveTeacherId}from'/src/services/identityService.ts';
createRoot(document.getElementById('root')).render(React.createElement(CaptureMatchingWorkspace,{assessmentId:sessionStorage.getItem('fictional-capture-assessment'),userId:getActiveTeacherId(),onClose:()=>{},onSwitchTeacher:()=>{}}));
</script></body></html>`;
const server = await createServer({cacheDir:`/tmp/capture-loading-retry-vite-${process.pid}`,server:{host:'127.0.0.1',port:0,watch:null,hmr:false},plugins:[{name:'capture-authority-fixture',configureServer(instance){instance.middlewares.use('/__capture-loading-review',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await instance.transformIndexHtml('/__capture-loading-review',harness));});}}]});
await server.listen();const address=server.httpServer!.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${address.port}`);await installFictionalClassroom(page);await page.locator('[data-testid^="select-teacher-"]').first().click();
 await page.evaluate(async()=>{const path='/src/capture/attachmentService.ts';const prototype=(await import(path)).CaptureAttachmentService.prototype,original=prototype.context;let fail=true;prototype.context=async function(...args:any[]){if(fail){fail=false;throw new Error('Fictional temporary picture read failure');}return original.apply(this,args);};});
 const {assessmentId}=await openUnifiedMarking(page,{phone:false});
 const matching=page.getByTestId('capture-matching');
 await matching.getByRole('alert').filter({hasText:'Fictional temporary picture read failure'}).waitFor();
 await matching.getByRole('button',{name:'Retry loading picture attachments',exact:true}).click();
 await matching.getByRole('button',{name:'Retry loading picture attachments',exact:true}).waitFor({state:'hidden'});
 const wizard=page.getByTestId('evidence-import-wizard');await wizard.getByLabel('Phone-photo ZIP',{exact:true}).check();await wizard.getByRole('button',{name:'Continue',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled===false);
 // Exercise capture's own authority boundary without the enclosing marking
 // workspace also observing/rejecting the membership change.
 await page.evaluate(assessmentId=>sessionStorage.setItem('fictional-capture-assessment',assessmentId),assessmentId);
 await page.goto(`http://127.0.0.1:${address.port}/__capture-loading-review`);
 await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled===false);
 const zip=await page.evaluate(async()=>{
   const path='/shared/capturePackage.ts',capture=await import(path),c=document.createElement('canvas');c.width=60;c.height=60;c.getContext('2d')!.fillRect(0,0,60,60);
   const bytes=Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),character=>character.charCodeAt(0)),pagePath=capture.capturePagePath('fictional-set','fictional-page','image/png');
   const manifest={format:'studentorganizer-capture',version:2,packageId:'fictional-authority-package',assignmentId:'fictional-assignment',assignmentName:'Fictional retained assignment',revision:1,completed:true,submissions:[{id:'fictional-set',label:'Fictional retained set',pages:[{id:'fictional-page',order:0,path:pagePath,mime:'image/png',byteLength:bytes.length,sha256:await capture.captureSha256(bytes),edits:{rotation:0,crop:{x:0,y:0,width:1,height:1}}}]}]};
   const archive: Uint8Array = await capture.encodeCapturePackage(manifest,{[pagePath]:bytes}); return Array.from(archive);
 });
 const file={name:'fictional-authority.zip',mimeType:'application/zip',buffer:Buffer.from(zip)};
 await page.getByTestId('capture-zip').setInputFiles(file);await page.getByTestId('capture-set-fictional-set').click();await page.locator('[data-testid^="capture-student-"]').first().click();await page.getByTestId('capture-confirm').click();
 await page.getByTestId('capture-set-fictional-set').getByText(/^Saved to /).waitFor();
 await page.getByRole('button',{name:/View saved pages/}).click();
 const rows=()=>page.evaluate(async()=>{const path='/src/db/database.ts',{db}=await import(path);return{attachments:await db.captureAttachments.toArray(),receipts:await db.captureImportReceipts.toArray()};});
 const retained=await rows();assert.equal(retained.attachments.length,1);assert.equal(retained.receipts.length,1);
 const epoch=await page.evaluate(async()=>{const path='/src/services/identityService.ts';return(await import(path)).getIdentityEpoch();});
 await page.evaluate(async()=>{const dp='/src/db/database.ts',ip='/src/services/identityService.ts',{db}=await import(dp),identity=await import(ip),membership=await db.organizationMemberships.where('userId').equals(identity.getActiveTeacherId()).first();(window as any).reviewMembership=membership;await db.organizationMemberships.update(membership.id,{status:'suspended'});});
 await page.getByTestId('capture-zip').setInputFiles(file);
 await matching.getByText('Picture attachments and class records are hidden.',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-testid^="capture-student-"]').count(),0);assert.equal(await page.getByTestId('capture-set-fictional-set').count(),0);assert.equal(await page.getByTestId('capture-page-preview').count(),0);
 assert.equal(await page.evaluate(async()=>{const path='/src/services/identityService.ts';return(await import(path)).getIdentityEpoch();}),epoch,'membership denial occurs without identity epoch change');
 // Restoring membership alone must not expose the retained roster/draft.
 await page.evaluate(async()=>{const dp='/src/db/database.ts',sp='/src/capture/attachmentService.ts',{db}=await import(dp);await db.organizationMemberships.put((window as any).reviewMembership);const proto=(await import(sp)).CaptureAttachmentService.prototype,original=proto.context;(window as any).restoreCaptureContext=()=>{proto.context=original;};proto.context=async function(...args:any[]){const value=await original.apply(this,args);(window as any).captureReadReady=true;await new Promise(resolve=>(window as any).releaseCaptureRead=resolve);return value;};});
 await matching.getByRole('button',{name:'Retry loading picture attachments',exact:true}).click();await page.waitForFunction(()=>(window as any).captureReadReady===true);
 assert.equal(await page.locator('[data-testid^="capture-student-"]').count(),0,'old protected context stays hidden during retry');
 await page.evaluate(async()=>{const dp='/src/db/database.ts',{db}=await import(dp);await db.organizationMemberships.update((window as any).reviewMembership.id,{status:'suspended'});(window as any).releaseCaptureRead();});
 await matching.getByRole('button',{name:'Retry loading picture attachments',exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retry loading picture attachments');return button&&!button.disabled;});
 assert.equal(await page.locator('[data-testid^="capture-student-"]').count(),0,'previously authorized context response cannot defeat newer lifecycle denial');
 assert.deepEqual(await rows(),retained,'denial and retry never alter attachment originals or receipts');
 await page.evaluate(async()=>{const dp='/src/db/database.ts',{db}=await import(dp);await db.organizationMemberships.put((window as any).reviewMembership);(window as any).restoreCaptureContext();});
 await matching.getByRole('button',{name:'Retry loading picture attachments',exact:true}).click();await page.getByTestId('capture-set-fictional-set').getByText(/^Saved to /).waitFor();
 assert.ok(await page.locator('[data-testid^="capture-student-"]').count()>0);assert.deepEqual(await rows(),retained,'latest authorized retry restores retained package without reimport');
 assert.deepEqual(errors,[]);
 await writeFile('/tmp/capture-loading-retry-results.json',JSON.stringify({status:'pass',checks:['initial context failure visible','explicit Retry','authorized file import recovers without remount','same-epoch membership denial hides protected content','retry quarantine survives older context success/new lifecycle denial','authorized retry restores retained package and receipts unchanged','no unhandled browser error']},null,2));
 console.log('PASS: initial Retry, same-epoch denial quarantine, retry generation safety and unchanged retained originals/receipts');
}finally{await browser.close();await server.close();}
