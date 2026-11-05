import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { fictionalMarkedPdf } from './pdfFixture';
const outDir='/tmp/so-pdf-runtime-build';
await build({build:{outDir,emptyOutDir:true,rollupOptions:{input:'scripts/pdfRuntimeHarness.html'}}});
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:5191,strictPort:true}});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'});
try {
 const page=await browser.newPage(), errors:string[]=[], remote:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5191/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remote.push(r.url());});
 await page.goto('http://127.0.0.1:5191/scripts/pdfRuntimeHarness.html');await page.waitForFunction(()=>typeof (window as any).processPdf==='function');
 const run=async(bytes:Uint8Array,options={})=>page.evaluate(async({bytes,options})=>{try{const result=await (window as any).processPdf(new Uint8Array(bytes),options);let pixels:any=null;
 if(result.image){const url=URL.createObjectURL(new Blob([result.image],{type:'image/png'}));const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let red=0,yellow=0;for(let i=0;i<data.length;i+=4){if(data[i]>240&&data[i+1]<30&&data[i+2]<30)red++;if(data[i]>240&&data[i+1]>240&&data[i+2]<30)yellow++;}pixels={red,yellow,width:img.width,height:img.height};URL.revokeObjectURL(url);}
 return {pages:result.pageCount,imageBytes:result.image?.byteLength,pixels};}catch(e){return {error:String(e)};}},{bytes:Array.from(bytes),options});
 const result=await run(fictionalMarkedPdf(),{page:1,scale:1.25});assert.equal(result.pages,2);assert.ok(result.imageBytes!>100);
 const scan=await run(fictionalMarkedPdf({pages:1,scan:true}),{page:1,scale:1});assert.ok(scan.pixels?.yellow>1000,'scanned pixels retained');
 const annotations=await run(fictionalMarkedPdf({pages:1,annotations:true}),{page:1,scale:1});assert.ok(annotations.pixels?.yellow>1000,'highlight appearance retained');assert.ok(annotations.pixels?.red>100,'ink appearance retained');
 const rotated=await run(fictionalMarkedPdf({pages:1,rotate:90}),{page:1,scale:1});assert.equal(rotated.pixels?.width,500);assert.equal(rotated.pixels?.height,400);
 assert.match((await run(fictionalMarkedPdf({pages:21}))).error!,/1–20/);
 assert.match((await run(fictionalMarkedPdf({script:true}))).error!,/scripts/);
 assert.match((await run(fictionalMarkedPdf({form:true}))).error!,/forms/);
 assert.match((await run(fictionalMarkedPdf({width:100000}))).error!,/dimensions/);
 assert.match((await run(new TextEncoder().encode('%PDF-1.7 broken %%EOF'))).error!,/could not be displayed/);
 const cancelled=await page.evaluate(async(bytes)=>{const controller=new AbortController();const pending=(window as any).processPdf(new Uint8Array(bytes),{page:1,scale:2,signal:controller.signal});controller.abort();try{await pending;return false;}catch{return true;}},Array.from(fictionalMarkedPdf()));assert.equal(cancelled,true);
 const afterCancel=await run(fictionalMarkedPdf(),{page:2,scale:1});assert.equal(afterCancel.pages,2);
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
 console.log('PASS production CSP: local PDF worker/render, page bounds, malformed/script/form rejection, cancel/retry, no remote requests');
}finally{await browser.close();await new Promise<void>(resolve=>server.httpServer.close(()=>resolve()));}
