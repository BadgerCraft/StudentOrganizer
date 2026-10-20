import { MarkingService } from '../marking/markingService';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { db } from '../db/database';
import { getActiveTeacherId, getAppIdentity, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { CaptureAttachmentService, base64ToBytes } from './attachmentService';
import type { CaptureImportReceipt } from './types';
import { CAPTURE_LIMITS, decodeCapturePackage, type ParsedCapturePackage } from '../../shared/capturePackage';
import { CapturePagePreview } from './CapturePagePreview';
import { AuthorizationError } from '../services/authHelper';

const service = new CaptureAttachmentService(db);
const button = 'rounded-lg border border-slate-400 px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed';
type Actor = { userId: string; deviceId: string; identityEpoch: number };
type Context = Awaited<ReturnType<CaptureAttachmentService['context']>>;
type Page = ParsedCapturePackage['submissions'][number]['pages'][number];
interface CaptureMatchingWorkspaceProps {
  assessmentId: string; userId: string; onClose: () => void; onSwitchTeacher: () => void;
  embedded?: boolean; showImport?: boolean; confirmedRubricId?: string;
  onStart?: (attemptIds: string[]) => Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
export function CaptureMatchingWorkspace({ assessmentId, userId, onClose, onSwitchTeacher, embedded = false, showImport = true, confirmedRubricId, onStart, onBusyChange, onDirtyChange }: CaptureMatchingWorkspaceProps) {
  const epoch = useSyncExternalStore(subscribeIdentityChange, getIdentityEpoch);
  const [actor, setActor] = useState<Actor | null>(null);
  const [lifecycle, setLifecycle] = useState<Awaited<ReturnType<CaptureAttachmentService['lifecycle']>> | null>(null);
  const [appendRoot, setAppendRoot] = useState(''), [rubricId, setRubricId] = useState(''), [markingTarget, setMarkingTarget] = useState('');
  const [context, setContext] = useState<Context | null>(null);
  const [pkg, setPackage] = useState<ParsedCapturePackage | null>(null);
  const [receipts, setReceipts] = useState<CaptureImportReceipt[]>([]);
  const [savedPreview, setSavedPreview] = useState<{label:string; pages:Page[]} | null>(null);
  const [submissionId, setSubmissionId] = useState(''), [enrollmentId, setEnrollmentId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('Choose a completed phone ZIP from local files.');
  const lock = useRef(false), mounted = useRef(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const loadedScope = useRef('');
  const loadGeneration = useRef(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const deniedRead = useRef(false);
  const valid = (value: Actor) => mounted.current && !deniedRead.current && value.userId === getActiveTeacherId() && value.identityEpoch === getIdentityEpoch();
  function quarantineDenied(cause: unknown, expectedEpoch = actor?.identityEpoch ?? epoch) {
    if (!(cause instanceof AuthorizationError) || !mounted.current || getIdentityEpoch() !== expectedEpoch || getActiveTeacherId() !== userId || loadedScope.current !== `${assessmentId}:${userId}:${getIdentityEpoch()}`) return false;
    // A same-epoch membership revocation must hide already loaded records too.
    // Keep drafts/receipts in memory; only a fresh authorized read may reveal them.
    deniedRead.current = true; loadGeneration.current++;
    setAccessDenied(true); setLoadState('error'); setLoadError(cause.message);
    return true;
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const generation = ++loadGeneration.current;
    const started = getIdentityEpoch();
    const scope = `${assessmentId}:${userId}:${started}`;
    const current = () => !cancelled && mounted.current && loadGeneration.current === generation && getIdentityEpoch() === started && getActiveTeacherId() === userId;
    if (loadedScope.current !== scope) {
      // Never carry a departed teacher's previews into a new authority scope.
      setActor(null); setContext(null); setLifecycle(null);
      setPackage(null); setReceipts([]); setSavedPreview(null);
      setSubmissionId(''); setEnrollmentId(''); setAppendRoot(''); setMarkingTarget(''); setRubricId('');
      setError(''); setStatus('Choose a completed phone ZIP from local files.');
      loadedScope.current = scope;
    }
    setLoadState('loading'); setLoadError('');
    void getAppIdentity(db).then(async identity => {
      const value = { userId: identity.userId, deviceId: identity.deviceId, identityEpoch: started };
      if (!current() || identity.userId !== userId) return;
      const next = await service.context(assessmentId, value);
      if (!current()) return;
      const life = await service.lifecycle(assessmentId, value);
      if (!current()) return;
      deniedRead.current = false; setAccessDenied(false);
      setActor(value); setContext(next); setLifecycle(life); setLoadState('ready');
    }).catch(cause => {
      if (current()) {
        if (quarantineDenied(cause, started)) return;
        setLoadError(cause instanceof Error ? cause.message : 'Saved picture attachments could not load.');
        setLoadState('error');
      }
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [assessmentId, userId, epoch, loadAttempt]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); onDirtyChange?.(false); }, [onBusyChange, onDirtyChange]);
  useEffect(() => { onDirtyChange?.(!!pkg && pkg.submissions.some(submission => !receipts.some(receipt => receipt.submissionId === submission.id))); }, [pkg, receipts, onDirtyChange]);
  const selectedRubricId = confirmedRubricId ?? rubricId;
  const stale = accessDenied || loadState !== 'ready' || !actor || actor.identityEpoch !== epoch || getActiveTeacherId() !== userId;
  const matched = new Map(receipts.map(receipt => [receipt.submissionId, receipt]));
  const matchedStudents = new Set(receipts.map(receipt => receipt.classEnrollmentId));
  const selected = pkg?.submissions.find(submission => submission.id === submissionId);
  const student = context?.roster.find(row => row.enrollment.id === enrollmentId);
  const name = (id: string) => {
    const row = context?.roster.find(row => row.enrollment.id === id);
    return row ? `${row.student.firstName} ${row.student.lastName} (${row.student.localStudentNumber})` : 'Saved student attachment';
  };
  async function read(file?: File) {
    if (!file || !actor || lock.current || stale) return;
    if (pkg && pkg.submissions.some(submission => !matched.has(submission.id)) && !window.confirm('Choose another package? Confirmed attachments stay saved. Unmatched sets can be recovered by reopening this ZIP.')) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (!file.name.toLowerCase().endsWith('.zip') || !file.size || file.size > CAPTURE_LIMITS.archiveBytes) throw new Error('Choose a completed phone ZIP, at most 256 MB.');
      setStatus('Validating package and photos locally…');
      const next = await decodeCapturePackage(new Uint8Array(await file.arrayBuffer()));
      if (!valid(actor)) throw new Error('Teacher context changed. Reopen under the intended teacher.');
      const saved = await service.reconcile(assessmentId, next, actor);
      if (!valid(actor)) return;
      const current = await service.context(assessmentId, actor);
      if (!valid(actor)) return;
      const life = await service.lifecycle(assessmentId, actor);
      if (!valid(actor)) return;
      setLifecycle(life); setAppendRoot('');
      setPackage(next); setReceipts(saved); setContext(current); setSubmissionId(''); setEnrollmentId('');
      setStatus(`${next.submissions.length} page sets ready; ${saved.length} already saved. Select a page set and a student, then Confirm match.`);
    } catch (error) { quarantineDenied(error); if (mounted.current) { setError(error instanceof Error ? error.message : String(error)); setStatus('Import failed. Your previous package and saved attachments are retained.'); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function confirmMatch() {
    if (!actor || !pkg || !selected || !student || lock.current || stale || matched.has(selected.id)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const root = lifecycle?.roots.find(r => r.id === appendRoot);
      const target = lifecycle?.targets.find(t => t.id === root?.markingAttemptId);
      const receipt = await service.confirm(assessmentId, pkg, selected.id, student.enrollment.id, actor, root ? { rootAttachmentId: root.id, expectedAttemptVersion: target?.version, sessionVersions: target?.sessionVersions } : undefined);
      // Only a committed receipt changes the matched presentation.
      if (!valid(actor)) return;
      setReceipts(previous => [...previous.filter(item => item.id !== receipt.id), receipt]);
      setStatus(`Saved all ${selected.pages.length} pages to ${name(receipt.classEnrollmentId)}. Matching is complete for this set.`);
      setSubmissionId(''); setEnrollmentId(''); setAppendRoot('');
      try { const life = await service.lifecycle(assessmentId, actor); if (!valid(actor)) return; const next = await service.context(assessmentId, actor); if (!valid(actor)) return; setLifecycle(life); setContext(next); } catch (cause) { if (quarantineDenied(cause)) return; /* Receipt already confirms the durable save. Reopening reloads the saved list. */ }
      if (onStart && selectedRubricId) {
        try {
          const currentLife = await service.lifecycle(assessmentId, actor);
          if (!valid(actor)) return;
          const savedRoot = currentLife.roots.find(item => item.id === (root?.id ?? receipt.attachmentId));
          if (!savedRoot) throw new Error('Saved work is unavailable in this view. Reopen the assignment.');
          const attemptId = savedRoot.markingAttemptId ?? (await new MarkingService(db).bindCaptureRoot(savedRoot.id, { rubricId: selectedRubricId }, { userId: actor.userId, deviceId: actor.deviceId, epoch: actor.identityEpoch })).id;
          if (!valid(actor)) return;
          const life = await service.lifecycle(assessmentId, actor);
          if (!valid(actor)) return;
          setLifecycle(life);
          const opened = await onStart([attemptId]);
          if (!valid(actor)) return;
          if (!opened) throw new Error('Marking could not open.');
        } catch (cause) {
          quarantineDenied(cause);
          if (mounted.current) setError(`Match saved locally. ${cause instanceof Error ? cause.message : String(cause)} Use the saved submission below to retry marking without re-uploading.`);
        }
      }
    } catch (error) { quarantineDenied(error); if (mounted.current) setError(`${error instanceof Error ? error.message : String(error)} Your selection is retained; retry when ready.`); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function previewSaved(attachmentId: string) {
    if (!actor || stale || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const attachment = await service.groupedAttachment(assessmentId, attachmentId, actor);
      if (valid(actor)) setSavedPreview({label:attachment.label,pages:attachment.pages.map(page=>({metadata:page.metadata,bytes:base64ToBytes(page.base64)}))});
    } catch (error) { quarantineDenied(error); if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function bind(rootId: string, existing: boolean) {
    if (!actor || stale || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const target = lifecycle?.targets.find(t => t.id === markingTarget);
      const attempt = await new MarkingService(db).bindCaptureRoot(rootId, existing ? { attemptId: markingTarget, expectedVersion: target?.version, sessionVersions: target?.sessionVersions } : { rubricId: selectedRubricId }, { userId: actor.userId, deviceId: actor.deviceId, epoch: actor.identityEpoch });
      if (valid(actor)) {
        // Refresh the committed association before opening. A failed open can retry
        // the existing attempt instead of trying to bind/import this root again.
        const life = await service.lifecycle(assessmentId, actor);
        if (!valid(actor)) return;
        setLifecycle(life);
        setStatus('Capture submission associated with marking. Original capture receipts are retained.');
        if (onStart) { const opened = await onStart([attempt.id]); if (!valid(actor)) return; if (!opened) throw new Error('Work is saved. Use Open marking below to retry without importing again.'); }
      }
    } catch (error) { quarantineDenied(error); if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function openSaved(attemptId: string) {
    if (!actor || stale || lock.current || !onStart) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const opened = await onStart([attemptId]);
      if (!valid(actor)) return;
      if (!opened) throw new Error('Saved work could not open. Retry Open marking; the original submission is retained.');
    } catch (error) { quarantineDenied(error); if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function close() {
    if (lock.current) return;
    if (pkg && pkg.submissions.some(submission => !matched.has(submission.id)) && !window.confirm('Close with unmatched page sets? Confirmed attachments remain saved. Reopen the ZIP to finish the rest.')) return;
    onClose();
  }
  // Hide prior-scope data synchronously, before the identity effect clears it.
  if (loadedScope.current !== `${assessmentId}:${userId}:${epoch}` || (actor && (actor.identityEpoch !== epoch || getActiveTeacherId() !== userId))) return <section data-testid="capture-matching" role="status" className="p-3">Loading authorized picture attachments…</section>;
  if (accessDenied) return <section data-testid="capture-matching" className="space-y-3 rounded bg-red-50 p-3">
    <p role="alert">{loadError || 'Picture attachments are hidden until access is checked again.'}</p>
    <p>Picture attachments and class records are hidden. Your saved attachments, matches and retained import draft are unchanged.</p>
    {loadState === 'loading' && <p role="status">Checking access to picture attachments…</p>}
    <button type="button" className={button} disabled={busy || loadState === 'loading'} onClick={() => setLoadAttempt(value => value + 1)}>Retry loading picture attachments</button>
    <button type="button" className={button} disabled={busy} onClick={close}>Close matching</button>
  </section>;
  return <section className={embedded ? "space-y-4" : "max-w-7xl mx-auto p-4 space-y-4"} data-testid="capture-matching">
    {loadState === 'loading' && <p role="status">Loading authorized picture attachments…</p>}
    {loadState === 'error' && <div role="alert" className="rounded bg-red-50 p-3 text-red-800"><p>{loadError}</p><p>Saved attachments and matches are retained.</p><button type="button" className={button} disabled={busy} onClick={() => setLoadAttempt(value => value + 1)}>Retry loading picture attachments</button></div>}
    {showImport && <><header className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="text-xl font-bold">Match phone-photo work</h2><p>{context?.assessment.title ?? 'Loading assignment…'}</p></div><div className="flex gap-2">{!embedded && <button className={button} disabled={busy} onClick={onSwitchTeacher}>Switch teacher</button>}<button className={button} disabled={busy} onClick={close}>Close matching</button></div></header>
    <p>Choose the completed ZIP downloaded from your phone or private Drive. Student-name labels help you choose; they never assign a student automatically. Confirm saves the entire page set locally. Then start marking the saved submission below.</p>
    {loadState === 'ready' && stale && <p role="alert">{actor ? 'Teacher context changed. Close and reopen this assignment.' : 'Loading authorized class roster…'}</p>}
    <label className="block">Completed phone package (.zip)<input className="block mt-1" data-testid="capture-zip" type="file" accept=".zip,application/zip" disabled={busy || stale} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void read(file); }} /></label>
    {pkg && <><h2 className="text-xl font-semibold">{pkg.manifest.assignmentName}</h2><div className="grid md:grid-cols-2 gap-5">
      <section aria-label="Phone page sets"><h3 className="font-semibold mb-2">Page sets</h3><div className="space-y-2">
        {[...pkg.submissions].sort((a, b) => Number(matched.has(a.id)) - Number(matched.has(b.id))).map(submission => {
          const receipt = matched.get(submission.id);
          return <button type="button" data-testid={`capture-set-${submission.id}`} aria-pressed={submissionId === submission.id} key={submission.id} disabled={busy || stale || !!receipt} onClick={() => setSubmissionId(submission.id)} className={`${button} block text-left w-full ${receipt ? 'bg-slate-200 text-slate-500' : submissionId === submission.id ? 'bg-blue-100 border-blue-700' : 'bg-white'}`}>
            {submission.label} · {submission.pages.length} page(s) <span className="text-xs">(set {pkg.submissions.indexOf(submission) + 1})</span>{receipt && <span className="block">Saved to {name(receipt.classEnrollmentId)}</span>}
          </button>;
        })}</div><div className="space-y-3 mt-3">{selected?.pages.map(page => <CapturePagePreview key={page.metadata.id} page={page} />)}</div></section>
      <section aria-label="Authorized class roster"><h3 className="font-semibold mb-2">Class roster</h3><p className="text-sm mb-2">Choose the student for the selected page set.</p><div className="space-y-2">{[...(context?.roster ?? [])].sort((a, b) => Number(matchedStudents.has(a.enrollment.id)) - Number(matchedStudents.has(b.enrollment.id))).map(row => <button type="button" key={row.enrollment.id} data-testid={`capture-student-${row.enrollment.id}`} aria-pressed={enrollmentId === row.enrollment.id} disabled={busy || stale} onClick={() => { setEnrollmentId(row.enrollment.id); setAppendRoot(''); }} className={`${button} block w-full text-left ${enrollmentId === row.enrollment.id ? 'bg-blue-100 border-blue-700' : matchedStudents.has(row.enrollment.id) ? 'bg-slate-100 text-slate-600' : 'bg-white'}`}>{name(row.enrollment.id)}{matchedStudents.has(row.enrollment.id) && <span className="block text-sm">Has saved pages</span>}</button>)}</div></section>
    </div><div className="sticky bottom-0 p-3 bg-white border rounded-lg"><p>{selected && student ? `Save “${selected.label}” (${selected.pages.length} pages) to ${name(student.enrollment.id)}?` : 'Select one page set and one student.'}</p><label className="block mt-2">Save destination<select data-testid="capture-append-target" className={button} value={appendRoot} disabled={busy || stale || !student} onChange={event => setAppendRoot(event.target.value)}><option value="">New independent submission</option>{lifecycle?.roots.filter(root => root.enrollmentId === enrollmentId).map(root => { const target = lifecycle.targets.find(t => t.id === root.markingAttemptId); return <option key={root.id} value={root.id} disabled={!!target?.blocked}>Append to {root.label} · {root.pageCount} pages · reference {root.id.slice(-6)}{target?.blocked ? ' — finalized or archived; append blocked' : ''}</option>; })}</select></label><button type="button" data-testid="capture-confirm" className={`${button} mt-2 bg-blue-700 text-white`} disabled={busy || stale || !selected || !student || matched.has(submissionId)} onClick={() => void confirmMatch()}>{busy ? 'Working…' : onStart ? 'Confirm match and start marking' : 'Confirm match'}</button></div></>}
    </>}
    {(showImport || error) && <p role="status" className="rounded bg-blue-50 p-3">{status}</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {!!lifecycle?.roots.length && <section><h2 className="font-semibold">Saved picture attachments</h2><p>Each submission keeps its original page sets and receipts. Appending late pages requires an explicit destination. Finalized or archived marking submissions are read-only.</p>
      {confirmedRubricId === undefined && <label className="block">Confirmed rubric for starting marking<select data-testid="capture-rubric" value={rubricId} onChange={e => setRubricId(e.target.value)} disabled={busy || stale}><option value="">Choose a confirmed rubric</option>{lifecycle.rubrics.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
      <label className="block">Existing marking submission to associate<select data-testid="capture-marking-target" value={markingTarget} onChange={e => setMarkingTarget(e.target.value)} disabled={busy || stale}><option value="">Choose exact existing photo submission</option>{lifecycle.targets.map(t => <option key={t.id} value={t.id} disabled={t.blocked}>{name(t.enrollmentId ?? '')} · {t.pageCount} pages · reference {t.id.slice(-6)}{t.blocked ? ' — finalized or archived' : ''}</option>)}</select></label>
      <ul>{lifecycle.roots.map(root => <li key={root.id} className="my-3 border rounded p-2"><button className={button} disabled={busy || stale} onClick={() => void previewSaved(root.id)}>{root.label} · {root.pageCount} pages · {name(root.enrollmentId)} · View saved pages</button>{root.markingAttemptId ? <div>{onStart && <button data-testid={`capture-open-${root.id}`} className={button} disabled={busy || stale || lifecycle.targets.find(t => t.id === root.markingAttemptId)?.blocked} onClick={() => void openSaved(root.markingAttemptId!)}>Open marking</button>}<p>Associated with marking · reference {root.markingAttemptId.slice(-6)}{lifecycle.targets.find(t => t.id === root.markingAttemptId)?.blocked ? ' — finalized or archived; late append blocked.' : ' — draft; late pages can be appended explicitly.'}</p></div> : <div><button data-testid={`capture-start-${root.id}`} className={button} disabled={busy || stale || !selectedRubricId} onClick={() => void bind(root.id, false)}>Start marking this submission</button><button data-testid={`capture-link-${root.id}`} className={button} disabled={busy || stale || !markingTarget} onClick={() => void bind(root.id, true)}>Associate exact existing marking submission</button></div>}</li>)}</ul>
      {savedPreview && <div><h3>{savedPreview.label} — saved pages</h3>{savedPreview.pages.map((page, index) => <CapturePagePreview key={`${index}-${page.metadata.id}`} page={page}/>)}</div>}
    </section>}

  </section>;
}
