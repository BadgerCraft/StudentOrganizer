import { mkdir, readFile, rename, writeFile, open, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Event, LIMITS, Namespace, validateEvent } from '../../src/analytics/schema';
import { ingestEvents, CollectorState } from '../../src/analytics/collector';
import { queryDashboard, QueryPolicy } from '../../src/analytics/query';
type Store = CollectorState;
/** Disposable local fictional collector. No listener, credentials, account or network transport. */
export class LocalCollector {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private now = () => Date.now()) {}
  private async load(): Promise<Store> {
    try {
      if((await stat(join(this.directory,'collector.json'))).size>LIMITS.collectorEvents*LIMITS.eventBytes) throw new Error('Collector capacity');
      const raw = await readFile(join(this.directory,'collector.json'),'utf8');
      if (Buffer.byteLength(raw)>LIMITS.collectorEvents*LIMITS.eventBytes) throw new Error('Collector capacity');
      const s = JSON.parse(raw);
      if (s.schema !== 1 || Object.keys(s).sort().join() !== 'events,schema,withdrawn' || !Array.isArray(s.events) || !Array.isArray(s.withdrawn) || s.events.length>LIMITS.collectorEvents || s.withdrawn.length>LIMITS.collectorEvents || s.withdrawn.some((k:unknown)=>typeof k!=='string'||!/^(demo|measured-test):sim_[a-z0-9_-]{1,48}$/.test(k))) throw new Error('Unsupported/corrupt collector');
      s.events = s.events.map(validateEvent);
      const keys=s.events.map((e:Event)=>`${e.namespace}:${e.id}`);
      if(new Set(keys).size!==keys.length) throw new Error('Duplicate persisted event');
      return s;
    } catch (e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') return {schema:1,events:[],withdrawn:[]}; throw e; }
  }
  private transaction<T>(fn: (s: Store)=>T, mutate=true): Promise<T> {
    const action = async () => {
      await mkdir(this.directory,{recursive:true,mode:0o700});
      // Fail busy across processes; never steal a lock after a guessed timeout.
      const lock = await open(join(this.directory,'collector.lock'),'wx',0o600);
      try {
        const s=await this.load();
        const result=fn(s);
        if(mutate) { const tmp=join(this.directory,'collector.tmp'); const file=await open(tmp,'w',0o600); try { await file.writeFile(JSON.stringify(s)); await file.sync(); } finally { await file.close(); } await rename(tmp,join(this.directory,'collector.json')); }
        return result;
      } finally { await lock.close(); await unlink(join(this.directory,'collector.lock')); }
    };
    const result=this.pending.then(action,action); this.pending=result.catch(()=>{}); return result;
  }
  ingest(input: unknown) {
    return this.transaction(s=>{
      return ingestEvents(s,input,this.now());
    });
  }
  withdraw(namespace:Namespace,teacher:string) {
    return this.transaction(s=>{ if(!['demo','measured-test'].includes(namespace)||!/^sim_[a-z0-9_-]{1,48}$/.test(teacher)) throw new Error('Invalid withdrawal'); const key=`${namespace}:${teacher}`; if(!s.withdrawn.includes(key)) s.withdrawn.push(key); if(s.withdrawn.length>LIMITS.collectorEvents) throw new Error('Withdrawal capacity'); s.events=s.events.filter(e=>e.namespace!==namespace||e.teacher!==teacher); });
  }
  query(namespace:Namespace,asOf:string,observedSince:string,policy?:QueryPolicy) {
    return this.transaction(s=>queryDashboard(s.events.filter(e=>Date.parse(e.at)>=this.now()-LIMITS.retentionDays*86400000),namespace,asOf,observedSince,policy),false);
  }
  export(namespace:Namespace) { return this.transaction(s=>({schema:1 as const,events:s.events.filter(e=>e.namespace===namespace && !s.withdrawn.includes(`${e.namespace}:${e.teacher}`) && Date.parse(e.at)>=this.now()-LIMITS.retentionDays*86400000)}),false); }
  retain() { return this.transaction(s=>{s.events=s.events.filter(e=>Date.parse(e.at)>=this.now()-LIMITS.retentionDays*86400000);}); }
}
/** Explicit local export: validated payload only, never a teacher database dump. */
export async function exportFixtureBatch(path: string, input: unknown) {
  if(!Array.isArray(input)||input.length>LIMITS.batch) throw new Error('Invalid export');
  const events=input.map(validateEvent); await writeFile(path,JSON.stringify({schema:1,events}),{mode:0o600,flag:'wx'});
}
export async function ingestFixtureFile(collector:LocalCollector,path:string) {
  const raw=await readFile(path,'utf8'); if(Buffer.byteLength(raw)>LIMITS.batch*LIMITS.eventBytes) throw new Error('Oversize export');
  const input=JSON.parse(raw); if(Object.keys(input).sort().join()!=='events,schema'||input.schema!==1) throw new Error('Invalid export schema'); return collector.ingest(input.events);
}
