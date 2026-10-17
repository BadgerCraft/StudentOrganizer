import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Actual components, disposable fictional props, and browser interactions.
// This isolates modal propagation and focused editors from database setup.
const harness = `<!doctype html><html><head><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/index.css';
import {StudentProfileModal} from '/src/components/StudentProfileModal.tsx';
import {RubricEvidenceEditor} from '/src/marking/ui/ModeEvidence.tsx';
import {ImageMarkup} from '/src/marking/ui/ImageMarkup.tsx';
const e = React.createElement;
const rubric = {id:'rubric',title:'Fictional reasoning',levels:['Legacy secure'],criteria:[
{id:'reason',name:'Reasoning',categoryCode:'T',descriptors:{'Legacy secure':'Supports each claim'}},
{id:'voice',name:'Voice',categoryCode:'C',descriptors:{'Legacy secure':'Clear expression'}}]};
const canvas=document.createElement('canvas'); canvas.width=600;canvas.height=800;
const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,600,800);
const original=canvas.toDataURL('image/png').split(',')[1];
const pages=[{id:'page',name:'Fictional page.png',mime:'image/png',width:600,height:800,base64:original,hash:'fixture'}];
function Harness(){
const [open,setOpen]=useState(false),[background,setBackground]=useState(0);
const [feedback,setFeedback]=useState([{criterionId:'reason',level:'',feedback:'First recorded feedback'},{criterionId:'voice',level:'',feedback:'Unrelated recorded feedback'}]);
const [image,setImage]=useState([{pageId:'page',rotation:0,crop:{x:0,y:0,width:1,height:1},annotations:[
{id:'a',kind:'comment',points:[{x:.2,y:.2}],width:.004,color:'red',text:'First image feedback',criterionId:'reason',level:''},
{id:'b',kind:'comment',points:[{x:.5,y:.5}],width:.004,color:'blue',text:'Unrelated image feedback',criterionId:'voice',level:''}]}]);
return e('div',{onClick:()=>setBackground(value=>value+1),onPointerDown:()=>{window.backgroundPointers=(window.backgroundPointers||0)+1},onKeyDown:()=>{window.backgroundKeys=(window.backgroundKeys||0)+1}},
e('button',{id:'open-profile',onClick:()=>setOpen(true)},'Open fictional profile'),e('output',{id:'background'},background),
open&&e(StudentProfileModal,{enrollmentId:'enrollment',enrollment:{id:'enrollment',studentId:'student',classSectionId:'class',enrollmentStatus:'active'},student:{id:'student',firstName:'Fictional',lastName:'Learner',localStudentNumber:'000'},assessments:[],categories:[],studentAssessments:[],categoryResults:[],participationEvents:[],policy:{weightK:25,weightT:25,weightC:25,weightA:25,decimalPrecision:1},overrides:[],notes:[],auditEntries:[],onRefresh:()=>{},onClose:()=>setOpen(false)}),
e(RubricEvidenceEditor,{rubric,value:feedback,onChange:setFeedback,disabled:false,annotations:[{id:'quote',documentId:'work',start:0,end:7,quote:'A claim',criterionId:'reason',level:'3',text:'Recorded text annotation'}],imageFeedback:image}),
e('output',{id:'criterion-state'},JSON.stringify(feedback)),
e(ImageMarkup,{pages,feedback:image,onChange:setImage,rubric,disabled:false}),
e('output',{id:'image-state'},JSON.stringify(image)),e('output',{id:'original-unchanged'},String(pages[0].base64===original)));
}
createRoot(document.getElementById('root')).render(e(Harness));
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'classroom-focused-fixture', configureServer(instance) {
  instance.middlewares.use('/__classroom-focused', async (_request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__classroom-focused', harness));
  });
} }] });
await server.listen();
const address = server.httpServer!.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.goto(`${origin}/__classroom-focused`);
  await page.getByRole('button', { name: 'Open fictional profile', exact: true }).click();
  const modal = page.getByTestId('student-profile-modal');
  const dialog = modal.getByRole('dialog');
  await dialog.waitFor();
  const bounds = await dialog.boundingBox(); assert.ok(bounds);
  assert.ok(Math.abs(bounds.width - 720) < 3, 'desktop student popup is half the viewport width');
  assert.ok(bounds.height >= 800 && bounds.height <= 812, 'desktop student popup uses most viewport height');
  const background = await page.locator('#background').innerText();
  const pointers = await page.evaluate(() => (window as any).backgroundPointers);
  await page.getByTestId('profile-tab-notes').click();
  const note = page.getByTestId('profile-note-textarea'); await note.fill('Unsaved fictional note');
  assert.equal(await page.locator('#background').innerText(), background, 'modal clicks do not activate an ancestor');
  assert.equal(await page.evaluate(() => (window as any).backgroundPointers), pointers, 'modal pointers do not activate an ancestor');
  for (const action of ['escape', 'x', 'outside']) {
    page.once('dialog', confirmation => confirmation.dismiss());
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'x') await page.getByTestId('profile-close-btn').click();
    if (action === 'outside') await page.mouse.click(20, 300);
    await modal.waitFor(); assert.equal(await note.inputValue(), 'Unsaved fictional note');
  }
  await page.keyboard.press('Tab');
  assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), 'keyboard focus stays inside the popup');
  page.once('dialog', confirmation => confirmation.accept());
  await page.mouse.click(20, 300); await modal.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#background').innerText(), background, 'backdrop dismiss does not activate a background student');
  assert.equal(await page.locator('#open-profile').evaluate(node => node === document.activeElement), true, 'focus restores to opener');
  await page.locator('#open-profile').click();
  await page.getByTestId('open-grade-override-btn').click();
  await page.getByTestId('override-modal').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('override-modal').waitFor({ state: 'hidden' }); await modal.waitFor();
  await page.getByTestId('profile-close-btn').click(); await modal.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 560, height: 800 });
  await page.locator('#open-profile').click();
  const narrow = await dialog.boundingBox(); assert.ok(narrow);
  assert.ok(narrow.x >= 15 && narrow.x + narrow.width <= 545 && narrow.height > 700, 'small screen preserves side margins and height');
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
  console.log('PASS: popup half-width/tall/responsive, X/outside/Escape dirty guards, nested Escape, focus restoration, no background activation');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const reason = page.getByTestId('marking-criterion-reason');
  assert.match(await reason.innerText(), /Recorded text annotation/);
  const primaryColors = await reason.getByRole('button', { name: 'Edit comment', exact: true }).evaluate(node => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
  assert.deepEqual(primaryColors, { foreground: 'rgb(255, 255, 255)', background: 'rgb(29, 78, 216)' }, 'primary comment control has visible white text on blue');
  await reason.getByRole('button', { name: 'Edit comment', exact: true }).click();
  assert.equal(await page.getByTestId('marking-criterion-voice').count(), 0, 'unrelated criterion comments are hidden while composing');
  const editor = page.getByTestId('marking-criterion-feedback-reason');
  assert.equal(await editor.evaluate(node => node === document.activeElement), false, 'opening a comment does not force focus and scroll the viewed work');
  await editor.focus();
  assert.ok(await editor.evaluate(node => node === document.activeElement), 'comment editor remains keyboard accessible');
  await editor.fill('Edited focused feedback');
  await page.getByRole('button', { name: 'Done — review criteria', exact: true }).click();
  assert.match(await page.getByTestId('marking-criterion-voice').innerText(), /Unrelated recorded feedback/);
  assert.match(await reason.innerText(), /Edited focused feedback/);
  await reason.getByRole('button', { name: '4+(high)', exact: true }).click();
  assert.match(await reason.innerText(), /Selected level: 4\+\(high\)/);
  await reason.locator('summary').filter({ hasText: /^Other rubric labels$/ }).click();
  await reason.getByTestId('marking-criterion-level-reason').selectOption('Legacy secure');
  const rubricState = JSON.parse(await page.locator('#criterion-state').innerText());
  assert.equal(rubricState[0].level, 'Legacy secure'); assert.equal(rubricState[1].level, '');
  console.log('PASS: focused criterion comment editing, return review, retained evidence, built-in and saved rubric level choices');

  const image = page.getByTestId('image-markup');
  await image.getByLabel('Select saved mark').selectOption('a');
  const imageEditor = image.getByLabel('Image comment text');
  assert.equal(await imageEditor.inputValue(), 'First image feedback');
  assert.equal(await image.getByLabel('Select saved mark').count(), 0, 'unrelated saved comment list hidden in editor');
  assert.equal(await image.locator('svg').getByText('Unrelated image feedback', { exact: true }).count(), 0, 'other image comments hidden in editor');
  await imageEditor.fill('Edited image feedback');
  await image.getByRole('button', { name: '4+(med)', exact: true }).click();
  await image.getByRole('button', { name: 'Save feedback', exact: true }).click();
  await image.getByRole('button', { name: 'Write a comment', exact: true }).click();
  assert.match(await image.innerText(), /Click the page where/);
  await image.getByRole('button', { name: 'Pen', exact: true }).click();
  const surface = image.getByTestId('image-annotation-surface');
  await surface.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="image-annotation-surface"]')!).visibility === 'visible');
  const canvasBounds = await surface.boundingBox(); assert.ok(canvasBounds);
  await page.mouse.move(canvasBounds.x + canvasBounds.width * .75, canvasBounds.y + canvasBounds.height * .65);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * .85, canvasBounds.y + canvasBounds.height * .75, { steps: 5 });
  await page.mouse.up();
  const imageState = JSON.parse(await page.locator('#image-state').innerText());
  assert.equal(imageState[0].annotations[0].text, 'Edited image feedback');
  assert.equal(imageState[0].annotations[0].level, '4+(med)');
  assert.equal(imageState[0].annotations[1].text, 'Unrelated image feedback');
  assert.equal(imageState[0].annotations[2].kind, 'pen'); assert.ok(imageState[0].annotations[2].points.length > 1);
  assert.equal(await page.locator('#original-unchanged').innerText(), 'true');
  assert.deepEqual(errors, []);
  console.log('PASS: focused image comments/shared levels, pen stroke preserved alongside comments, original image bytes retained');
} finally { await browser.close(); await server.close(); }
