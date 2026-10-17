import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const base=process.env.CAPTURE_TEST_URL??'http://127.0.0.1:4173';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>void d.accept());
await page.addInitScript(()=>{
 const receipt=(value={})=>JSON.stringify({accepted:true,...value});let chunks=[];
 window.CaptureNative={
 getTransferStatus:()=>JSON.stringify({available:true,enabled:true,wifiOnly:true,summary:'Mock private transport — no upload'}),requestDriveSetup:()=>{},enqueueCapture:()=>{throw Error('Legacy transfer forbidden');},saveLocalZip:()=>{throw Error('Legacy transfer forbidden');},
 startCamera:(batchId,submissionId,remaining)=>{localStorage.setItem('session',JSON.stringify({batchId,submissionId,remaining}));return receipt();},
 getPendingCaptures:(batchId,submissionId)=>JSON.stringify(JSON.parse(localStorage.getItem('pending')??'[]').filter(p=>p.batchId===batchId&&p.submissionId===submissionId).map(p=>({id:p.id}))),
 readPendingCapture:(id,batchId,submissionId)=>{const p=JSON.parse(localStorage.getItem('pending')??'[]').find(p=>p.id===id&&p.batchId===batchId&&p.submissionId===submissionId);return JSON.stringify(p??{error:'wrong owner'});},
 acknowledgeCapture:(id,batchId,submissionId)=>{const p=JSON.parse(localStorage.getItem('pending')??'[]');localStorage.setItem('pending',JSON.stringify(p.filter(p=>p.id!==id||p.batchId!==batchId||p.submissionId!==submissionId)));return receipt();},
 discardPendingCapture:(id,batchId,submissionId)=>{const p=JSON.parse(localStorage.getItem('pending')??'[]');localStorage.setItem('pending',JSON.stringify(p.filter(p=>p.id!==id||p.batchId!==batchId||p.submissionId!==submissionId)));localStorage.setItem('omitted',id);return receipt();},
 beginZip:()=>{chunks=[];return receipt({token:'mock-token'});},appendZip:(_,data)=>{chunks.push(data);return receipt();},cancelZip:()=>receipt(),
 finishZip:(_,id,revision,mode)=>{if(localStorage.getItem('fail-transfer')==='true')return JSON.stringify({accepted:false,error:'Fictional interrupted transport'});const rows=JSON.parse(localStorage.getItem('transfers')??'[]');if(!rows.some(r=>r.id===id&&r.revision===revision&&r.mode===mode))rows.push({id,revision,mode,chunks:chunks.length});localStorage.setItem('transfers',JSON.stringify(rows));return receipt({summary:'Mock transfer retained'});}
 };
});
const settle=()=>page.waitForFunction(()=>!document.querySelector('#controls').disabled);const click=async s=>{await page.click(s);await settle();};
try{
 await page.goto(base);await settle();assert.equal(await page.locator('#browser-camera').isVisible(),false);await page.fill('#assignment','Fictional native study');await click('#name');await click('#native-camera');
 await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;const session=JSON.parse(localStorage.getItem('session'));localStorage.setItem('pending',JSON.stringify([{...session,id:'fictional-native-1',dataUrl:c.toDataURL('image/png')},{...session,id:'fictional-native-2',dataUrl:c.toDataURL('image/png')},{...session,id:'fictional-bad',dataUrl:'data:image/jpeg;base64,YmFk'}]));});
 // Simulates process death after native photos persist, before renderer receives events.
 await page.reload();await settle();await page.waitForFunction(()=>document.querySelectorAll('#pages article').length===2);await settle();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pending')).length),0);assert.equal(await page.evaluate(()=>localStorage.getItem('omitted')),'fictional-bad');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('capture-preview')));await settle();await page.waitForSelector('#label-section:visible');await page.fill('#label','Fictional Avery');await click('#save-group');
 assert.equal(await page.evaluate(()=>localStorage.getItem('transfers')),null);await click('#done');
 await page.evaluate(()=>localStorage.setItem('fail-transfer','true'));await click('#drive-queue');assert.match(await page.locator('#status').innerText(),/interrupted transport/);
 await page.evaluate(()=>localStorage.removeItem('fail-transfer'));await click('#drive-queue');await click('#drive-queue');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('transfers')).length),1);
 await page.reload();await settle();assert.equal(await page.locator('#groups article').count(),1);assert.deepEqual(errors,[]);
 console.log('PASS mocked native recovery scoped to assignment/student, preview cancellation, no intermediate transfer, failed transfer retry/dedup, completed restart. Native camera/OAuth/upload UNVERIFIED.');
}finally{await browser.close();}
