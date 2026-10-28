import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { CLASSROOM_LEVEL_LABELS } from '../src/services/classroomLevels';

// Reuse the actual-component fictional fixture; no student files or official marks.
const source = await readFile(new URL('./classroomEvidencePopupSmoke.ts', import.meta.url), 'utf8');
let harness = source.match(/const harness = `([\s\S]*?)`;\nconst server/)![1].replace("const [open,setOpen]=useState(false)","const [readOnly,setReadOnly]=useState(false),[busy,setBusy]=useState(false);window.setFictionalReadOnly=setReadOnly;window.setFictionalBusy=setBusy; const [open,setOpen]=useState(false)").replace("e(ImageMarkup,{pages,feedback:image,onChange:setImage,rubric,disabled:false})","e(ImageMarkup,{pages,feedback:image,onChange:setImage,rubric,disabled:readOnly||busy,readOnly,onFeedbackActiveChange:active=>{window.fictionalFeedbackActive=active}})");
// Exercise delayed fixture state delivery without altering the real component.
if (process.env.ANNOTATION_DELAY_READONLY_COMMIT === '1') harness = harness.replace('window.setFictionalReadOnly=setReadOnly;', 'window.setFictionalReadOnly=value=>setTimeout(()=>setReadOnly(value),100);');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{name:'annotation-fixture',configureServer(instance){instance.middlewares.use('/__annotation', async (_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await instance.transformIndexHtml('/__annotation',harness));});}}]});
await server.listen();
const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'});
try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${address.port}/__annotation`);
 const image=page.getByTestId('image-markup'),surface=image.getByTestId('image-annotation-surface');
 await surface.waitFor({state:'visible'});await surface.scrollIntoViewIfNeeded();
 const state=async()=>JSON.parse(await page.locator('#image-state').innerText())[0].annotations;
 const box=await surface.boundingBox();assert.ok(box);
 const scroll=await page.evaluate(()=>window.scrollY);
 const focus=await page.evaluate(()=>document.activeElement?.tagName);
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.35,{steps:5});await page.mouse.up();
 if(process.env.ANNOTATION_BASELINE){
  assert.equal(await image.getByLabel('Image comment text',{exact:true}).count(),0);
  const created=(await state()).at(-1);await image.getByLabel('Select saved mark').selectOption(created.id);
  assert.equal(await image.getByRole('button',{name:'3',exact:true}).isDisabled(),true);
  console.log('REPRODUCED: new pen has no selected editor; level 3 disabled until criterion chosen');
  process.exitCode=0;
 }else{
 assert.equal(await image.getByLabel('Image comment text',{exact:true}).count(),1,'new pen mark immediately selects exact feedback editor');
 assert.equal(await page.evaluate(()=>window.scrollY),scroll,'opening editor preserves page scroll');
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),focus,'opening editor never steals focus');
 const editor=image.getByLabel('Image comment text',{exact:true});
 assert.equal(await image.getByLabel('Image criterion',{exact:true}).inputValue(),'reason');
 await image.getByTestId('feedback-keyboard-control').focus();await page.keyboard.press('Shift+Digit3');
 assert.equal(await image.getByLabel('Image criterion',{exact:true}).inputValue(),'voice','open photo feedback accepts confirmed category shortcut');
 await editor.focus();await page.keyboard.press('Shift+Digit2');
 assert.equal(await image.getByLabel('Image criterion',{exact:true}).inputValue(),'voice','typing never switches photo category');
 await image.getByLabel('Image criterion',{exact:true}).selectOption('reason');
 for(const level of CLASSROOM_LEVEL_LABELS){
  await image.getByRole('button',{name:level,exact:true}).click();
  assert.equal(await image.getByRole('button',{name:level,exact:true}).getAttribute('aria-pressed'),'true');
 }
 await editor.fill('Fictional selected pen feedback');
 assert.equal((await state()).at(-1).text,'Fictional selected pen feedback','unfinished text remains available to draft autosave');
 await image.getByLabel('Image criterion',{exact:true}).selectOption('voice');
 assert.match(await image.innerText(),/Selected level: Not selected/);
 await image.getByRole('button',{name:'3+',exact:true}).click();
 await surface.scrollIntoViewIfNeeded();const blocked=await surface.boundingBox();assert.ok(blocked);
 await page.mouse.click(blocked.x+blocked.width*.8,blocked.y+blocked.height*.8);
 assert.equal((await state()).length,3,'additional mark cannot interrupt unfinished feedback');
 await image.locator('svg').getByText('Comment',{exact:true}).first().click();
 assert.equal(await editor.inputValue(),'Fictional selected pen feedback','saved-mark selection cannot replace unfinished editor');
 assert.match(await image.innerText(),/Save or cancel feedback/);
 await image.getByRole('button',{name:'Save feedback',exact:true}).click();
 const saved=(await state()).at(-1);assert.equal(saved.text,'Fictional selected pen feedback');assert.equal(saved.criterionId,'voice');assert.equal(saved.level,'3+');
 assert.equal(await editor.count(),0,'save clearly finishes active item');
 const afterSaveShortcut=await state();await image.getByRole('button',{name:'Highlight',exact:true}).focus();await page.keyboard.press('Shift+Digit2');assert.deepEqual(await state(),afterSaveShortcut,'saved photo feedback disables category shortcut');
 await image.getByLabel('Select saved mark').selectOption(saved.id);
 await editor.fill('Unconfirmed replacement');await image.getByRole('button',{name:'1−',exact:true}).click();
 await image.getByRole('button',{name:'Cancel feedback',exact:true}).click();
 assert.deepEqual((await state()).at(-1),saved,'cancelling edit retains saved feedback and geometry');
 await image.getByRole('button',{name:'Highlight',exact:true}).click();await surface.scrollIntoViewIfNeeded();
 const next=await surface.boundingBox();assert.ok(next);await page.mouse.move(next.x+next.width*.3,next.y+next.height*.5);await page.mouse.down();await page.mouse.move(next.x+next.width*.5,next.y+next.height*.5,{steps:4});await page.mouse.up();
 assert.equal(await editor.count(),1,'highlight immediately opens its exact feedback editor');
 assert.equal((await state()).at(-1).kind,'highlight');
 await editor.fill('Fictional cancelled highlight');await image.getByRole('button',{name:'Cancel feedback',exact:true}).click();
 assert.equal((await state()).length,3,'cancel removes only newly created mark');
 await image.getByLabel('Select saved mark').selectOption(saved.id);
 assert.equal(await editor.inputValue(),saved.text,'reopening preserves confirmed feedback');
 await page.screenshot({path:'/tmp/annotation-feedback.png',fullPage:true});
 await image.getByRole('button',{name:'Cancel feedback',exact:true}).click();
 await image.getByLabel('Select saved mark').selectOption(saved.id);
 await editor.fill('Temporarily busy feedback');
 await page.evaluate(()=>(window as any).setFictionalBusy(true));
 await image.locator('button:disabled').filter({hasText:/^Cancel feedback$/}).waitFor();
 assert.equal(await page.evaluate(()=>(window as any).fictionalFeedbackActive),true,'temporary busy state keeps unfinished feedback guard');
 assert.equal(await image.getByRole('button',{name:'Cancel feedback',exact:true}).isDisabled(),true,'busy cannot bypass Save/Cancel snapshot');
 assert.equal(await image.getByRole('button',{name:'Close feedback',exact:true}).count(),0);
 await page.evaluate(()=>(window as any).setFictionalBusy(false));
 await image.getByRole('button',{name:'Cancel feedback',exact:true}).click();
 assert.deepEqual((await state()).at(-1),saved,'cancel still restores snapshot after temporary busy state');
 await page.evaluate(()=>(window as any).setFictionalReadOnly(true));
 // The fixture setter schedules React work; returning from evaluate is not a commit.
 await image.locator('button:disabled').filter({hasText:/^Pen$/}).waitFor();
 const beforeReadOnly=await state();
 await image.getByLabel('Select saved mark').selectOption(saved.id);
 await image.getByRole('button',{name:'Close feedback',exact:true}).waitFor();
 // Departure guard is delivered by ImageMarkup's effect after the readonly render.
 await page.waitForFunction(()=>(window as any).fictionalFeedbackActive===false);
 assert.equal(await page.evaluate(()=>(window as any).fictionalFeedbackActive),false,'read-only viewing cannot block workspace departure');
 assert.equal(await image.getByRole('button',{name:'Close feedback',exact:true}).isEnabled(),true);
 await image.getByRole('button',{name:'Close feedback',exact:true}).click();
 assert.deepEqual(await state(),beforeReadOnly,'closing read-only feedback never writes');
 assert.equal(await editor.count(),0);
 assert.equal(await page.locator('#original-unchanged').innerText(),'true');
 await writeFile('/tmp/annotation-feedback-results.json',JSON.stringify({status:'pass',levels:CLASSROOM_LEVEL_LABELS,checks:['automatic pen/highlight selection','no focus/scroll movement','all 17 clickable exact levels','visible changeable criterion','new-mark and existing-mark switching guard','save finishes','cancel new removes only new','cancel saved retains feedback','reopen preserves','original bytes preserved','busy preserves active guard and cancel snapshot','read-only close without writes or departure guard']},null,2));
 console.log('PASS: photo selection, 17 levels, criterion, Save/Cancel, switching guards and retained feedback/bytes');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();await server.close();}
