import Dexie from 'dexie';
import type { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { assertClassSectionWriteAccess } from '../services/authHelper';
import { getActiveTeacherId, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { validateMarkingBackupFiles } from '../marking/portabilityValidation';
import { validateCaptureBackupFiles } from '../capture/portabilityValidation';

export type Row = Record<string, unknown> & { id: string };
export interface Snapshot { organizerSync?: { ancestors: { id:string; digest:string }[] }; version: number; schemaVersion: number; exportedAt: string; tables: Record<string, Row[]> }
export interface Conflict { key: string; table: string; id: string; local?: Row; remote?: Row }
export interface MergePlan { snapshot: Snapshot; conflicts: Conflict[]; local: Snapshot }
// Local device identity, pending transport, and preferences never migrate during merge.
const LOCAL = new Set(['devices', 'userPreferences', 'syncMutations', 'syncCursors']);
const PROTECTED = new Set(['organizations', 'users', 'organizationMemberships', 'classSectionStaff']);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
export function dataSignature(snapshot: Snapshot): string {
  return canonical(Object.fromEntries(Object.entries(snapshot.tables).map(([k,v]) => [k,[...v].sort((a,b)=>a.id.localeCompare(b.id))])));
}
export function mergeSnapshots(base: Snapshot | null, local: Snapshot, remote: Snapshot, userId?:string): MergePlan {
  if (local.schemaVersion !== remote.schemaVersion || (base && base.schemaVersion !== local.schemaVersion)) throw new Error('Both computers must use the same backup schema before syncing.');
  if (canonical(Object.keys(local.tables).sort()) !== canonical(Object.keys(remote.tables).sort())) throw new Error('The computers have different table sets. Update both before syncing.');
  const snapshot: Snapshot = { ...local, exportedAt: new Date().toISOString(), tables: {} }, conflicts: Conflict[] = [];
  for (const table of Object.keys(local.tables)) {
    if (LOCAL.has(table) || table==='participationDailySummaries') { snapshot.tables[table] = structuredClone(local.tables[table]); continue; }
    // Remote snapshots cannot grant access, change teachers, or silently change organization authority.
    if (PROTECTED.has(table) && canonical([...local.tables[table]].sort((a,b)=>a.id.localeCompare(b.id))) !== canonical([...remote.tables[table]].sort((a,b)=>a.id.localeCompare(b.id)))) {
      const safeNewClassStaff=(source:Snapshot,other:Snapshot)=>source.tables.classSectionStaff.every(staff=>{
        const existing=other.tables.classSectionStaff.find(row=>row.id===staff.id);
        if(existing)return canonical(existing)===canonical(staff);
        if(!userId||!local.tables.organizationMemberships.some(m=>m.id===staff.organizationMembershipId&&m.userId===userId&&m.status==='active'&&m.deletedAt===null)||staff.role!=='primary_teacher'||staff.deletedAt!==null||other.tables.classSections.some(section=>section.id===staff.classSectionId))return false;
        const section=source.tables.classSections.find(section=>section.id===staff.classSectionId),course=source.tables.courses.find(course=>course.id===section?.courseId);
        return !!course&&local.tables.organizationMemberships.some(m=>m.userId===userId&&m.organizationId===course.organizationId&&m.status==='active'&&m.deletedAt===null&&['teacher','admin','department_head'].includes(String(m.role)));
      });
      if(table!=='classSectionStaff'||!safeNewClassStaff(local,remote)||!safeNewClassStaff(remote,local))throw new Error('Teacher, organization or class permissions differ. Resolve those locally before syncing; existing permissions are never changed remotely.');
    }
    const l = new Map(local.tables[table].map(r=>[r.id,r])), r = new Map(remote.tables[table].map(row=>[row.id,row]));
    const b = new Map((base?.tables[table] ?? []).map(row=>[row.id,row]));
    const rows: Row[] = [];
    for (const id of new Set([...l.keys(),...r.keys(),...b.keys()])) {
      const left=l.get(id), right=r.get(id), before=b.get(id);
      let chosen: Row | undefined;
      if (canonical(left) === canonical(right)) chosen=left;
      else if (base && canonical(left) === canonical(before)) chosen=right;
      else if (base && canonical(right) === canonical(before)) chosen=left;
      else if (!before && !left) chosen=right;
      else if (!before && !right) chosen=left;
      else { conflicts.push({key:table+':'+id,table,id,local:left,remote:right}); chosen=left; }
      if(chosen) rows.push(structuredClone(chosen));
    }
    snapshot.tables[table]=rows;
  }
  return { snapshot, conflicts, local };
}
export function resolvePlan(plan: MergePlan, choices: Record<string,'local'|'remote'>): Snapshot {
  const result=structuredClone(plan.snapshot);
  for(const conflict of plan.conflicts) {
    if(!choices[conflict.key]) throw new Error('Choose a version for every conflict before applying.');
    const chosen=conflict[choices[conflict.key]];
    if(conflict.table==='__workspace__') {
      const full=structuredClone(chosen!.snapshot as Snapshot);
      for(const name of LOCAL) full.tables[name]=structuredClone(plan.local.tables[name]);
      return full;
    }
    result.tables[conflict.table]=result.tables[conflict.table].filter(row=>row.id!==conflict.id);
    if(chosen) result.tables[conflict.table].push(structuredClone(chosen));
  }
  return result;
}
export async function assertWorkspaceAccess(database: OntarioTeacherDB, userId: string, epoch: number): Promise<void> {
  if(getActiveTeacherId()!==userId || getIdentityEpoch()!==epoch) throw new Error('The acting teacher changed. Reopen recovery settings.');
  const user=await database.users.get(userId);
  if(!user || user.deletedAt!==null) throw new Error('Select an active teacher first.');
  const memberships=await database.organizationMemberships.filter(m=>m.userId===userId&&m.deletedAt===null&&m.status==='active').toArray();
  if(!memberships.some(m=>['teacher','admin','department_head'].includes(m.role))) throw new Error('An active teacher membership is required for full-workspace recovery.');
  const activeUsers=await database.users.filter(u=>u.deletedAt===null&&u.id!==userId).toArray();
  const orgs=await database.organizations.toArray();
  const orgChain=(id:string)=>{const ids:string[]=[];let current:string|null=id;while(current&&!ids.includes(current)&&ids.length<100){ids.push(current);current=orgs.find(o=>o.id===current)?.parentOrganizationId??null;}return ids;};
  const adminFor=(id:string)=>memberships.some(m=>m.role==='admin'&&orgChain(id).includes(m.organizationId));
  // Full backups include identity, unassigned students and archived data. Shared workspaces
  // require administrative authority; class-level co-teaching alone cannot export everything.
  if(activeUsers.length && orgs.some(org=>!adminFor(org.id))) throw new Error('Full-workspace sync and automatic recovery require sole-teacher ownership or administrator access to every organization. Use authorized class exports instead.');
  const sections=await database.classSections.toArray();
  for(const section of sections) {
    if(section.deletedAt===null) await assertClassSectionWriteAccess(database,userId,section.id);
    else {
      const course=await database.courses.get(section.courseId);
      const staff=await database.classSectionStaff.where('classSectionId').equals(section.id).toArray();
      if(!course || (!adminFor(course.organizationId)&&!staff.some(s=>memberships.some(m=>m.id===s.organizationMembershipId)&&s.deletedAt===null&&['primary_teacher','co_teacher','support'].includes(s.role)&&memberships.some(m=>m.organizationId===course.organizationId&&m.role==='teacher')))) throw new Error('This workspace contains archived classes outside your write access. Full-workspace recovery is unavailable.');
    }
  }
  for(const student of await database.students.toArray()) if(!adminFor(student.organizationId)&&!memberships.some(m=>m.organizationId===student.organizationId&&['teacher','department_head'].includes(m.role))) throw new Error('This workspace contains students outside your organization access.');
}
export async function readSnapshot(database: OntarioTeacherDB): Promise<Snapshot> {
  return JSON.parse(await new PortabilityService(database).createFullBackupJSON()) as Snapshot;
}
/** A merge preserves device state, validates all relationships/blobs, and rejects edits since preview. */
export async function applySnapshot(database: OntarioTeacherDB, target: Snapshot, expected: Snapshot, userId: string, epoch: number): Promise<void> {
  const json=JSON.stringify(target);
  new PortabilityService(database).validateBackupJSON(json);
  await validateMarkingBackupFiles(target.tables);
  await validateCaptureBackupFiles(target.tables);
  await database.transaction('rw',database.tables,async()=>{
    await assertWorkspaceAccess(database,userId,epoch);
    const current=await readSnapshot(database);
    if(dataSignature(current)!==dataSignature(expected)) throw new Error('Local work changed after preview. Refresh sync; no changes were applied.');
    const tx=Dexie.currentTransaction!;
    const unsubscribe=subscribeIdentityChange(()=>tx.abort());
    tx.on('complete',unsubscribe); tx.on('abort',unsubscribe); tx.on('error',unsubscribe);
    // Reuse the canonical restore normalization and projection rebuild inside this transaction.
    await Dexie.waitFor(new PortabilityService(database).restoreFromJSON(json));
    // Validate the resulting scope too: a remote course/class move cannot evade local authority.
    await assertWorkspaceAccess(database,userId,epoch);
    if(getActiveTeacherId()!==userId || getIdentityEpoch()!==epoch) throw new Error('The acting teacher changed. No changes were applied.');
  });
}

/** Conservatively offer whole-version choice if independently created linked records collide. */
export function guardMergeRelationships(database:OntarioTeacherDB,plan:MergePlan,remote:Snapshot):MergePlan {
  let invalid=false;
  for(const table of database.tables) for(const index of table.schema.indexes.filter(index=>index.unique)) {
    const seen=new Set<string>();
    for(const row of plan.snapshot.tables[table.name]??[]) {
      const path=index.keyPath;
      const values=(Array.isArray(path)?path:[path]).map(key=>typeof key==='string'?row[key]:undefined);
      if(values.some(value=>value===undefined||value===null)) continue;
      const key=canonical(values);if(seen.has(key)){invalid=true;break;}seen.add(key);
    }
  }
  try {new PortabilityService(database).validateBackupJSON(JSON.stringify(plan.snapshot));} catch {invalid=true;}
  if(!invalid)return plan;
  return {...plan,conflicts:[{key:'__workspace__:linked-records',table:'__workspace__',id:'Linked records cannot safely be combined. Choose one complete workspace version.',local:{id:'local',snapshot:plan.local},remote:{id:'remote',snapshot:remote}}]};
}
export async function snapshotDigest(snapshot:Snapshot):Promise<string> {
  const bytes=new TextEncoder().encode(canonical(snapshot));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
