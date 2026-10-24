import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real components and IndexedDB with fictional records; no teacher profile is opened.
const cacheDir = await mkdtemp(join(tmpdir(), 'qa-classroom-cache-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'qa-classroom-entry',
  resolveId(id) { if (id === '/qa-classroom-entry.ts') return id; },
  load(id) { if (id === '/qa-classroom-entry.ts') return "import React from 'react';import {createRoot} from 'react-dom/client';export {React,createRoot};"; },
  configureServer(instance) { instance.middlewares.use('/__qa-classroom', async (_req, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end(await instance.transformIndexHtml('/__qa-classroom', '<!doctype html><html><body><div id="root"></div></body></html>'));
  }); }
}] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [], alerts: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { if (dialog.type() === 'alert') alerts.push(dialog.message()); await dialog.accept(); });
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/__qa-classroom`);
  await page.evaluate(`(async () => {
    const {db}=await import('/src/db/database.ts'); await (await import('/src/db/seeds.ts')).seedDatabase(db);
    const identity=await (await import('/src/services/identityService.ts')).selectActingTeacher(db,'user-tyler');
    const {React,createRoot}=await import('/qa-classroom-entry.ts'); const root=createRoot(document.getElementById('root'));
    const section=await db.classSections.toCollection().first(); const layout=await db.seatingLayouts.where('classSectionId').equals(section.id).first();
    window.qa={db,identity,section,layout,root};
    window.qa.snapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()])));
    window.qa.renderDashboard=async()=>root.render(React.createElement((await import('/src/components/DashboardView.tsx')).DashboardView,{classes:[{section:await db.classSections.get(section.id),course:await db.courses.get(section.courseId),enrollments:[],term:await db.terms.get(section.termId)}],...identity,onOpenClass:()=>{},onRefresh:()=>{}}));
    window.qa.renderSeating=async()=>root.render(React.createElement((await import('/src/components/SeatingChartView.tsx')).SeatingChartView,{layout:await db.seatingLayouts.get(layout.id),seatPositions:await db.seatPositions.toArray(),enrollments:await db.classEnrollments.where('classSectionId').equals(section.id).toArray(),students:await db.students.toArray(),attendanceRecords:[],dailySummaries:[],selectedEnrollmentIds:[],selectedSchoolDate:'2026-10-24',...identity,onSelectDate:()=>{},onToggleSelectStudent:()=>{},onOpenStudentProfile:()=>{},onRefresh:()=>window.qa.renderSeating()}));
    await db.classSectionStaff.toCollection().modify({role:'read_only'}); await window.qa.renderDashboard();
  })()`);
  const snapshot = () => page.evaluate<string>('window.qa.snapshot()');
  const denied = await snapshot();
  const deniedAlert = page.waitForEvent('dialog', dialog => dialog.type() === 'alert');
  await page.getByTitle('Archive Class', { exact: true }).click();
  await deniedAlert;
  assert.ok(alerts.some(message => message.includes('Read-only')));
  assert.equal(await snapshot(), denied);
  await page.evaluate('window.qa.renderSeating()');
  for (const title of ['Add Row', 'Remove Row', 'Add Column', 'Remove Column', 'Toggle Card Size']) {
    await page.getByTitle(title, { exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Read-only' }).waitFor();
    assert.equal(await snapshot(), denied);
  }
  await page.getByRole('button', { name: /Unlocked|Locked/ }).click();
  await page.getByRole('alert').filter({ hasText: 'Read-only' }).waitFor(); assert.equal(await snapshot(), denied);
  // Stale visible UI after role revocation is the regression, not hiding the buttons.
  await page.evaluate('window.qa.db.classSectionStaff.toCollection().modify({role:"primary_teacher"})');
  const previous = await page.evaluate<{rows:number;version:number}>('window.qa.db.seatingLayouts.get(window.qa.layout.id)');
  await page.getByTitle('Add Row', { exact: true }).click();
  await page.waitForFunction(async old => {
    const qa = (window as any).qa; return (await qa.db.seatingLayouts.get(qa.layout.id)).version === old + 1;
  }, previous.version);
  assert.equal(await page.evaluate('window.qa.db.seatingLayouts.get(window.qa.layout.id).then(x=>x.rows)'), previous.rows + 1);
  await page.evaluate('window.qa.renderDashboard()');
  await page.getByTitle('Archive Class', { exact: true }).click();
  await page.waitForFunction(async () => { const qa = (window as any).qa; return (await qa.db.classSections.get(qa.section.id)).deletedAt !== null; });
  assert.equal(await page.evaluate('window.qa.db.auditEntries.where("entityId").equals(window.qa.section.id).count()'), 1);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: real Dashboard archive and six SeatingChart controls deny read-only writes, retain all tables and show errors; authorized layout/archive writes version and audit; zero page errors/external requests.');
} finally { await browser.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
