import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { unzipSync, strFromU8 } from 'fflate';
const base = process.env.CAPTURE_TEST_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',args:['--no-sandbox']});
const context = await browser.newContext({viewport:{width:390,height:844}});
const page = await context.newPage();const requests=[];const errors=[];
context.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))requests.push(r.url());});
page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(() => {
  window.CaptureNative = {
    getTransferStatus: () => JSON.stringify({available:true,enabled:localStorage.getItem('fictional-enabled')==='true',wifiOnly:true,summary:'Fictional native test double; no actual Drive upload'}),
    requestDriveSetup: () => localStorage.setItem('fictional-enabled','true'),
    enqueueCapture: (bytes,id,revision) => {
      if(localStorage.getItem('fictional-enabled')!=='true')return JSON.stringify({accepted:false,error:'off'});
      const rows=JSON.parse(localStorage.getItem('fictional-queue')??'[]');const previous=rows.find(r=>r.id===id&&r.revision===revision);
      if(previous&&previous.bytes!==bytes)return JSON.stringify({accepted:false,error:'changed revision'});
      if(!previous){rows.push({bytes,id,revision});localStorage.setItem('fictional-queue',JSON.stringify(rows));}
      return JSON.stringify({accepted:true,summary:'Retained by fictional native queue. Upload not verified.'});
    },
    saveLocalZip: bytes => {localStorage.setItem('fictional-export',bytes);return JSON.stringify({accepted:true});}
  };
});
const settle=()=>page.waitForFunction(()=>!document.querySelector('#controls').disabled);
const rows=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('fictional-queue')??'[]'));
try {
  await page.goto(base);await settle();
  await page.selectOption('#class','fictional-science');await settle();
  await page.selectOption('#assignment','Fictional leaf study');await settle();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;return c.toDataURL('image/png').split(',')[1];});
  await page.setInputFiles('#files',{name:'fictional.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await settle();
  await page.locator('article input').fill('Fictional closed-loop');await page.click('#save-labels');await settle();
  assert.equal((await rows()).length,0);
  await page.click('#drive-settings');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('fictional-queue')??'[]').length===1,{},{timeout:15000});
  const first=(await rows())[0];const manifest=JSON.parse(strFromU8(unzipSync(Buffer.from(first.bytes,'base64'))['manifest.json']));
  assert.equal(manifest.pages[0].studentId,null);assert.equal(manifest.pages[0].labelHint,'Fictional closed-loop');
  await page.reload();await settle();
  await page.waitForFunction(()=>document.querySelector('#transfer-status').textContent.includes('fictional native queue'),{},{timeout:15000});
  assert.equal((await rows()).length,1); // replay exact revision after reload deduplicates
  await page.click('#export');await settle();assert.ok(await page.evaluate(()=>localStorage.getItem('fictional-export')));
  await page.evaluate(()=>localStorage.setItem('fictional-enabled','false'));
  await page.locator('article input').fill('Fictional offline retained');await page.click('#save-labels');await settle();
  assert.equal((await rows()).length,1);
  assert.equal(await page.locator('article input').inputValue(),'Fictional offline retained');
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  console.log('PASS: fictional native bridge opt-in/off, labelled snapshot autoqueue, exact revision replay dedup, native local save, unchanged student matching, zero external network. Native Android runtime/Drive not exercised.');
} finally {await browser.close();}
