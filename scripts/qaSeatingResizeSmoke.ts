import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real seating controls, isolated fictional IndexedDB, and preserved screenshot evidence.
const evidenceDir = process.env.QA_SEATING_EVIDENCE_DIR || join(tmpdir(), 'studentorganizer-qa06');
await mkdir(evidenceDir, { recursive: true });
const cacheDir = await mkdtemp(join(tmpdir(), 'qa-classroom-cache-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'qa-classroom-entry',
  resolveId(id) { if (id === '/qa-classroom-entry.ts') return id; },
  async load(id) {
    if (process.env.QA_SEATING_SERVICE_SOURCE && id.endsWith('/src/services/classroomStructureService.ts'))
      return readFile(process.env.QA_SEATING_SERVICE_SOURCE, 'utf8');
    if (id === '/qa-classroom-entry.ts') return "import React from 'react';import {createRoot} from 'react-dom/client';export {React,createRoot};"; },
  configureServer(instance) { instance.middlewares.use('/__qa-classroom', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end(await instance.transformIndexHtml('/__qa-classroom', '<!doctype html><html><body><div id="root"></div></body></html>'));
  }); }
}] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/__qa-classroom`);
  await page.evaluate(`(async () => {
    const {db}=await import('/src/db/database.ts'); await (await import('/src/db/seeds.ts')).seedDatabase(db);
    await import('/src/index.css');
    const identity=await (await import('/src/services/identityService.ts')).selectActingTeacher(db,'user-tyler');
    const {React,createRoot}=await import('/qa-classroom-entry.ts'); const root=createRoot(document.getElementById('root'));
    const section=await db.classSections.toCollection().first(); const layout=await db.seatingLayouts.where('classSectionId').equals(section.id).first();
    window.qa={db,identity,section,layout,root};
    window.qa.snapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()])));
    window.qa.renderDashboard=async()=>root.render(React.createElement((await import('/src/components/DashboardView.tsx')).DashboardView,{classes:[{section:await db.classSections.get(section.id),course:await db.courses.get(section.courseId),enrollments:[],term:await db.terms.get(section.termId)}],...identity,onOpenClass:()=>{},onRefresh:()=>{}}));
    window.qa.renderSeating=async()=>root.render(React.createElement((await import('/src/components/SeatingChartView.tsx')).SeatingChartView,{layout:await db.seatingLayouts.get(layout.id),seatPositions:await db.seatPositions.toArray(),enrollments:await db.classEnrollments.where('classSectionId').equals(section.id).toArray(),students:await db.students.toArray(),attendanceRecords:[],dailySummaries:[],selectedEnrollmentIds:[],selectedSchoolDate:'2026-10-24',...identity,onSelectDate:()=>{},onToggleSelectStudent:()=>{},onOpenStudentProfile:()=>{},onRefresh:()=>window.qa.renderSeating()}));
    await db.seatingLayouts.update(layout.id,{rows:3,cols:3,isLocked:false});
    await db.seatPositions.clear();
    const enrollment=await db.classEnrollments.where('classSectionId').equals(section.id).first();
    await db.students.update(enrollment.studentId,{firstName:'EdgeFictional',lastName:'Review',preferredName:null});
    const {SeatingDomainService}=await import('/src/services/seatingService.ts');
    await new SeatingDomainService(db).assignSeat(layout.id,2,2,enrollment.id,identity.userId,identity.deviceId);
    window.qa.enrollment=enrollment;
    await window.qa.renderSeating();
  })()`);
  const snapshot = () => page.evaluate<string>('window.qa.snapshot()');
  await page.getByTestId('student-seat-name').filter({hasText:'EdgeFictional'}).waitFor();
  await page.getByRole('button', { name: 'Attendance & seating tools', exact: true }).click();
  const initial = await snapshot();
  for (const title of ['Remove Row', 'Remove Column']) {
    await page.getByTitle(title, {exact:true}).click();
    if (process.env.QA_SEATING_SERVICE_SOURCE) {
      await page.waitForFunction(async () => (await (window as any).qa.db.seatingLayouts.get((window as any).qa.layout.id)).rows === 2);
      await page.waitForFunction(() => !document.body.innerText.includes('EdgeFictional Review') || document.body.innerText.includes('Some saved seats are outside'));
      await page.screenshot({path:join(evidenceDir,'before-shrink.png'),fullPage:true});
    }
    await page.getByRole('alert').filter({hasText:'Move students out'}).waitFor({timeout:5000});
    assert.equal(await snapshot(), initial);
    await page.getByTestId('student-seat-name').filter({hasText:'EdgeFictional'}).waitFor();
  }
  await page.screenshot({path:join(evidenceDir,'occupied-edge-rejected.png'),fullPage:true});
  // Move using real rendered controls, then remove both now-empty edges.
  await page.getByTestId('tap-move-seats-btn').click();
  await page.getByTestId('student-seat-card').click();
  await page.getByRole('button',{name:'Empty seat row 2 column 2',exact:true}).click();
  await page.waitForFunction(async () => {
    const q=(window as any).qa, seat=await q.db.seatPositions.where('classEnrollmentId').equals(q.enrollment.id).first();
    return seat.row===1 && seat.col===1;
  });
  await page.getByTestId('tap-move-seats-btn').click();
  await page.getByTitle('Remove Row',{exact:true}).click();
  await page.getByText('Grid (2 × 3)',{exact:true}).waitFor();
  await page.getByTitle('Remove Column',{exact:true}).click();
  await page.getByText('Grid (2 × 2)',{exact:true}).waitFor();
  await page.getByTestId('student-seat-name').filter({hasText:'EdgeFictional'}).waitFor();
  const afterMove=await page.evaluate<any>(`(async()=>{
    const q=window.qa; return {layout:await q.db.seatingLayouts.get(q.layout.id),
      seats:await q.db.seatPositions.toArray(),audit:await q.db.auditEntries.where('entityId').equals(q.layout.id).toArray(),
      outbox:await q.db.syncMutations.where('entityId').equals(q.layout.id).toArray()};
  })()`);
  assert.equal(afterMove.layout.version,3); assert.equal(afterMove.seats.length,1);
  assert.equal(afterMove.audit.length,2); assert.equal(afterMove.outbox.length,2);
  const initialTables=Object.fromEntries(JSON.parse(initial));
  assert.equal(afterMove.seats[0].id,initialTables.seatPositions[0].id);
  assert.equal(afterMove.seats[0].classEnrollmentId,initialTables.seatPositions[0].classEnrollmentId);
  await page.screenshot({path:join(evidenceDir,'moved-then-shrunk.png'),fullPage:true});
  // Fictional legacy snapshot: assignment outside a previously shrunken grid.
  await page.evaluate(`(async()=>{
    const q=window.qa; await q.db.seatPositions.update((await q.db.seatPositions.toCollection().first()).id,{row:2,col:2});
    await q.renderSeating();
  })()`);
  await page.getByRole('alert').filter({hasText:'Some saved seats are outside'}).waitFor();
  assert.match(await page.getByRole('alert').filter({hasText:'Some saved seats are outside'}).innerText(),/EdgeFictional Review — row 3, column 3/);
  const hidden=await snapshot();
  await page.screenshot({path:join(evidenceDir,'legacy-seat-recovery.png'),fullPage:true});
  assert.equal(await snapshot(),hidden);
  await page.getByTitle('Add Row',{exact:true}).click();
  await page.getByText('Grid (3 × 2)',{exact:true}).waitFor();
  await page.getByTitle('Add Column',{exact:true}).click();
  await page.getByText('Grid (3 × 3)',{exact:true}).waitFor();
  await page.getByTestId('student-seat-name').filter({hasText:'EdgeFictional'}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:'Some saved seats are outside'}).count(),0);
  assert.deepEqual(await page.evaluate('window.qa.db.seatPositions.toArray()'),Object.fromEntries(JSON.parse(hidden)).seatPositions);
  await page.evaluate('window.qa.db.classSectionStaff.toCollection().modify({role:"read_only"})');
  const denied=await snapshot();
  await page.getByTitle('Remove Row',{exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Read-only'}).waitFor();
  assert.equal(await snapshot(),denied);
  // Legacy malformed/inactive rows must not promise that growth can reveal them.
  await page.evaluate(`(async()=>{
    const q=window.qa;
    await q.db.classEnrollments.update(q.enrollment.id,{enrollmentStatus:'withdrawn'});
    await q.db.seatPositions.update((await q.db.seatPositions.toCollection().first()).id,{row:3});
    await q.renderSeating();
  })()`);
  await page.getByRole('alert').filter({hasText:'Student is not active or available'}).waitFor();
  await page.evaluate(`(async()=>{
    const q=window.qa;
    await q.db.seatPositions.update((await q.db.seatPositions.toCollection().first()).id,{row:-1});
    await q.renderSeating();
  })()`);
  await page.getByRole('alert').filter({hasText:'Invalid saved position; expanding the grid will not restore'}).waitFor();
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  console.log('PASS: occupied row/column reject without writes; real tap move then both shrinks preserve seat identity with exact layout audit/outbox; legacy hidden seat named/revealed by expansion without relocation; read-only denial; zero browser errors/external requests. Screenshots: '+evidenceDir);
} finally { await browser.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
