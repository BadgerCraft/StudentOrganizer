import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Actual desktop preview component with fictional generated pixels. Gate codec
// completion to prove cancellation ownership instead of allocating huge photos.
const harness = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import '/src/index.css';import{CapturePagePreview}from'/src/capture/CapturePagePreview.tsx';
const e=React.createElement,c=document.createElement('canvas');c.width=60;c.height=60;c.getContext('2d').fillStyle='rgb(0,0,255)';c.getContext('2d').fillRect(0,0,60,60);
const bytes=Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),x=>x.charCodeAt(0));
const pages=Array.from({length:10},(_,i)=>({bytes,metadata:{id:'fictional-'+i,order:i,path:'fictional.png',mime:'image/png',byteLength:bytes.length,sha256:'fixture',edits:{rotation:0,crop:{x:0,y:0,width:1,height:1}}}}));
function Harness(){const[show,setShow]=useState(true);window.setPreviewVisible=setShow;return e('div',null,show&&pages.map(page=>e(CapturePagePreview,{key:page.metadata.id,page})));}
createRoot(document.getElementById('root')).render(e(React.StrictMode,null,e(Harness)));
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{ name: 'preview-scheduling-fixture', configureServer(instance) {
  instance.middlewares.use('/__preview-scheduling', async (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(await instance.transformIndexHtml('/__preview-scheduling', harness)); });
} }] });
await server.listen();
const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'});
try {
  const page = await browser.newPage({viewport:{width:1200,height:800}}), errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const original=window.createImageBitmap.bind(window);
    const state=(window as any).previewCodec={active:0,peak:0,started:0,closed:0,releases:[] as Array<() => void>,failNext:false};
    window.createImageBitmap=async(...args:any[])=>{
      state.started++;state.active++;state.peak=Math.max(state.peak,state.active);
      try{await new Promise<void>(resolve=>state.releases.push(resolve));if(state.failNext){state.failNext=false;throw new Error('Fictional preview decode failure');}
        const bitmap=await original(...args as [any]),close=bitmap.close.bind(bitmap);bitmap.close=()=>{state.closed++;close();};return bitmap;
      }finally{state.active--;}
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/__preview-scheduling`);
  const figures=page.getByTestId('capture-page-preview');await figures.last().waitFor();
  await page.waitForFunction(()=>(window as any).previewCodec.active===1);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>(window as any).previewCodec.started),1,'StrictMode replay and queued pages do not overlap or allocate obsolete work');
  assert.equal(await figures.last().locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement).width),0,'far page is lazy');
  await page.evaluate(()=>(window as any).setPreviewVisible(false));await figures.first().waitFor({state:'hidden'});
  await page.evaluate(()=>(window as any).previewCodec.releases.shift()());
  await page.waitForFunction(()=>(window as any).previewCodec.closed===1);
  assert.equal(await page.evaluate(()=>(window as any).previewCodec.started),1,'unmount removes queued decodes');
  await page.evaluate(()=>{(window as any).previewCodec.failNext=true;(window as any).setPreviewVisible(true);});
  await page.waitForFunction(()=>(window as any).previewCodec.releases.length===1);
  await page.evaluate(()=>(window as any).previewCodec.releases.shift()());
  await figures.first().getByRole('alert').filter({hasText:'Fictional preview decode failure'}).waitFor();
  // Remove other queued visible pages, retaining just the first component, so
  // Retry does not need to await unrelated gated fixture codecs.
  await page.evaluate(()=>document.querySelectorAll('[data-testid="capture-page-preview"]').forEach((node,index)=>{if(index) (node as HTMLElement).style.display='none';}));
  // The second visible page may already own the slot; settle it before Retry.
  await page.waitForTimeout(100);
  await page.evaluate(()=>(window as any).previewCodec.releases.splice(0).forEach((release:any)=>release()));
  await figures.first().getByRole('button',{name:'Retry page preview'}).click();
  await page.waitForFunction(()=>(window as any).previewCodec.releases.length===1);
  await page.evaluate(()=>(window as any).previewCodec.releases.shift()());
  await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c?.width===60&&getComputedStyle(c).display!=='none';});
  assert.deepEqual(await figures.first().locator('canvas').evaluate(canvas=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(30,30,1,1).data)),[0,0,255,255],'retry renders readable fictional original pixels');
  await page.evaluate(()=>{document.body.style.minHeight='4000px';window.scrollTo(0,3000);});
  await page.waitForFunction(()=>document.querySelector('canvas')?.width===0);
  const result=await page.evaluate(()=>({peak:(window as any).previewCodec.peak,started:(window as any).previewCodec.started,closed:(window as any).previewCodec.closed}));
  assert.equal(result.peak,1);assert.deepEqual(errors,[]);
  await writeFile('/tmp/capture-preview-scheduling-results.json',JSON.stringify({status:'pass',...result,checks:['one active decoder','StrictMode queued cancellation','lazy far pages','offscreen canvas released','active cancellation closes bitmap','no stale unmounted draw','local codec failure and Retry','readable original pixels']},null,2));
  console.log('PASS: bounded/lazy preview decoding, queued/active cancellation, bitmap cleanup and error Retry',result);
} finally {await browser.close();await server.close();}
