import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AS_OF, dashboard, fictionalTeachers, fictionalReliability, definitions } from './dashboard';
import './style.css';
type Approval = { status: 'candidate' | 'tested' | 'approved' | 'revoked'; candidate: { version: string; arch: string; sourceCommit: string; artifact: { name: string; bytes: number; sha512: string } }; test: { notes: string; at: string } | null; approvedAt: string | null };
type Snapshot = { approval: Approval | null; mode: 'local-preview-only'; publicationReady: false; message: string; error?: string };
type Bridge = { status(): Promise<Snapshot>; importCandidate(): Promise<Snapshot>; recordTest(notes: string): Promise<Snapshot>; approve(): Promise<Snapshot>; revoke(): Promise<Snapshot>; exportPreview(): Promise<Snapshot> };
declare global { interface Window { ownerConsole?: Bridge } }
const metrics = dashboard(fictionalTeachers, AS_OF);
const rate = (value: { returned: number; eligible: number }) => value.eligible ? `${value.returned}/${value.eligible} (${Math.round(value.returned / value.eligible * 100)}%)` : 'Not mature yet (0 eligible)';
function App() {
  const [tab, setTab] = useState<'updates' | 'dashboard'>('updates');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [notes, setNotes] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const bridge = window.ownerConsole;
  useEffect(() => { bridge?.status().then(setSnapshot).catch(() => setSnapshot({ approval: null, mode: 'local-preview-only', publicationReady: false, message: '', error: 'Local approval status is unavailable.' })); }, [bridge]);
  async function action(run: () => Promise<Snapshot>) {
    setBusy(true);
    try { setSnapshot(await run()); }
    catch { setSnapshot(previous => ({ approval: previous?.approval || null, mode: 'local-preview-only', publicationReady: false, message: '', error: 'Local action failed. Nothing was published.' })); }
    finally { setBusy(false); setAttest(false); }
  }
  const approval = snapshot?.approval;
  return <><header><div className="identity">BC <span>STUDENT ORGANIZER / OWNER TOOLS</span></div><h1>Control Panel</h1><p>Tyler’s separate local console</p></header>
    <div className="boundary"><strong>LOCAL PREVIEW ONLY</strong><span>No live usage. No telemetry. No publishing connection.</span></div>
    <nav aria-label="Owner console"><button aria-current={tab === 'updates' ? 'page' : undefined} onClick={() => setTab('updates')}>Update preparation</button><button aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => setTab('dashboard')}>Fictional dashboard</button></nav>
    <main>{tab === 'updates' ? <>
      <div className="section-title"><div><p className="eyebrow">STAGE 1 / RELEASE PREPARATION</p><h2>Approve a tested candidate locally</h2></div><span className="badge">Live publishing unavailable</span></div>
      <p>Import candidate metadata and select the matching Windows NSIS installer. Its filename, size and SHA-512 fingerprint are checked before test evidence, approval and export. The fingerprint binds the approval to file contents; the declared source commit and test notes remain owner attestations. This console never runs the installer.</p>
      <aside><strong>Local approval does not offer an update to teachers.</strong> The stable release feed, verified publisher signing and publication process need separate setup and authorization. Student Organizer’s current “Check for updates” continues to use its existing fixed GitHub source.</aside>
      {!bridge && <p role="status" className="notice">Browser preview: release actions require the separate packaged Control Panel executable.</p>}
      <section className="panel"><h3>1. Select a candidate</h3><p>Use the JSON format described in the Control Panel guide. Selecting a new candidate replaces only this console’s local preparation record.</p><button disabled={!bridge || busy} onClick={() => action(() => bridge!.importCandidate())}>Import candidate + verify installer</button>
        {approval && <><dl><dt>Status</dt><dd><strong>{approval.status.toUpperCase()} — LOCAL ONLY</strong></dd><dt>Version / platform</dt><dd>{approval.candidate.version} / Windows {approval.candidate.arch}</dd><dt>Declared source commit</dt><dd><code>{approval.candidate.sourceCommit}</code></dd><dt>Artifact</dt><dd>{approval.candidate.artifact.name} ({approval.candidate.artifact.bytes.toLocaleString()} bytes)</dd><dt>SHA-512</dt><dd><code>{approval.candidate.artifact.sha512}</code></dd><dt>Publisher</dt><dd>Unverified. No signing keys or publisher trust configured here.</dd></dl></>}
      </section>
      <section className="panel"><h3>2. Record test evidence</h3><p>Record checks you actually performed on these exact bytes: package identity, backup, deliberate installation, reopen and recovery. Recording a note does not run those checks.</p>
        <label htmlFor="evidence">Verification evidence (no personal or student data)</label><textarea id="evidence" value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} placeholder="Exact build and test results, platform, remaining limits…" />
        <label className="check"><input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} />I performed the checks described above on this exact installer.</label>
        <button disabled={!bridge || busy || !attest || notes.trim().length < 12 || !approval || !['candidate', 'tested'].includes(approval.status)} onClick={() => action(() => bridge!.recordTest(notes))}>Record completed verification</button>
        {approval?.test && <p className="evidence">Recorded {approval.test.at}: {approval.test.notes}</p>}
      </section>
      <section className="panel"><h3>3. Prepare approval</h3><p>Approve only after recording verification. Export saves a preview JSON file for local integration tests. Revocation stops future local offers; old exported snapshots remain independent and must be discarded.</p><div className="actions"><button disabled={!bridge || busy || approval?.status !== 'tested'} onClick={() => action(() => bridge!.approve())}>Approve locally</button><button disabled={!bridge || busy || approval?.status !== 'approved'} onClick={() => action(() => bridge!.exportPreview())}>Export local preview feed</button><button className="secondary" disabled={!bridge || busy || approval?.status !== 'approved'} onClick={() => action(() => bridge!.revoke())}>Revoke local approval</button></div></section>
      {snapshot?.error && <p role="alert" className="error">{snapshot.error}</p>}{snapshot?.message && <p role="status" className="notice">{snapshot.message}</p>}
    </> : <>
      <div className="section-title"><div><p className="eyebrow">FICTIONAL DATA / NO CONNECTED INSTALLATIONS</p><h2>Adoption & reliability demonstration</h2></div><span className="badge">As of {AS_OF}</span></div>
      <p>Every teacher, assignment use, mark and operation below is invented. These figures demonstrate definitions and presentation. They are not investor evidence or actual product usage.</p>
      <div className="metrics"><article><span>Meaningful active teachers · 28 days</span><strong>{metrics.active}</strong><small>{definitions.active}</small></article><article><span>Activated · all fictional starts</span><strong>{metrics.activated}/{metrics.started}</strong><small>{definitions.activation}</small></article><article><span>Repeat assignment adoption</span><strong>{metrics.repeat}/{metrics.active}</strong><small>{definitions.repeat}</small></article></div>
      <section className="panel"><h3>Return after activation</h3><p>Week 1: <strong>{rate(metrics.week1)}</strong> · Week 4: <strong>{rate(metrics.week4)}</strong></p><p>{definitions.retention}</p><table><caption>Fictional activation cohorts</caption><thead><tr><th>Activation month</th><th>Activated</th><th>Week 1 returned / eligible</th><th>Week 4 returned / eligible</th></tr></thead><tbody>{metrics.cohorts.map(c => <tr key={c.month}><td>{c.month}</td><td>{c.activated}</td><td>{rate(c.week1)}</td><td>{rate(c.week4)}</td></tr>)}</tbody></table></section>
      <section className="panel"><h3>Reliability by version · fictional 28 days</h3><p>{definitions.reliability}</p><table><thead><tr><th>Version</th><th>Initial attempts</th><th>Failed initial operations</th><th>Retried operations</th><th>Recovered by retry</th></tr></thead><tbody>{fictionalReliability.map(r => <tr key={r.version}><td>{r.version}</td><td>{r.attempts}</td><td>{r.failures} ({(100 * r.failures / r.attempts).toFixed(1)}%)</td><td>{r.retries}</td><td>{r.recovered}</td></tr>)}</tbody></table></section>
      <section className="panel"><h3>Assignment use by teacher & course · fictional 28 days</h3><p>Rows follow fictional teacher labels and titles, with no quality ranking. Course codes relate the same subject across teachers; no cross-teacher marks ranking is calculated.</p><p>{definitions.averages}</p><table><thead><tr><th>Fictional teacher</th><th>Course</th><th>Assignment title</th><th>Completed workflows</th><th>Assignment average</th></tr></thead><tbody>{metrics.assignments.map(r => <tr key={`${r.teacher}/${r.course}/${r.title}`}><td>{r.teacher}</td><td>{r.course}</td><td>{r.title}</td><td>{r.uses}</td><td>{r.average.toFixed(1)}%</td></tr>)}</tbody></table></section>
      <section className="panel"><h3>Latest class aggregates · fictional 28 days</h3><table><thead><tr><th>Fictional teacher</th><th>Course</th><th>Aggregate average</th><th>Snapshot day</th></tr></thead><tbody>{metrics.classes.map(r => <tr key={`${r.teacher}/${r.course}`}><td>{r.teacher}</td><td>{r.course}</td><td>{r.average.toFixed(1)}%</td><td>{r.day}</td></tr>)}</tbody></table><p>No student records, individual marks, essays or photographs exist in this dataset. Real collection and account/feature controls are deferred.</p></section>
    </>}</main><footer>Student Organizer Control Panel · owner-local preparation · fictional dashboard · teacher settings remain teacher-controlled</footer></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
