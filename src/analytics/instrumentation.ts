import { FictionalOutbox } from './outbox';
import { Event, reportingLabel } from './schema';
/** Summary-only seam. No marking/session/student record accepted or traversed. */
export function fictionalInstrumentation(outbox: FictionalOutbox) {
  return {
    workflowCompleted(event: Omit<Extract<Event,{kind:'workflow_completed'}>,'kind'|'label'>, label?: {choice:string; approved:boolean}) {
      return outbox.capture({...event,kind:'workflow_completed',...(label && reportingLabel(label.choice,label.approved) ? {label:reportingLabel(label.choice,true)} : {})});
    },
    reliability(event: Omit<Extract<Event,{kind:'reliability'}>,'kind'>) { return outbox.capture({...event,kind:'reliability'}); }
  };
}
