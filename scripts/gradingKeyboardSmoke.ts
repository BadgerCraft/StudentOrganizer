import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium, webkit, type Page } from 'playwright';
import { CLASSROOM_LEVEL_LABELS } from '../src/services/classroomLevels';

// Real MarkingWorkspace + ImageMarkup with disposable seeded work. No live student data.
const source = await readFile(new URL('./focusedMarkingSmoke.ts', import.meta.url), 'utf8');
let harness = source.match(/const harness = `([\s\S]*?)`\.replace/)![1]
  .replace('const document=await createPastedDocument', 'const work=await createPastedDocument')
  .replace('[document],enrollment', '[work],enrollment');
harness = harness.replace('window.fixture={attemptId:attempt.id,assessmentId:id};', `
const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
canvas.getContext('2d').fillStyle='white';canvas.getContext('2d').fillRect(0,0,600,800);
const original=await(await fetch(canvas.toDataURL('image/png'))).blob();
const {parseMarkingImages}=await import('/src/marking/importImages');
const {pages}=await parseMarkingImages([1,2].map(n=>new File([original],'Fictional page '+n+'.png',{type:'image/png'})));
const photo=await service.importImageAttempt(id,rubric.id,pages,enrollment.id,actor);
window.fixture={attemptId:attempt.id,photoId:photo.id,assessmentId:id};
window.allDrafts=async()=>JSON.stringify((await db.markingSessions.toArray()).map(s=>({id:s.id,draft:s.draft})));
`);
harness = harness.replace('<div id="root"></div>', '<div id="outside-editable" contenteditable="true" role="textbox" aria-label="Outside editable">Fictional editable</div><button id="outside-button">Outside control</button><div id="root"></div>');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{ name: 'grading-keyboard-fixture', configureServer(instance) {
  instance.middlewares.use('/__keyboard', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__keyboard', harness)); });
} }] });
await server.listen();const address=server.httpServer!.address();assert.ok(address&&typeof address!=='string');
const engine=process.env.BROWSER_ENGINE==='webkit'?'webkit':'chromium';
const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'}));
const out=`/tmp/grading-keyboard-${engine}`;await mkdir(out,{recursive:true});
let page:Page|undefined;
try {
 page=await browser.newPage({viewport:{width:1440,height:1000}});const p=page;const errors:string[]=[];
 p.setDefaultTimeout(10000);p.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER',e.message);});p.on('dialog',d=>void d.accept());
 await p.goto(`http://127.0.0.1:${address.port}/__keyboard`);
 await p.getByRole('heading',{name:'Prepare this assignment'}).waitFor();
 const official=await p.evaluate(()=>(window as any).official());
 const fixture=await p.evaluate(()=>(window as any).fixture);
 await p.getByRole('button',{name:'Marking queue',exact:true}).click();
 await p.getByTestId(`marking-session-open-${fixture.attemptId}`).click();
 const document=p.getByTestId('marking-document');await document.waitFor();
 const choosePassage=async()=>{
  await document.evaluate(root=>{const node=window.document.createTreeWalker(root,NodeFilter.SHOW_TEXT).nextNode();if(!node)throw new Error('Missing text');const range=window.document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(10,node.textContent!.length));const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await p.getByTestId('marking-feedback').waitFor();
 };
 await choosePassage();
 const control=p.getByTestId('feedback-keyboard-control');
 const criterion=p.getByLabel('Criterion',{exact:true});const level=p.getByLabel('Evidence level (optional)',{exact:true});
 const assertLevel=async(expected:string,note:string)=>assert.equal(await level.inputValue(),expected,note);
 const chord=async(n:number)=>{await p.keyboard.press(`Shift+Digit${n}`);};
 await control.focus();assert.equal(await control.getAttribute('data-phase'),'category');
 await p.keyboard.press('Shift+Tab');assert.equal(await control.evaluate(el=>el===window.document.activeElement),false);await p.keyboard.press('Tab');assert.equal(await control.evaluate(el=>el===window.document.activeElement),true,'shortcut control reachable by ordinary focus navigation');
 await chord(2);assert.equal(await criterion.inputValue(),'criterion-T');assert.equal(await control.getAttribute('data-phase'),'level');await assertLevel('','category chord never grades');
 await chord(3);await assertLevel('3','next chord chooses major level');
 await p.keyboard.down('Shift');await p.keyboard.down('Digit4');await assertLevel('4(low)','approved Shift4 selects exact lower plain4');await p.keyboard.up('Shift');await p.keyboard.press('Tab');await assertLevel('4(low)','heldDigit4 blocks increment after Shift releases');await p.keyboard.up('Digit4');await p.keyboard.press('Tab');await assertLevel('4(high)','fresh Tab after complete release moves to exact upper plain4');await chord(3);
 await p.keyboard.down('Tab');await assertLevel('3+','Tab increments once');
 await p.keyboard.down('Tab');await assertLevel('3+','held Tab repeat cannot increment');
 await p.keyboard.up('Tab');
 await p.keyboard.down('Shift');await assertLevel('3+','standalone Shift waits for release');
 await p.keyboard.up('Shift');await assertLevel('3','standalone Shift release decrements');
 await p.keyboard.down('Shift');await p.keyboard.down('Digit2');await p.keyboard.up('Digit2');await assertLevel('2','grade chord accepted');
 await p.keyboard.down('Digit4');await p.keyboard.up('Digit4');await assertLevel('2','second chord without releasing Shift blocked');
 await p.keyboard.down('Tab');await p.keyboard.up('Tab');await assertLevel('2','Tab before all keys released blocked');
 await p.keyboard.up('Shift');await assertLevel('2','chord Shift release never decrements');
 await control.focus();await chord(3);await assertLevel('3','full release rearms');
 await p.keyboard.down('Shift');await p.keyboard.down('Shift');await p.keyboard.up('Shift');await assertLevel('3','repeat Shift cannot decrement');
 await p.keyboard.down('Shift');await p.keyboard.press('KeyX');await p.keyboard.up('Shift');await assertLevel('3','unrecognized chord cannot become standalone Shift');
 await p.keyboard.down('ShiftLeft');await p.keyboard.down('ShiftRight');await p.keyboard.up('ShiftRight');await p.keyboard.up('ShiftLeft');await assertLevel('3','dual Shift is not standalone');
 await p.keyboard.down('Control');await p.keyboard.press('Shift+Digit1');await p.keyboard.up('Control');await assertLevel('3','control modifier not interpreted');
 await p.keyboard.down('Alt');await p.keyboard.press('Shift+Digit1');await p.keyboard.up('Alt');await assertLevel('3','alt modifier not interpreted');
 // Focus leaves via ordinary backwards navigation; its Shift release must not grade.
 await p.keyboard.press('Shift+Tab');assert.equal(await control.evaluate(el=>el===window.document.activeElement),false);await assertLevel('3','Shift+Tab preserves level');
 await control.focus();await p.keyboard.press('Escape');assert.equal(await control.evaluate(el=>el===window.document.activeElement),false,'keyboard escape exits grading');await assertLevel('3','Escape does not change level');
 // Existing form controls retain native typing and Tab; keyboard shortcuts are not global.
 const comment=p.getByTestId('marking-feedback');await comment.fill('Fictional keyboard feedback');await comment.focus();await chord(1);await p.keyboard.press('Shift');await p.keyboard.press('Tab');await assertLevel('3','typing and ordinary Tab never grade');assert.equal(await criterion.inputValue(),'criterion-T');
 await p.locator('#outside-editable').focus();await chord(4);await p.keyboard.press('Tab');await p.keyboard.press('Shift');await assertLevel('3','contenteditable never grades');assert.equal(await criterion.inputValue(),'criterion-T');
 await p.locator('#outside-button').focus();await chord(1);await p.keyboard.press('Tab');await p.keyboard.press('Shift');await assertLevel('3','controls outside editor never grade');
 // Held modifier across a real focus transition must be quarantined until release.
 await control.focus();await p.keyboard.down('Shift');await comment.focus();await control.focus();await p.keyboard.up('Shift');await assertLevel('3','blur/refocus cannot turn held Shift into decrement');
 await p.keyboard.press('Tab');await assertLevel('3+','fresh post-blur Tab accepted');
 await p.locator('#outside-button').focus();await p.keyboard.down('KeyA');await control.focus();await p.keyboard.press('Tab');await assertLevel('3+','held external nonmodifier blocks grading after focus enters');await p.keyboard.up('KeyA');await p.keyboard.press('Tab');await assertLevel('4−(low)','releasing external key rearms grading');
 await p.locator('#outside-button').focus();await p.keyboard.down('Shift');await p.keyboard.down('Digit2');await control.focus();await p.keyboard.up('Shift');await p.keyboard.press('Tab');await assertLevel('4−(low)','released Shift with digit still held stays blocked');await p.keyboard.up('Digit2');await chord(3);await assertLevel('3','external chord fully released rearms');
 // Every Ctrl/Alt/Meta combination crosses focus with Tab and a category/level chord.
 // Browser-native actions may move focus; only preserved grade/criterion is asserted.
 for(const modifiers of [['Control'],['Alt'],['Meta'],['Control','Alt'],['Control','Meta'],['Alt','Meta'],['Control','Alt','Meta']]){
  await p.locator('#outside-button').focus();for(const modifier of modifiers)await p.keyboard.down(modifier);
  await control.focus();await p.keyboard.press('Tab');await assertLevel('3',`${modifiers.join('+')} held outside plus Tab cannot grade`);
  await control.focus();await chord(1);await assertLevel('3',`${modifiers.join('+')} held outside plus Shift chord cannot grade`);assert.equal(await criterion.inputValue(),'criterion-T');
  for(const modifier of [...modifiers].reverse())await p.keyboard.up(modifier);
  await control.focus();await chord(3);await assertLevel('3','fresh chord after modifier release remains usable');
 }
 await p.locator('#outside-button').focus();await p.keyboard.down('Shift');await control.focus();await p.keyboard.press('Tab');assert.equal(await control.evaluate(el=>el===window.document.activeElement),false,'held external Shift plus Tab preserves backwards focus navigation');await p.keyboard.up('Shift');await assertLevel('3','external Shift+Tab release cannot decrement');
 // Tab used to enter the control is navigation, never an increment on keyup.
 await control.focus();await p.keyboard.press('Shift+Tab');await p.keyboard.down('Tab');assert.equal(await control.evaluate(el=>el===window.document.activeElement),true,'ordinary Tab enters grading control');await assertLevel('3','entering on Tab does not grade');await p.keyboard.up('Tab');await assertLevel('3','navigation Tab release does not grade');
 await p.locator('#outside-button').focus();await p.keyboard.down('Tab');await control.focus();await p.keyboard.down('Tab');await assertLevel('3','Tab held outside cannot repeat into grading');await p.keyboard.up('Tab');await p.keyboard.press('Tab');await assertLevel('3+','fresh Tab after entry release increments');
 await level.selectOption(CLASSROOM_LEVEL_LABELS[0]);await control.focus();await p.keyboard.press('Shift');await assertLevel('R','lower bound clamps');
 for(const expected of CLASSROOM_LEVEL_LABELS.slice(1)){await p.keyboard.press('Tab');await assertLevel(expected,'every exact increment follows immutable scale');}
 await p.keyboard.press('Tab');await assertLevel(CLASSROOM_LEVEL_LABELS.at(-1)!,'upper bound clamps');
 for(const expected of [...CLASSROOM_LEVEL_LABELS].reverse().slice(1)){await p.keyboard.press('Shift');await assertLevel(expected,'every exact decrement follows immutable scale');}
 await level.selectOption('3+');await control.focus();await p.keyboard.press('Tab');await assertLevel('4−(low)','increments preserve exact lower4 label');await p.keyboard.press('Tab');await assertLevel('4−(High)','increments preserve exact upper4-minus label');
 await p.screenshot({path:`${out}/text-keyboard.png`,fullPage:true});
 await p.getByTestId('marking-comment-save').click();await control.waitFor({state:'detached'});
 const saved=await p.evaluate(()=>(window as any).allDrafts());await p.locator('#outside-button').focus();await chord(2);await p.keyboard.press('Tab');await p.keyboard.press('Shift');assert.equal(await p.evaluate(()=>(window as any).allDrafts()),saved,'closed editor cannot change draft');
 await p.locator('#outside-button').focus();await p.keyboard.down('KeyA');await p.getByRole('button',{name:'Edit feedback',exact:true}).click();await control.waitFor();assert.equal(await control.getAttribute('data-phase'),'category','reopened editor starts category phase');await control.focus();await chord(1);assert.equal(await criterion.inputValue(),'criterion-T','key held before editor opens blocks shortcut until full release');await p.keyboard.up('KeyA');await chord(1);assert.equal(await criterion.inputValue(),'criterion-K');
 await p.getByTestId('marking-comment-save').click();
 await p.getByRole('button',{name:'Final grading',exact:true}).click();await p.getByTestId('final-grading-workspace').waitFor();assert.equal(await control.count(),0);
 const finalBefore=await p.evaluate(()=>(window as any).allDrafts());await p.getByRole('button',{name:'Final grading',exact:true}).focus();await chord(4);await p.keyboard.press('Tab');await p.keyboard.press('Shift');assert.equal(await p.evaluate(()=>(window as any).allDrafts()),finalBefore,'final review never handles annotation shortcuts');
 assert.equal(await p.evaluate(()=>(window as any).official()),official,'keyboard never finalizes official grades');
 // A different attempt starts independent keyboard state, using actual photo feedback.
 await p.getByRole('button',{name:'Marking queue',exact:true}).click();await p.getByTestId(`marking-session-open-${fixture.photoId}`).click();
 const surface=p.getByTestId('image-annotation-surface');await surface.waitFor();await p.getByRole('button',{name:'Write a comment',exact:true}).click();await surface.scrollIntoViewIfNeeded();const box=await surface.boundingBox();assert.ok(box);await p.mouse.click(box.x+box.width*.25,box.y+box.height*.25);
 const photoComment=p.getByLabel('Image comment text',{exact:true});await photoComment.waitFor();await control.waitFor();assert.equal(await control.getAttribute('data-phase'),'category');
 await control.focus();await chord(4);assert.equal(await p.getByLabel('Image criterion').inputValue(),'criterion-A');
 await p.keyboard.down('Shift');await p.keyboard.down('Digit4');assert.equal(await p.getByRole('button',{name:'4(low)',exact:true}).getAttribute('aria-pressed'),'true','photo Shift4 selects approved exact plain4');await p.keyboard.up('Shift');await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'4(low)',exact:true}).getAttribute('aria-pressed'),'true','photo heldDigit4 blocks increment');await p.keyboard.up('Digit4');await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'4(high)',exact:true}).getAttribute('aria-pressed'),'true','photo freshTab chooses exact upper plain4');
 await chord(3);await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'3+',exact:true}).getAttribute('aria-pressed'),'true');
 await p.keyboard.down('Shift');await p.keyboard.down('Digit2');await p.keyboard.up('Digit2');await p.keyboard.up('Shift');assert.equal(await p.getByRole('button',{name:'2',exact:true}).getAttribute('aria-pressed'),'true','photo chord release never decrements');
 await p.locator('#outside-button').focus();await p.keyboard.down('KeyA');await control.focus();await p.keyboard.press('Tab');assert.equal(await p.getByRole('button',{name:'2',exact:true}).getAttribute('aria-pressed'),'true','photo focus entry respects held external key');await p.keyboard.up('KeyA');
 await photoComment.fill('Fictional photo feedback');await photoComment.focus();await chord(1);assert.equal(await p.getByLabel('Image criterion').inputValue(),'criterion-A');assert.equal(await p.getByRole('button',{name:'2',exact:true}).getAttribute('aria-pressed'),'true');
 await control.focus();await p.keyboard.down('Shift');await p.getByRole('button',{name:'Save feedback',exact:true}).click();await p.keyboard.up('Shift');await control.waitFor({state:'detached'});
 await p.getByLabel('Select saved mark').selectOption({index:1});await control.waitFor();assert.equal(await control.getAttribute('data-phase'),'category','photo reopening resets phase');assert.equal(await p.getByRole('button',{name:'2',exact:true}).getAttribute('aria-pressed'),'true','held Shift at close does not mutate saved mark');
 await p.getByRole('button',{name:'Cancel feedback',exact:true}).click();await p.getByRole('button',{name:'Next page',exact:true}).click();await surface.waitFor();await surface.scrollIntoViewIfNeeded();const pageTwo=await surface.boundingBox();assert.ok(pageTwo);await p.mouse.click(pageTwo.x+pageTwo.width*.35,pageTwo.y+pageTwo.height*.35);await control.waitFor();assert.equal(await control.getAttribute('data-phase'),'category','page change resets phase');
 await control.focus();await chord(2);assert.equal(await p.getByLabel('Image criterion').inputValue(),'criterion-T');await chord(3);await p.keyboard.press('Shift');assert.equal(await p.getByRole('button',{name:'3−',exact:true}).getAttribute('aria-pressed'),'true');
 await photoComment.fill('Fictional second page');await p.screenshot({path:`${out}/photo-keyboard.png`,fullPage:true});await p.getByRole('button',{name:'Save feedback',exact:true}).click();
 assert.equal(await p.evaluate(()=>(window as any).official()),official,'photo shortcut edits remain draft');assert.deepEqual(errors,[]);
 const result={status:'PASS',engine,checks:['category/level phase','approved Shift4 to4(low), releasedTab to4(high) in text/photo','all-keys release gate','held/repeat/rapid/unknown/dual Shift guards','standalone Shift release','native Shift+Tab and Escape exit','typing/contenteditable/outside controls','blur/refocus and externally held keys','all Ctrl/Alt/Meta combinations and native/held Tab focus entry','preopen key lifetime quarantine','all17 exactscale increments/decrements and clamps','closed/reopened/final-review negatives','different attempt and photo-page contexts','no automatic finalization'],screenshots:['text-keyboard.png','photo-keyboard.png']};
 await writeFile(`${out}/results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch(error) { if(page){await page.screenshot({path:`${out}/failure.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(-10000));}throw error; }
finally {await browser.close();await server.close();}
