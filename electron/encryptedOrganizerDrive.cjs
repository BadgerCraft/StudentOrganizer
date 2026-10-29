// Protected-mode personal transport. Crypto and keys remain in the main-process host.
// The injected host MUST be controller.transferHost, whose callbacks enforce canonical
// snapshot validation and the main-bound actor's full-workspace transfer authority.
// This adapter never falls back to the legacy plaintext purpose or file namespace.
const { createOrganizerDrive, MAX_BYTES } = require('./organizerDrive.cjs');
const { DriveError } = require('./captureDrive.cjs');
const MESSAGE='Encrypted personal sync could not be verified. Keep sync off, unlock the verified workspace and refresh private versions before retrying.';
const failure=(code='invalid')=>Object.assign(new DriveError(MESSAGE),{code});
function createEncryptedOrganizerDrive({ host, parseEnvelope, ...options }) {
  if(!host||!['status','sealTransfer','openTransfer','captureTransferContext','assertTransferContext'].every(key=>typeof host[key]==='function'))throw failure('setup');
  if(!parseEnvelope){try{parseEnvelope=require('./generated/encryption/shared/encryption/index.js').parseEnvelope;}catch{throw failure('setup');}}
  if(typeof parseEnvelope!=='function')throw failure('setup');
  function scope(){
    const value=host.status();
    if(!value||value.state!=='unlocked'||value.appId!=='student-organizer'||typeof value.vaultId!=='string'||!Number.isSafeInteger(value.keyVersion)||value.keyVersion<1)throw failure('auth');
    return {appId:value.appId,vaultId:value.vaultId,keyVersion:value.keyVersion};
  }
  function checked(id,text,expected){
    const envelope=parseEnvelope(text),context=envelope.context;
    if(context.appId!==expected.appId||context.vaultId!==expected.vaultId||context.keyVersion!==expected.keyVersion||context.purpose!=='transfer'||context.recordId!=='drive/'+id||!Number.isSafeInteger(context.revision)||context.revision<1)throw failure();
    return envelope;
  }
  function validatePrimary(text){
    if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)throw failure();
    let value;try{value=JSON.parse(text);}catch{throw failure();}
    if(!value||value.schemaVersion!==5||value.version!==2||!value.tables||typeof value.tables!=='object'||Array.isArray(value.tables))throw failure();
    return value;
  }
  async function guarded(action){try{return await action();}catch(error){if(error?.code==='auth')transport?.disconnect();if(error instanceof DriveError)throw error;throw failure();}}
  const transport=createOrganizerDrive({...options,codec:{
    purpose:'personal-sync-encrypted-v1',namePrefix:'StudentOrganizer-Encrypted-',
    capture:async()=>{const expected=scope();try{const token=await host.captureTransferContext();await host.assertTransferContext(token);return Object.freeze({token,scope:expected});}catch{throw failure('auth');}},
    assertCurrent:async ticket=>{try{await host.assertTransferContext(ticket.token);if(JSON.stringify(scope())!==JSON.stringify(ticket.scope))throw failure('auth');}catch{throw failure('auth');}},
    validateUpload:async text=>{scope();validatePrimary(text);},
    seal:async(id,text)=>guarded(async()=>{
      const expected=scope();validatePrimary(text);
      // Host independently validates canonical records/bytes and current export authority.
      const result=await host.sealTransfer(id,text);
      if(!result||typeof result.ciphertext!=='string')throw failure();
      const envelope=checked(id,result.ciphertext,expected);if(envelope.context.revision!==result.revision)throw failure();
      const current=scope();if(JSON.stringify(current)!==JSON.stringify(expected))throw failure('auth');return result.ciphertext;
    }),
    open:async(id,text,selection)=>guarded(async()=>{
      const expected=scope();checked(id,text,expected);
      if(!selection||typeof selection.version!=='string'||!/^[1-9]\d*$/.test(selection.version)||typeof selection.sha256Checksum!=='string'||!/^[a-f0-9]{64}$/.test(selection.sha256Checksum))throw failure();
      // The transport just verified this explicitly selected immutable file's metadata,
      // hash and bytes before and after download. Deliberate historical review is allowed.
      const json=await host.openTransfer(id,text,Object.freeze({...selection}));validatePrimary(json);
      const current=scope();if(JSON.stringify(current)!==JSON.stringify(expected))throw failure('auth');return json;
    })
  }});
  const status=()=>{const unlocked=host.status()?.state==='unlocked';const value=transport.status();return {...value,connected:value.connected&&unlocked,protection:'encrypted-v1',workspaceUnlocked:unlocked};};
  return Object.freeze({
    status,
    disconnect:()=>({...transport.disconnect(),protection:'encrypted-v1',workspaceUnlocked:host.status()?.state==='unlocked'}),
    connect:()=>guarded(async()=>{scope();await transport.connect();return status();}),
    list:()=>guarded(async()=>{scope();return transport.list();}),
    download:id=>guarded(async()=>{scope();return transport.download(id);}),
    upload:text=>guarded(async()=>{scope();return transport.upload(text);})
  });
}
module.exports={createEncryptedOrganizerDrive};
