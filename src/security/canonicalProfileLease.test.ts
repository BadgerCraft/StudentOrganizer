import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as cryptoRuntime from '../../shared/encryption';
const require = createRequire(import.meta.url), { createCanonicalProfileLease } = require('../../electron/canonicalProfileLease.cjs');
const { createProtectedRevisionLedger } = require('../../electron/protectedRevisionLedger.cjs'), { createPendingEncryptedCommit } = require('../../electron/pendingEncryptedCommit.cjs'), { createSqliteEncryptedVaultStore } = require('../../electron/sqliteEncryptedVaultStore.cjs');
const directories: string[] = [], children: ChildProcessWithoutNullStreams[] = [];
const scope = { appId:'canonical-lease-test', vaultId:'fictional-copied-vault', keyVersion:1 };
beforeAll(()=>execFileSync(process.execPath,['scripts/buildEncryptionNative.cjs']));
afterEach(async()=>{
  for(const child of children.splice(0)) if(child.exitCode===null&&child.signalCode===null) { child.kill(); await new Promise<void>(resolve=>child.once('close',()=>resolve())); }
  for(const directory of directories.splice(0)) await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
async function fixture() {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'fictional-canonical-profile-'));directories.push(directory);
  const root=path.join(directory,'profile'),a=path.join(directory,'workspace-A'),b=path.join(directory,'workspace-B');
  await Promise.all([root,a,b].map(dir=>fs.mkdir(dir,{mode:0o700})));
  const factory=createCanonicalProfileLease({canonicalProfileRoot:root,scope});return{directory,root,a,b,factory,left:factory.forWorkspace(a),right:factory.forWorkspace(b)};
}
describe('canonical profile leases outside movable workspaces',()=>{
  it('shares one real registry across copied paths and rejects cross-binding or expired lease use',async()=>{
    const f=await fixture();
    expect(()=>f.left.assertProfileLease()).toThrow();await expect(f.left.read('protected-slot')).rejects.toThrow();
    await f.left.withExclusiveProfileLock(async()=>{
      expect(()=>f.left.assertProfileLease()).not.toThrow();expect(()=>f.right.assertProfileLease()).toThrow();await expect(f.right.create('bad-slot',new Uint8Array([1]))).rejects.toThrow();
      await f.left.create('protected-slot',new Uint8Array([7,8]));
    });
    expect(()=>f.left.assertProfileLease()).toThrow();await f.right.withExclusiveProfileLock(async()=>expect(await f.right.read('protected-slot')).toEqual(new Uint8Array([7,8])));
    const reopened=createCanonicalProfileLease({canonicalProfileRoot:f.root,scope}).forWorkspace(f.a);await reopened.withExclusiveProfileLock(async()=>expect(await reopened.read('protected-slot')).toEqual(new Uint8Array([7,8])));
    expect(await fs.readdir(f.a)).toEqual([]);expect(await fs.readdir(f.b)).toEqual([]);expect(await fs.readdir(f.root)).toEqual(['canonical-encryption-v1']);
  });
  it('serializes same-process factories and ancestor aliases using the physical canonical root',async()=>{
    const f=await fixture(),alias=path.join(f.directory,'alias');await fs.symlink(f.directory,alias,process.platform==='win32'?'junction':'dir');
    const other=createCanonicalProfileLease({canonicalProfileRoot:path.join(alias,'profile'),scope}).forWorkspace(path.join(alias,'workspace-B'));
    let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),order:string[]=[];
    const first=f.left.withExclusiveProfileLock(async()=>{order.push('A-enter');entered();await held;order.push('A-exit');});await started;
    const second=other.withExclusiveProfileLock(async()=>{order.push('B-enter');});await Promise.resolve();expect(order).toEqual(['A-enter']);release();await Promise.all([first,second]);expect(order).toEqual(['A-enter','A-exit','B-enter']);
  });
  it('rejects overlapping or leaf-linked locations before creating a registry',async()=>{
    const f=await fixture();expect(()=>f.factory.forWorkspace(f.root)).toThrow();expect(()=>f.factory.forWorkspace(f.directory)).toThrow();
    const nested=path.join(f.root,'nested');await fs.mkdir(nested,{mode:0o700});expect(()=>f.factory.forWorkspace(nested)).toThrow();
    const link=path.join(f.directory,'workspace-link');await fs.symlink(f.a,link,process.platform==='win32'?'junction':'dir');expect(()=>f.factory.forWorkspace(link)).toThrow();
    const rootLink=path.join(f.directory,'profile-link');await fs.symlink(f.root,rootLink,process.platform==='win32'?'junction':'dir');expect(()=>createCanonicalProfileLease({canonicalProfileRoot:rootLink,scope})).toThrow();
    expect((await fs.readdir(f.root)).sort()).toEqual(['nested']);
  });
  it('revokes a closed binding across awaits and rolls back its uncommitted registry insert',async()=>{
    const f=await fixture();await expect(f.left.withExclusiveProfileLock(async()=>{await f.left.create('cancelled-slot',new Uint8Array([5]));f.left.close();})).rejects.toThrow();
    await f.right.withExclusiveProfileLock(async()=>expect(await f.right.read('cancelled-slot')).toBeNull());await expect(f.left.initialize()).rejects.toThrow();
  });
  it.each(['workspace','root'])('detects %s replacement across an awaited lease without adopting the new path',async location=>{
    const f=await fixture();const selected=location==='workspace'?f.a:f.root;
    await expect(f.left.withExclusiveProfileLock(async()=>{await fs.rename(selected,selected+'-old');await fs.mkdir(selected,{mode:0o700});f.left.assertProfileLease();})).rejects.toThrow();
    expect(()=>f.left.assertCurrent()).toThrow();await expect(f.left.initialize()).rejects.toThrow();
  });
  it('expires a queued waiter without ever running its callback later and refuses nested leases',async()=>{
    const f=await fixture(),other=createCanonicalProfileLease({canonicalProfileRoot:f.root,scope,waitMilliseconds:10}).forWorkspace(f.b);
    let release!:()=>void,entered!:()=>void,called=false;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
    const first=f.left.withExclusiveProfileLock(async()=>{entered();await expect(f.right.withExclusiveProfileLock(async()=>{})).rejects.toThrow();await held;});await started;
    await expect(other.withExclusiveProfileLock(async()=>{called=true;})).rejects.toMatchObject({code:'CANONICAL_PROFILE_BUSY'});release();await first;await f.right.initialize();expect(called).toBe(false);
  });
  it('does not lend a live lease to an unrelated asynchronous call',async()=>{
    const f=await fixture();let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
    const first=f.left.withExclusiveProfileLock(async()=>{entered();await held;});await started;expect(()=>f.left.assertProfileLease()).toThrow();await expect(f.left.read('protected-slot')).rejects.toThrow();release();await first;
  });
  it('serializes separate-process copied workspaces and refuses a stale copy after the other advances the OS head',async()=>{
    const f=await fixture(),receipt=path.join(f.root,'synthetic-os-receipt.bin'),expectedFile=path.join(f.root,'synthetic-expected.json');
    const backend={read:async()=>{try{return new Uint8Array(await fs.readFile(receipt));}catch(e:any){if(e.code==='ENOENT')return null;throw e;}},write:async(_target:string,bytes:Uint8Array)=>{await fs.writeFile(receipt,bytes,{mode:0o600});}};
    const ledger=createProtectedRevisionLedger({scope,platform:'win32',assertProfileLease:f.left.assertProfileLease,loadWindowsBinding:()=>backend});
    const store=createSqliteEncryptedVaultStore({directory:f.a,scope,parseEnvelope:cryptoRuntime.parseEnvelope});
    const initial={revision:1,ciphertext:await cryptoRuntime.encryptBytes(new Uint8Array(32).fill(7),{...scope,purpose:'working-data',recordId:'workspace',revision:1},new Uint8Array([1]))};
    const coordinator=createPendingEncryptedCommit({scope,ledger,candidates:store,withExclusiveProfileLock:f.left.withExclusiveProfileLock,assertFreshEnrollment:()=>{if(initial.revision!==1)throw Error('synthetic enrollment missing');}});
    expect((await coordinator.commit(null,initial)).status).toBe('durable');const expected={revision:1,hash:createHash('sha256').update(initial.ciphertext).digest('hex')};await fs.writeFile(expectedFile,JSON.stringify(expected),{mode:0o600});await fs.cp(f.a,f.b,{recursive:true});
    const script=`
      const fs=require('node:fs/promises');const path=require('node:path');
      const {createCanonicalProfileLease}=require('./electron/canonicalProfileLease.cjs');
      const {createProtectedRevisionLedger}=require('./electron/protectedRevisionLedger.cjs');
      const {createPendingEncryptedCommit}=require('./electron/pendingEncryptedCommit.cjs');
      const {createSqliteEncryptedVaultStore}=require('./electron/sqliteEncryptedVaultStore.cjs');
      const crypto=require('./electron/generated/encryption/shared/encryption/index.js');
      (async()=>{const [root,workspace,kind]=process.argv.slice(1),scope=${JSON.stringify(scope)};
      const binding=createCanonicalProfileLease({canonicalProfileRoot:root,scope}).forWorkspace(workspace),receipt=path.join(root,'synthetic-os-receipt.bin');
      const ledger=createProtectedRevisionLedger({scope,platform:'win32',assertProfileLease:binding.assertProfileLease,loadWindowsBinding:()=>({read:async()=>new Uint8Array(await fs.readFile(receipt)),write:async(_t,bytes)=>fs.writeFile(receipt,bytes)})});
      const candidates=createSqliteEncryptedVaultStore({directory:workspace,scope,parseEnvelope:crypto.parseEnvelope});
      let leaseEntered=false;const coordinator=createPendingEncryptedCommit({scope,ledger,candidates,withExclusiveProfileLock:fn=>binding.withExclusiveProfileLock(async()=>{leaseEntered=true;if(kind==='A'){process.stdout.write('held\\n');await new Promise(resolve=>process.stdin.once('data',resolve));}return fn();})});
      const next={revision:2,ciphertext:await crypto.encryptBytes(new Uint8Array(32).fill(7),{...scope,purpose:'working-data',recordId:'workspace',revision:2},new Uint8Array([kind==='A'?2:3]))};
      process.stdout.write('attempt\\n');const result=await coordinator.commit(JSON.parse(await fs.readFile(path.join(root,'synthetic-expected.json'),'utf8')),next);process.stdout.write(JSON.stringify({...result,leaseEntered})+'\\n');
      })().catch(()=>{process.stderr.write('synthetic-child-failed');process.exitCode=1;});`;
    function start(workspace:string,kind:string){
      const child=spawn(process.execPath,['--no-warnings','-e',script,f.root,workspace,kind],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});children.push(child);let output='',error='';const waiters:{text:string;resolve:()=>void}[]=[];
      child.stdout.on('data',part=>{output+=part;for(const waiter of [...waiters])if(output.includes(waiter.text)){waiters.splice(waiters.indexOf(waiter),1);waiter.resolve();}});child.stderr.on('data',part=>{error+=part;});
      const done=new Promise<any>((resolve,reject)=>child.once('close',code=>{if(code!==0)return reject(Error(error||'synthetic child failed'));try{resolve(JSON.parse(output.trim().split('\n').at(-1)!));}catch{reject(Error('synthetic child omitted result'));}}));
      return{child,done,wait:(text:string)=>output.includes(text)?Promise.resolve():new Promise<void>(resolve=>waiters.push({text,resolve}))};
    }
    const left=start(f.a,'A');await left.wait('held\n');const right=start(f.b,'B');await right.wait('attempt\n');left.child.stdin.end('release\n');const [a,b]=await Promise.all([left.done,right.done]);
    expect(a.status).toBe('durable');expect(b.leaseEntered).toBe(true);expect(b.status).toBe('uncertain');expect((await store.read()).revision).toBe(2);const copied=createSqliteEncryptedVaultStore({directory:f.b,scope,parseEnvelope:cryptoRuntime.parseEnvelope});expect((await copied.read()).revision).toBe(1);
    await f.left.withExclusiveProfileLock(async()=>expect((await ledger.read()).head).toEqual(a.head));
  },30000);
});
