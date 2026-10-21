import { FictionalOutbox } from '../../src/analytics/outbox';
import { fictionalInstrumentation } from '../../src/analytics/instrumentation';
import { Event, Namespace } from '../../src/analytics/schema';
import type { LocalCollector } from './collector';
export const AS_OF='2026-10-21T12:00:00.000Z';
export const OBSERVED='2026-06-01T00:00:00.000Z';
export const truth={activated:6,installations:7,weeklyActive:6,monthlyActive:6,assignmentsPerMonthlyActive:1.5,repeatingTeachers:6,weeklyEligible:6,weeklyReturned:5,monthlyEligible:6,monthlyReturned:3,failures:3,retries:2};
export async function simulate(collector:Pick<LocalCollector,'ingest'|'query'>,namespace:Namespace='demo') {
  let storage:string|null=null;
  const outbox=new FictionalOutbox({read:()=>storage,write:s=>{storage=s;}},namespace,()=>Date.parse(AS_OF));
  outbox.consent(true);
  const instrument=fictionalInstrumentation(outbox);
  let serial=0;
  for(let teacher=0;teacher<6;teacher++) {
    const dates=['2026-07-01',...(teacher<5?['2026-07-09']:[]),...(teacher<3?['2026-08-05']:[]),'2026-10-20'];
    for(const day of dates) {
      const base={schema:1 as const,namespace,id:`sim_event_${serial++}`,teacher:`sim_teacher_${teacher}`,install:`sim_install_${teacher}`,at:`${day}T12:00:00.000Z`,timezone:'America/Toronto',version:'1.0.0',assignment:'sim_assignment_a',course:'sim_course_a',...(teacher<3 && day==='2026-07-09'?{summary:{basis:'class' as const,category:'K' as const,scale:'percentage-v1' as const,sampleSize:20,average:77}}:{})};
      if(!instrument.workflowCompleted(base,{choice:'Practice set',approved:true})) throw new Error('Simulation capture failed');
    }
    if(teacher<3) instrument.workflowCompleted({schema:1,namespace,id:`sim_event_${serial++}`,teacher:`sim_teacher_${teacher}`,install:teacher===0?'sim_install_extra':`sim_install_${teacher}`,at:'2026-10-20T13:00:00.000Z',timezone:'America/Toronto',version:'1.0.0',assignment:'sim_assignment_b',course:'sim_course_a',summary:{basis:'assignment',category:'K',scale:'percentage-v1',sampleSize:20,average:75}},{choice:'Unit assessment',approved:true});
  }
  for(const [code,count] of [['save_failed',3],['retry',2]] as const) instrument.reliability({schema:1,namespace,id:`sim_event_${serial++}`,install:'sim_install_0',teacher:'sim_teacher_0',at:'2026-10-20T13:00:00.000Z',timezone:'America/Toronto',version:'1.0.0',code,count});
  await outbox.flush({send:async(events:Event[])=>{await collector.ingest(events);}});
  if(outbox.status().queued) throw new Error('Simulator queue did not drain');
  return collector.query(namespace,AS_OF,OBSERVED);
}
