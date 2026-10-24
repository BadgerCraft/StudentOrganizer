import '/workspace/StudentOrganizer/node_modules/fake-indexeddb/auto/index.mjs';
import { OntarioTeacherDB } from '/workspace/StudentOrganizer/src/db/database.ts';
import { seedDatabase } from '/workspace/StudentOrganizer/src/db/seeds.ts';
import { selectActingTeacher, getIdentityEpoch, clearActiveTeacherId } from '/workspace/StudentOrganizer/src/services/identityService.ts';
import { CaptureAttachmentService } from '/workspace/StudentOrganizer/src/capture/attachmentService.ts';
import { MarkingService } from '/workspace/StudentOrganizer/src/marking/markingService.ts';
import { captureSha256, capturePagePath, encodeCapturePackage, decodeCapturePackage } from '/workspace/StudentOrganizer/shared/capturePackage.ts';
(async()=>{
const db=new OntarioTeacherDB('review-capture-size-'+crypto.randomUUID());
try {
await seedDatabase(db); const identity=await selectActingTeacher(db,'user-tyler');
const actor={...identity,identityEpoch:getIdentityEpoch()}, ma={...identity,epoch:getIdentityEpoch()};
const service=new CaptureAttachmentService(db), marking=new MarkingService(db);
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
const chunk=new Uint8Array(7*1024*1024), view=new DataView(chunk.buffer);view.setUint32(0,chunk.length-12);chunk.set(new TextEncoder().encode('tEXt'),4);
let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}view.setUint32(chunk.length-4,(crc^0xffffffff)>>>0);
const bytes=new Uint8Array(png.length+chunk.length);bytes.set(png.subarray(0,-12));bytes.set(chunk,png.length-12);bytes.set(png.subarray(-12),bytes.length-12);
const hash=await captureSha256(bytes);
const pages=Array.from({length:5},(_,order)=>({id:'page-'+order,order,path:capturePagePath('fictional-student','page-'+order,'image/png'),mime:'image/png' as const,byteLength:bytes.length,sha256:hash,edits:{rotation:0 as const,crop:{x:0,y:0,width:1,height:1}}}));
const manifest={format:'studentorganizer-capture' as const,version:2 as const,packageId:'fictional-package',assignmentId:'fictional-assignment',assignmentName:'Fictional photos',revision:1,completed:true as const,submissions:[{id:'fictional-student',label:'Fictional Student',pages}]};
const zip=await encodeCapturePackage(manifest,Object.fromEntries(pages.map(p=>[p.path,bytes])));const pkg=await decodeCapturePackage(zip);
const enrollment=(await service.context('assess-eng-essay',actor)).roster[0].enrollment.id;
const receipt=await service.confirm('assess-eng-essay',pkg,'fictional-student',enrollment,actor);
const rubric=await marking.saveRubric('assess-eng-essay',{title:'Fictional rubric',levels:['Developing','Secure'],criteria:[{id:'reason',name:'Reasoning',categoryCode:'K',descriptors:{Developing:'Some',Secure:'Clear'}}]},ma);
console.log(JSON.stringify({zipBytes:zip.length,originalBytes:bytes.length*5,attachmentCount:await db.captureAttachments.count(),receiptCount:await db.captureImportReceipts.count()}));
try {await marking.bindCaptureRoot(receipt.attachmentId,{rubricId:rubric.id},ma);throw new Error('Unexpected binding success');} catch(e){console.log('BIND RESULT:',String(e));}
console.log('marking attempts after failure',await db.markingAttempts.count());
}finally{clearActiveTeacherId();await db.delete();}
})();
