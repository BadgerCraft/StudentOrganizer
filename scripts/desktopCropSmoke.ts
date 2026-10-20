import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const harness = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import'/src/index.css';import{ImageMarkup}from'/src/marking/ui/ImageMarkup.tsx';
const e=React.createElement,c=document.createElement('canvas');c.width=600;c.height=800;c.getContext('2d').fillRect(0,0,600,800);const original=c.toDataURL('image/png').split(',')[1];
const pages=['first','second'].map(id=>({id,name:'Fictional '+id+'.png',mime:'image/png',width:600,height:800,base64:original,hash:id}));
const rubric={id:'rubric',title:'Fictional reasoning',levels:['Secure'],criteria:[{id:'reason',name:'Reasoning',categoryCode:'K',descriptors:{Secure:'Clear'}}]};
function Harness(){const[feedback,setFeedback]=useState(pages.map(p=>({pageId:p.id,rotation:0,crop:{x:0,y:0,width:1,height:1},annotations:[{id:'comment-'+p.id,kind:'comment',points:[{x:.5,y:.5}],color:'red',width:.004,text:'Fictional retained mark',criterionId:'reason',level:''}]})));const[disabled,setDisabled]=useState(false),[crop,setCrop]=useState(false),[mounted,setMounted]=useState(true);window.setCropDisabled=setDisabled;window.remountCrop=()=>{setMounted(false);setTimeout(()=>setMounted(true),0)};return e('main',{style:{maxWidth:900,margin:'auto'}},mounted&&e(ImageMarkup,{pages,feedback,onChange:setFeedback,rubric,disabled,onCropEditingChange:setCrop}),e('output',{id:'crop-state'},JSON.stringify(feedback)),e('output',{id:'crop-dirty'},String(crop)),e('output',{id:'original-intact'},String(pages.every(p=>p.base64===original))));}createRoot(document.getElementById('root')).render(e(Harness));
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [{ name: 'desktop-crop-fixture', configureServer(instance) { instance.middlewares.use('/__desktop-crop', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__desktop-crop', harness)); }); } }] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } }); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); await page.goto(`http://127.0.0.1:${address.port}/__desktop-crop`);
  const editor = page.getByTestId('image-markup'), surface = page.getByTestId('image-annotation-surface'); await surface.waitFor({ state: 'visible' });
  const state = async () => JSON.parse(await page.locator('#crop-state').innerText()); const initial = await state();
  const cropButton = (name: string) => editor.getByRole('button', { name, exact: true });
  async function dragCorner(x: number, y: number) {
    const handle = editor.getByTestId('crop-handle-top-left'); await handle.waitFor({state:'visible'}); const h = await handle.boundingBox(), overlay = await editor.getByTestId('page-crop-overlay').boundingBox(); assert.ok(h && overlay);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(overlay.x + overlay.width * x, overlay.y + overlay.height * y, { steps: 5 }); await page.mouse.up();
  }
  await cropButton('Edit crop').click(); await dragCorner(.2,.3); assert.deepEqual(await state(), initial, 'drag is staged, not stored'); assert.equal(await page.locator('#crop-dirty').innerText(),'true');
  await cropButton('Next page').click(); assert.match(await editor.innerText(),/Apply or cancel the crop/); assert.match(await editor.innerText(),/Page 1 of 2/);
  await cropButton('Cancel crop').click(); assert.deepEqual(await state(),initial); await page.waitForFunction(()=>document.querySelector('#crop-dirty')?.textContent==='false');
  await cropButton('Rotate clockwise').click(); assert.equal((await state())[0].rotation,90);
  await cropButton('Edit crop').click(); await dragCorner(.2,.3); await cropButton('Apply crop').click(); const applied=(await state())[0];
  assert.ok(Math.abs(applied.crop.x-.3)<.005); assert.ok(Math.abs(applied.crop.y)<.005); assert.ok(Math.abs(applied.crop.width-.7)<.005); assert.ok(Math.abs(applied.crop.height-.8)<.005); assert.deepEqual(applied.annotations,initial[0].annotations); assert.deepEqual((await state())[1],initial[1],'crop changes stay on the selected page');
  await cropButton('Undo last view edit').click(); assert.deepEqual((await state())[0].crop,initial[0].crop); assert.equal((await state())[0].rotation,90);
  await cropButton('Undo last view edit').click(); assert.equal((await state())[0].rotation,0);
  await cropButton('Next page').click(); assert.equal(await cropButton('Undo last view edit').isDisabled(),true,'view history belongs to its page'); await cropButton('Previous page').click();
  await cropButton('Edit crop').click(); await editor.getByTestId('crop-handle-top-left').press('ArrowRight'); assert.deepEqual((await state())[0].crop,initial[0].crop);
  await page.evaluate(()=>(window as any).setCropDisabled(true)); await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Apply crop'&&button.disabled)); assert.equal(await cropButton('Apply crop').isDisabled(),true); assert.equal(await page.locator('#crop-dirty').innerText(),'true');
  await page.evaluate(()=>(window as any).setCropDisabled(false)); await cropButton('Apply crop').click(); assert.ok((await state())[0].crop.x>.009);
  await page.evaluate(()=>(window as any).remountCrop()); await cropButton('Edit crop').waitFor(); assert.ok((await state())[0].crop.x>.009,'applied geometry survives editor remount');
  await cropButton('Edit crop').click(); await cropButton('Reset crop').click(); await cropButton('Apply crop').click(); await surface.waitFor({state:'visible'});
  await page.waitForFunction(()=>{const c=document.querySelector('[data-testid="image-markup"] canvas') as HTMLCanvasElement;return c.width===600&&c.height===800;});
  const box=await surface.boundingBox(); assert.ok(box); await page.mouse.move(box.x+box.width*.2,box.y+box.height*.25); await page.mouse.down(); await page.mouse.move(box.x+box.width*.3,box.y+box.height*.25,{steps:3});
  const before=(await state())[0].annotations.at(-1); assert.ok(before.points.length>1);
  await surface.evaluate(svg=>{(svg.parentElement as HTMLElement).style.width='450px';}); await page.mouse.move(box.x+box.width*.3+1,box.y+box.height*.25+1); await page.mouse.up();
  assert.deepEqual((await state())[0].annotations.at(-1).points,before.points,'resize ends stroke without joining different surface rectangles');
  await cropButton('Cancel feedback').click(); assert.deepEqual((await state())[0].annotations,initial[0].annotations);
  assert.equal(await page.locator('#original-intact').innerText(),'true'); assert.deepEqual(errors,[]);
  await writeFile('/tmp/desktop-crop-results.json',JSON.stringify({status:'pass',checks:['staged mouse handles','crop page-departure guard','cancel unchanged','rotated original-coordinate apply','geometry undo preserves marks','keyboard corner','busy retains crop draft','remount retained crop','resize ends ink without bridge','original bytes unchanged']},null,2));
  console.log('PASS: desktop crop handles, staged apply/cancel, rotation/undo, keyboard/busy/remount, resize-stroke interruption, unchanged originals/marks');
} finally { await browser.close(); await server.close(); }
