import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { LocalCollector } from './collector';
import { AS_OF, simulate } from './simulator';
const directory=await mkdtemp(path.join(tmpdir(),'analytics-browser-'));
const collector=new LocalCollector(directory,()=>Date.parse(AS_OF));
await simulate(collector,'measured-test');
const fixture=JSON.stringify(await collector.export('measured-test'));
const root=path.resolve('apps/control-panel/dist');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(root,'.'+new URL(req.url!,'http://local').pathname);if(requested!==root&&!requested.startsWith(root+path.sep))throw Error();const file=requested===root?path.join(root,'index.html'):requested;res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors:string[]=[],external:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.goto(origin);await page.getByRole('button',{name:'Analytics pipeline',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Run local pipeline',exact:true}).isDisabled(),true);
 assert.equal(await page.getByTestId('analytics-weekly').innerText(),'0');
 await page.getByLabel('I consent to this fictional simulation session only.').check();await page.getByRole('button',{name:'Run local pipeline',exact:true}).click();
 await page.getByText(/Local fictional pipeline completed:/).waitFor();assert.equal(await page.getByTestId('analytics-weekly').innerText(),'6');assert.equal(await page.getByTestId('analytics-activation').innerText(),'6');assert.equal(await page.getByTestId('analytics-installations').innerText(),'7');
 await page.getByLabel('Dataset',{exact:true}).selectOption('measured-test');assert.equal(await page.getByTestId('analytics-weekly').innerText(),'0');
 await page.locator('input[type=file]').setInputFiles({name:'events-measured-test.json',mimeType:'application/json',buffer:Buffer.from(fixture)});
 await page.getByText(/Validated local collector export ingested/).waitFor();assert.equal(await page.getByTestId('analytics-weekly').innerText(),'6');
 assert.match(await page.locator('main').innerText(),/5 \/ 6/);assert.match(await page.locator('main').innerText(),/3 \/ 6/);
 assert.equal(await page.getByRole('cell',{name:/75 · percentage-v1/}).count(),0);
 await page.getByLabel(/Preview fictional academic summaries/).check();assert.equal(await page.getByRole('cell',{name:/75 · percentage-v1/}).count(),3);assert.equal(await page.getByRole('cell',{name:/77 · percentage-v1.*class/}).count(),3);
 if(process.env.ANALYTICS_EVIDENCE_DIR){await mkdir(process.env.ANALYTICS_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.ANALYTICS_EVIDENCE_DIR,'dashboard.png'),fullPage:true});}
 await page.reload();await page.getByRole('button',{name:'Analytics pipeline',exact:true}).click();await page.getByLabel('Dataset',{exact:true}).selectOption('measured-test');assert.equal(await page.getByTestId('analytics-weekly').innerText(),'6');assert.equal(await page.getByRole('button',{name:'Run local pipeline',exact:true}).isDisabled(),true);
 // Delay File.text to force import/withdraw overlap; stale result must not resurrect summaries.
 await page.evaluate(()=>{const original=File.prototype.text;File.prototype.text=async function(){await new Promise(r=>setTimeout(r,300));return original.call(this);};});
 const importing=page.locator('input[type=file]').setInputFiles({name:'events.json',mimeType:'application/json',buffer:Buffer.from(fixture)});await importing;
 await page.getByRole('button',{name:'Withdraw fictional session & purge source',exact:true}).click();
 await page.waitForTimeout(500);assert.equal(await page.getByTestId('analytics-weekly').innerText(),'0');
 await page.locator('input[type=file]').setInputFiles({name:'replay.json',mimeType:'application/json',buffer:Buffer.from(fixture)});await page.getByText(/Import rejected:/).waitFor();assert.equal(await page.getByTestId('analytics-weekly').innerText(),'0');
 await page.getByRole('button',{name:'Reset local fictional data',exact:true}).click();
 // An obsolete dashboard instance must not commit after tab-away/back + reset.
 await page.locator('input[type=file]').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(fixture)});
 await page.getByRole('button',{name:'Update preparation',exact:true}).click();
 await page.getByRole('button',{name:'Analytics pipeline',exact:true}).click();
 await page.getByRole('button',{name:'Reset local fictional data',exact:true}).click();
 await page.waitForTimeout(500);assert.equal(await page.getByTestId('analytics-weekly').innerText(),'0');
 assert.equal(await page.evaluate(()=>localStorage.getItem('owner-fictional-analytics-v1')),null);
 await page.evaluate(()=>localStorage.setItem('owner-fictional-analytics-v1','{corrupt'));await page.reload();await page.getByRole('button',{name:'Analytics pipeline',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Run local pipeline',exact:true}).isDisabled(),true);assert.equal(await page.locator('input[type=file]').isDisabled(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('owner-fictional-analytics-v1')),'{corrupt');
 await page.getByRole('button',{name:'Reset local fictional data',exact:true}).click();assert.equal(await page.locator('input[type=file]').isDisabled(),false);
 await page.setViewportSize({width:820,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(directory,'analytics-dashboard.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: actual local collector export → browser ingestion/query; simulation consent; source separation; suppression/context; restart; delayed-import withdrawal/replay; corrupt-state reset; responsive UI; zero external requests.');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
