import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
const require=createRequire(import.meta.url);
const {createOrganizerDrive}=require('../../electron/organizerDrive.cjs');
function fixture(options:{configured?:boolean;shared?:boolean;changed?:boolean;uploadFailure?:boolean;unsafeSession?:boolean}={}) {
 const owner='fictional-owner',files=new Map<string,{text:string;metadata:Record<string,unknown>}>();
 const calls:{url:string;init:RequestInit}[]=[];let pending:Record<string,unknown>|null=null;let checks=0,auths=0;
 const client=createOrganizerDrive({configured:()=>options.configured!==false,now:()=>Date.parse('2026-10-27T00:00:00Z'),authorize:async()=>{auths++;return{token:'fictional-memory-token',expiresAt:Date.parse('2026-10-28T00:00:00Z')};},fetchImpl:async(input:string,init:RequestInit)=>{
  calls.push({url:input,init});const url=new URL(input);
  if(url.pathname.startsWith('/upload/')) {
   if(options.uploadFailure)throw new Error('network interruption');
   if(init.method==='POST'){pending=JSON.parse(String(init.body));return new Response(null,{headers:{location:options.unsafeSession?'https://untrusted.invalid/upload':'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fictional'}});}
   const metadata=pending!;const text=String(init.body);
   files.set(String(metadata.id),{metadata,text});return Response.json({id:metadata.id});
  }
  if(url.pathname.endsWith('/about'))return Response.json({user:{permissionId:owner}});
  if(url.pathname.endsWith('/root'))return Response.json({id:'root-id'});
  if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['version-'+(files.size+1)]});
  if(url.pathname.endsWith('/permissions'))return Response.json({permissions:[{id:owner,type:'user',role:'owner'}]});
  const id=url.pathname.split('/').at(-1)!;const f=files.get(id);
  if(f) {
   if(url.searchParams.get('alt')==='media')return new Response(f.text);
   checks++;return Response.json({...f.metadata,parents:['root-id'],ownedByMe:true,shared:options.shared??false,trashed:false,owners:[{permissionId:owner}],size:String(Buffer.byteLength(f.text)),sha256Checksum:createHash('sha256').update(f.text).digest('hex'),version:options.changed&&checks>1?'2':'1'});
  }
  return Response.json({files:[...files].map(([id,f])=>({id,name:f.metadata.name,modifiedTime:'2026-10-27T00:00:00Z'}))});
 }});
 return {client,calls,auths:()=>auths};
}
const snapshot=JSON.stringify({version:2,schemaVersion:5,tables:{students:[]},exportedAt:'2026-10-27T00:00:00Z'});
describe('personal Drive snapshot boundary',()=>{
 it('is unavailable without separate setup and never starts OAuth',async()=>{const f=fixture({configured:false});await expect(f.client.connect()).rejects.toThrow('not been approved');expect(f.auths()).toBe(0);expect(f.calls).toHaveLength(0);});
 it('creates immutable verified private versions on fixed origins without exposing credentials',async()=>{
  const f=fixture();await f.client.connect();const first=await f.client.upload(snapshot),second=await f.client.upload(snapshot);
  expect(first.id).not.toBe(second.id);expect((await f.client.list()).length).toBe(2);expect((await f.client.download(first.id)).json).toBe(snapshot);
  expect(f.calls.every(c=>new URL(c.url).origin==='https://www.googleapis.com'&&c.init.redirect==='error')).toBe(true);
  expect(f.calls.filter(c=>c.init.method==='POST')).toHaveLength(2);expect(f.calls.filter(c=>c.init.method==='PUT')).toHaveLength(2);expect(f.calls.some(c=>['DELETE','PATCH'].includes(c.init.method??''))).toBe(false);
  expect(JSON.stringify([f.client.status(),first,second])).not.toContain('fictional-memory-token');
 });
 it('rejects shared or concurrently changed uploaded versions',async()=>{
  for(const options of [{shared:true},{changed:true}]){const f=fixture(options);await f.client.connect();await expect(f.client.upload(snapshot)).rejects.toThrow(/shared|changed/);}
 });
 it('reports uncertain upload without deleting local or remote files or retrying automatically',async()=>{
  const f=fixture({uploadFailure:true});await f.client.connect();await expect(f.client.upload(snapshot)).rejects.toThrow('outcome is uncertain');expect(f.calls.filter(c=>c.init.method==='POST')).toHaveLength(1);
 });
 it('does not send snapshot bytes to an untrusted resumable-session URL',async()=>{
  const f=fixture({unsafeSession:true});await f.client.connect();await expect(f.client.upload(snapshot)).rejects.toThrow('untrusted upload session');expect(f.calls.some(c=>c.init.method==='PUT')).toBe(false);expect(f.calls.some(c=>c.url.includes('untrusted.invalid'))).toBe(false);
 });
 it('rejects arbitrary download targets and drops session access on disconnect',async()=>{
  const f=fixture();await f.client.connect();await expect(f.client.download('https://evil.invalid')).rejects.toThrow('listed version');f.client.disconnect();expect(f.client.status().connected).toBe(false);await expect(f.client.upload(snapshot)).rejects.toThrow('expired');
 });
});
