import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const harness = `<!doctype html><html><body><div id="root"></div><script type="module">
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DictationFeedback} from '/src/dictation/DictationFeedback.tsx';
const e=React.createElement;
window.calls={begin:0,transcribe:0,cancel:0,stopped:0,bytes:0};window.failMic=false;window.delay=false;window.available=true;
window.desktopDictation={status:async()=>({ready:window.available,reason:'Optional model missing'}),install:async()=>({ready:false,reason:'Model file not selected'}),begin:async()=>{window.calls.begin++;return 'fictional-'+window.calls.begin},cancel:async()=>{window.calls.cancel++},transcribe:async(_token,wav)=>{window.calls.transcribe++;window.calls.bytes=wav.length;return window.delay?new Promise(resolve=>window.resolveTranscript=resolve):'Explain your reasoning.'},onInterrupted:()=>()=>{}};
// Entirely synthetic audio. The browser never opens a physical microphone.
navigator.mediaDevices.getUserMedia=async constraints=>{if(window.delayMic)await new Promise(resolve=>window.releaseMic=resolve);if(window.failMic)throw new DOMException('No microphone','NotFoundError');if(constraints.video!==false)throw Error('Video requested');const context=new AudioContext();const oscillator=context.createOscillator();const output=context.createMediaStreamDestination();oscillator.connect(output);oscillator.start();for(const track of output.stream.getTracks()){const original=track.stop.bind(track);let ended=false;track.stop=()=>{if(ended)return;ended=true;window.calls.stopped++;original();oscillator.stop();void context.close();};}return output.stream;};
function App(){const [target,setTarget]=useState('student-a:mark-a'),[value,setValue]=useState('Original feedback'),[saved,setSaved]=useState(''),[disabled,setDisabled]=useState(false);window.changeTarget=()=>{setTarget('student-b:'+Math.random());setValue('Other draft');};window.disable=()=>setDisabled(true);return e('div',{},e(DictationFeedback,{target,value,onValue:setValue,disabled,'aria-label':'Feedback',maxLength:100}),e('button',{onClick:()=>setSaved(value)},'Save feedback'),e('pre',{id:'saved'},saved),e('pre',{id:'draft'},value));}createRoot(document.getElementById('root')).render(e(App));
</script></body></html>`;
const server = await createServer({server:{host:'127.0.0.1',port:0},plugins:[{name:'dictation-fixture',configureServer(instance){instance.middlewares.use('/__dictation',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await instance.transformIndexHtml('/__dictation',harness));});}}]});
await server.listen(); const address=server.httpServer!.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
try{
 const page=await browser.newPage();const errors:string[]=[],external:string[]=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto(`http://127.0.0.1:${address.port}/__dictation`);
 const start=page.getByRole('button',{name:'Start dictation',exact:true}),stop=page.getByRole('button',{name:'Stop dictation',exact:true}),input=page.getByRole('textbox',{name:'Feedback',exact:true});
 const record=async()=>{await start.click();await stop.waitFor();await page.waitForTimeout(250);await stop.click();};
 await record();await page.getByRole('textbox',{name:'Review dictated feedback'}).waitFor();
 assert.equal(await input.inputValue(),'Original feedback','transcript never autosaves into feedback');assert.equal(await page.locator('#saved').innerText(),'');
 await page.getByRole('textbox',{name:'Review dictated feedback'}).fill('x'.repeat(101));await page.getByRole('button',{name:'Add transcript to feedback'}).click();assert.equal(await input.inputValue(),'Original feedback');await page.getByRole('status').filter({hasText:'exceeds 100'}).waitFor();
 await page.getByRole('textbox',{name:'Review dictated feedback'}).fill('Reviewed fictional feedback.');await page.getByRole('button',{name:'Add transcript to feedback'}).click();
 assert.equal(await input.inputValue(),'Original feedback\nReviewed fictional feedback.');assert.equal(await page.locator('#draft').innerText(),'Original feedback\nReviewed fictional feedback.','native edit updates React state');
 await input.press('Control+z');assert.equal(await input.inputValue(),'Original feedback','native undo retains original');
 await record();await page.getByRole('button',{name:'Add transcript to feedback'}).click();await page.getByRole('button',{name:'Save feedback',exact:true}).click();
 assert.equal(await page.locator('#saved').innerText(),'Original feedback\nExplain your reasoning.');
 await start.click();await stop.waitFor();await page.getByRole('button',{name:'Cancel dictation',exact:true}).click();
 assert.equal(await input.inputValue(),'Original feedback\nExplain your reasoning.');
 await page.evaluate(()=>{(window as any).delay=true;});await record();await page.getByText('Microphone off. Transcribing on this computer…',{exact:true}).waitFor();
 await page.waitForFunction(()=>(window as any).resolveTranscript);await page.evaluate(()=>{(window as any).changeTarget();});
 await page.evaluate(()=>{(window as any).resolveTranscript('Stale student feedback');(window as any).delay=false;});await page.waitForTimeout(100);
 assert.equal(await input.inputValue(),'Other draft');assert.equal(await page.getByRole('textbox',{name:'Review dictated feedback'}).count(),0);
 await start.click();await stop.waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await start.waitFor();
 await page.evaluate(()=>{(window as any).delayMic=true;});await start.click();await page.waitForFunction(()=>(window as any).releaseMic);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.evaluate(()=>{(window as any).delayMic=false;(window as any).releaseMic();});await start.waitFor();assert.equal(await stop.count(),0,'late microphone must close after blur');
 await page.evaluate(()=>{(window as any).failMic=true;});await start.click();await page.getByRole('status').filter({hasText:'No microphone'}).waitFor();assert.equal(await input.inputValue(),'Other draft');
 await page.evaluate(()=>{(window as any).failMic=false;(window as any).available=false;(window as any).changeTarget();});await page.getByText('Optional model missing',{exact:false}).first().waitFor();assert.equal(await start.isDisabled(),true);await page.getByRole('button',{name:'Choose local speech model'}).click();await page.getByText('Model file not selected',{exact:false}).first().waitFor();
 await page.evaluate(()=>{(window as any).available=true;(window as any).changeTarget();});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Start dictation')?.disabled);await start.click();await stop.waitFor();await page.evaluate(()=>{(window as any).disable();});await page.waitForFunction(()=>document.querySelector('textarea')?.disabled);
 assert.equal(await stop.count(),0);assert.equal(await input.inputValue(),'Other draft');
 const calls=await page.evaluate(()=>(window as any).calls);assert.ok(calls.stopped>=6);assert.ok(calls.bytes>44);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',checks:'review/add/save, native undo, synthetic capture, repeated use, cancellation, stale target, window blur, no microphone, disabled editor, zero external requests',calls}));
}finally{await browser.close();await server.close();}
