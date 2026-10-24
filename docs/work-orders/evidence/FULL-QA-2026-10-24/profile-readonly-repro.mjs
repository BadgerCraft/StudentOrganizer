import { createServer } from '/workspace/StudentOrganizer/node_modules/vite/dist/node/index.js';
import { chromium } from '/workspace/StudentOrganizer/node_modules/playwright/index.mjs';
const server=await createServer({root:'/workspace/StudentOrganizer',cacheDir:'/tmp/studentorganizer-review/vite-persistence-cache',plugins:[{name:'review-entry',resolveId(id){if(id==='/qa-review-entry.ts')return id;},load(id){if(id==='/qa-review-entry.ts')return "import React from 'react';import {createRoot} from 'react-dom/client';export {React,createRoot};";}}],server:{host:'127.0.0.1',port:4318,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});
try{
 const page=await browser.newPage(); page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto('http://127.0.0.1:4318');
 await page.waitForTimeout(1000);
 await page.evaluate(async()=>{
 const {db}=await import('/src/db/database.ts'); await db.transaction('rw',db.tables,async()=>{for(const t of db.tables)await t.clear()});
 await (await import('/src/db/seeds.ts')).seedDatabase(db);
 const identity=await (await import('/src/services/identityService.ts')).selectActingTeacher(db,'user-tyler');
 await db.classSectionStaff.toCollection().modify({role:'read_only'});
 const enrollment=await db.classEnrollments.toCollection().first();
 const props={enrollmentId:enrollment.id,enrollment,student:await db.students.get(enrollment.studentId),assessments:await db.assessments.toArray(),categories:await db.assessmentCategories.toArray(),studentAssessments:await db.studentAssessments.toArray(),categoryResults:await db.categoryResults.toArray(),participationEvents:[],policy:await db.gradingPolicies.where('classSectionId').equals(enrollment.classSectionId).first(),overrides:[],notes:[],auditEntries:[],userId:identity.userId,deviceId:identity.deviceId,onClose:()=>{},onRefresh:()=>{}};
 const {React,createRoot}=await import('/qa-review-entry.ts');
 document.getElementById('root').remove(); const el=document.createElement('div');document.body.append(el);
 createRoot(el).render(React.createElement((await import('/src/components/StudentProfileModal.tsx')).StudentProfileModal,props));
 });
 await page.getByTestId('profile-tab-assessments').click();
 await page.getByRole('button',{name:'Add Individual Assignment'}).click();
 await page.getByTestId('custom-assessment-title-input').fill('Fictional read-only injected assessment');
 await page.getByTestId('custom-assessment-score-input').fill('87');
 await page.getByTestId('save-custom-assessment-btn').click(); await page.waitForTimeout(500);
 console.log('CUSTOM_READONLY',await page.evaluate(async()=>{const {db}=await import('/src/db/database.ts');const a=await db.assessments.filter(a=>a.title==='Fictional read-only injected assessment').first();return {assessment:a,studentAssessments:a?await db.studentAssessments.where('assessmentId').equals(a.id).count():0,audit:a?await db.auditEntries.where('entityId').equals(a.id).count():0,error:document.body.innerText.includes('Read-only staff')}}));
}finally{await browser.close();await server.close()}
