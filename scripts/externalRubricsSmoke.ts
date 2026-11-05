import assert from 'node:assert/strict';
import { fictionalMarkedPdf } from './pdfFixture';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const harness = `<!doctype html><html class="dark"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import'/src/index.css';
import{db}from'/src/db/database';import{seedDatabase}from'/src/db/seeds';import{selectActingTeacher,getIdentityEpoch}from'/src/services/identityService';
import{PortabilityService}from'/src/services/portabilityService';import{MarkingService}from'/src/marking/markingService';import{createPastedDocument}from'/src/marking/importDocuments';import{MarkingWorkspace}from'/src/components/MarkingWorkspace';
await seedDatabase(db);const identity=await selectActingTeacher(db,'user-tyler');const actor={userId:identity.userId,deviceId:identity.deviceId,epoch:getIdentityEpoch()};
const template=await db.assessments.get('assess-eng-essay');const id='fictional-focused-assignment';await db.assessments.add({...template,id,title:'Fictional inquiry',code:'FOCUSED'});
const cats=(await db.assessmentCategories.where('assessmentId').equals(template.id).toArray()).map(c=>({...c,id:'focused-'+c.categoryCode,assessmentId:id}));await db.assessmentCategories.bulkAdd(cats);
window.official=async()=>JSON.stringify({s:await db.studentAssessments.toArray(),r:await db.categoryResults.toArray()});
window.savedAttempts=async()=>await db.markingAttempts.where('assessmentId').equals(id).toArray();
window.roundtrip=async()=>{const service=new PortabilityService(db);await service.restoreFromJSON(await service.createFullBackupJSON());};
window.fixture={assessmentId:id};
createRoot(document.getElementById('root')).render(React.createElement(MarkingWorkspace,{assessmentId:id,userId:identity.userId,onClose:()=>{},onRefresh:()=>{}}));
</script></body></html>`.replace("const document=await createPastedDocument", "const work=await createPastedDocument").replace('[document],enrollment','[work],enrollment');
const server=await createServer({server:{host:'127.0.0.1',port:0,watch:null,hmr:false},plugins:[{name:'focused-marking-fixture',configureServer(instance){instance.middlewares.use('/__focused',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await instance.transformIndexHtml('/__focused',harness));});}}]});
await server.listen();const address=server.httpServer!.address();assert.ok(address && typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
const out='/tmp/external-rubrics';await mkdir(out,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER',e.message)});await page.goto(`http://127.0.0.1:${address.port}/__focused`);
 await page.getByRole('heading',{name:'Prepare this assignment'}).waitFor();
 const baseline=await page.evaluate(()=>(window as any).official());
 await page.getByRole('button',{name:/Import already marked rubrics/}).click();
 await page.getByRole('heading',{name:'Upload already marked rubric files'}).waitFor();
 await page.getByLabel('Upload a text/document file',{exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Choose text/document files',{exact:true}).setInputFiles([
   {name:'Fictional-A.txt',mimeType:'text/plain',buffer:Buffer.from('K: 3. Already marked fictional rubric.')},
   {name:'Fictional-B.txt',mimeType:'text/plain',buffer:Buffer.from('K: 3. Already marked fictional rubric.')},
   {name:'Unsupported.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF unsupported')}
 ]);
 await page.getByRole('button',{name:'Add work and select students'}).click();
 await page.getByRole('heading',{name:'Who does this work belong to?'}).waitFor();
 assert.match(await page.getByTestId('evidence-import-wizard').innerText(),/2 work item/);
 await page.getByLabel('Continue with only the work successfully added; leave these files out.').check();
 const students=page.getByRole('group',{name:'Class students'}).getByRole('checkbox');
 await students.nth(0).check();await students.nth(1).check();
 await page.getByRole('button',{name:'Continue to matching'}).click();
 await page.getByRole('radio',{name:'Fictional-A.txt',exact:true}).check();
 const names=page.locator('input[name="evidence-student-match"]');await names.nth(0).check();
 await page.getByRole('button',{name:'Confirm match',exact:true}).click();
 await page.getByRole('button',{name:'Undo / change match',exact:true}).click();
 await names.nth(1).check();await page.getByRole('button',{name:'Confirm match',exact:true}).click();
 await page.getByRole('radio',{name:'Fictional-B.txt',exact:true}).check();await names.nth(0).check();
 await page.getByRole('button',{name:'Confirm match',exact:true}).click();
 await page.getByRole('button',{name:'Review matches',exact:true}).click();
 await page.getByRole('button',{name:'Confirm and start marking',exact:true}).click();
 await page.getByTestId('final-grading-workspace').waitFor();
 const originals=page.getByRole('region',{name:'Uploaded work beside grades'});
 assert.equal(await originals.getByText('K: 3. Already marked fictional rubric.',{exact:true}).isVisible(),true);
 const attempts=await page.evaluate(()=>(window as any).savedAttempts());assert.equal(attempts.length,2);
 assert.notEqual(attempts[0].classEnrollmentId,attempts[1].classEnrollmentId);
 assert.equal(await page.evaluate(()=>(window as any).official()),baseline);
 const chips=page.getByRole('complementary',{name:'Final category decisions'});
 await chips.getByRole('button',{name:/K · Knowledge/}).click();
 const group=page.getByRole('group',{name:'K category judgment',exact:true});
 await group.getByRole('button',{name:'Level',exact:true}).click();await group.getByRole('button',{name:'3+',exact:true}).click();
 await page.getByRole('button',{name:'Finish category',exact:true}).click();
 await page.screenshot({path:`${out}/grades-beside-rubric.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>(window as any).official()),baseline);
 await page.getByRole('button',{name:'Save and next submission',exact:true}).click();
 await page.waitForFunction(async()=>JSON.parse(await (window as any).official()).r.some((r:any)=>r.assessmentCategoryId==='focused-K'&&r.rawScore==='3+'));
 await page.getByTestId('final-grading-workspace').waitFor();
 assert.equal(await originals.isVisible(),true);
 await page.getByRole('button',{name:'Marking queue',exact:true}).click();
 await page.getByTestId(`marking-session-open-${attempts[1].id}`).click();
 await page.getByTestId('final-grading-workspace').waitFor();
 // A second batch exercises the faithful image view with identical pixels and distinct filenames.
 await page.getByRole('button',{name:'Assignment setup',exact:true}).click();
 await page.getByRole('button',{name:/Import already marked rubrics/}).click();
 await page.getByLabel('Upload a picture',{exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 const png=await page.screenshot();
 await page.getByLabel('Choose pictures',{exact:true}).setInputFiles([
   {name:'Fictional-A.png',mimeType:'image/png',buffer:png},
   {name:'Fictional-B.png',mimeType:'image/png',buffer:png}
 ]);
 await page.getByRole('button',{name:'Add work and select students'}).click();
 await page.getByRole('heading',{name:'Who does this work belong to?'}).waitFor();
 await students.nth(0).check();await students.nth(1).check();
 await page.getByRole('button',{name:'Continue to matching'}).click();
 const imageStudentLabels=await names.evaluateAll(inputs=>inputs.map(input=>input.closest('label')!.textContent!.replace(/No work matched yet|\d+ confirmed · available for more pages/g,'').trim()));
 for (const [i,name] of ['Fictional-A.png','Fictional-B.png'].entries()) {
   await page.getByRole('radio',{name,exact:true}).check();await page.getByRole('radio',{name:new RegExp(imageStudentLabels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}).check();
   await page.getByRole('button',{name:'Confirm match',exact:true}).click();
 }
 await page.getByRole('button',{name:'Review matches',exact:true}).click();
 await page.getByRole('button',{name:'Confirm and start marking',exact:true}).click();
 await page.getByTestId('final-grading-workspace').waitFor();
 const visibleImage=originals.getByRole('img');await visibleImage.waitFor();
 assert.equal(await visibleImage.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0),true);
 const layout=await Promise.all([originals.boundingBox(),chips.boundingBox()]);
 assert.ok(layout[0] && layout[1] && layout[0].x+layout[0].width<=layout[1].x,'document and grades are side by side');
 await page.screenshot({path:`${out}/image-beside-grades.png`,fullPage:true});
 // PDF import preserves the original bytes and renders marked pages locally.
 await page.getByRole('button',{name:'Assignment setup',exact:true}).click();
 await page.getByRole('button',{name:/Import already marked rubrics/}).click();
 await page.getByLabel('Upload marked PDFs (class set)',{exact:true}).check();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 const pdfBytes=fictionalMarkedPdf();
 await page.getByLabel('Choose marked PDF files',{exact:true}).setInputFiles([
   {name:'Fictional-A.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBytes)},
   {name:'Fictional-B.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBytes)},
   {name:'Corrupt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 broken %%EOF')}
 ]);
 await page.getByRole('button',{name:'Add work and select students'}).click();
 await page.getByRole('heading',{name:'Who does this work belong to?'}).waitFor({timeout:45000});
 await page.getByLabel('Continue with only the work successfully added; leave these files out.').check();
 await students.nth(0).check();await students.nth(1).check();
 await page.getByRole('button',{name:'Continue to matching'}).click();
 for (const [i,name] of ['Fictional-A.pdf','Fictional-B.pdf'].entries()) {
   await page.getByRole('radio',{name,exact:true}).check();await page.getByRole('radio',{name:new RegExp(imageStudentLabels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}).check();
   await page.getByRole('button',{name:'Confirm match',exact:true}).click();
 }
 await page.getByRole('button',{name:'Review matches',exact:true}).click();
 await page.getByRole('button',{name:'Confirm and start marking',exact:true}).click();
 const viewer=originals.getByRole('region',{name:'Local PDF viewer'});
 await viewer.getByRole('img',{name:/page 1/}).waitFor({timeout:30000});
 await viewer.getByRole('button',{name:'Next PDF page'}).click();
 const pdfImage=viewer.getByRole('img',{name:/page 2/});await pdfImage.waitFor({timeout:30000});
 const pixel=await pdfImage.evaluate(async(img:HTMLImageElement)=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(45,90,1,1).data);});
 assert.deepEqual(pixel,[255,255,0,255],'visible yellow highlighting survives PDF rendering');
 const savedPdfs=await page.evaluate(async()=> (await (window as any).savedAttempts()).filter((a:any)=>a.pdfDocuments?.length));
 assert.equal(savedPdfs.length,2);assert.equal(savedPdfs[0].pdfDocuments[0].base64,Buffer.from(pdfBytes).toString('base64'));
 await chips.getByRole('button',{name:/K · Knowledge/}).click();
 await group.getByRole('button',{name:'Level',exact:true}).click();await group.getByRole('button',{name:'2',exact:true}).click();
 await page.getByRole('button',{name:'Finish category',exact:true}).click();
 await page.screenshot({path:`${out}/pdf-beside-grades.png`,fullPage:true});
 await page.getByRole('button',{name:'Save and next submission',exact:true}).click();
 await page.waitForFunction(async()=>JSON.parse(await (window as any).official()).r.some((r:any)=>r.assessmentCategoryId==='focused-K'&&r.rawScore==='2'));
 const beforeRestore=await page.evaluate(()=>(window as any).official());await page.evaluate(()=>(window as any).roundtrip());
 assert.equal(await page.evaluate(()=>(window as any).official()),beforeRestore);
 const restored=await page.evaluate(async()=> (await (window as any).savedAttempts()).filter((a:any)=>a.pdfDocuments?.length));assert.deepEqual(restored,savedPdfs);

 assert.deepEqual(errors,[]);
 await writeFile(`${out}/results.json`,JSON.stringify({status:'PASS',checks:['category template created without rubric re-entry','two identical files remain separate','unsupported PDF explicit exclusion','manual match correction','review before save','visible text beside grades','draft leaves Markbook unchanged','explicit save transfers exact level','save-next and queue reopen preserve work','identical image batch and decoded original beside grade sidebar','PDF original bytes retained, page navigation, yellow highlight pixels, explicit grade save and real-browser backup restore']},null,2));
 console.log('PASS: external rubric batch, matching correction, visible grading and Markbook transfer');
} finally {await browser.close();await server.close();}
