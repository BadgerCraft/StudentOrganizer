import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
const base=process.env.CAPTURE_TEST_URL??'http://127.0.0.1:4173';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage(),errors=[],external=[];
page.on('pageerror',e=>errors.push(String(e)));context.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
page.on('dialog',d=>void d.accept());
const settle=()=>page.waitForFunction(()=>!document.querySelector('#controls').disabled);
const click=async s=>{await page.click(s);await settle();};
try {
 await page.goto(base);await settle();await page.fill('#assignment','Fictional leaf study');await click('#name');
 const pictures=await page.evaluate(()=>['red','blue'].map(color=>{const c=document.createElement('canvas');c.width=300;c.height=400;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,300,400);return c.toDataURL('image/png').split(',')[1];}));
 const files=pictures.map((p,i)=>({name:`fictional-${i}.png`,mimeType:'image/png',buffer:Buffer.from(p,'base64')}));
 await page.setInputFiles('#files',files);await settle();assert.equal(await page.locator('#pages article').count(),2);
 await page.reload();await settle();assert.equal(await page.locator('#pages article').count(),2);await click('#preview');
 await page.getByRole('button',{name:'Rotate 90°'}).first().click();await settle();
 await page.locator('#pages article').first().getByLabel('Left',{exact:true}).fill('10');await page.getByRole('button',{name:'Apply crop'}).first().click();await settle();
 await page.getByRole('button',{name:'Move down',exact:true}).first().click();await settle();await page.fill('#label','Fictional same name');
 // Failed transaction retains both pages and the label for retry.
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){IDBObjectStore.prototype.put=put;throw new DOMException('Fictional disk full','QuotaExceededError');};});
 await click('#save-group');assert.match(await page.locator('#status').innerText(),/Not completed/);assert.equal(await page.inputValue('#label'),'Fictional same name');await click('#save-group');
 assert.equal(await page.locator('#groups article').count(),1);assert.equal(await page.locator('#export').isDisabled(),true);
 await page.setInputFiles('#files',files.slice(0,1));await settle();await click('#preview');await page.fill('#label','Fictional same name');await click('#save-group');
 assert.equal(await page.locator('#groups article').count(),2);await page.reload();await settle();assert.equal(await page.locator('#groups article').count(),2);
 // Wrong image cannot damage already persisted groups.
 await page.setInputFiles('#files',{name:'wrong.jpg',mimeType:'image/jpeg',buffer:Buffer.from('wrong')});await settle();assert.match(await page.locator('#status').innerText(),/Not completed/);assert.equal(await page.locator('#groups article').count(),2);
 await page.setInputFiles('#files',files.slice(0,1));await settle();await click('#preview');await click('#discard-draft');assert.equal(await page.locator('#pages article').count(),0);assert.equal(await page.locator('#groups article').count(),2);
 await click('#done');assert.equal(await page.locator('#export').isEnabled(),true);
 const download=page.waitForEvent('download');await click('#export');const downloaded=await download;await downloaded.saveAs('/tmp/capture-phone-e2e.zip');const zip=new Uint8Array(await readFile(await downloaded.path()));const contents=unzipSync(zip);const manifest=JSON.parse(strFromU8(contents['manifest.json']));
 assert.equal(manifest.submissions.length,2);assert.notEqual(manifest.submissions[0].id,manifest.submissions[1].id);assert.equal(manifest.submissions[0].pages.length,2);assert.equal(manifest.submissions[0].pages[1].edits.rotation,90);assert.equal(manifest.submissions[0].pages[1].edits.crop.x,.1);
 const completedId=await page.inputValue('#archive');await click('#new');await page.fill('#assignment','Fictional next assignment');await click('#name');await page.selectOption('#archive',completedId);await settle();assert.equal(await page.locator('#groups article').count(),2);assert.equal(await page.locator('#done').isDisabled(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS mobile repeated/interrupted flow: edits, duplicate labels, quota retry, restart, freeze/export and retained assignments; no external requests.');
} finally {await browser.close();}
