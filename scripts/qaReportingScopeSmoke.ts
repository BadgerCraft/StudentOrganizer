import { createServer } from 'vite';
import { chromium, type Locator } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real profile/markbook and production domain services; all records fictional and local.
const root = fileURLToPath(new URL('..', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'qa-reporting-scope-'));
const entry = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { StudentProfileModal } from '/src/components/StudentProfileModal.tsx';
import { MarkbookView } from '/src/components/MarkbookView.tsx';
import { db } from '/src/db/database.ts';
import { initializeDatabase } from '/src/db/seeds.ts';
import { createTeacherProfile } from '/src/services/teacherProfileService.ts';
import { selectActingTeacher, getIdentityEpoch } from '/src/services/identityService.ts';
import { ClassDomainService } from '/src/services/classService.ts';
import { PortabilityService, parseCSV } from '/src/services/portabilityService.ts';
import { ProfileAssessmentService } from '/src/services/profileAssessmentService.ts';
await initializeDatabase(db);
const teacher=await createTeacherProfile(db,{name:'Fictional Scope Teacher'});
const actor=await selectActingTeacher(db,teacher.id);
const section=await new ClassDomainService(db).createClassSection({...actor,courseCode:'SCOPE1',courseTitle:'Fictional Scope Course',sectionNumber:'1',period:'1',roomNumber:'1',colorToken:'#ffffff'});
const portability=new PortabilityService(db);
const rows=await portability.validateRosterCandidates(section.id,[{rowNumber:1,rawText:'Scope Fictional 001',firstName:'Scope',lastName:'Fictional',studentNumber:'001',error:null,warning:null}]);
await portability.importRosterBatch({...actor,classSectionId:section.id,rows});
const enrollment=await db.classEnrollments.where('classSectionId').equals(section.id).first();
const student=await db.students.get(enrollment.studentId);
let policy=await db.gradingPolicies.where('classSectionId').equals(section.id).first();
await db.gradingPolicies.update(policy.id,{weightK:25,weightT:75,weightC:0,weightA:0,decimalPrecision:1});
policy=await db.gradingPolicies.get(policy.id);
const first=await db.reportingPeriods.get('local-reporting-period');
await db.reportingPeriods.add({...first,id:'fictional-period-two',name:'Fictional period two',sequenceNumber:2});
const service=new ProfileAssessmentService(db);
const periods=[first.id,'fictional-period-two'];
for(const [index,period] of periods.entries()) {
 for(const [categoryCode,score] of [['K',index?80:40],['T',index?100:80]])
  await service.createIndividual({...actor,identityEpoch:getIdentityEpoch(),operationId:'scope-'+index+'-'+categoryCode,enrollmentId:enrollment.id,classSectionId:section.id,policyId:policy.id,reportingPeriodId:period,title:'Fictional '+index+' '+categoryCode,assessmentType:'summative',categoryCode,rawPercentage:String(score),feedback:''});
 for(const [categoryCode,overridePercentage] of [['OVERALL',index?94:61],['K',index?90:20]])
  await service.saveOverride({...actor,identityEpoch:getIdentityEpoch(),enrollmentId:enrollment.id,classSectionId:section.id,policyId:policy.id,reportingPeriodId:period,categoryCode,overridePercentage,rationale:'Fictional period '+(index+1)+' '+categoryCode+' judgment',expected:null});
}
const reactRoot=createRoot(document.getElementById('root'));
let revision=0;
window.qaReporting={
 async csv(period){return parseCSV(await portability.exportClassMarkbookCSV(section.id,period));},
 async snapshot(){return JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));},
 async render(view,period,reverse){
  const shared={policy,...actor,enrollments:[enrollment],students:[student],classSectionId:section.id,onOpenStudentProfile(){},onRefresh(){}};
  for(const [prop,table] of Object.entries({assessments:'assessments',categories:'assessmentCategories',studentAssessments:'studentAssessments',categoryResults:'categoryResults',overrides:'gradeOverrides'}))shared[prop]=await db.table(table).toArray();
  if(reverse) shared.overrides.reverse();
  const key=String(++revision);
  // A keyed wrapper makes each order/scope a new committed render, not a stale previous screen.
  const child=view==='profile'?React.createElement(StudentProfileModal,{...shared,enrollmentId:enrollment.id,enrollment,student,participationEvents:[],notes:[],auditEntries:[],onClose(){}}):React.createElement(MarkbookView,{...shared,reportingPeriodId:period});
  reactRoot.render(React.createElement('div',{key,'data-testid':'reporting-fixture','data-revision':key},child));
  return key;
 }
};
`;
const engineSource = process.env.QA_REPORTING_ENGINE_SOURCE ? await readFile(process.env.QA_REPORTING_ENGINE_SOURCE, 'utf8') : null;
const server = await createServer({ root, cacheDir: cache, plugins: [{ name: 'qa-reporting-scope',
  enforce: 'pre',
  resolveId(id) { if (id === '/qa-reporting-entry.ts') return id; },
  load(id) {
    if (id === '/qa-reporting-entry.ts') return entry;
    // Optional local old-source injection proves the regression without modifying production files.
    if (engineSource !== null && id.replaceAll('\\', '/').endsWith('/src/services/calculationEngine.ts')) return engineSource;
  },
  configureServer(vite) { vite.middlewares.use((req,res,next) => {
    if (req.url !== '/qa-reporting.html') return next();
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/qa-reporting-entry.ts"></script></body></html>');
  }); }
}],server:{host:'127.0.0.1',port:0,watch:null,hmr:false} });
await server.listen();const address=server.httpServer!.address();assert.ok(address&&typeof address!=='string');
const origin=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors:string[]=[],external:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>void dialog.accept());
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(`${origin}/qa-reporting.html`);await page.waitForFunction(()=>!!(window as any).qaReporting);
  const snapshot=()=>page.evaluate<string>('window.qaReporting.snapshot()');
  const before=await snapshot();
  async function render(view:'profile'|'markbook',period:string|null,reverse:boolean){
    const revision=await page.evaluate(({view,period,reverse})=>(window as any).qaReporting.render(view,period,reverse),{view,period,reverse});
    await page.locator(`[data-testid="reporting-fixture"][data-revision="${revision}"]`).waitFor();
  }
  async function cellText(cell:Locator,expected:string){assert.equal((await cell.innerText()).trim(),expected);}
  for(const reverse of [false,true]) {
    await render('profile',null,reverse);
    const overall=page.getByText('Overall Mark',{exact:true}).locator('..');
    assert.match(await overall.innerText(),/82\.5%/,'aggregate profile must use weighted evidence across both periods');
    assert.equal(await overall.getByText('Overridden',{exact:true}).count(),0);
    for(const [label,expected] of [['Knowledge','60.0%'],['Thinking','90.0%']]) {
      const card=page.getByText(label,{exact:true}).locator('../..');assert.ok((await card.innerText()).includes(expected),label+' aggregate excludes period overrides');
    }
    await page.getByTestId('open-grade-override-btn').click();
    for(const [period,number,overallValue,kValue] of [['local-reporting-period',1,61,20],['fictional-period-two',2,94,90]] as const) {
      await page.getByTestId('override-period-select').selectOption(period);
      for(const [scope,value] of [['OVERALL',overallValue],['K',kValue]] as const) {
        await page.getByTestId('override-category-select').selectOption(scope);
        assert.equal(await page.getByTestId('override-percentage-input').inputValue(),String(value));
        assert.equal(await page.getByTestId('override-rationale-input').inputValue(),`Fictional period ${number} ${scope} judgment`);
      }
    }
    await page.getByTestId('cancel-override-btn').click();
    await page.getByTestId('override-modal').waitFor({state:'hidden'});
    for(const [period,total,k,t,rationale] of [
      [null,'82.5%','60.0%','90.0%',null],
      ['local-reporting-period','61%','20.0%','80.0%','Fictional period 1 OVERALL judgment'],
      ['fictional-period-two','94%','90.0%','100.0%','Fictional period 2 OVERALL judgment']
    ] as const) {
      await render('markbook',period,reverse);
      await page.getByRole('button',{name:'Show percentage details',exact:true}).click();
      await page.getByRole('button',{name:'Hide percentage details',exact:true}).waitFor();
      const row=page.locator('tbody tr').filter({hasText:'Fictional'});await row.waitFor();
      const cells=row.locator('td');
      // Leading identity cell, then overall and independent KTCA columns.
      const overallCell=cells.nth(1);
      assert.equal(await overallCell.getByText(total,{exact:true}).count(),1,`overall ${period} reversed=${reverse}`);
      await cellText(cells.nth(2),k);await cellText(cells.nth(3),t);
      const marker=overallCell.locator('[title]');
      if(rationale)assert.equal(await marker.getAttribute('title'),rationale);
      else assert.equal(await marker.count(),0,'aggregate cannot borrow either period rationale');
    }
  }
  for(const [period,calculated,final] of [[null,'82.5','82.5'],['local-reporting-period','65','61'],['fictional-period-two','97.5','94']] as const) {
    const csv=await page.evaluate<string[][],string|null>(period=>(window as any).qaReporting.csv(period),period);
    assert.equal(csv.length,2);
    assert.equal(csv[1][csv[0].indexOf('Overall Calculated %')],calculated);
    assert.equal(csv[1][csv[0].indexOf('Overall Final %')],final);
  }
  assert.equal(await snapshot(),before,'display and reversed order must preserve all stored records');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: real profile aggregate and Markbook aggregate/two explicit periods retain weighted evidence, exact61/94 period overall overrides and distinct category overrides/rationales in both input orders; CSV calculated/final columns agree; all records unchanged; zero page errors/external traffic.');
} finally {await browser.close();await server.close();await rm(cache,{recursive:true,force:true});}
