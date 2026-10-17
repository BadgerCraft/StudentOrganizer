import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { decodeCapturePackage, encodeCapturePackage, capturePagePath, captureSha256, type CaptureManifest } from '../shared/capturePackage';
const origin = 'http://127.0.0.1:4231';
const server = await createServer({ server: { host: '127.0.0.1', port: 4231, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage(); const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.goto(origin); await installFictionalClassroom(page); await page.locator('[data-testid^="select-teacher-"]').first().click();
  const rows = (table: string) => page.evaluate(table => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('OntarioTeacherAssessmentDB'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const database = open.result; const tx = database.transaction(table); const read = tx.objectStore(table).getAll(); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => database.close(); };
  }), table);
  const beforeResults = await rows('categoryResults'), beforeAttempts = await rows('markingAttempts');
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,240,320); ctx.fillStyle = '#126'; ctx.fillRect(0,0,100,100); return canvas.toDataURL('image/png').split(',')[1]; });
  const bytes = new Uint8Array(Buffer.from(png,'base64')), hash = await captureSha256(bytes);
  const manifest: CaptureManifest = { format:'studentorganizer-capture',version:2,packageId:'fictional-package',assignmentId:'fictional-assignment',assignmentName:'Fictional picture assignment',revision:1,completed:true,submissions:[] };
  const files: Record<string,Uint8Array> = {};
  for (let s=0;s<3;s++) { const id=`set-${s}`, pages=[]; for (let p=0;p<2;p++) { const pageId=`page-${s}-${p}`, path=capturePagePath(id,pageId,'image/png'); files[path]=bytes; pages.push({id:pageId,order:p,path,mime:'image/png' as const,byteLength:bytes.length,sha256:hash,edits:{rotation:90 as const,crop:{x:0,y:0,width:0.5,height:1}}}); } manifest.submissions.push({id,label:s<2?'Fictional Same Name':'Fictional Third',pages}); }
  const zip = await encodeCapturePackage(manifest,files);
  async function openMatching() { await page.getByRole('button',{name:'Assessments',exact:true}).click(); await page.locator('[data-testid^="upload-pictures-"]').first().click(); await page.getByTestId('capture-zip').waitFor(); await page.waitForFunction(()=>!document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled); }
  const upload = async (buffer: Uint8Array = zip, name = 'fictional.zip') => { await page.waitForFunction(()=>!document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled); await page.getByTestId('capture-zip').setInputFiles({name,mimeType:'application/zip',buffer:Buffer.from(buffer)}); };
  await openMatching();
  await upload(new Uint8Array([1,2,3]),'wrong.txt'); await page.getByRole('alert').filter({hasText:'Choose a completed'}).waitFor();
  await upload(new Uint8Array([1,2,3])); await page.getByRole('alert').filter({hasText:'ZIP'}).waitFor();
  await upload(); await page.getByTestId('capture-set-set-0').waitFor();
  assert.equal(await page.getByTestId('capture-confirm').isDisabled(),true);
  await page.getByTestId('capture-set-set-0').click();
  await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('canvas')?.width===320);
  await page.locator('[data-testid^="capture-student-"]').first().click();
  await page.screenshot({path:'/tmp/capture-desktop-matching.png',fullPage:true});
  // Inject one actual IDB failure; selection must remain retryable and neither row may appear.
  await page.evaluate(()=> { const original=IDBObjectStore.prototype.add; IDBObjectStore.prototype.add=function(value:any,key?:IDBValidKey) { if(this.name==='captureImportReceipts'){ IDBObjectStore.prototype.add=original; throw new DOMException('Fictional full disk','QuotaExceededError'); } return key===undefined?original.call(this,value):original.call(this,value,key); }; });
  await page.getByTestId('capture-confirm').click(); await page.getByRole('alert').filter({hasText:'selection is retained'}).waitFor();
  assert.equal((await rows('captureAttachments')).length,0); assert.equal((await rows('captureImportReceipts')).length,0);
  await page.getByTestId('capture-confirm').dblclick(); await page.waitForFunction(()=>document.querySelector('[data-testid="capture-set-set-0"]')?.hasAttribute('disabled'));
  assert.equal((await rows('captureAttachments')).length,1); assert.equal((await rows('captureImportReceipts')).length,1);
  await page.getByTestId('capture-set-set-1').click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="capture-set-set-1"]')?.hasAttribute('disabled'));
  const saved=await rows('captureAttachments'); assert.equal(saved.length,2); assert.equal(saved[0].pages.length,2); assert.notEqual(saved[0].classEnrollmentId,saved[1].classEnrollmentId);
  // Partial completion survives reload/reimport; labels never identify a student.
  await page.reload(); const teacher=page.locator('[data-testid^="select-teacher-"]').first(); if(await teacher.isVisible()) await teacher.click(); await openMatching(); await upload();
  await page.waitForFunction(()=>document.querySelector('[data-testid="capture-set-set-0"]')?.hasAttribute('disabled'));
  assert.equal(await page.getByTestId('capture-set-set-1').isDisabled(),true); assert.equal(await page.getByTestId('capture-set-set-2').isDisabled(),false);
  await page.getByTestId('capture-set-set-2').click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="capture-set-set-2"]')?.hasAttribute('disabled'));
  assert.equal((await rows('captureAttachments')).length,3);
  await upload(); await page.getByRole('status').filter({hasText:'3 already saved'}).waitFor();
  assert.equal((await rows('captureAttachments')).length,3); assert.deepEqual(await rows('categoryResults'),beforeResults); assert.deepEqual(await rows('markingAttempts'),beforeAttempts);
  await page.getByRole('button',{name:'Close matching'}).click(); await openMatching(); await page.getByRole('heading',{name:'Saved picture attachments'}).waitFor();
  await page.getByRole('button',{name:/View saved pages/}).first().click(); await page.locator('canvas').first().waitFor();
  if (process.env.CAPTURE_PHONE_ZIP) {
    const phoneBytes = new Uint8Array(await readFile(process.env.CAPTURE_PHONE_ZIP)); const phone = await decodeCapturePackage(phoneBytes);
    await upload(phoneBytes); await page.getByTestId(`capture-set-${phone.submissions[0].id}`).waitFor();
    for (const submission of phone.submissions) {
      await page.getByTestId(`capture-set-${submission.id}`).click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
      await page.waitForFunction(id=>document.querySelector(`[data-testid="capture-set-${id}"]`)?.hasAttribute('disabled'),submission.id);
      await page.waitForFunction(()=>!document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled);
    }
    const phoneSaved=(await rows('captureAttachments')).filter(a=>a.packageId===phone.manifest.packageId);
    assert.equal(phoneSaved.length,phone.submissions.length);
    for(const submission of phone.submissions) { const saved=phoneSaved.find(a=>a.submissionId===submission.id); assert.equal(saved.pages.length,submission.pages.length); for(let i=0;i<saved.pages.length;i++){assert.deepEqual(saved.pages[i].metadata.edits,submission.pages[i].metadata.edits);assert.deepEqual(Buffer.from(saved.pages[i].base64,'base64'),Buffer.from(submission.pages[i].bytes));} }
    console.log('PASS actual phone browser exported edited ZIP -> desktop explicit matches -> exact originals/edits durable, no rubric/marking.');
  }
  await page.getByRole('button',{name:'Switch teacher',exact:true}).click(); assert.equal(await page.getByTestId('capture-matching').count(),0);
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  console.log('PASS desktop ZIP: wrong files/invalid archive; duplicate labels; edited preview; atomic quota rollback/retry; double confirm; partial restart/reimport; receipts prevent duplicates; matching without rubric/marking; official grades unchanged; teacher switch clears view; zero network.');
} finally { await browser.close(); await server.close(); }
