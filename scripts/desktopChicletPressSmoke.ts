import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';import {chromium} from 'playwright';
import {installFictionalClassroom} from './helpers/classroomFixture';
const server=await createServer({root:process.cwd(),cacheDir:join(tmpdir(),`desktop-chiclet-press-vite-${process.pid}`),server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});await server.listen();const port=(server.httpServer!.address() as any).port;
const b=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'});const r:any={};
try{const p=await b.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(10000);await p.goto(`http://127.0.0.1:${port}`);await installFictionalClassroom(p);await p.locator('[data-testid^="select-teacher-"]').first().click();await p.getByTestId('nav-dashboard-btn').click();
  await p.getByTestId('chiclet-open-overlay-btn').first().click();
  await p.getByTestId('classroom-tools-toggle').click();const cards=p.getByTestId('student-seat-card');await cards.first().waitFor();
const first=cards.first();await first.scrollIntoViewIfNeeded();let box=(await first.boundingBox())!;
// Measure the real dock, then put the card's body near the viewport bottom. A
// fixed 1000px viewport only happened to overlap with our local font metrics.
// This still requires a genuine new overlay over the held physical pointer.
await first.focus();await p.keyboard.press('Space');
assert.equal(await first.getAttribute('aria-pressed'),'true');
const dock=p.locator('.participation-dock');const measuredDock=(await dock.boundingBox())!;
assert.ok(measuredDock.height>48,'real selected-student dock has usable height');
await p.keyboard.press('Space');
assert.equal(await first.getAttribute('aria-pressed'),'false');
const regressionHeight=Math.ceil(box.y+box.height-12+Math.min(24,measuredDock.height/4));
await p.setViewportSize({width:1440,height:regressionHeight});
box=(await first.boundingBox())!;
const pressPoint={x:box.x+12,y:box.y+box.height-12};
assert.ok(pressPoint.y>0&&pressPoint.y<regressionHeight,'regression body point remains visible');
assert.equal(await p.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-testid="student-seat-card"]')?.getAttribute('data-enrollment-id'),pressPoint),await first.getAttribute('data-enrollment-id'),'physical press starts on the intended card');
await p.mouse.move(pressPoint.x,pressPoint.y);await p.mouse.down();assert.equal(await first.getAttribute('aria-pressed'),'true','selection starts on press');
const dockOverlap=await p.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.participation-dock'),pressPoint);
assert.equal(dockOverlap,true,'new dock overlaps this regression press point');
r.dockOverlapGeometry={viewportHeight:regressionHeight,pressPoint,measuredDock,openedDock:await dock.boundingBox()};
await p.mouse.up();assert.equal(await first.getAttribute('aria-pressed'),'true','release does not toggle twice');await p.mouse.move(pressPoint.x+28,pressPoint.y);assert.equal(await first.getAttribute('aria-pressed'),'true','movement after release cannot undo completed selection');
await p.setViewportSize({width:1440,height:1000});
// Native child keyboard actions do not bubble into parent selection.
await first.getByTestId('student-settings-gear-btn').focus();await p.keyboard.press('Enter');await p.getByTestId('student-settings-modal').waitFor();await p.keyboard.press('Escape');
await first.getByTestId('open-student-profile-btn').focus();await p.keyboard.press('Enter');const modal=p.getByTestId('student-profile-modal');await modal.waitFor();
const dialog=await modal.getByRole('dialog').boundingBox();assert.ok(dialog);
let target=-1,point:any;for(let i=0;i<await cards.count();i++){const q=await cards.nth(i).boundingBox();if(q&&i!==0){const x=q.x+8,y=q.y+q.height-8;if(y>=0&&y<1000&&(x<dialog.x||x>dialog.x+dialog.width)){target=i;point={x,y};break;}}}assert.ok(target>=0,'fictional card outside profile dialog');
// Focus restoration can scroll the class; resolve the intended card's current geometry before each new press.
const refreshPoint=async()=>{const current=(await cards.nth(target).boundingBox())!;point={x:current.x+8,y:current.y+current.height-8};};
await refreshPoint();await p.mouse.move(point.x,point.y);await p.mouse.down();await modal.waitFor({state:'hidden'});assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'true','explicit background student transfer on press');await p.mouse.up();assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'true','residual click cannot deselect target');
// A covered profile control transfers its exact student intent, without residual release closing it.
await first.getByTestId('open-student-profile-btn').click();const previousTitle=await modal.getByRole('dialog').getAttribute('aria-label');const profileTarget=cards.nth(target).getByTestId('open-student-profile-btn');const profileBox=(await profileTarget.boundingBox())!;assert.ok(profileBox.x+profileBox.width/2<dialog.x||profileBox.x+profileBox.width/2>dialog.x+dialog.width,'target profile action is outside dialog');await p.mouse.move(profileBox.x+profileBox.width/2,profileBox.y+profileBox.height/2);await p.mouse.down();await p.waitForFunction(previous=>document.querySelector('[data-testid="student-profile-modal"] [role="dialog"]')?.getAttribute('aria-label')!==previous,previousTitle);const transferredTitle=await modal.getByRole('dialog').getAttribute('aria-label');assert.notEqual(transferredTitle,previousTitle);await p.mouse.up();assert.equal(await modal.getByRole('dialog').getAttribute('aria-label'),transferredTitle);await p.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await profileTarget.evaluate(node=>node===document.activeElement),true,'focus restores to transferred student control');
// Rejected press-time dismissal preserves the old student's dirty note and target selection.
await first.getByTestId('open-student-profile-btn').click();await modal.getByTestId('profile-tab-notes').click();await modal.getByTestId('profile-note-textarea').fill('Fictional unsaved note');let phase='press',confirmPhase='';p.once('dialog',d=>{confirmPhase=phase;void d.dismiss();});await refreshPoint();await p.mouse.move(point.x,point.y);await p.mouse.down();assert.equal(confirmPhase,'press');phase='release';await p.mouse.up();assert.equal(await modal.getByTestId('profile-note-textarea').inputValue(),'Fictional unsaved note');assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'false');
p.once('dialog',d=>void d.accept());await refreshPoint();await p.mouse.move(point.x,point.y);await p.mouse.down();await modal.waitFor({state:'hidden'});await p.waitForFunction(index=>document.querySelectorAll('[data-testid="student-seat-card"]')[index]?.getAttribute('aria-pressed')==='true',target);assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'true');await p.mouse.up();assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'true');
// Dirty settings rejection also keeps its student-owned form and suspended-profile state.
await first.getByTestId('student-settings-gear-btn').click();const settings=p.getByTestId('student-settings-modal');await settings.waitFor();await settings.getByTestId('student-first-name-input').fill('Fictional pending settings');p.once('dialog',d=>void d.dismiss());await refreshPoint();await p.mouse.move(point.x,point.y);await p.mouse.down();await p.mouse.up();assert.equal(await settings.getByTestId('student-first-name-input').inputValue(),'Fictional pending settings');assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'false');p.once('dialog',d=>void d.accept());await refreshPoint();await p.mouse.move(point.x,point.y);await p.mouse.down();await settings.waitFor({state:'hidden'});await p.mouse.up();assert.equal(await cards.nth(target).getAttribute('aria-pressed'),'true');assert.equal(await modal.count(),0,'old suspended profile cannot reopen over the new student');
// Dragging away reverses temporary selection instead of activating release's student.
const sourceEnrollment=await first.getAttribute('data-enrollment-id'),destinationEnrollment=await cards.nth(target).getAttribute('data-enrollment-id');const beforeSeats=await p.evaluate(async()=>{const path='/src/db/database.ts';return (await import(path)).db.seatPositions.toArray();});const destination=beforeSeats.find((seat:any)=>seat.classEnrollmentId===destinationEnrollment);
box=(await first.boundingBox())!;const targetBox=(await cards.nth(target).boundingBox())!;await p.mouse.move(box.x+12,box.y+20);await p.mouse.down();assert.equal(await first.getAttribute('aria-pressed'),'true');await p.mouse.move(targetBox.x+12,targetBox.y+20,{steps:6});await p.mouse.up();assert.equal(await p.locator(`[data-testid="student-seat-card"][data-enrollment-id="${sourceEnrollment}"]`).getAttribute('aria-pressed'),'false','drag restores opening selection');assert.equal(await p.locator(`[data-testid="student-seat-card"][data-enrollment-id="${destinationEnrollment}"]`).getAttribute('aria-pressed'),'true');
if(await first.getAttribute('draggable')==='true'){await p.waitForFunction(async({id,row,col})=>{const path='/src/db/database.ts';const seats=await(await import(path)).db.seatPositions.toArray();return seats.some((seat:any)=>seat.classEnrollmentId===id&&seat.row===row&&seat.col===col);},{id:sourceEnrollment,row:destination.row,col:destination.col});}
// Right press never dismisses; blank outside primary press dismisses without a background action.
await first.getByTestId('open-student-profile-btn').click();await modal.waitFor();await p.mouse.click(8,300,{button:'right'});assert.ok(await modal.isVisible());await p.mouse.move(8,300);await p.mouse.down();await modal.waitFor({state:'hidden'});await p.mouse.up();
r.checks=['press selection without double toggle','child gear/profile keyboard','deliberate student and profile-control transfer on press','dirty rejection preserves note and settings','accepted guarded transfer','drag reverses temporary selection and preserves native seat swap','non-primary ignored','blank backdrop press dismissal'];

await writeFile(join(tmpdir(),'desktop-chiclet-press-results.json'),JSON.stringify(r,null,2));await p.screenshot({path:join(tmpdir(),'desktop-chiclet-press.png')});console.log(JSON.stringify(r,null,2));
}finally{await b.close();await server.close();}
