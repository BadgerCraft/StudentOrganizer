import React, { useState, useRef, useEffect } from 'react';
import { CollectorState, ingestEvents, validateExport } from '../../../src/analytics/collector';
import { Namespace, LIMITS } from '../../../src/analytics/schema';
import { queryDashboard } from '../../../src/analytics/query';
import { simulate, AS_OF, OBSERVED } from '../../../scripts/analytics/simulator';
const empty=():CollectorState=>({schema:1,events:[],withdrawn:[]});
const STORE='owner-fictional-analytics-v1';
function load():CollectorState {
  const raw=localStorage.getItem(STORE); if(!raw)return empty();
  if(raw.length>LIMITS.collectorEvents*LIMITS.eventBytes)throw Error();
  const s=JSON.parse(raw);
  if(s.schema!==1||Object.keys(s).sort().join()!=='events,schema,withdrawn'||!Array.isArray(s.events)||s.events.length>LIMITS.collectorEvents||!Array.isArray(s.withdrawn)||s.withdrawn.length>LIMITS.collectorEvents||s.withdrawn.some((v:unknown)=>typeof v!=='string'||!/^(demo|measured-test):sim_[a-z0-9_-]{1,48}$/.test(v)))throw Error();
  const state=empty();state.withdrawn=s.withdrawn;
  for(let i=0;i<s.events.length;i+=LIMITS.batch)ingestEvents(state,s.events.slice(i,i+LIMITS.batch),Date.parse(AS_OF));
  return state;
}
export function AnalyticsDashboard() {
  const [store,setStore]=useState<CollectorState>(()=>{try{return load();}catch{return empty();}});
  const generation=useRef(0);
  const currentStore=useRef(store);
  useEffect(()=>()=>{generation.current++;},[]);
  const [healthy,setHealthy]=useState(()=>{try{load();return true;}catch{return false;}});
  const [source,setSource]=useState<Namespace>('demo');
  const [consent,setConsent]=useState(false);
  const [academic,setAcademic]=useState(false);
  const [message,setMessage]=useState(()=>{try{load();return 'No real collection is available. Explicitly grant fictional-session consent to run the simulator.';}catch{return 'Corrupt fictional store preserved. Reset local fictional data to recover.';}});
  const [busy,setBusy]=useState(false);
  const metrics=queryDashboard(store.events,source,AS_OF,OBSERVED,{allowAcademic:academic,minimumTeachers:5,minimumSamples:10});
  function save(next:CollectorState) { try{localStorage.setItem(STORE,JSON.stringify(next));}catch(error){setHealthy(false);throw error;}setStore(next);currentStore.current=next; }
  async function run() {
    if(!consent||!healthy||busy)return;
    const operation=++generation.current;
    setBusy(true);
    try {
      const next=structuredClone(currentStore.current);
      await simulate({ingest:async input=>ingestEvents(next,input,Date.parse(AS_OF)),query:async(namespace,at,since,policy)=>queryDashboard(next.events,namespace,at,since,policy)},source);
      if(operation!==generation.current)return;
      save(next);setMessage('Local fictional pipeline completed: instrumentation → consented outbox → ingestion → stored events → dashboard query. No external traffic.');
    }catch{if(operation!==generation.current)return;setMessage('Local fictional operation failed. Existing stored data is preserved. Reset only if deliberate.');}
    finally{if(operation===generation.current)setBusy(false);}
  }
  async function importFile(file:File|undefined) {
    if(!file||!healthy||busy)return;
    const operation=++generation.current;setBusy(true);
    try {
      if(file.size>LIMITS.collectorEvents*LIMITS.eventBytes)throw Error();
      const events=validateExport(JSON.parse(await file.text()),source);
      const next=structuredClone(currentStore.current);
      for(let i=0;i<events.length;i+=LIMITS.batch)ingestEvents(next,events.slice(i,i+LIMITS.batch),Date.parse(AS_OF));
      if(operation!==generation.current)return;
      save(next);setMessage('Validated local collector export ingested. Dashboard reflects stored summary events.');
    }catch{if(operation!==generation.current)return;setMessage('Import rejected: invalid schema, source, privacy fields, replay or retention. Existing data preserved.');}
    finally{if(operation===generation.current)setBusy(false);}
  }
  function withdraw() {
    generation.current++;setBusy(false);setConsent(false);
    if(!healthy)return;
    try {const next=structuredClone(currentStore.current);const teachers=new Set(next.events.filter(e=>e.namespace===source).map(e=>e.teacher));for(const teacher of teachers){const key=`${source}:${teacher}`;if(!next.withdrawn.includes(key))next.withdrawn.push(key);}next.events=next.events.filter(e=>e.namespace!==source);save(next);setMessage('Fictional session withdrawn; local source events purged and replay blocked. Independent exported files require deliberate removal.');}
    catch{setHealthy(false);setMessage('Withdrawal could not be persisted. Session consent is off; stored data purge is unconfirmed. Recover local storage before continuing.');}
  }
  return <>
    <div className="section-title"><div><p className="eyebrow">LOCAL ANALYTICS PIPELINE / FICTIONAL INSTALLATIONS ONLY</p><h2>Queried adoption & reliability</h2></div><span className="badge">As of {AS_OF.slice(0,10)}</span></div>
    <aside><strong>Real collection locked off.</strong> Destination, consent/privacy review and a separately approved implementation are required. This local collector is not authenticated production hosting.</aside>
    <section className="panel"><h3>Data source & fictional controls</h3><label>Dataset <select aria-label="Dataset" value={source} disabled={busy} onChange={e=>{generation.current++;setSource(e.target.value as Namespace);setConsent(false);setAcademic(false);}}><option value="demo">Demo — invented scenario</option><option value="measured-test">Measured test — simulated pipeline only</option></select></label><p data-testid="analytics-source">{source==='demo'?'DEMO — invented events':'MEASURED TEST — fictional events, not real teachers'}</p>
      <label className="check"><input type="checkbox" checked={consent} disabled={!healthy||busy} onChange={e=>setConsent(e.target.checked)}/>I consent to this fictional simulation session only.</label>
      <button disabled={!consent||busy||!healthy} onClick={run}>Run local pipeline</button> <button disabled={!healthy} onClick={withdraw}>Withdraw fictional session & purge source</button>
      <p><label>Import this source’s validated local collector event export <input type="file" disabled={!healthy||busy} accept="application/json,.json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label></p>
      <button className="secondary" onClick={()=>{generation.current++;setBusy(false);try{localStorage.removeItem(STORE);const fresh=empty();setStore(fresh);currentStore.current=fresh;setHealthy(true);setConsent(false);setAcademic(false);setMessage('Local fictional test store reset. Independent exported files remain.');}catch{setMessage('Reset failed; stored bytes preserved.');}}}>Reset local fictional data</button>
      <p role="status">{message}</p>
    </section>
    <h3>Aggregate adoption view</h3><p>Completed assignment-level marking workflows count as meaningful use; launches and individual submissions do not. Teacher tokens can span installs but do not verify unique people. No teacher rankings.</p>
    <div className="metrics"><article><span>Meaningful weekly active · 7 local days</span><strong data-testid="analytics-weekly">{metrics.adoption.weeklyActive}</strong></article><article><span>Meaningful monthly active · 30 local days</span><strong data-testid="analytics-monthly">{metrics.adoption.monthlyActive}</strong></article><article><span>Activated in observed coverage / installations</span><strong data-testid="analytics-activation">{metrics.adoption.activated} / {metrics.adoption.installations}</strong></article><article><span>Distinct assignments per monthly active</span><strong>{metrics.adoption.assignmentsPerMonthlyActive??'Withheld'}</strong></article><article><span>Teachers reusing an assignment</span><strong>{metrics.adoption.repeatingTeachers}</strong></article></div>
    <section className="panel"><h3>Mature cohort return</h3><p>First observed activation: first completed workflow within declared coverage. Week return: days 7–13; month return: days 30–59 after activation. Denominators include only teachers whose full window has elapsed. Coverage begins {OBSERVED.slice(0,10)}. Retention history is bounded to 400 days.</p><table><thead><tr><th>Return window</th><th>Returned / mature eligible teachers</th><th>Rate</th></tr></thead><tbody>{[['Week',metrics.adoption.weeklyRetention],['Month',metrics.adoption.monthlyRetention]].map(([name,value])=>{const r=value as typeof metrics.adoption.weeklyRetention;return <tr key={String(name)}><td>{String(name)}</td><td>{r.returned} / {r.eligible}</td><td>{r.rate===null?'Withheld / insufficient mature cohort':`${(r.rate*100).toFixed(1)}%`}</td></tr>;})}</tbody></table></section>
    <section className="panel"><h3>Reliability counts by version</h3><p>Allowlisted failure/retry counts only. No raw errors or paths; no failure rate without an operations denominator.</p><table><thead><tr><th>Version</th><th>Failures</th><th>Retries</th></tr></thead><tbody>{metrics.reliability.map(r=><tr key={r.version}><td>{r.version}</td><td>{r.failures}</td><td>{r.retries}</td></tr>)}</tbody></table></section>
    <section className="panel"><h3>Teacher/course academic context · separate from adoption</h3><p>{metrics.privacyNotice} Fixed reporting labels replace titles. Course and assignment tokens identify fictional entities only.</p><label className="check"><input type="checkbox" checked={academic} onChange={e=>setAcademic(e.target.checked)}/>Preview fictional academic summaries (minimum 5 participating teacher tokens and 10 summary samples).</label><table><thead><tr><th>Teacher token</th><th>Course / assignment</th><th>Reporting label</th><th>Workflow uses</th><th>Academic context</th></tr></thead><tbody>{metrics.teacherCourseAssignments.map((r,i)=><tr key={`${r.teacher}/${r.course}/${r.assignment}/${i}`}><td>{r.teacher}</td><td>{r.course} / {r.assignment}</td><td>{r.label}</td><td>{r.workflows}</td><td>{r.academic?`${r.academic.average} · ${r.academic.scale} / ${r.academic.category} / ${r.academic.basis} (n=${r.academic.sampleSize}) · ${r.snapshotAt.slice(0,10)}`:'Withheld'}</td></tr>)}</tbody></table></section>
  </>;
}
