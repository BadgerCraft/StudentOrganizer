import { createServer } from '/workspace/StudentOrganizer/node_modules/vite/dist/node/index.js';
import { chromium } from '/workspace/StudentOrganizer/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const server=await createServer({root:'/workspace/StudentOrganizer', cacheDir:'/tmp/studentorganizer-review/vite-markbook-cache', plugins:[{name:'review-entry',resolveId(id){if(id==='/qa-review-entry.ts')return id;},load(id){if(id==='/qa-review-entry.ts')return "import React from 'react';import {createRoot} from 'react-dom/client';export {React,createRoot};";}}],server:{host:'127.0.0.1',port:4270,strictPort:true,watch:null,hmr:false}});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(12000); await page.goto('http://127.0.0.1:4270');
 await page.getByPlaceholder('Enter Teacher here').waitFor();
 await page.evaluate(async()=>{
 const {db}=await import('/src/db/database.ts'); const {seedDatabase}=await import('/src/db/seeds.ts');
 // Fresh isolated browser profile only; replace empty initialized calendar with fictional fixture.
 await db.transaction('rw',db.tables,async()=>{for(const t of db.tables)await t.clear();});
 await seedDatabase(db);
 });
 await page.reload();await page.locator('[data-testid^="select-teacher-"]').first().click();

 await page.getByRole('button',{name:'List View (Markbook)',exact:true}).click();
 const ids=await page.evaluate(async()=>{const {db}=await import('/src/db/database.ts');const sa=await db.studentAssessments.where('assessmentId').equals('assess-eng-essay').first();const cr=await db.categoryResults.where('studentAssessmentId').equals(sa.id).first();return {sa:sa.id,cr:cr.id,enrollment:sa.classEnrollmentId,category:cr.assessmentCategoryId,raw:cr.rawScore};});
 await page.getByTestId(`markbook-cell-${ids.enrollment}-${ids.category}`).click();
 const input=page.getByRole('textbox',{name:'Existing result',exact:true});await input.waitFor();
 const openedValue=await input.inputValue();await input.fill('3+');
 await page.evaluate(async ids=>{const {db}=await import('/src/db/database.ts');const {MarkbookDomainService}=await import('/src/services/markbookService.ts');const {getAppIdentity}=await import('/src/services/identityService.ts');const actor=await getAppIdentity(db);const sa=await db.studentAssessments.get(ids.sa);const cr=await db.categoryResults.get(ids.cr);await new MarkbookDomainService(db).saveMarkbookCell({assessmentId:sa.assessmentId,classSectionId:sa.classSectionId,classEnrollmentId:sa.classEnrollmentId,assessmentCategoryId:cr.assessmentCategoryId,rawScore:'90',inputFormat:'percentage',feedback:'NEWER WRITE',expectedStudentAssessmentVersion:sa.version,expectedCategoryResultVersion:cr.version,...actor});},ids);
 await page.waitForTimeout(500);
 const before=await page.evaluate(async id=>{const {db}=await import('/src/db/database.ts');return db.categoryResults.get(id);},ids.cr);
 assert.equal(before.normalizedPercentage,90);assert.equal(await input.inputValue(),'3+');
 await page.getByRole('button',{name:'Save Result',exact:true}).click();await input.waitFor({state:'hidden'});
 const after=await page.evaluate(async id=>{const {db}=await import('/src/db/database.ts');return db.categoryResults.get(id);},ids.cr);
 console.log('STALE_EDITOR_OVERWRITE',JSON.stringify({openedValue,newerWrite:{raw:before.rawScore,feedback:before.feedback,version:before.version},staleSave:{raw:after.rawScore,feedback:after.feedback,version:after.version}}));assert.equal(after.rawScore,'3+');assert.notEqual(after.feedback,'NEWER WRITE');
}finally{await browser.close();await server.close();}
