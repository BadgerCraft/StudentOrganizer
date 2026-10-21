import { Event, LIMITS, Namespace, validateEvent } from './schema';
export type CollectorState = {schema:1; events:Event[]; withdrawn:string[]};
export function ingestEvents(s:CollectorState,input:unknown,now:number) {
  if(!Array.isArray(input)||input.length>LIMITS.batch) throw new Error('Invalid batch');
  const events=input.map(validateEvent);
  const cutoff=now-LIMITS.retentionDays*86400000;
  if(events.some(e=>Date.parse(e.at)<cutoff||Date.parse(e.at)>now||s.withdrawn.includes(`${e.namespace}:${e.teacher}`))) throw new Error('Expired/future/withdrawn event');
  const retained=s.events.filter(e=>Date.parse(e.at)>=cutoff);
  const seen=new Map(retained.map(e=>[`${e.namespace}:${e.id}`,JSON.stringify(e)]));
  let inserted=0;
  for(const e of events) {const key=`${e.namespace}:${e.id}`;if(seen.has(key)){if(seen.get(key)!==JSON.stringify(e)) throw new Error('Conflicting replay');continue;}seen.set(key,JSON.stringify(e));retained.push(e);inserted++;}
  if(retained.length>LIMITS.collectorEvents) throw new Error('Collector capacity');
  s.events=retained;return {inserted};
}
export function validateExport(input:unknown,namespace:Namespace):Event[] {
  if(!input || typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid export');
  const o=input as Record<string,unknown>;
  if(Object.keys(o).sort().join()!=='events,schema'||o.schema!==1||!Array.isArray(o.events)||o.events.length>LIMITS.collectorEvents) throw new Error('Invalid export');
  const events=o.events.map(validateEvent);if(events.some(e=>e.namespace!==namespace)) throw new Error('Mixed/incorrect data source');return events;
}
