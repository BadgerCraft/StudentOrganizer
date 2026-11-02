import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
const base=process.env.CAPTURE_TEST_URL??'http://127.0.0.1:4173';
const evidence=process.env.CAPTURE_UI_EVIDENCE??'/tmp/phone-ui-evidence';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
const errors=[],external=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('blob:'))external.push(r.url());});
let accept=false;page.on('dialog',d=>void(accept?d.accept():d.dismiss()));
const settle=()=>page.waitForFunction(()=>!document.querySelector('#controls').disabled);
const click=async id=>{await page.click(id);await settle();};
async function screenshot(name){await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});}
async function layout(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');const tiny=await page.locator('button,summary,input,select').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<43).map(e=>e.id||e.textContent));assert.deepEqual(tiny,[],'visible touch controls at least 44px tall');}
try{
 await page.goto(base);await settle();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await screenshot('home-dark');
 await click('#new');assert.equal(await page.locator('#intake').isVisible(),false);await screenshot('setup-dark');await click('#name');assert.match(await page.locator('#status').innerText(),/Enter an assignment name/);
 await page.fill('#assignment','Fictional class · leaf study');await click('#name');assert.equal(await page.locator('#setup').isVisible(),false);assert.equal(await page.locator('#delivery').isVisible(),false);await screenshot('capture-dark');
 const picture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=320;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,240,320);x.fillStyle='#234';x.font='20px sans-serif';x.fillText('FICTIONAL',35,60);x.fillText('Leaf study',35,100);return c.toDataURL('image/png').split(',')[1];});
 await page.setInputFiles('#files',{name:'fictional.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')});await settle();await screenshot('pending-dark');
 await click('#preview');assert.equal(await page.locator('#checklist li').nth(2).getAttribute('data-complete'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'task-title');await click('#save-group');assert.match(await page.locator('#status').innerText(),/label/i);assert.equal(await page.locator('#pages article').count(),1);
 await page.fill('#label','Fictional Avery');await click('#resume');assert.notEqual(await page.locator('#upload-readiness').innerText(),'Clear to Upload');await click('#preview');assert.equal(await page.inputValue('#label'),'Fictional Avery');
 await click('#discard-draft');assert.equal(await page.locator('#pages article').count(),1,'cancel retains draft');
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await layout();await screenshot(`preview-dark-${width}`);}
 await page.setViewportSize({width:390,height:844});await click('#theme');assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await screenshot('preview-light');await page.reload();await settle();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.inputValue('#label'),'Fictional Avery');
 // Busy guard rejects repeated synchronous taps while saving the same student.
 await page.evaluate(()=>{document.querySelector('#save-group').click();document.querySelector('#save-group').click();});await settle();assert.equal(await page.locator('#groups article').count(),1);assert.equal(await page.evaluate(()=>document.activeElement.id),'task-title');assert.ok(await page.locator('#task-title').evaluate(el=>el.getBoundingClientRect().top>=0));await screenshot('between-students-light');await page.getByRole('button',{name:'Reopen group',exact:true}).click();await settle();assert.equal(await page.locator('#checklist li').nth(2).getAttribute('data-complete'),'false');assert.notEqual(await page.locator('#upload-readiness').innerText(),'Clear to Upload');await click('#save-group');
 await click('#done');assert.equal(await page.locator('#delivery').isVisible(),false,'cancel completion remains editable');accept=true;await click('#done');assert.equal(await page.locator('#delivery').isVisible(),true);assert.equal(await page.locator('#intake').isVisible(),false);await layout();await screenshot('transfer-light');
 await click('#theme');await screenshot('transfer-dark');await page.locator('#package-details summary').click();accept=false;await click('#delete');assert.equal(await page.locator('#groups article').count(),1,'cancel delete retains package');
 // A completed-package validation failure blocks upload, not recovery navigation.
 await page.addInitScript(()=>{window.savedDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(algorithm,bytes)=>algorithm==='SHA-256'?Promise.reject(Error('Synthetic package check failure')):window.savedDigest(algorithm,bytes);});
 await page.reload();await settle();assert.equal(await page.locator('#controls').isDisabled(),false);
 assert.equal(await page.locator('#checklist li').nth(3).getAttribute('data-complete'),'false');
 assert.match(await page.locator('#status').innerText(),/Package check failed/);assert.equal(await page.locator('#drive-queue').isDisabled(),true);
 await page.evaluate(()=>{crypto.subtle.digest=window.savedDigest;});await click('#check-upload');assert.equal(await page.locator('#checklist li').nth(3).getAttribute('data-complete'),'true');await click('#home');await page.locator('#new').focus();await page.keyboard.press('Enter');await settle();assert.equal(await page.locator('#setup').isVisible(),true);await layout();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS focused stages, dark/light persistence, 320/390/768px layout and touch sizes, required label, Back/cancel, double tap, original draft retention; no external requests.');
}finally{await browser.close();}
