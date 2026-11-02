import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const address=server.httpServer!.address();assert.ok(address&&typeof address!=='string');
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium'});
try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${address.port}/`);
 const result=await page.evaluate(async()=>{
  const c=await import('/shared/encryption/index.ts' as string);
  const key=c.generateMasterKey(),context={appId:'synthetic-browser',vaultId:'fictional-vault',purpose:'backup',recordId:'synthetic',revision:1,keyVersion:1};
  const data=new TextEncoder().encode('Fictional backup bytes only');
  const sealed=await c.encryptBytes(key,context,data);const opened=await c.decryptBytes(key,context,sealed);
  if(new TextDecoder().decode(opened)!=='Fictional backup bytes only')throw Error('Roundtrip failed');
  let rejected=false;try{await c.decryptBytes(key,{...context,appId:'other-app'},sealed);}catch{rejected=true;}if(!rejected)throw Error('Cross-app accepted');
  const code=await c.generateRecoveryCode();const wrapped=await c.wrapMasterKey(key,code,context.appId,context.vaultId,1);const recovered=await c.recoverMasterKey(code,wrapped,context.appId,context.vaultId,1);
  if(!recovered.every((v:number,i:number)=>v===key[i]))throw Error('Recovery failed');
  key.fill(0);recovered.fill(0);opened.fill(0);return 'PASS';
 });assert.equal(result,'PASS');assert.deepEqual(errors,[]);console.log('PASS synthetic Chromium: authenticated backup roundtrip, cross-app rejection, offline recovery; no provisioning or activation.');
}finally{await browser.close();await server.close();}
