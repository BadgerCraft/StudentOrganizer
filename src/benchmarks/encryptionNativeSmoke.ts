import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Synthetic keys/bytes in a disposable profile only; no teacher profile or real-device provisioning.
if (process.platform !== 'win32') throw new Error('Packaged encryption probe targets Windows CI.');
const profile=await mkdtemp(path.join(os.tmpdir(),'organizer-encryption-probe-'));
const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>typeof v[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe'),args:[`--user-data-dir=${profile}`],env,timeout:45000});
try{
 const result=await app.evaluate(async({app},profile)=>{
  const path=(process as any).getBuiltinModule('path'),fs=(process as any).getBuiltinModule('fs'),{DatabaseSync}=(process as any).getBuiltinModule('node:sqlite');
  const require=(process as any).getBuiltinModule('module').createRequire(path.join(app.getAppPath(),'package.json'));
  if(typeof DatabaseSync!=='function')throw Error('Packaged SQLite unavailable');
  const root=app.getAppPath();const cryptoApi=require(path.join(root,'electron/generated/encryption/shared/encryption/index.js'));
  const {createSqliteEncryptedVaultStore}=require(path.join(root,'electron/sqliteEncryptedVaultStore.cjs'));
  const scope={appId:'student-organizer',vaultId:'fictional-native-probe',keyVersion:1};const directory=path.join(profile,'encrypted-probe');
  const key=cryptoApi.generateMasterKey();const bytes=new TextEncoder().encode('FICTIONAL_ENCRYPTED_NATIVE_MARKER_20261029');
  const context={...scope,purpose:'working-data',recordId:'workspace',revision:1};
  const store=createSqliteEncryptedVaultStore({directory,scope});
  const first={revision:1,ciphertext:await cryptoApi.encryptBytes(key,context,bytes)};await store.commit(null,first);
  const reopened=createSqliteEncryptedVaultStore({directory,scope});const saved=await reopened.read();if(saved.revision!==1||saved.ciphertext!==first.ciphertext)throw Error('Committed bytes differ');
  const plain=await cryptoApi.decryptBytes(key,context,saved.ciphertext);if(new TextDecoder().decode(plain)!==new TextDecoder().decode(bytes))throw Error('Decrypt mismatch');
  let stale=false;try{await reopened.commit(null,first);}catch{stale=true;}if(!stale)throw Error('Stale CAS accepted');
  const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});const integrity=db.prepare('PRAGMA integrity_check').get();db.close();if(Object.values(integrity)[0]!=='ok')throw Error('SQLite integrity failed');
  for(const name of fs.readdirSync(directory)){const data=fs.readFileSync(path.join(directory,name));if(data.includes(Buffer.from(bytes)))throw Error('Plaintext leaked into storage');}
  const {createSqliteProtectedKeyStore}=require(path.join(root,'electron/sqliteProtectedKeyStore.cjs'));
  const {createPlatformKeyringStore}=require(path.join(root,'electron/platformKeyringStore.cjs'));
  const registry=createSqliteProtectedKeyStore({directory:path.join(profile,'protected-profile'),scope});
  const protectedKeys=createPlatformKeyringStore({configured:true,platform:'win32',withExclusiveProfileLock:registry.withExclusiveProfileLock,localProtectedStorage:registry});
  if(!await protectedKeys.available())throw Error('Packaged DPAPI provider unavailable');
  await protectedKeys.save(scope,key);const recovered=await protectedKeys.load(scope);
  if(!recovered||!Buffer.from(recovered).equals(Buffer.from(key)))throw Error('Packaged protected key did not reopen');recovered.fill(0);
  const nativeLedger=require(path.join(root,'electron/generated/windowsCredentialLedger.node'));
  const target='TeacherVaultLedgerQAV1-'+require('node:crypto').randomBytes(32).toString('hex');
  try{if(nativeLedger.read(target)!==null)throw Error('Unexpected synthetic receipt');const receipt=Buffer.from(JSON.stringify({synthetic:true,revision:1,hash:'a'.repeat(64)}));nativeLedger.write(target,receipt);if(!nativeLedger.read(target).equals(receipt))throw Error('Packaged native receipt mismatch');}finally{nativeLedger.removeSynthetic(target);}
  for(const name of fs.readdirSync(path.join(profile,'protected-profile'))){const data=fs.readFileSync(path.join(profile,'protected-profile',name));if(data.includes(Buffer.from(key))||data.includes(Buffer.from(key).toString('base64')))throw Error('Clear master leaked into protected profile');}
  key.fill(0);plain.fill(0);bytes.fill(0);return{status:'PASS',electron:process.versions.electron,node:process.versions.node,sqlite:process.versions.sqlite,checks:['actual packaged SQLite','encrypted commit and reopen','stale CAS rejection','integrity check','no plaintext marker in database sidecars','actual packaged nested DPAPI key roundtrip','actual packaged local credential receipt roundtrip'],limits:['synthetic data','isolated synthetic OS metadata only; temporary profile and QA receipt removed','not a power-loss test']};
 },profile);
 assert.equal(result.status,'PASS');await mkdir('release/qa-evidence/encryption',{recursive:true});await writeFile('release/qa-evidence/encryption/native-sqlite.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.close();await rm(profile,{recursive:true,force:true});}
