import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { applySnapshot, dataSignature, snapshotDigest, guardMergeRelationships, mergeSnapshots, readSnapshot, resolvePlan } from './snapshot';
import { RecoveryStore, saveBackup, saveRecoveryOptions } from './backupStore';
import { automaticBackupStatus, runAutomaticBackup } from './automaticBackup';
import { finishSync, previewSync, publishFirstSnapshot, type DriveBridge } from './driveSync';
let db:OntarioTeacherDB, store:RecoveryStore;
beforeEach(async()=>{db=new OntarioTeacherDB('sync-'+crypto.randomUUID());store=new RecoveryStore('recovery-'+crypto.randomUUID());await seedDatabase(db);await selectActingTeacher(db,'user-tyler');});
afterEach(async()=>{clearActiveTeacherId();await db.delete();await store.delete();});
describe('personal snapshot merge',()=>{
 it('creates a distinct computer-local identity after restoring the first computer’s full backup',async()=>{
  const first=await readSnapshot(db),firstDevice=first.tables.devices.find(row=>row.userId==='user-tyler')!;
  const other=new OntarioTeacherDB('second-computer-'+crypto.randomUUID());
  try {
    await new PortabilityService(other).restoreFromJSON(JSON.stringify(first));
    vi.resetModules();const secondIdentity=await import('../services/identityService');
    await secondIdentity.selectActingTeacher(other,'user-tyler');const identity=await secondIdentity.getAppIdentity(other);
    expect(identity.deviceId).not.toBe(firstDevice.id);expect(identity.device.installationId).toBe(identity.deviceId);
    expect(await other.devices.get(String(firstDevice.id))).toBeDefined();
  } finally {await other.delete();}
 });
 it('combines separate student edits and keeps device preferences local',async()=>{
  const base=await readSnapshot(db),local=structuredClone(base),remote=structuredClone(base);
  local.tables.students[0].firstName='Local Fiction';remote.tables.students[1].firstName='Remote Fiction';
  remote.tables.devices=[];remote.tables.userPreferences=[];
  const plan=mergeSnapshots(base,local,remote);expect(plan.conflicts).toHaveLength(0);
  expect(plan.snapshot.tables.students[0].firstName).toBe('Local Fiction');expect(plan.snapshot.tables.students[1].firstName).toBe('Remote Fiction');
  expect(plan.snapshot.tables.devices).toEqual(local.tables.devices);expect(plan.snapshot.tables.userPreferences).toEqual(local.tables.userPreferences);
 });
 it('requires explicit choice for concurrent edit or deletion and never auto-averages',async()=>{
  const base=await readSnapshot(db),local=structuredClone(base),remote=structuredClone(base);const id=local.tables.students[0].id;
  local.tables.students[0].firstName='Computer A';remote.tables.students[0].firstName='Computer B';
  const plan=mergeSnapshots(base,local,remote);expect(plan.conflicts).toHaveLength(1);expect(()=>resolvePlan(plan,{})).toThrow('every conflict');
  expect(resolvePlan(plan,{['students:'+id]:'remote'}).tables.students.find(row=>row.id===id)?.firstName).toBe('Computer B');
  remote.tables.students=remote.tables.students.filter(row=>row.id!==id);expect(mergeSnapshots(base,local,remote).conflicts).toHaveLength(1);
 });
 it('rejects remote permission edits before offering conflict choices',async()=>{
  const local=await readSnapshot(db),remote=structuredClone(local);remote.tables.organizationMemberships[0].role='admin';
  expect(()=>mergeSnapshots(null,local,remote)).toThrow('permissions differ');
 });
 it('merges a new class only with the same teacher’s new primary grant',async()=>{
  const local=await readSnapshot(db),remote=structuredClone(local),section=remote.tables.classSections[0],staff=remote.tables.classSectionStaff.find(s=>s.classSectionId===section.id)!;
  remote.tables.classSections.push({...section,id:'fictional-new-class',sectionCode:'SYNC-NEW'});
  remote.tables.classSectionStaff.push({...staff,id:'fictional-new-staff',classSectionId:'fictional-new-class',role:'primary_teacher',deletedAt:null});
  const plan=mergeSnapshots(local,local,remote,'user-tyler');expect(plan.conflicts).toHaveLength(0);expect(plan.snapshot.tables.classSections.some(s=>s.id==='fictional-new-class')).toBe(true);
  remote.tables.classSectionStaff[0].role='read_only';expect(()=>mergeSnapshots(local,local,remote,'user-tyler')).toThrow('permissions differ');
 });
 it('retains automatic backup access to the acting teacher’s own archived class',async()=>{
  const section=(await db.classSections.toArray())[0];await db.classSections.update(section.id,{deletedAt:'2026-10-01T00:00:00Z'});
  expect(await saveBackup(db,'user-tyler','manual',store)).not.toBeNull();
 });
 it('rejects full-workspace export with another teacher’s archived records',async()=>{
  const section=(await db.classSections.toArray())[0];await db.classSections.update(section.id,{deletedAt:'2026-10-01T00:00:00Z'});
  for(const staff of await db.classSectionStaff.where('classSectionId').equals(section.id).toArray())await db.classSectionStaff.update(staff.id,{deletedAt:'2026-10-01T00:00:00Z'});
  await expect(saveBackup(db,'user-tyler','manual',store)).rejects.toThrow('archived classes');expect(await store.backups.count()).toBe(0);
 });
 it('applies validated records atomically and rejects stale previews',async()=>{
  const before=await readSnapshot(db),target=structuredClone(before);target.tables.students[0].firstName='Merged Fiction';
  await applySnapshot(db,target,before,'user-tyler',getIdentityEpoch());expect((await db.students.get(target.tables.students[0].id))?.firstName).toBe('Merged Fiction');
  await expect(applySnapshot(db,before,before,'user-tyler',getIdentityEpoch())).rejects.toThrow('changed after preview');
 });
 it('rolls back a valid remote class move outside the acting teacher’s scope',async()=>{
  const before=await readSnapshot(db),target=structuredClone(before),section=target.tables.classSections[0],course=target.tables.courses.find(row=>row.id===section.courseId)!;
  const otherOrg=target.tables.organizations.find(row=>row.id!==course.organizationId)!;course.organizationId=otherOrg.id;
  await expect(applySnapshot(db,target,before,'user-tyler',getIdentityEpoch())).rejects.toThrow();expect(dataSignature(await readSnapshot(db))).toBe(dataSignature(before));
 });
 it('rejects a broken relationship without applying unrelated valid edits',async()=>{
  const before=await readSnapshot(db),target=structuredClone(before);target.tables.students[0].firstName='Never Applied';target.tables.classEnrollments[0].studentId='missing-fictional-student';
  await expect(applySnapshot(db,target,before,'user-tyler',getIdentityEpoch())).rejects.toThrow();expect(dataSignature(await readSnapshot(db))).toBe(dataSignature(before));
 });
 it('rejects revoked local authority and stale acting-teacher epoch',async()=>{
  const before=await readSnapshot(db),epoch=getIdentityEpoch();clearActiveTeacherId();await selectActingTeacher(db,'user-tyler');
  await expect(applySnapshot(db,before,before,'user-tyler',epoch)).rejects.toThrow('teacher changed');
 });
});
async function addFormerTeacherContent() {
 const actor=(await db.users.get('user-tyler'))!,now=new Date().toISOString(),enrollment=(await db.classEnrollments.toArray())[0];
 await db.users.add({...actor,id:'former-fictional-teacher',authSubject:'fictional-former',email:'former@example.invalid',deletedAt:now});
 await db.studentNotes.add({id:'former-confidential-note',classEnrollmentId:enrollment.id,authorUserId:'former-fictional-teacher',content:'Fictional former teacher confidential note',isConfidential:true,createdAt:now,updatedAt:now,deletedAt:null,version:1});
}
describe('retained teacher ownership boundary',()=>{
 it.each(['automatic','manual','before-sync','before-restore'] as const)('rejects %s backup after another teacher is archived',async reason=>{
  await addFormerTeacherContent();
  await expect(saveBackup(db,'user-tyler',reason,store)).rejects.toThrow('sole-teacher ownership');
  expect(await store.backups.count()).toBe(0);
 });
 it('does not treat a missing legacy note author as solely owned content',async()=>{
  await addFormerTeacherContent();await db.users.delete('former-fictional-teacher');
  await expect(saveBackup(db,'user-tyler','manual',store)).rejects.toThrow('sole-teacher ownership');
  expect(await store.backups.count()).toBe(0);
 });
 it('rejects first publication and preview before any Drive call',async()=>{
  await addFormerTeacherContent();const called=vi.fn();const bridge={list:called,upload:called,download:called} as unknown as DriveBridge;
  await expect(publishFirstSnapshot(db,'user-tyler',bridge,store)).rejects.toThrow('sole-teacher ownership');
  await expect(previewSync(db,'user-tyler',{id:'remote-fiction',name:'Fiction',modifiedTime:'2026-10-27'},bridge,store)).rejects.toThrow('sole-teacher ownership');
  expect(called).not.toHaveBeenCalled();expect(await store.state.get('sync')).toBeUndefined();
 });
 it('rechecks retained ownership at application of a previously authorized preview',async()=>{
  const json=JSON.stringify(await readSnapshot(db)),download=vi.fn(async()=>({ok:true as const,value:{json}})),upload=vi.fn();
  const bridge={download,upload} as unknown as DriveBridge;
  const preview=await previewSync(db,'user-tyler',{id:'remote-fiction',name:'Fiction',modifiedTime:'2026-10-27'},bridge,store);
  await addFormerTeacherContent();download.mockClear();
  await expect(finishSync(db,preview,{},bridge,store)).rejects.toThrow('sole-teacher ownership');
  expect(download).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();expect(await store.backups.count()).toBe(0);
 });
 it('rejects restoring out of a shared archived-author workspace without deleting its retained note',async()=>{
  const sole=await readSnapshot(db);await addFormerTeacherContent();const current=await readSnapshot(db);
  await expect(applySnapshot(db,sole,current,'user-tyler',getIdentityEpoch())).rejects.toThrow('sole-teacher ownership');
  expect(dataSignature(await readSnapshot(db))).toBe(dataSignature(current));
 });
 it('rolls back a restore that introduces another archived teacher and confidential content',async()=>{
  const sole=await readSnapshot(db);await addFormerTeacherContent();const shared=await readSnapshot(db);
  await db.studentNotes.delete('former-confidential-note');await db.users.delete('former-fictional-teacher');
  await expect(applySnapshot(db,shared,sole,'user-tyler',getIdentityEpoch())).rejects.toThrow('sole-teacher ownership');
  expect(dataSignature(await readSnapshot(db))).toBe(dataSignature(sole));
 });
 it('allows the retained workspace only with explicit administrator authority over every organization',async()=>{
  await addFormerTeacherContent();const membership=(await db.organizationMemberships.where('userId').equals('user-tyler').toArray())[0];
  const board=(await db.organizations.toArray()).find(org=>org.parentOrganizationId===null)!;
  await db.organizationMemberships.update(membership.id,{organizationId:board.id,role:'admin'});
  const saved=await saveBackup(db,'user-tyler','manual',store);
  expect(saved?.json).toContain('Fictional former teacher confidential note');
 });
});
describe('dated local recovery',()=>{
 it('deduplicates unchanged automatic backups and retains manual/safety snapshots',async()=>{
  const now=new Date('2026-10-01T00:00:00Z');await saveRecoveryOptions({id:'options',automatic:true,intervalHours:1,retain:7},store);
  const first=await saveBackup(db,'user-tyler','automatic',store,now);expect(first).not.toBeNull();
  expect(await saveBackup(db,'user-tyler','automatic',store,new Date('2026-10-02T00:00:00Z'))).toBeNull();
  await saveBackup(db,'user-tyler','manual',store,now);await saveBackup(db,'user-tyler','before-restore',store,now);
  const student=(await db.students.toArray())[0];
  for(let day=2;day<=10;day++){await db.students.update(student.id,{firstName:'Fiction '+day});await saveBackup(db,'user-tyler','automatic',store,new Date(`2026-10-${String(day).padStart(2,'0')}T00:00:00Z`));}
  expect(await store.backups.where('reason').equals('automatic').count()).toBe(7);expect(await store.backups.count()).toBe(9);
 });
 it('notifies mounted observers when an automatic write fails without any database change',async()=>{
  await runAutomaticBackup(db,'user-tyler',store);
  const rows=await store.backups.toArray();
  await saveRecoveryOptions({id:'options',automatic:true,intervalHours:1,retain:7},store);
  await store.backups.clear();store.backups.hook('creating',()=>{throw new Error('fictional quota full');});
  let notifications=0;const unsubscribe=automaticBackupStatus.subscribe(()=>{notifications++;});
  await runAutomaticBackup(db,'user-tyler',store);unsubscribe();
  expect(automaticBackupStatus.getSnapshot()).toContain('quota full');expect(notifications).toBe(1);expect(await store.backups.count()).toBe(0);expect(rows.length).toBe(1);
 });
 it('keeps old backups if writing the new snapshot fails',async()=>{
  await saveBackup(db,'user-tyler','manual',store);const rows=await store.backups.toArray();store.backups.hook('creating',()=>{throw new Error('fictional disk full');});
  await expect(saveBackup(db,'user-tyler','manual',store)).rejects.toThrow('disk full');expect(await store.backups.toArray()).toEqual(rows);
 });
 it('keeps a local merge and pre-sync recovery when Drive upload fails',async()=>{
  const base=await readSnapshot(db);await store.state.put({id:'sync',base,lastRemoteId:'base-id'});const remote=structuredClone(base);remote.organizerSync={ancestors:[{id:'base-id',digest:await snapshotDigest(base)}]};remote.tables.students[0].firstName='Remote Fiction';const json=JSON.stringify(remote);
  const bridge={download:async()=>({ok:true,value:{json}}),upload:async()=>({ok:false,message:'offline'})} as unknown as DriveBridge;
  const preview=await previewSync(db,'user-tyler',{id:'remote-1',name:'Fictional snapshot',modifiedTime:'2026-10-27'},bridge,store);
  await expect(finishSync(db,preview,{},bridge,store)).rejects.toThrow('offline');expect((await db.students.get(remote.tables.students[0].id))?.firstName).toBe('Remote Fiction');expect(await store.backups.where('reason').equals('before-sync').count()).toBe(1);
  expect((await store.state.get('sync'))?.base).toEqual(base);
 });
 it('does not treat divergent offline uploads or historical versions as a shared base',async()=>{
  const original=await readSnapshot(db),uploaded=structuredClone(original);uploaded.tables.students[0].firstName='Newer Local';
  await applySnapshot(db,uploaded,original,'user-tyler',getIdentityEpoch());await store.state.put({id:'sync',base:uploaded,lastRemoteId:'local-upload'});
  const other=structuredClone(original);other.tables.students[1].firstName='Other Computer';
  const bridge={download:async()=>({ok:true,value:{json:JSON.stringify(other)}})} as unknown as DriveBridge;
  const preview=await previewSync(db,'user-tyler',{id:'other-upload',name:'Other Computer',modifiedTime:'2026-10-27'},bridge,store);
  expect(preview.plan.conflicts.some(c=>c.id===original.tables.students[0].id)).toBe(true);
 });
 it('merges simultaneous offline branches using a verified older common Drive ancestor',async()=>{
  const common=await readSnapshot(db),fingerprint=await snapshotDigest(common),uploaded=structuredClone(common),remote=structuredClone(common);
  uploaded.tables.students[0].firstName='Computer A independent edit';uploaded.organizerSync={ancestors:[{id:'common-id',digest:fingerprint}]};
  remote.tables.students[1].firstName='Computer B independent edit';remote.organizerSync={ancestors:[{id:'common-id',digest:fingerprint}]};
  await applySnapshot(db,uploaded,common,'user-tyler',getIdentityEpoch());await store.state.put({id:'sync',base:uploaded,lastRemoteId:'a-upload'});
  const requested:string[]=[];const bridge={download:async(id:string)=>{requested.push(id);return{ok:true,value:{json:JSON.stringify(id==='common-id'?common:remote)}};}} as unknown as DriveBridge;
  const preview=await previewSync(db,'user-tyler',{id:'b-upload',name:'B',modifiedTime:'2026-10-27'},bridge,store);
  expect(requested).toEqual(['b-upload','common-id']);expect(preview.plan.conflicts).toHaveLength(0);
  expect(preview.plan.snapshot.tables.students[0].firstName).toBe('Computer A independent edit');expect(preview.plan.snapshot.tables.students[1].firstName).toBe('Computer B independent edit');
  const bad={download:async()=>({ok:true,value:{json:JSON.stringify(remote)}})} as unknown as DriveBridge;
  await expect(previewSync(db,'user-tyler',{id:'b-upload',name:'B',modifiedTime:'2026-10-27'},bad,store)).rejects.toThrow('common Drive ancestor changed');
 });
 it('offers a whole-version resolution when independent logical rows have different IDs',async()=>{
  const base=await readSnapshot(db),local=structuredClone(base),remote=structuredClone(base);
  const source=base.tables.studentAssessments[0];expect(source).toBeDefined();
  local.tables.studentAssessments=local.tables.studentAssessments.filter(row=>row.id!==source.id);
  remote.tables.studentAssessments=remote.tables.studentAssessments.filter(row=>row.id!==source.id);
  local.tables.studentAssessments.push({...source,id:'local-first-grade'});remote.tables.studentAssessments.push({...source,id:'remote-first-grade'});
  const plan=guardMergeRelationships(db,mergeSnapshots(null,local,remote),remote);
  expect(plan.conflicts[0].table).toBe('__workspace__');expect(resolvePlan(plan,{[plan.conflicts[0].key]:'local'}).tables.studentAssessments).toEqual(local.tables.studentAssessments);
 });
 it('rejects remote bytes changed after preview before local mutation',async()=>{
  const base=await readSnapshot(db);let json=JSON.stringify(base);const bridge={download:async()=>({ok:true,value:{json}})} as unknown as DriveBridge;
  const preview=await previewSync(db,'user-tyler',{id:'remote-1',name:'Fictional snapshot',modifiedTime:'2026-10-27'},bridge,store);json+=' ';
  await expect(finishSync(db,preview,{},bridge,store)).rejects.toThrow('selected Drive version changed');expect(await store.backups.count()).toBe(0);
 });
});
