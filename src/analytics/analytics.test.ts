import { describe,it,expect,vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Event, LIMITS, reportingLabel, validateEvent } from './schema';
import { FictionalOutbox, productionAnalytics } from './outbox';
import { queryDashboard } from './query';
import { fictionalInstrumentation } from './instrumentation';
import { LocalCollector, exportFixtureBatch, ingestFixtureFile } from '../../scripts/analytics/collector';
import { simulate, AS_OF, OBSERVED, truth } from '../../scripts/analytics/simulator';
const now=Date.parse(AS_OF);
const event=(id='sim_event_a'):Extract<Event,{kind:'workflow_completed'}>=>({schema:1,namespace:'measured-test',id,install:'sim_install_a',teacher:'sim_teacher_a',at:'2026-10-20T12:00:00.000Z',timezone:'America/Toronto',version:'1.0.0',kind:'workflow_completed',assignment:'sim_assignment_a',course:'sim_course_a'});
const memory=()=>{let value:string|null=null;return {read:()=>value,write:(v:string)=>{value=v;}};};
async function temporary(fn:(path:string)=>Promise<void>) {const dir=await mkdtemp(join(tmpdir(),'analytics-test-'));try {await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
describe('analytics privacy and consent',()=>{
 it('production cannot activate/capture and denied consent never touches storage or transport',async()=>{expect(productionAnalytics.activate()).toBe(false);expect(productionAnalytics.capture(event())).toBe(false);const store=memory(),write=vi.spyOn(store,'write'),send=vi.fn();const b=new FictionalOutbox(store,'measured-test',()=>now);expect(b.capture(event())).toBe(false);await b.flush({send});expect(send).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();});
 it.each(['student','studentId','name','photo','rawTitle','path','error','marks','extra'])('rejects forbidden %s fields',field=>{expect(()=>validateEvent({...event(),[field]:'secret'})).toThrow();});
 it('rejects schema/type/namespace/time/scale/summary/label abuse',()=>{for(const patch of [{schema:2},{namespace:'production'},{teacher:'real_teacher'},{at:'2026-02-30T00:00:00.000Z'},{timezone:'invalid'},{label:'Student Smith'},{summary:{scale:'percentage-v1',category:'K',basis:'assignment',sampleSize:2,average:80}},{summary:{scale:'level-1-4-v1',category:'K',basis:'assignment',sampleSize:20,average:80}},{count:2}]) expect(()=>validateEvent({...event(),...patch})).toThrow();});
 it('omits arbitrary titles even on explicit approval and requires fixed-label approval',()=>{expect(reportingLabel('Smith 123',true)).toBeUndefined();expect(reportingLabel('Project',false)).toBeUndefined();const s=memory(),b=new FictionalOutbox(s,'measured-test',()=>now);b.consent(true);fictionalInstrumentation(b).workflowCompleted(event(),{choice:'Smith 123',approved:true});expect(s.read()).not.toContain('Smith');expect(s.read()).not.toContain('label');});
 it('withdrawal purges persisted queue and late transport completion cannot restore it',async()=>{const s=memory(),b=new FictionalOutbox(s,'measured-test',()=>now);b.consent(true);b.capture(event());let finish!:()=>void;const flushing=b.flush({send:()=>new Promise<void>(r=>{finish=r;})});expect(b.withdraw()).toBe(true);finish();await flushing;expect(b.status().queued).toBe(0);expect(b.capture(event())).toBe(false);expect(new FictionalOutbox(s,'measured-test',()=>now).status().consent).toBe('withdrawn');expect(s.read()).not.toContain('sim_teacher');});
 it('bounds queue and retries offline; duplicate and future capture rejected',async()=>{let clock=now;const b=new FictionalOutbox(memory(),'measured-test',()=>clock);b.consent(true);expect(b.capture({...event(),at:'2026-10-22T00:00:00.000Z'})).toBe(false);for(let n=0;n<LIMITS.queue;n++)expect(b.capture(event(`sim_event_${n}`))).toBe(true);expect(b.capture(event('sim_overflow'))).toBe(false);expect(b.capture(event('sim_event_0'))).toBe(false);const send=vi.fn(async()=>{throw Error('offline');});for(let i=0;i<12;i++){await b.flush({send});clock+=100000;}expect(send).toHaveBeenCalledTimes(12);expect(b.status().queued).toBe(0);});
 it('fails closed on corrupt/future local state or storage failure, preserving corrupt bytes',()=>{const s=memory();s.write('{corrupt');const b=new FictionalOutbox(s,'measured-test',()=>now);expect(b.consent(true)).toBe(false);expect(b.capture(event())).toBe(false);expect(s.read()).toBe('{corrupt');const broken=new FictionalOutbox({read:()=>null,write:()=>{throw Error();}},'measured-test',()=>now);expect(broken.consent(true)).toBe(false);expect(()=>broken.capture(event())).not.toThrow();});
});
describe('real local collector pipeline',()=>{
 it('matches deterministic truth, separates sources, persists across restart, and makes no fetch requests',()=>temporary(async dir=>{const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('External traffic forbidden');});try {const c=new LocalCollector(dir,()=>now);await simulate(c,'demo');const d=await simulate(c,'measured-test');expect(d.adoption).toMatchObject({activated:truth.activated,installations:truth.installations,weeklyActive:truth.weeklyActive,monthlyActive:truth.monthlyActive,assignmentsPerMonthlyActive:truth.assignmentsPerMonthlyActive,repeatingTeachers:truth.repeatingTeachers});expect(d.adoption.weeklyRetention).toMatchObject({eligible:6,returned:5,rate:5/6});expect(d.adoption.monthlyRetention).toMatchObject({eligible:6,returned:3,rate:0.5});expect(d.reliability).toEqual([{version:'1.0.0',failures:3,retries:2}]);expect(d.teacherCourseAssignments.every(r=>r.academic===null)).toBe(true);const again=await new LocalCollector(dir,()=>now).query('measured-test',AS_OF,OBSERVED);expect(again).toEqual(d);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}}));
 it('exports allowlisted fixtures, ingests idempotently and rejects conflicting replay atomically',()=>temporary(async dir=>{const c=new LocalCollector(dir,()=>now);const path=join(dir,'batch.json');await exportFixtureBatch(path,[event()]);expect(await ingestFixtureFile(c,path)).toEqual({inserted:1});expect(await ingestFixtureFile(c,path)).toEqual({inserted:0});await expect(c.ingest([event('sim_new'),{...event(),version:'2.0.0'}])).rejects.toThrow('Conflicting');expect((await c.query('measured-test',AS_OF,OBSERVED)).adoption.activated).toBe(1);await expect(c.ingest([{...event(),studentId:'secret'}])).rejects.toThrow();expect(await readFile(join(dir,'collector.json'),'utf8')).not.toContain('secret');}));
 it('serializes concurrent ingestion, rejects another process lock, purges withdrawn teacher and rejects replay',()=>temporary(async dir=>{const c=new LocalCollector(dir,()=>now);await Promise.all(Array.from({length:15},()=>c.ingest([event()])));expect((await c.query('measured-test',AS_OF,OBSERVED)).teacherCourseAssignments[0].workflows).toBe(1);const lock=await open(join(dir,'collector.lock'),'wx');await expect(new LocalCollector(dir,()=>now).ingest([event()])).rejects.toMatchObject({code:'EEXIST'});await lock.close();await rm(join(dir,'collector.lock'));await c.withdraw('measured-test','sim_teacher_a');expect((await c.query('measured-test',AS_OF,OBSERVED)).adoption.activated).toBe(0);await expect(new LocalCollector(dir,()=>now).ingest([event()])).rejects.toThrow('withdrawn');}));
 it('preserves corrupt/future collector bytes and safely expires retained events',()=>temporary(async dir=>{const path=join(dir,'collector.json');await writeFile(path,'{"schema":2}');await expect(new LocalCollector(dir,()=>now).ingest([event()])).rejects.toThrow();expect(await readFile(path,'utf8')).toBe('{"schema":2}');await rm(path);const c=new LocalCollector(dir,()=>now);await c.ingest([event()]);const later=new LocalCollector(dir,()=>now+401*86400000);await later.retain();expect(JSON.parse(await readFile(path,'utf8')).events).toEqual([]);await expect(later.ingest([event()])).rejects.toThrow('Expired');}));
 it('uses local calendar boundaries, mature windows and conservative suppression',()=>{const e={...event(),at:'2026-10-15T01:00:00.000Z'};const q=queryDashboard([e],'measured-test','2026-10-21T12:00:00.000Z',OBSERVED);expect(q.adoption.weeklyActive).toBe(0);expect(q.adoption.weeklyRetention).toMatchObject({eligible:0,rate:null,withheld:true});expect(q.adoption.assignmentsPerMonthlyActive).toBeNull();expect(q.adoption.installations).toBe(1);});
 it('keeps unlike academic contexts separate and requires opt-in plus cohort/sample policy',()=>temporary(async dir=>{const c=new LocalCollector(dir,()=>now);await simulate(c,'measured-test');const q=await c.query('measured-test',AS_OF,OBSERVED,{allowAcademic:true,minimumTeachers:5,minimumSamples:10});expect(q.teacherCourseAssignments.filter(r=>r.academic).length).toBe(6);expect(q.teacherCourseAssignments.find(r=>r.academic?.basis==='assignment')?.academic).toMatchObject({scale:'percentage-v1',category:'K',basis:'assignment',average:75});const hidden=await c.query('measured-test',AS_OF,OBSERVED,{allowAcademic:true,minimumTeachers:7,minimumSamples:10});expect(hidden.teacherCourseAssignments.every(r=>r.academic===null)).toBe(true);}));
});

describe('independent-review regression cases',()=>{
 it('recognizes known pre-window activation without inventing a new cohort',()=>{
   const old={...event(),id:'sim_old',at:'2026-07-01T12:00:00.000Z'};
   const q=queryDashboard([old,event()],'measured-test',AS_OF,'2026-10-01T00:00:00.000Z');
   expect(q.adoption.activated).toBe(0);expect(q.adoption.knownPreviouslyActivated).toBe(1);expect(q.adoption.monthlyActive).toBe(1);
   expect(q.adoption.monthlyRetention.eligible).toBe(0);
 });
 it('reordered JSON is an idempotent replay',()=>temporary(async dir=>{
   const c=new LocalCollector(dir,()=>now);await c.ingest([event()]);
   const reordered=Object.fromEntries(Object.entries(event()).reverse());expect(await c.ingest([reordered])).toEqual({inserted:0});
 }));
 it('preserves distinct academic category, scale and class/assignment contexts',()=>{
   const variants=[{scale:'percentage-v1',category:'K',basis:'assignment',average:70},{scale:'level-1-4-v1',category:'T',basis:'assignment',average:3},{scale:'percentage-v1',category:'K',basis:'class',average:75}];
   const rows=variants.map((v,i)=>validateEvent({...event(`sim_event_${i}`),summary:{...v,sampleSize:20}}));
   const q=queryDashboard(rows,'measured-test',AS_OF,OBSERVED,{allowAcademic:true,minimumTeachers:2,minimumSamples:10});
   expect(q.teacherCourseAssignments.length).toBe(3);expect(q.teacherCourseAssignments.every(r=>r.academic===null)).toBe(true);
 });
 it('bounds hung transport attempts and signals withdrawal cancellation',async()=>{
   const b=new FictionalOutbox(memory(),'measured-test',()=>now,5);b.consent(true);b.capture(event());
   let signal:AbortSignal|undefined;await b.flush({send:async(_events,s)=>{signal=s;await new Promise<void>(()=>{});}});expect(signal?.aborted).toBe(true);expect(b.status().queued).toBe(1);
   const c=new FictionalOutbox(memory(),'measured-test',()=>now);c.consent(true);c.capture(event());const flushing=c.flush({send:async(_events,s)=>{signal=s;await new Promise<void>(()=>{});}});c.withdraw();await flushing;expect(signal?.aborted).toBe(true);expect(c.status().queued).toBe(0);
 });
 it('failed withdrawal is surfaced and restart never resumes the retained granted queue',async()=>{
   let raw:string|null=null,fail=false;const storage={read:()=>raw,write:(v:string)=>{if(fail)throw Error();raw=v;}};
   const b=new FictionalOutbox(storage,'measured-test',()=>now);b.consent(true);b.capture(event());fail=true;
   expect(b.withdraw()).toBe(false);expect(b.status().healthy).toBe(false);expect(raw).toContain('granted');
   const restarted=new FictionalOutbox(storage,'measured-test',()=>now);const send=vi.fn();await restarted.flush({send});expect(send).not.toHaveBeenCalled();
   fail=false;const recovered=new FictionalOutbox(storage,'measured-test',()=>now);expect(recovered.status().consent).toBe('denied');expect(recovered.status().queued).toBe(0);expect(recovered.consent(true)).toBe(true);await recovered.flush({send});expect(send).not.toHaveBeenCalled();
 });
});
