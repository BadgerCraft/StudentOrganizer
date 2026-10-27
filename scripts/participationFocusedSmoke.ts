import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Component interaction regression: fictional props only, blocked network.
const harness = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import '/src/index.css';import{ParticipationDock}from'/src/components/ParticipationDock.tsx';
import{getSchoolLocalDate,shiftSchoolDate}from'/src/utils/dateUtils.ts';
const e=React.createElement, today=getSchoolLocalDate();
const person={enrollment:{id:'student-one'},student:{firstName:'Fictional',lastName:'Learner'}};
const type={id:'thoughtful',name:'Thoughtful contribution',classification:'positive',recordingMode:'quick_tally',defaultPoints:1,defaultCategoryCode:null,sortOrder:1,isArchived:false};
const record=(id,extra={})=>({id,classEnrollmentId:'student-one',localSchoolDate:today,occurredAt:new Date().toISOString(),deletedAt:null,snapshottedName:'Thoughtful contribution',version:1,...extra});
function App(){const[open,setOpen]=useState(true),[events,setEvents]=useState([record('first'),record('repeat'),record('yesterday',{localSchoolDate:shiftSchoolDate(today,-1)})]);
const[fail,setFail]=useState(false),[count,setCount]=useState(0);
return e('main',null,e('button',{id:'open',onClick:()=>setOpen(true)},'Open learner'),e('button',{id:'fail',onClick:()=>setFail(!fail)},'Toggle failure'),e('output',{id:'count'},count),e('output',{id:'events'},JSON.stringify(events)),
e(ParticipationDock,{selectedEnrollments:open?[person]:[],eventTypes:[type],selectedSchoolDate:today,todayEvents:events,onRetractEvent:async event=>{setEvents(rows=>rows.map(row=>row.id===event.id?{...row,deletedAt:new Date().toISOString()}:row))},onRecordEvent:async()=>{setCount(n=>n+1);await new Promise(r=>setTimeout(r,150));if(fail)throw Error('Fictional write failed');setOpen(false);return true},onClearSelection:()=>setOpen(false),lastBatchUndo:null,onUndo:()=>{}}));}
createRoot(document.getElementById('root')).render(e(App));</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{ name: 'participation-fixture', configureServer(instance) {
  instance.middlewares.use('/__participation', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__participation', harness)); });
} }] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.goto(`${origin}/__participation`);
  const chips = page.getByTestId('today-feedback-chip'); await chips.first().waitFor(); assert.equal(await chips.count(), 2);
  await chips.first().click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="today-feedback-chip"]').length === 1);
  const events = JSON.parse(await page.locator('#events').innerText());
  assert.ok(events[0].deletedAt); assert.equal(events[1].deletedAt, null); assert.equal(events[2].deletedAt, null);
  await page.locator('#fail').click(); await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Retain this fictional draft');
  await page.getByTestId('participation-event-btn').evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await page.getByRole('alert').waitFor(); assert.equal(await page.locator('#count').innerText(), '1');
  assert.equal(await page.getByTestId('observation-note-input').inputValue(), 'Retain this fictional draft');
  await page.locator('#fail').click(); await page.getByTestId('participation-event-btn').click();
  await page.getByTestId('participation-event-btn').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#count').innerText(), '2');
  await page.locator('#open').click(); await chips.first().waitFor();
  await mkdir('/tmp/student-organizer-ui-evidence', { recursive: true });
  await page.screenshot({ path: '/tmp/student-organizer-ui-evidence/participation-chooser.png', fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: today-only occurrence chips; exact correction preserves repeat and history; repeated clicks save once; failed write retains note; successful save dismisses; no browser errors or external requests.');
} finally { await browser.close(); await server.close(); }
