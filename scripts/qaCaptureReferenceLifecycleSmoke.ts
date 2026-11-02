// Actual components and public capture/marking services; all data is fictional and local.
// Small bound pages are converted to valid references to isolate lifecycle faults
// without duplicating the separate 35 MiB pixel-capacity smoke.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const harness = `<html><body><div id="root"></div><script type="module">
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {db} from '/src/db/database.ts';import {seedDatabase} from '/src/db/seeds.ts';
import {selectActingTeacher,getIdentityEpoch,setActiveTeacherId} from '/src/services/identityService.ts';
import {CaptureAttachmentService} from '/src/capture/attachmentService.ts';import {MarkingService} from '/src/marking/markingService.ts';
import {captureSha256,capturePagePath} from '/shared/capturePackage.ts';
import {ImageMarkup} from '/src/marking/ui/ImageMarkup.tsx';import {ReadOnlyOriginalWork} from '/src/marking/ui/ReadOnlyMarkingHistory.tsx';
await seedDatabase(db);const identity=await selectActingTeacher(db,'user-tyler');const actor={...identity,epoch:getIdentityEpoch()},ca={...identity,identityEpoch:actor.epoch};
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));const hash=await captureSha256(bytes);
const pages=[0,1].map(order=>({id:'page-'+order,order,path:capturePagePath('student','page-'+order,'image/png'),mime:'image/png',byteLength:bytes.length,sha256:hash,edits:{rotation:0,crop:{x:0,y:0,width:1,height:1}}}));
const submission={id:'student',label:'Fictional',pages};const pkg={manifest:{format:'studentorganizer-capture',version:2,packageId:'fictional-package',assignmentId:'fictional-assignment',assignmentName:'Fictional',revision:1,completed:true,submissions:[submission]},submissions:[{...submission,pages:pages.map(metadata=>({metadata,bytes}))}]};
const capture=new CaptureAttachmentService(db),marking=new MarkingService(db);const enrollment=(await capture.context('assess-eng-essay',ca)).roster[0].enrollment.id;
const receipt=await capture.confirm('assess-eng-essay',pkg,'student',enrollment,ca);const rubric=await marking.saveRubric('assess-eng-essay',{title:'Fictional',levels:['Clear'],criteria:[{id:'reason',name:'Reason',categoryCode:'K',descriptors:{Clear:'Clear'}}]},actor);
const attempt=await marking.bindCaptureRoot(receipt.attachmentId,{rubricId:rubric.id},actor);
attempt.imagePages=attempt.imagePages.map((page,i)=>{const {base64,...rest}=page;return {...rest,captureRef:{version:1,attachmentId:receipt.attachmentId,pageId:pages[i].id}}});await db.markingAttempts.put(attempt);
const session=await marking.openSession(attempt.id,actor);window.ids=attempt.imagePages.map(p=>p.id);window.original=await db.captureAttachments.get(receipt.attachmentId);window.remove=()=>db.captureAttachments.delete(receipt.attachmentId);window.restore=()=>db.captureAttachments.put(window.original);
const realRead=MarkingService.prototype.readImagePage;window.calls=[];MarkingService.prototype.readImagePage=async function(...args){window.calls.push(args[1]);const result=await realRead.apply(this,args);if(window.hold){window.hold=false;await new Promise(resolve=>window.release=resolve)}return result};
function App(){const [mode,setMode]=useState('none'),[who,setWho]=useState(actor);window.mount=setMode;window.switchTeacher=()=>{setActiveTeacherId('fictional-other');setWho({...actor,userId:'fictional-other',epoch:getIdentityEpoch()})};window.returnTeacher=async()=>{await selectActingTeacher(db,'user-tyler');setWho({...actor,epoch:getIdentityEpoch()})};return mode==='editor'?React.createElement(ImageMarkup,{attemptId:attempt.id,actor:who,pages:attempt.imagePages,feedback:session.draft.imageFeedback,onChange:()=>{window.writes=(window.writes||0)+1},rubric,disabled:false}):mode==='history'?React.createElement(ReadOnlyOriginalWork,{attempt,actor:who}):null}createRoot(document.getElementById('root')).render(React.createElement(App));window.ready=true;
</script></body></html>`;
const server = await createServer({ cacheDir: '/tmp/capture-lifecycle-vite', server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{ name: 'fixture', configureServer(s) { s.middlewares.use('/__fixture', async (req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/__fixture', harness)); }); } }] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const origin = 'http://127.0.0.1:' + (server.httpServer!.address() as {
        port: number;
    }).port;
    const external: string[] = [];
    await page.route('**/*', route => { if (route.request().url().startsWith(origin + '/') || route.request().url().startsWith('blob:'))
        return route.continue(); external.push(route.request().url()); return route.abort(); });
    await page.goto(origin + '/__fixture');
    await page.waitForFunction(() => (window as any).ready);
    await page.evaluate(() => { (window as any).hold = true; (window as any).mount('editor'); });
    await page.waitForFunction(() => !!(window as any).release);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.evaluate(() => (window as any).release());
    await page.locator('canvas').waitFor({ state: 'visible' });
    assert.match(await page.locator('canvas').getAttribute('aria-label') ?? '', /page-1/);
    assert.equal(await page.evaluate(() => (window as any).calls.length), 2);
    console.log('PASS pending original page switch ignores obsolete read; queue serves selected page');
    await page.evaluate(() => (window as any).remove());
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => (window as any).restore());
    await page.getByRole('button', { name: 'Retry image preview' }).click();
    await page.locator('canvas').waitFor({ state: 'visible' });
    console.log('PASS missing reference shows retry; restored original recovers');
    await page.evaluate(() => { (window as any).hold = true; (window as any).release = null; });
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => !!(window as any).release);
    await page.evaluate(() => (window as any).switchTeacher());
    await page.evaluate(() => (window as any).release());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('canvas').isVisible(), false);
    assert.equal(await page.evaluate(() => (window as any).writes || 0), 0);
    console.log('PASS teacher switch while original pending leaves no stale pixels or writes');
    await page.evaluate(() => (window as any).returnTeacher());
    await page.locator('canvas').waitFor({ state: 'visible' });
    await page.evaluate(() => { const decode = (window as any).createImageBitmap.bind(window); let calls = 0, active = 0; (window as any).maxDecode = 0; (window as any).releaseDecode = null; (window as any).createImageBitmap = async (...args: any[]) => { active++; (window as any).maxDecode = Math.max((window as any).maxDecode, active); try {
        const result = await decode(...args);
        if (++calls === 2)
            await new Promise(resolve => (window as any).releaseDecode = resolve);
        return result;
    }
    finally {
        active--;
    } }; });
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.waitForFunction(() => !!(window as any).releaseDecode);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.evaluate(() => (window as any).releaseDecode());
    await page.locator('canvas').waitFor({ state: 'visible' });
    assert.match(await page.locator('canvas').getAttribute('aria-label') ?? '', /page-1/);
    assert.equal(await page.evaluate(() => (window as any).maxDecode), 1);
    console.log('PASS delayed actual decoder cancellation releases queue, ignores old pixels, maximum one in-flight decode');
    await page.evaluate(async () => { await (window as any).returnTeacher(); (window as any).mount('history'); });
    await page.getByLabel('Saved original page').selectOption(await page.evaluate(() => (window as any).ids[0]));
    await page.locator('img').waitFor();
    await page.evaluate(() => (window as any).remove());
    await page.getByLabel('Saved original page').selectOption(await page.evaluate(() => (window as any).ids[1]));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('img').count(), 0);
    await page.evaluate(() => (window as any).restore());
    await page.getByRole('button', { name: 'Retry original' }).click();
    await page.locator('img').waitFor();
    console.log('PASS history missing reference hides old image and retry recovers');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
}
finally {
    await browser.close();
    await server.close();
}
