import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Acceptance harness only: fictional rows, synthetic keys, disposable browser storage.
// Imports the real browser ESM gate/crypto/session; it does not enable production App encryption.
const harness = `<!doctype html><html><body>
<h1>Synthetic storage acceptance</h1><p>Encryption activation is unavailable in this harness.</p>
<label>Unrelated text input <input id="outside"></label><button id="close">Close synthetic workspace</button>
<script type="module">
import Dexie,{liveQuery}from'dexie';
import{DurableDexieGate}from'/src/security/durableDexieGate.ts';
import{EncryptedWorkspaceSession}from'/src/security/encryptedWorkspace.ts';
import{encryptBytes,decryptBytes,generateMasterKey}from'/shared/encryption/index.ts';
const scope={appId:'student-organizer',vaultId:'browser-synthetic',keyVersion:1};
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const context=revision=>({...scope,purpose:'working-data',recordId:'workspace',revision});
const validate=value=>{if(!value||!Array.isArray(value.records))throw Error('Invalid fixture');};
let current;
window.setup=async()=>{
 if(current){current.subscription.unsubscribe();current.db.close();await current.db.delete();current.key.fill(0);}
 const db=new Dexie('synthetic-storage-'+crypto.randomUUID(),{cache:'disabled'});db.version(1).stores({rows:'id,group'});await db.open();await db.rows.put({id:'a',group:1,name:'before'});
 const key=generateMasterKey();let checkpoint={revision:1,ciphertext:await encryptBytes(key,context(1),encode({records:await db.rows.toArray()}))};
 let writes=0,epoch=0,mode='',hold=null,started=()=>{},guard=()=>{};
 const store={read:async()=>structuredClone(checkpoint),commit:async(expected,next)=>{
  started();if(hold)await hold;guard();if(checkpoint.revision!==expected)throw Error('Stale synthetic CAS');
  checkpoint=structuredClone(next);writes++;if(mode==='lost-reply')throw Error('Synthetic reply lost');
 }};
 const session=await EncryptedWorkspaceSession.open(store,scope,key,validate);
 const gate=new DurableDexieGate(async(snapshots,assertCurrent)=>{guard=assertCurrent;await session.transact(draft=>{assertCurrent();draft.records=structuredClone(snapshots.get(db).rows);});},()=>{const captured=epoch;return()=>{if(captured!==epoch)throw Error('Synthetic teacher changed');};});gate.register(db);
 const events=[];const subscription=liveQuery(()=>db.rows.toArray()).subscribe(rows=>events.push(rows));
 const state={db,key,gate,session,subscription,events,operations:[],hold:()=>{let release,ready;hold=new Promise(resolve=>release=resolve);state.ready=new Promise(resolve=>ready=resolve);started=ready;state.release=()=>{hold=null;release();};},
 startWrite:(name='pending')=>{const operation={status:'pending'};state.operations.push(operation);db.rows.update('a',{name}).then(()=>operation.status='accepted',()=>operation.status='rejected');return state.operations.length-1;},
 startRead:()=>{const operation={status:'pending'};state.operations.push(operation);db.rows.get('a').then(value=>{operation.status='accepted';operation.value=value;},()=>operation.status='rejected');return state.operations.length-1;},
 summary:async()=>({writes,locked:gate.locked,operations:structuredClone(state.operations),visible:events.at(-1)?.[0]?.name,checkpointRevision:checkpoint.revision,ciphertext:checkpoint.ciphertext,durable:JSON.parse(new TextDecoder().decode(await decryptBytes(key,context(checkpoint.revision),checkpoint.ciphertext)))}),
 loseReply:()=>{mode='lost-reply';},changeTeacher:()=>{epoch++;},
 ordinary:async()=>{let forced=false;try{await db.transaction('rw',db.rows,async()=>{await db.rows.put({id:'outer'});await db.transaction('rw!',db.rows,()=>db.rows.put({id:'inner'}));});}catch{forced=true;}const noForced=!(await db.rows.get('outer'))&&!(await db.rows.get('inner'));await db.rows.where('group').equals(1).modify({name:'modified'});await db.rows.where('group').equals(2).delete();return{forced,noForced};},
 reopened:async()=>{const reopened=await EncryptedWorkspaceSession.open(store,scope,key,validate);try{return reopened.read();}finally{reopened.lock();}}
 };
 current=state;window.fixture=state;document.getElementById('close').onclick=()=>{gate.lock();session.lock();};return true;
};
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, plugins: [{ name: 'encrypted-storage-acceptance', configureServer(instance) {
  instance.middlewares.use('/__encrypted-storage', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await instance.transformIndexHtml('/__encrypted-storage', harness)); });
} }] });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors: string[] = [], external: string[] = [];
page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
const call = (method: string, arg?: string) => page.evaluate(async ({ method, arg }) => (window as any).fixture[method](arg), { method, arg });
const setup = async () => { await page.evaluate(() => (window as any).setup()); await page.waitForFunction(() => (window as any).fixture.events.length > 0); };
const summary = () => call('summary');
const waitSettled = () => page.waitForFunction(() => (window as any).fixture.operations.every((operation: any) => operation.status !== 'pending'));
const out = '/tmp/encrypted-storage-browser'; await mkdir(out, { recursive: true });
try {
  await page.goto(origin + '/__encrypted-storage'); await page.waitForFunction(() => typeof (window as any).setup === 'function'); await setup();
  await call('hold'); const writing = await call('startWrite', 'after'); await page.evaluate(() => (window as any).fixture.ready);
  const reading = await call('startRead'); await page.getByLabel('Unrelated text input').fill('Fictional typing while storage is pending'); await page.getByLabel('Unrelated text input').focus();
  let state = await summary(); assert.equal(state.operations[writing].status, 'pending'); assert.equal(state.operations[reading].status, 'pending'); assert.equal(state.visible, 'before'); assert.equal(state.durable.records[0].name, 'before'); assert.equal(state.writes, 0);
  await call('release'); await waitSettled(); await page.waitForFunction(() => (window as any).fixture.events.at(-1)[0].name === 'after'); state = await summary(); assert.equal(state.operations[writing].status, 'accepted'); assert.equal(state.operations[reading].value.name, 'after'); assert.equal(state.writes, 1);
  assert.deepEqual(await call('ordinary'), { forced: true, noForced: true }); assert.equal((await call('reopened')).records[0].name, 'modified');
  // Repeated attempts queued before an identity change cannot acquire the replacement actor's context.
  await setup(); await call('hold'); await call('startWrite', 'old teacher'); await page.evaluate(() => (window as any).fixture.ready); await call('startWrite', 'repeated old intent'); await call('startRead'); await call('changeTeacher'); await call('release'); await waitSettled(); state = await summary(); assert.equal(state.writes, 0); assert.equal(state.locked, true); assert.ok(state.operations.every((operation: any) => operation.status === 'rejected')); assert.equal(state.durable.records[0].name, 'before');
  // Closing while persistence is pending rejects acknowledgment and every later reader.
  await setup(); await call('hold'); await call('startWrite', 'close interrupted'); await page.evaluate(() => (window as any).fixture.ready); await call('startRead'); await page.getByRole('button', { name: 'Close synthetic workspace' }).click(); await call('release'); await waitSettled(); await call('startRead'); await waitSettled(); state = await summary(); assert.equal(state.writes, 0); assert.equal(state.locked, true); assert.ok(state.operations.every((operation: any) => operation.status === 'rejected'));
  // A durable commit with a lost reply is accepted once on disk, never replayed from the RAM queue.
  await setup(); await call('loseReply'); await call('startWrite', 'durable despite lost reply'); await waitSettled(); await call('startWrite', 'must not duplicate'); await call('startRead'); await waitSettled(); state = await summary(); assert.equal(state.writes, 1); assert.equal(state.locked, true); assert.ok(state.operations.every((operation: any) => operation.status === 'rejected')); assert.equal((await call('reopened')).records[0].name, 'durable despite lost reply'); assert.doesNotMatch(state.ciphertext, /durable despite lost reply|Fictional/);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(out + '/results.json', JSON.stringify({ status: 'PASS', engine: 'Chromium via Vite ESM', checks: ['encrypted CAS before acknowledgment/live query', 'pending readers blocked', 'unrelated focus/typing does not save', 'forced nested transaction rollback', 'collection mutation and encrypted reopen', 'queued identity changes reject stale intents', 'close rejects pending acknowledgment and reads', 'lost reply commits once with no replay', 'synthetic keys and rows only; no App activation or external requests'] }, null, 2));
  console.log('PASS encrypted storage: actual Chromium/Vite, pending reads/liveQuery/acknowledgment, nested rollback, encrypted reopen, repeated/identity/close interruption and uncertain commit without replay; synthetic fixture only.');
} finally { await browser.close(); await server.close(); }
