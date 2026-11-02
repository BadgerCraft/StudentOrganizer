import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real components, database, permission checks and serializers. Only the native
// warning/save boundary is mocked: this does not certify OS dialogs or PDF bytes.
const harness = `<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import'/src/index.css';
import{db}from'/src/db/database';import{seedDatabase}from'/src/db/seeds';
import{selectActingTeacher,getIdentityEpoch,clearActiveTeacherId}from'/src/services/identityService';
import{CommentBankPicker}from'/src/marking/ui/CommentBankPicker';import{saveCommentBank,exportCommentBank}from'/src/marking/commentBank';import{initializeEncryptedRuntime}from'/src/security/encryptedRuntime';import{validateEncryptedBundle}from'/src/security/validateEncryptedBundle';
import{ImportExportModal}from'/src/components/ImportExportModal';import{MarkingWorkspace}from'/src/components/MarkingWorkspace';
import{MarkingService}from'/src/marking/markingService';import{PortabilityService}from'/src/services/portabilityService';
import{setRendererStorageMode}from'/src/security/rendererStorageMode';import{downloadFile}from'/src/utils/downloadFile';
await seedDatabase(db);const identity=await selectActingTeacher(db,'user-tyler');const actor={...identity,epoch:getIdentityEpoch()};
const service=new MarkingService(db),assessmentId='assess-eng-essay',section=await db.classSections.get('class-eng4u-01');
const rubric=await service.saveRubric(assessmentId,{title:'Fictional export rubric',levels:['Secure'],criteria:[{id:'reason',name:'Reasoning',categoryCode:'T',descriptors:{Secure:'Clear evidence.'}}]},actor);
const enrollment=await db.classEnrollments.where('classSectionId').equals(section.id).first();
const attempt=await service.importAttempt(assessmentId,rubric.id,[{id:'fictional-document',name:'fictional.txt',text:'Fictional export evidence.',hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Fictional export evidence.')))].map(b=>b.toString(16).padStart(2,'0')).join(''),original:null}],enrollment.id,null,actor);
let session=await service.openSession(attempt.id,actor);session=await service.saveDraft(session.id,{...session.draft,overallFeedback:'Fictional saved feedback — é',judgments:session.draft.judgments.map(j=>({...j,assessed:true,rawScore:'3+',inputFormat:'scale_code',feedback:'Fictional category feedback.'}))},session.version,actor);
const commit=await service.finalize(session.id,session.version,actor);
const portability=new PortabilityService(db);const expected={markbook:await portability.exportClassMarkbookCSV(section.id,null),participation:await portability.exportParticipationEventsCSV(section.id)};
const calls=[],saved=[];let resolve=null,cancels=0;const exportFile=(kind,filename,content,revision)=>{calls.push({kind,filename,content,revision});return new Promise(done=>{resolve=(accepted)=>{if(accepted)saved.push({kind,filename,content});resolve=null;done(accepted);};});};
window.desktopEncryption={selectActingTeacher:async()=>({ok:true,value:null}),status:async()=>({ok:true,value:{mode:'encrypted',state:'unlocked',revision:7}})};window.desktopReports={exportCsv:(name,text,revision)=>exportFile('csv',name,text,revision),exportPdf:(name,text,revision)=>exportFile('pdf',name,text,revision),cancelReadableExport:async()=>{cancels++;resolve?.(false);}};
const root=createRoot(document.getElementById('root'));const render=(mode)=>root.render(mode==='csv'?React.createElement(ImportExportModal,{classSection:section,userId:'user-tyler',deviceId:identity.deviceId,onRefresh:()=>{}}):mode==='pdf'?React.createElement(MarkingWorkspace,{assessmentId,userId:'user-tyler',onClose:()=>root.render(null),onRefresh:()=>{}}):mode==='bank'?React.createElement(CommentBankPicker,{actor,onSelect:()=>{}}):null);
const prepareBank=async()=>{const comments=['Fictional saved bank, with comma','Fictional \"quoted\" café feedback'];saveCommentBank(localStorage,actor,comments);const snapshot={format:'student-organizer-working',version:1,primary:JSON.parse(await portability.createFullBackupJSON()),recovery:{backups:[],options:[],state:[]},applicationStorage:{['ota.comment-bank.v1.'+actor.userId]:localStorage.getItem('ota.comment-bank.v1.'+actor.userId)}};await validateEncryptedBundle(snapshot,db);window.desktopEncryption.read=async()=>({ok:true,value:{revision:7,snapshot}});window.desktopEncryption.lock=async()=>({ok:true,value:null});await initializeEncryptedRuntime({mode:'encrypted',state:'unlocked',appId:'student-organizer',deviceId:identity.deviceId,ephemeralPartition:true},window.desktopEncryption);const next=await selectActingTeacher(db,'user-tyler');Object.assign(actor,next,{epoch:getIdentityEpoch()});expected.bank=exportCommentBank(comments);render('bank');};
window.fixture={prepareBank,changeActor:()=>clearActiveTeacherId(),expected,calls,saved,commit:commit.id,cancels:()=>cancels,finish:(ok)=>resolve?.(ok),render,blockGeneric:()=>{const results=[];for(const [name,mime]of[['fictional.html','text/html'],['fictional.json','application/json']]){try{downloadFile(new Blob(['fictional'],{type:mime}),name);results.push('allowed');}catch(e){results.push(e.message);}}return results;}};
setRendererStorageMode('encrypted');render('csv');
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{ name: 'protected-export-fixture', configureServer(instance) { instance.middlewares.use('/__protected-exports', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await instance.transformIndexHtml('/__protected-exports', harness)); }); } }] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000);
const errors: string[] = [], external: string[] = [], downloads: string[] = [];
page.on('pageerror', e => errors.push(e.message)); page.on('download', d => downloads.push(d.suggestedFilename()));
await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
const state = () => page.evaluate(() => { const f = (window as any).fixture; return { calls: f.calls, saved: f.saved, cancels: f.cancels(), expected: f.expected }; });
const out = `${process.env.ENCRYPTION_ARTIFACT_DIR || '/tmp'}/protected-readable-exports`;
try {
  await page.addInitScript('globalThis.__name = (fn) => fn');
  await page.addInitScript(() => { (window as any).desktopEncryption = { selectActingTeacher: async () => ({ ok: true, value: null }) }; });
  await page.goto(origin + '/__protected-exports'); await page.getByTestId('export-markbook-btn').waitFor();
  for (const [id, kind] of [['export-markbook-btn', 'markbook'], ['export-participation-btn', 'participation']] as const) {
    const button = page.getByTestId(id), before = await state();
    await button.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
    await page.waitForFunction(count => (window as any).fixture.calls.length === count, before.calls.length + 1);
    assert.equal(await button.isDisabled(), true);
    let current = await state(); assert.equal(current.calls.at(-1).revision, 7); assert.equal(current.calls.at(-1).content, current.expected[kind]); assert.match(current.calls.at(-1).filename, /\.csv$/); assert.equal(current.saved.length, before.saved.length);
    await page.evaluate(() => (window as any).fixture.finish(false)); await page.getByText('Export cancelled. No file was saved.', { exact: true }).waitFor();
    await button.click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, before.calls.length + 2);
    await page.evaluate(() => (window as any).fixture.finish(true)); await page.getByText('Unencrypted CSV saved.', { exact: true }).waitFor();
    current = await state(); assert.equal(current.saved.length, before.saved.length + 1); assert.equal(current.saved.at(-1).content, current.expected[kind]);
  }
  const beforeSwitch = await state(); await page.getByTestId('export-markbook-btn').click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforeSwitch.calls.length + 1);
  await page.evaluate(() => (window as any).fixture.render('none')); await page.waitForFunction(() => (window as any).fixture.cancels() > 0); assert.equal((await state()).saved.length, beforeSwitch.saved.length);
  await page.evaluate(() => (window as any).fixture.render('pdf')); await page.getByRole('button', { name: 'Marking queue', exact: true }).click();
  const pdf = page.getByRole('button', { name: 'Export marked PDF', exact: true }).first(); await pdf.waitFor();
  const beforePdf = await state(); await pdf.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); }); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforePdf.calls.length + 1);
  assert.equal(await pdf.isDisabled(), true); const payload = (await state()).calls.at(-1); assert.equal(payload.kind, 'pdf'); assert.equal(payload.revision, 7); assert.match(payload.filename, /\.pdf$/); assert.match(payload.content, /Fictional saved feedback — é/); assert.match(payload.content, /3\+ \(scale code\)/); assert.match(payload.content, /Content-Security-Policy/);
  await page.evaluate(() => (window as any).fixture.finish(false)); await page.getByText('Export cancelled. Saved work is unchanged.', { exact: true }).waitFor();
  await pdf.click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforePdf.calls.length + 2); await page.evaluate(() => (window as any).fixture.finish(true)); await page.getByText('Report exported locally.', { exact: true }).waitFor(); assert.equal((await state()).saved.at(-1).content, payload.content);
  await page.getByRole('button', { name: /^Report / }).first().click(); await page.getByText(/Readable file export is unavailable/).waitFor(); assert.equal((await state()).calls.length, beforePdf.calls.length + 2);
  const blocked = await page.evaluate(() => (window as any).fixture.blockGeneric()); assert.equal(blocked.length, 2); for (const message of blocked) assert.match(message, /No readable file was saved/);
  await page.screenshot({ path: (await mkdir(out, { recursive: true }), out + '/protected-export.png'), fullPage: true });
  const beforePdfSwitch = await state(); await pdf.click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforePdfSwitch.calls.length + 1); await page.evaluate(() => (window as any).fixture.render('none')); await page.waitForFunction(count => (window as any).fixture.cancels() > count, beforePdfSwitch.cancels); assert.equal((await state()).saved.length, beforePdfSwitch.saved.length);
  await page.evaluate(() => (window as any).fixture.prepareBank());
  await page.getByRole('button', { name: 'Choose bank comment (2)', exact: true }).click();
  const bank = page.getByRole('button', { name: 'Export comment bank', exact: true });
  const beforeBank = await state(); await bank.evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
  await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforeBank.calls.length + 1);
  assert.equal(await bank.isDisabled(), true); let bankState = await state(); assert.equal(bankState.calls.at(-1).revision, 7); assert.equal(bankState.calls.at(-1).filename, 'comment-bank.csv'); assert.equal(bankState.calls.at(-1).content, bankState.expected.bank);
  await page.evaluate(() => (window as any).fixture.finish(false)); await page.getByText('Export cancelled. No file was saved.', { exact: true }).waitFor(); assert.equal((await state()).saved.length, beforeBank.saved.length);
  await bank.click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforeBank.calls.length + 2); await page.evaluate(() => (window as any).fixture.finish(true)); await page.getByText('Unencrypted comment bank CSV saved.', { exact: true }).waitFor(); bankState = await state(); assert.equal(bankState.saved.at(-1).content, bankState.expected.bank);
  await bank.click(); await page.waitForFunction(count => (window as any).fixture.calls.length === count, beforeBank.calls.length + 3); await page.evaluate(() => (window as any).fixture.render('none')); await page.waitForFunction(count => (window as any).fixture.cancels() > count, bankState.cancels); assert.equal((await state()).saved.length, bankState.saved.length);
  await page.evaluate(() => (window as any).fixture.render('bank')); await page.getByRole('button', { name: 'Choose bank comment (2)', exact: true }).click(); await page.evaluate(() => (window as any).fixture.changeActor()); const beforeWrongActor = await state(); await bank.click(); await page.getByText('The acting teacher changed. Reopen the comment editor before continuing.', { exact: true }).waitFor(); assert.equal((await state()).calls.length, beforeWrongActor.calls.length);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(downloads, []);
  await writeFile(out + '/results.json', JSON.stringify({ status: 'PASS', checks: ['real CSV and marking components with authorized fictional records', 'CSV exact serializer bytes', 'PDF HTML saved judgments and Unicode retained', 'cancel and retry for both formats', 'repeated clicks issue one native request', 'unmount cancels pending native export for both components', 'generic HTML report and HTML/JSON downloads fail closed', 'comment-bank CSV cancel/retry/duplicate/unmount and exact saved escaped Unicode content with revision', 'stale comment-bank actor blocked before native export', 'no browser download, external request, or page error'], limits: ['Native warning/save dialog mocked', 'PDF binary and OS filesystem not exercised', 'Component harness uses development modules and synthetic seeded IndexedDB, not encrypted disk storage'] }, null, 2));
  console.log('PASS protected readable exports; real components/services, mocked native boundary. Evidence: ' + out);
} catch (error) { console.error(await page.locator('body').innerText(), errors); throw error; }
finally { await browser.close(); await server.close(); }
