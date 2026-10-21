import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import './style.css';
type Approval = { status: 'candidate' | 'tested' | 'approved' | 'revoked'; candidate: { version: string; arch: string; sourceCommit: string; artifact: { name: string; bytes: number; sha512: string } }; test: { notes: string; at: string } | null; approvedAt: string | null };
type Snapshot = { approval: Approval | null; mode: 'local-preview-only'; publicationReady: false; message: string; error?: string };
type Bridge = { status(): Promise<Snapshot>; importCandidate(): Promise<Snapshot>; recordTest(notes: string): Promise<Snapshot>; approve(): Promise<Snapshot>; revoke(): Promise<Snapshot>; preparePublication(acknowledgeUnsigned: boolean): Promise<Snapshot>; exportPreview(): Promise<Snapshot> };
declare global { interface Window { ownerConsole?: Bridge } }
function App() {
  const [tab, setTab] = useState<'updates' | 'dashboard'>('updates');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [notes, setNotes] = useState('');
  const [attest, setAttest] = useState(false);
  const [unsignedPreparation, setUnsignedPreparation] = useState(false);
  const [busy, setBusy] = useState(false);
  const bridge = window.ownerConsole;
  useEffect(() => { bridge?.status().then(setSnapshot).catch(() => setSnapshot({ approval: null, mode: 'local-preview-only', publicationReady: false, message: '', error: 'Local approval status is unavailable.' })); }, [bridge]);
  async function action(run: () => Promise<Snapshot>) {
    setBusy(true);
    try { setSnapshot(await run()); }
    catch { setSnapshot(previous => ({ approval: previous?.approval || null, mode: 'local-preview-only', publicationReady: false, message: '', error: 'Local action failed. Nothing was published.' })); }
    finally { setBusy(false); setAttest(false); setUnsignedPreparation(false); }
  }
  const approval = snapshot?.approval;
  return <><header><div className="identity">BC <span>STUDENT ORGANIZER / OWNER TOOLS</span></div><h1>Control Panel</h1><p>Tyler’s separate local console</p></header>
    <div className="boundary"><strong>LOCAL PREVIEW ONLY</strong><span>No live usage. No telemetry. Publication requires separate approval.</span></div>
    <nav aria-label="Owner console"><button aria-current={tab === 'updates' ? 'page' : undefined} onClick={() => setTab('updates')}>Update preparation</button><button aria-current={tab === 'dashboard' ? 'page' : undefined} onClick={() => setTab('dashboard')}>Analytics pipeline</button></nav>
    <main>{tab === 'updates' ? <>
      <div className="section-title"><div><p className="eyebrow">STAGE 1 / RELEASE PREPARATION</p><h2>Approve a tested candidate locally</h2></div><span className="badge">Publishing is a separate action</span></div>
      <p>Import candidate metadata and select the matching Windows NSIS installer. Its filename, size and SHA-512 fingerprint are checked before test evidence, approval and export. The fingerprint binds the approval to file contents; the declared source commit and test notes remain owner attestations. This console never runs the installer.</p>
      <aside><strong>Local approval does not offer an update to teachers.</strong> Prepare exact release assets below. Student Organizer checks the fixed GitHub repository and offers only releases carrying matching owner approval. Nothing becomes available until those assets are separately approved for publication.</aside>
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
      <section className="panel"><h3>4. Prepare delivery files · nothing is published</h3><p>On Windows, recheck the exact installer and its real publisher signature, then save a new folder with the approved installer, latest.yml, approval record and publication instructions. No token, upload or release API is used. Student Organizer will reject missing approval or mismatched metadata after a release is published.</p><label className="check"><input type="checkbox" checked={unsignedPreparation} onChange={e => setUnsignedPreparation(e.target.checked)} />If this installer is unsigned, I explicitly accept preparing it with that warning. Teachers must still acknowledge unsigned installation.</label><button disabled={!bridge || busy || approval?.status !== 'approved'} onClick={() => action(() => bridge!.preparePublication(unsignedPreparation))}>Prepare publication folder</button><p>Preparation is not publication. A signed installer must retain the same verified publisher; an unsigned installer is never described as publisher-verified. A published release must target the exact source commit in the approval record.</p></section>
      {snapshot?.error && <p role="alert" className="error">{snapshot.error}</p>}{snapshot?.message && <p role="status" className="notice">{snapshot.message}</p>}
    </> : <AnalyticsDashboard /> }</main><footer>Student Organizer Control Panel · owner-local preparation · fictional analytics · teacher settings remain teacher-controlled</footer></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
