import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Synthetic encrypted bytes only; no OS-key provisioning or teacher profile is opened.
if (process.platform !== 'win32') throw new Error('Packaged encryption probe targets Windows CI.');
const profile=await mkdtemp(path.join(os.tmpdir(),'organizer-encryption-probe-'));
const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>typeof v[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe'),args:[`--user-data-dir=${profile}`],env,timeout:45000});
try{
 const result=await app.evaluate(async({app},profile)=>{
  const path=require('node:path'),fs=require('node:fs'),{DatabaseSync}=require('node:sqlite');
  if(typeof DatabaseSync!=='function')throw Error('Packaged SQLite unavailable');
  const root=app.getAppPath();const cryptoApi=require(path.join(root,'electron/generated/encryption/shared/encryption/index.js'));
  const {createSqliteEncryptedVaultStore}=require(path.join(root,'electron/sqliteEncryptedVaultStore.cjs'));
  const scope={appId:'student-organizer',vaultId:'fictional-native-probe',keyVersion:1};const directory=path.join(profile,'encrypted-probe');
  const key=cryptoApi.generateMasterKey();const bytes=new TextEncoder().encode('FICTIONAL_ENCRYPTED_NATIVE_MARKER_20261029');
  const context=(revision:number)=>({...scope,purpose:'working-data',recordId:'workspace',revision});
  const store=createSqliteEncryptedVaultStore({directory,scope});
  const first={revision:1,ciphertext:await cryptoApi.encryptBytes(key,context(1),bytes)};await store.commit(null,first);
  const reopened=createSqliteEncryptedVaultStore({directory,scope});const saved=await reopened.read();if(saved.revision!==1||saved.ciphertext!==first.ciphertext)throw Error('Committed bytes differ');
  const plain=await cryptoApi.decryptBytes(key,context(1),saved.ciphertext);if(new TextDecoder().decode(plain)!==new TextDecoder().decode(bytes))throw Error('Decrypt mismatch');
  let stale=false;try{await reopened.commit(null,first);}catch{stale=true;}if(!stale)throw Error('Stale CAS accepted');
  const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});const integrity=db.prepare('PRAGMA integrity_check').get();db.close();if(Object.values(integrity)[0]!=='ok')throw Error('SQLite integrity failed');
  for(const name of fs.readdirSync(directory)){const data=fs.readFileSync(path.join(directory,name));if(data.includes(Buffer.from(bytes)))throw Error('Plaintext leaked into storage');}
  key.fill(0);plain.fill(0);bytes.fill(0);return{status:'PASS',electron:process.versions.electron,node:process.versions.node,sqlite:process.versions.sqlite,checks:['actual packaged SQLite','encrypted commit and reopen','stale CAS rejection','integrity check','no plaintext marker in database sidecars'],limits:['synthetic data','no OS-key provisioning','not a power-loss test']};
 },profile);
 assert.equal(result.status,'PASS');await mkdir('release/qa-evidence/encryption',{recursive:true});await writeFile('release/qa-evidence/encryption/native-sqlite.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.close();await rm(profile,{recursive:true,force:true});}
