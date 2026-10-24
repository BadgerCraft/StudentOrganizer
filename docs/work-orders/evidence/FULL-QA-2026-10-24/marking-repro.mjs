import { createServer } from '/workspace/StudentOrganizer/node_modules/vite/dist/node/index.js';
import { chromium } from '/workspace/StudentOrganizer/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const server=await createServer({root:'/workspace/StudentOrganizer', cacheDir:'/tmp/studentorganizer-review/vite-marking-cache', plugins:[{name:'review-entry',resolveId(id){if(id==='/qa-review-entry.ts')return id;},load(id){if(id==='/qa-review-entry.ts')return "import React from 'react';import {createRoot} from 'react-dom/client';export {React,createRoot};";}}],server:{host:'127.0.0.1',port:4269,strictPort:true,watch:null,hmr:false}});
await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
try {
 const page=await browser.newPage();page.setDefaultTimeout(12000); await page.goto('http://127.0.0.1:4269');
 await page.getByPlaceholder('Enter Teacher here').waitFor();
 await page.evaluate(async()=>{
 const {db}=await import('/src/db/database.ts'); const {seedDatabase}=await import('/src/db/seeds.ts');
 // Fresh isolated browser profile only; replace empty initialized calendar with fictional fixture.
 await db.transaction('rw',db.tables,async()=>{for(const t of db.tables)await t.clear();});
 await seedDatabase(db);
 });
 await page.reload();await page.locator('[data-testid^="select-teacher-"]').first().click();
 await page.evaluate(async()=>{
 const {React,createRoot}=await import('/qa-review-entry.ts');
 const {StudentProfileModal}=await import('/src/components/StudentProfileModal.tsx'); const {db}=await import('/src/db/database.ts');const {getAppIdentity}=await import('/src/services/identityService.ts');
 const identity=await getAppIdentity(db);const enrollment=await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first();
 const student=await db.students.get(enrollment.studentId); const policy=await db.gradingPolicies.where('classSectionId').equals(enrollment.classSectionId).first();
 const props={enrollmentId:enrollment.id,enrollment,student,policy,...identity,onClose:()=>{},onRefresh:()=>{}};
 for(const k of ['assessments','categories','studentAssessments','categoryResults','participationEvents','overrides','notes','auditEntries'])props[k]=[];
 const mount=document.createElement('div');document.body.appendChild(mount);createRoot(mount).render(React.createElement(StudentProfileModal,props));
 });
 const modal=page.getByTestId('student-profile-modal');
 console.log('dialogs',await page.locator('[role="dialog"]').count());
 await page.getByTestId('profile-tab-assessments').click();
 await page.getByTestId('profile-add-assignment-btn').click();
 await page.getByTestId('custom-assessment-title-input').fill('Fictional partial write review');
 await page.getByTestId('custom-assessment-score-input').fill('4+');
 await page.getByTestId('save-custom-assessment-btn').click();
 await page.getByText('Invalid percentage format',{exact:false}).waitFor();
 async function result(){return page.evaluate(async()=>{const {db}=await import('/src/db/database.ts');const a=await db.assessments.filter(x=>x.title==='Fictional partial write review').toArray();const sa=await db.studentAssessments.where('assessmentId').anyOf(a.map(x=>x.id)).toArray();return {assessmentCount:a.length,assignmentCount:sa.length,resultCount:await db.categoryResults.where('studentAssessmentId').anyOf(sa.map(x=>x.id)).count(),periods:a.map(x=>x.reportingPeriodId)};});}
 console.log('INVALID_SCORE_PARTIAL',await result());assert.equal((await result()).assessmentCount,1);assert.equal((await result()).resultCount,0);
 await page.getByTestId('custom-assessment-score-input').fill('88%');await page.getByTestId('save-custom-assessment-btn').click();
 await page.getByTestId('custom-assessment-title-input').waitFor({state:'hidden'});console.log('RETRY_DUPLICATE',await result());assert.equal((await result()).assessmentCount,2);
 // Simulate the valid calendar identifier produced by clean production initialization, without changing profile policy (DEFAULT/null).
 await page.evaluate(async()=>{const {db}=await import('/src/db/database.ts');const rp=await db.reportingPeriods.get('rp-midterm');await db.reportingPeriods.delete('rp-midterm');await db.reportingPeriods.add({...rp,id:'local-reporting-period'});});
 await page.getByTestId('profile-add-assignment-btn').click();await page.getByTestId('custom-assessment-title-input').fill('Fictional clean calendar');await page.getByTestId('custom-assessment-score-input').fill('88%');await page.getByTestId('save-custom-assessment-btn').click();
 await page.getByText('Assessment references non-existent or deleted reporting period.',{exact:false}).waitFor();
 console.log('CLEAN_CALENDAR_BROKEN',await page.evaluate(async()=>{const {db}=await import('/src/db/database.ts');const a=await db.assessments.filter(x=>x.title==='Fictional clean calendar').first();return {assessment:a.id,period:a.reportingPeriodId,periodExists:!!await db.reportingPeriods.get(a.reportingPeriodId)};}));
}finally{await browser.close();await server.close();}
