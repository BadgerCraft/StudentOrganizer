import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { clearActiveTeacherId, selectActingTeacher, getIdentityEpoch } from '../services/identityService';
import { MarkingService } from './markingService';
import { parseMarkingFiles, sha256 } from './importDocuments';
import { strToU8, zipSync } from 'fflate';
import type { MarkingActor } from './types';

describe('marking records participate in atomic Organizer recovery',()=>{
 let db:OntarioTeacherDB,service:MarkingService,portability:PortabilityService,actor:MarkingActor;
 beforeEach(async()=>{
  db=new OntarioTeacherDB(`marking-recovery-${crypto.randomUUID()}`);await seedDatabase(db);
  const template=(await db.assessments.get('assess-eng-essay'))!;await db.assessments.add({...template,id:'recovery-essay',code:'RECOVERY'});
  const categories=await db.assessmentCategories.where('assessmentId').equals(template.id).toArray();
  await db.assessmentCategories.bulkAdd(categories.map(c=>({...c,id:`recovery-${c.categoryCode}`,assessmentId:'recovery-essay'})));
  const identity=await selectActingTeacher(db,'user-tyler');actor={userId:identity.userId,deviceId:identity.deviceId,epoch:getIdentityEpoch()};
  service=new MarkingService(db);portability=new PortabilityService(db);
 });
 afterEach(async()=>{clearActiveTeacherId();await db.delete();});
 async function fixture(){
  const rubric=await service.saveRubric('recovery-essay',{title:'Fictional rubric',levels:['3'],criteria:[{id:'reason',name:'Reasoning',categoryCode:'T',descriptors:{'3':'Clear reasoning'}}]},actor);
  const files=await parseMarkingFiles([new File(['Fictional essay.\r\nRepeated phrase.'],'fictional.txt')]);
  const enr=(await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
  const attempt=await service.importAttempt('recovery-essay',rubric.id,files.documents,enr.id,null,actor);
  const session=await service.openSession(attempt.id,actor);
  const saved=await service.saveDraft(session.id,{...session.draft,overallFeedback:'Fictional feedback-only result'},session.version,actor);
  const commit=await service.finalize(saved.id,saved.version,actor);
  const revision=await service.openSession(attempt.id,actor);return {attempt,commit,revision};
 }
 it('roundtrips originals, feedback-only commits and draft revisions without changing official feedback',async()=>{
  const f=await fixture();const json=await portability.createFullBackupJSON();expect(JSON.parse(json).schemaVersion).toBe(4);
  const other=new OntarioTeacherDB(`restore-${crypto.randomUUID()}`);
  try{await new PortabilityService(other).restoreFromJSON(json);expect(await other.markingAttempts.get(f.attempt.id)).toEqual(f.attempt);expect(await other.markingCommits.get(f.commit.id)).toEqual(f.commit);expect(await other.markingSessions.get(f.revision.id)).toEqual(f.revision);expect((await other.studentAssessments.get(f.commit.studentAssessmentId))?.overallFeedback).toBe('Fictional feedback-only result');}finally{await other.delete();}
 });
 it('rejects cross-student commit and modified original bytes before touching records',async()=>{
  const f=await fixture();const json=await portability.createFullBackupJSON();
  for(const mutation of [(b:any)=>{b.tables.markingCommits[0].studentAssessmentId='missing';},(b:any)=>{b.tables.markingAttempts[0].documents[0].original.hash='0'.repeat(64);},(b:any)=>{b.tables.markingAttempts[0].classSectionId='class-nonexistent';}]){
   const data=JSON.parse(json);mutation(data);await expect(portability.restoreFromJSON(JSON.stringify(data))).rejects.toThrow();expect(await db.markingCommits.get(f.commit.id)).toEqual(f.commit);expect(await db.markingAttempts.get(f.attempt.id)).toEqual(f.attempt);
  }
 });
 it('rejects independently valid hashes for mismatched DOCX text before replacing live data',async()=>{
  const f=await fixture();
  const bytes=zipSync({
   '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
   '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
   'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fictional original essay.</w:t></w:r></w:p></w:body></w:document>')
  });
  const parsed=await parseMarkingFiles([new File([new Uint8Array(bytes)],'fictional.docx')]);
  expect(parsed.errors).toEqual([]);
  const attempt=await service.importAttempt('recovery-essay',f.attempt.rubricId,parsed.documents,null,null,actor);
  const backup=JSON.parse(await portability.createFullBackupJSON());
  const document=backup.tables.markingAttempts.find((row:any)=>row.id===attempt.id).documents[0];
  document.text='A different fictional essay.';
  document.hash=await sha256(new TextEncoder().encode(document.text));
  const before=await db.students.toArray();
  await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow('normalized marking text do not match');
  expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
  expect(await db.students.toArray()).toEqual(before);
 });
 it('restores genuine version2/3 backups with additive empty marking tables',async()=>{
  for(const version of [2,3]){const original=JSON.parse(await portability.createFullBackupJSON());original.schemaVersion=version;for(const name of ['markingRubrics','markingAttempts','markingSessions','markingCommits'])delete original.tables[name];const before=await db.students.toArray();await portability.restoreFromJSON(JSON.stringify(original));expect(await db.students.toArray()).toEqual(before);expect(await db.markingAttempts.count()).toBe(0);}
 });
 it('rolls back a failed marking insert across all restored tables',async()=>{
  await fixture();const json=await portability.createFullBackupJSON();await db.markingSessions.clear();const before=await db.students.toArray();const fail=()=>{throw new Error('fictional storage failure');};db.markingSessions.hook('creating',fail);
  try{await expect(portability.restoreFromJSON(json)).rejects.toThrow('fictional storage failure');expect(await db.students.toArray()).toEqual(before);expect(await db.markingSessions.count()).toBe(0);}finally{db.markingSessions.hook('creating').unsubscribe(fail);}
 });
});
