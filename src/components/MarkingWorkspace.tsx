import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { getAppIdentity, getIdentityEpoch, getActiveTeacherId, subscribeIdentityChange } from '../services/identityService';
import { MarkingService } from '../marking/markingService';
import type { MarkingActor, MarkingDocument, MarkingDraft, MarkingSession, MarkingAnnotation, MarkingAttempt, MarkingContext, KTAC, CategoryChangeReview, MarkingMode, MarkingImagePage } from '../marking/types';
import { EvidenceImportWizard } from '../marking/ui/EvidenceImportWizard';
import { LevelPicker } from './LevelPicker';
import { classroomLevelOptions } from '../services/classroomLevels';

import { MarkingModePicker, OralEvidenceEditor, RubricEvidenceEditor } from '../marking/ui/ModeEvidence';
import { ImageMarkup } from '../marking/ui/ImageMarkup';
import { exportMarkingReport } from '../marking/report';
import { exportAnnotatedMarkingReport, supportsDesktopPdfExport } from '../marking/annotatedReport';
import { CommentBankPicker } from '../marking/ui/CommentBankPicker';
import { RubricEditor } from '../marking/ui/RubricEditor';
import { CategoryRecoveryReview } from '../marking/ui/CategoryRecoveryReview';
import { categorySignature } from '../marking/categoryRecovery';
import { assertMarkingImagePages, sessionCategories } from '../marking/validation';
import { sortCategoriesForDisplay } from '../utils/categoryDisplay';

const button = 'border border-slate-400 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed';
const field = 'border border-slate-300 rounded-lg p-2 w-full bg-white text-slate-900';
const service = new MarkingService(db);
interface Props { assessmentId: string; userId: string; initialEnrollmentId?: string; onClose: () => void; onRefresh: () => void; onSwitchTeacher?: () => void; onReturnToMarkbook?: () => void }
function studentName(context: MarkingContext, enrollmentId: string | null) {
  const enrollment = context.historicalEnrollments?.find(e => e.id === enrollmentId) ?? context.enrollments.find(e => e.id === enrollmentId);
  const student = context.students.find(s => s.id === enrollment?.studentId);
  return student ? `${student.firstName} ${student.lastName} (${student.localStudentNumber})` : 'Unmatched submission';
}
export function MarkingWorkspace({ assessmentId, userId, initialEnrollmentId, onClose, onRefresh, onSwitchTeacher, onReturnToMarkbook }: Props) {
  const epoch = useSyncExternalStore(subscribeIdentityChange, getIdentityEpoch);
  const [actor, setActor] = useState<MarkingActor | null>(null);
  const [error, setError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [tab, setTab] = useState<'queue' | 'rubric' | 'import' | 'archive'>('queue');
  const [session, setSession] = useState<MarkingSession | null>(null);
  const [draft, setDraft] = useState<MarkingDraft | null>(null);
  const sessionRef = useRef<MarkingSession | null>(null), draftRef = useRef<MarkingDraft | null>(null);
  const actorRef = useRef<MarkingActor | null>(null);
  const generation = useRef(0), savedGeneration = useRef(0), saving = useRef<Promise<void> | null>(null);
  const [saveStatus, setSaveStatus] = useState('Saved locally');
  const [busy, setBusy] = useState(false), [previewFinal, setPreviewFinal] = useState(false);
  const busyRef = useRef(false);
  const rubricDirty = useRef(false), importDirty = useRef(false), composerDirty = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const importBusyRef = useRef(false);
  const [composerRevision, setComposerRevision] = useState(0);
  const importBusyChanged = useCallback((value: boolean) => { importBusyRef.current = value; setImportBusy(value); }, []);
  const composerSources = useRef(new Set<string>());
  const trackComposer = useCallback((source: string, dirty: boolean) => {
    if (dirty) composerSources.current.add(source); else composerSources.current.delete(source);
    composerDirty.current = composerSources.current.size > 0;
  }, []);
  const textComposerDirty = useCallback((dirty: boolean) => trackComposer('text', dirty), [trackComposer]);
  const rubricComposerDirty = useCallback((dirty: boolean) => trackComposer('rubric', dirty), [trackComposer]);
  const imageComposerDirty = useCallback((dirty: boolean) => trackComposer('image', dirty), [trackComposer]);
  const importDirtyChanged = useCallback((dirty: boolean) => { importDirty.current = dirty; }, []);
  function confirmComposerDeparture() {
    if (composerDirty.current && !confirm('Discard the unfinished comment-bank import review? Comments already added to student work are saved.')) return false;
    if (composerDirty.current) setComposerRevision(value => value + 1);
    composerSources.current.clear(); composerDirty.current = false; return true;
  }

  const [conflictReview, setConflictReview] = useState(false);
  const [categoryReview, setCategoryReview] = useState<CategoryChangeReview | null>(null);
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<string[]>([]);
  const [allStudents, setAllStudents] = useState(!initialEnrollmentId);
  const [activeDocument, setActiveDocument] = useState('');
  const [rubricId, setRubricId] = useState('');
  const [importMode, setImportMode] = useState<MarkingMode>('written');
  const [modeEnrollment, setModeEnrollment] = useState(initialEnrollmentId ?? '');
  const [filter, setFilter] = useState('all');
  const selectionRoot = useRef<HTMLDivElement>(null);
  const validActor = () => {
    const value = actorRef.current;
    if (!value || value.userId !== getActiveTeacherId() || value.epoch !== getIdentityEpoch()) throw new Error('Teacher context changed. Reopen marking under the intended teacher. Pending writes were blocked.');
    return value;
  };
  useEffect(() => {
    const started = getIdentityEpoch(); let cancelled = false;
    getAppIdentity(db).then(identity => {
      if (!cancelled && identity.userId === userId && getIdentityEpoch() === started) {
        const value = { userId, deviceId: identity.deviceId, epoch: started }; actorRef.current = value; setActor(value);
      }
    }).catch(e => setError(String(e.message)));
    return () => { cancelled = true; };
  }, [userId]);
  const context = useLiveQuery(async () => {
    if (!actor || actor.epoch !== epoch || getActiveTeacherId() !== userId) return null;
    try { return await service.getContext(assessmentId, actor); } catch { return null; }
  }, [assessmentId, actor, epoch, userId]);
  useEffect(() => {
    if (context && !rubricId && context.rubrics.length) setRubricId(context.rubrics[context.rubrics.length - 1].id);
  }, [context, rubricId]);
  function change(next: MarkingDraft) {
    if (busyRef.current || importBusyRef.current || sessionRef.current?.status !== 'draft') return;
    try { validActor(); } catch { return; }
    draftRef.current = next; setDraft(next); generation.current++; setSaveStatus('Saving…'); setPreviewFinal(false); setCategoryReview(null);
  }
  async function flush() {
    if (saving.current) { await saving.current; if (savedGeneration.current < generation.current) await flush(); return; }
    const run = async () => {
      while (savedGeneration.current < generation.current) {
        const current = sessionRef.current, value = draftRef.current, target = generation.current;
        if (!current || !value) return;
        const saved = await service.saveDraft(current.id, structuredClone(value), current.version, validActor());
        validActor(); sessionRef.current = saved; setSession(saved); savedGeneration.current = target;
      }
      setSaveStatus('Saved locally');
    };
    saving.current = run();
    try { await saving.current; } catch (e) { setSaveStatus('Not saved — retry before leaving'); setError(e instanceof Error ? e.message : 'Saving failed.'); throw e; } finally { saving.current = null; }
  }
  useEffect(() => {
    if (!draft || savedGeneration.current === generation.current) return;
    const timer = setTimeout(() => { void flush().catch(() => {}); }, 250);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (rubricDirty.current || importDirty.current || composerDirty.current || savedGeneration.current < generation.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function action(work: () => Promise<void>, rethrow = false) {
    if (busyRef.current || importBusyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try { validActor(); await flush(); validActor(); await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); if (rethrow) throw e; } finally { busyRef.current = false; setBusy(false); }
  }
  function useSession(next: MarkingSession, attempt: MarkingAttempt) {
    validActor(); sessionRef.current = next; draftRef.current = next.draft; generation.current = 0; savedGeneration.current = 0;
    setSession(next); setDraft(next.draft); setSaveStatus('Saved locally'); setActiveDocument(attempt.documents[0]?.id ?? ''); setTab('queue'); setPreviewFinal(false); setConflictReview(false); setCategoryReview(null); setSelectedFeedbackIds([]);
  }
  async function reviewCategories() {
    const current = sessionRef.current;
    if (!current) return;
    const review = await service.reviewCategoryChanges(current.id, validActor());
    validActor(); setCategoryReview(review); setConflictReview(false); setPreviewFinal(false);
  }
  async function open(attempt: MarkingAttempt, reopen = false) {
    if (!confirmComposerDeparture()) return;
    await action(async () => {
      const fresh = await service.getContext(assessmentId, validActor());
      const history = fresh.sessions.filter(s => s.attemptId === attempt.id).sort((a,b) => b.revision-a.revision);
      // Merely navigating across the class set must not create revisions of finished work.
      const latest = history[0];
      const next = latest?.status === 'finalized' && !reopen ? latest : await service.openSession(attempt.id, validActor());
      useSession(next, attempt);
    });
  }
  const activeAttempt = context?.attempts.find(a => a.id === session?.attemptId && a.deletedAt === null);
  const rubric = context?.rubrics.find(r => r.id === session?.rubricId);
  const doc = activeAttempt?.documents.find(d => d.id === activeDocument);
  function captureSelection() {
    if (!doc || !draft || !rubric || session?.status !== 'draft' || busyRef.current) return;
    const selected = window.getSelection(); if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0), root = selectionRoot.current;
    if (!root || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const raw = selected.toString(), quote = raw.trim(); if (!quote) return;
    const prefix = document.createRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length + raw.length - raw.trimStart().length;
    if (doc.text.slice(start, start + quote.length) !== quote) { setError('Selection did not match this document. Select again.'); return; }
    if (draft.pending) { setError('Save or cancel your current comment before selecting another passage. Your draft is retained.'); return; }
    change({ ...draft, pending: { id: crypto.randomUUID(), documentId: doc.id, start, end: start + quote.length, quote, criterionId: rubric.criteria[0].id, level: '', text: '' } });
    selected.removeAllRanges();
  }
  function saveComment() {
    if (!draft?.pending || (!draft.pending.text.trim() && !draft.pending.level)) return;
    change({ ...draft, annotations: [...draft.annotations.filter(a => a.id !== draft.pending!.id), draft.pending], pending: null });
  }
  function renderDocument() {
    if (!doc || !draft) return null;
    const annotations = [...draft.annotations.filter(a => a.id !== draft.pending?.id), ...(draft.pending ? [draft.pending] : [])].filter(a => a.documentId === doc.id);
    const boundaries = Array.from(new Set([0, doc.text.length, ...annotations.flatMap(a => [a.start, a.end])])).sort((a,b) => a-b);
    return boundaries.slice(0,-1).map((start,i) => {
      const end = boundaries[i+1], covering = annotations.filter(a => a.start <= start && a.end >= end), text = doc.text.slice(start,end);
      return covering.length ? <mark key={start} className={`${covering.length > 1 ? 'bg-orange-200' : 'bg-yellow-100'} cursor-pointer`} title={`${covering.length} comment(s); select to view feedback`} onClick={() => {
        if (!window.getSelection()?.isCollapsed || busyRef.current) return;
        setSelectedFeedbackIds(covering.map(a => a.id));
      }}>{text}</mark> : <span key={start}>{text}</span>;
    });
  }
  if (actor && (actor.epoch !== epoch || getActiveTeacherId() !== userId)) return <div className="p-8"><p role="alert">Teacher changed. Protected marking content is hidden. Pending writes from the previous context were blocked. Saved drafts remain with their teacher.</p><button className={button} onClick={onClose}>Close marking</button></div>;
  if (!context) return <div className="p-8"><p>{actor ? 'Marking is unavailable for this teacher or assessment.' : 'Opening marking…'}</p>{error && <p role="alert">{error}</p>}<button className={button} onClick={onClose}>Close marking</button></div>;
  const attempts = context.attempts.filter(a => a.deletedAt === null && (allStudents || !initialEnrollmentId || a.classEnrollmentId === initialEnrollmentId));
  const currentStudentAssessment = context.studentAssessments.find(a => a.classEnrollmentId === activeAttempt?.classEnrollmentId);
  const currentResults = context.currentResults.filter(r => r.studentAssessmentId === currentStudentAssessment?.id);
  const savedCategories = session ? sessionCategories(session) : [];
  const displayJudgments = sortCategoriesForDisplay((draft?.judgments || []).map((judgment, index) => ({ judgment, index, categoryCode: savedCategories.find(category => category.id === judgment.assessmentCategoryId)?.categoryCode || 'K' })));
  const categoriesChanged = session?.status === 'draft' && categorySignature(savedCategories) !== categorySignature(context.categories);
  const officialSignature = (value: MarkingContext) => JSON.stringify({
    assessment: value.assessment,
    categories: value.categories,
    studentAssessment: value.studentAssessments.find(a => a.classEnrollmentId === activeAttempt?.classEnrollmentId),
    results: value.currentResults.filter(r => r.studentAssessmentId === value.studentAssessments.find(a => a.classEnrollmentId === activeAttempt?.classEnrollmentId)?.id)
  });
  const status = (attempt: MarkingAttempt) => {
    if (!attempt.classEnrollmentId) return 'unmatched';
    const revisions = context.sessions.filter(s => s.attemptId === attempt.id && s.deletedAt === null);
    if (revisions.some(s => s.status === 'draft')) return revisions.some(s => s.status === 'finalized') ? 'revision' : 'draft';
    return revisions.length ? 'finalized' : 'ready';
  };
  async function saveFinal(destination: 'stay' | 'next' | 'markbook') {
    if (destination === 'markbook' && (rubricDirty.current || importDirty.current) && !confirm('Return to Markbook and discard unsaved rubric or import preparation? Saved marking feedback is retained.')) return;
    if (!confirmComposerDeparture()) return;
    await action(async () => {
      const current = sessionRef.current;
      if (!current || !activeAttempt) return;
      if (categoriesChanged) { await reviewCategories(); return; }
      if (draftRef.current?.pending) throw new Error('Save or cancel your unfinished comment before saving the assessment.');
      await service.finalize(current.id, current.version, validActor());
      const fresh = await service.getContext(assessmentId, validActor());
      const saved = fresh.sessions.find(item => item.id === current.id);
      if (!saved) throw new Error('The assessment was saved. Reopen marking to see its saved status.');
      useSession(saved, activeAttempt); setSaveStatus('Assessment saved to Markbook'); onRefresh();
      if (destination === 'markbook') { (onReturnToMarkbook ?? onClose)(); return; }
      if (destination === 'next') {
        const list = fresh.attempts.filter(item => item.deletedAt === null && item.classEnrollmentId);
        const index = list.findIndex(item => item.id === activeAttempt.id);
        const next = list[index + 1];
        if (next) {
          const history = fresh.sessions.filter(item => item.attemptId === next.id).sort((a,b)=>b.revision-a.revision);
          const opened = history[0]?.status === 'finalized' ? history[0] : await service.openSession(next.id, validActor());
          useSession(opened, next);
        } else { setSaveStatus('Assessment saved to Markbook. No next submission in this queue.'); }
      }
    });
  }
  const exportCommit = async (commitId: string, annotated = false) => {
    const saved = await service.exportContext(commitId, validActor());
    validActor();
    const exported = await (annotated ? exportAnnotatedMarkingReport(saved, () => { validActor(); }) : exportMarkingReport(saved));
    validActor();
    setExportStatus(exported ? (annotated && !supportsDesktopPdfExport() ? 'Print-ready report downloaded. Open it and choose Print / Save as PDF.' : 'Report exported locally.') : 'Export cancelled. Saved work is unchanged.');
  };
  return <div className="max-w-7xl mx-auto p-4 space-y-4 text-slate-900">
    <header className="flex flex-wrap gap-3 items-center justify-between border-b pb-3"><div><h1 className="text-xl font-bold">Marking · {context.assessment.title}</h1><p className="text-sm">Draft feedback stays local. Only confirmed finalization changes official marks.</p></div><div className="flex gap-2"><button className={button} disabled={busy || importBusy} onClick={() => void action(async () => { if ((!rubricDirty.current && !importDirty.current && !composerDirty.current) || confirm('Leave marking and discard unsaved rubric, comment-bank or import preparation? Saved marking feedback is retained.')) onClose(); })}>Back to Organizer</button>{onSwitchTeacher && <button className={button} disabled={busy || importBusy} onClick={() => void action(async () => { if ((!rubricDirty.current && !importDirty.current && !composerDirty.current) || confirm('Switch teacher and discard unsaved rubric, comment-bank or import preparation? Saved marking feedback is retained.')) onSwitchTeacher(); })}>Switch teacher</button>}</div></header>
    {error && <div role="alert" className="bg-red-50 border border-red-200 p-3 whitespace-pre-wrap">{error}<button className={`${button} ml-3`} onClick={() => void action(async () => {})}>Retry save</button></div>}
    {exportStatus && <p role="status">{exportStatus}</p>}
    <fieldset disabled={busy} className="space-y-4">
    <nav className="flex gap-2">{(['queue','rubric','import','archive'] as const).map(t => <button className={button} key={t} disabled={busy || importBusy} aria-pressed={tab === t} onClick={() => void action(async () => setTab(t))}>{t === 'queue' ? 'Marking queue' : t === 'rubric' ? 'Rubric editor' : t === 'archive' ? 'Archive' : 'Import submissions'}</button>)}</nav>
    <div hidden={tab !== 'rubric'}><RubricEditor onDirtyChange={dirty => { rubricDirty.current = dirty; }} rubrics={context.rubrics} categories={context.categories.map(c => c.categoryCode as KTAC)} onSave={content => action(async () => { const saved = await service.saveRubric(assessmentId,content,validActor()); validActor(); setRubricId(saved.id); setTab('import'); }, true)} /></div>
    <section hidden={tab !== 'import'} className="bg-white border rounded-xl p-4 space-y-3"><h2 className="font-bold">Add student work</h2><label className="block">Marking mode<select data-testid="marking-import-mode" disabled={importBusy} className={field} value={importMode} onChange={e=>setImportMode(e.target.value as MarkingMode)}><option value="written">Written markup + rubric</option><option value="oral">Oral presentation + rubric</option><option value="rubric">Rubric only</option></select></label>
      <label className="block">Confirmed rubric<select className={field} value={rubricId} disabled={importBusy} onChange={e => setRubricId(e.target.value)}><option value="">Choose a confirmed rubric</option>{context.rubrics.map(r => <option key={r.id} value={r.id}>{r.title} · {r.createdAt}</option>)}</select></label>
      {!context.rubrics.length && <p>Create and confirm a rubric before importing.</p>}
      {importMode !== 'written' && <div className="space-y-3"><p>{importMode === 'oral' ? 'Customize presentation checks and private notes alongside the pinned rubric. Checks do not calculate grades.' : 'Assess the pinned rubric without attaching student work.'}</p><label className="block">Confirm student<select data-testid="marking-mode-student" className={field} value={modeEnrollment} onChange={e=>setModeEnrollment(e.target.value)}><option value="">Choose and confirm student</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label><button data-testid="marking-mode-create" className={button} disabled={!rubricId || !modeEnrollment || busy} onClick={()=>void action(async()=>{const attempt=await service.createModeAttempt(assessmentId,rubricId,importMode,modeEnrollment,validActor());const opened=await service.openSession(attempt.id,validActor());useSession(opened,attempt);})}>Create marking session</button></div>}
      <div hidden={importMode !== 'written'}><EvidenceImportWizard context={context} rubricId={rubricId} identityKey={`${userId}:${epoch}:${assessmentId}`} validateTeacher={validActor} disabled={busy}
        onDirtyChange={importDirtyChanged} onBusyChange={importBusyChanged}
        onCreate={async group => {
          await flush(); validActor();
          const attempt = group.kind === 'pictures'
            ? await service.importImageAttempt(assessmentId, rubricId, group.pages, group.enrollmentId, validActor())
            : await service.importAttempt(assessmentId, rubricId, group.documents, group.enrollmentId, group.previousAttemptId, validActor());
          return { attemptId: attempt.id };
        }} onStart={async ids => {
          await flush(); validActor();
          const fresh = await service.getContext(assessmentId, validActor());
          const attempt = fresh.attempts.find(item => item.id === ids[0]);
          if (!attempt) throw new Error('Saved work is unavailable. Reopen it from the marking queue.');
          const opened = await service.openSession(attempt.id, validActor());
          useSession(opened, attempt); return true;
        }} /></div>
    </section>
    {tab === 'queue' && <fieldset disabled={importBusy}><MarkingModePicker disabled={busy} onSelect={mode=>void action(async()=>{setImportMode(mode);setTab(context.rubrics.length?'import':'rubric');})}/><section className="border rounded-xl bg-white p-4 space-y-3">{initialEnrollmentId && <label className="flex gap-2"><input type="checkbox" checked={allStudents} onChange={e=>setAllStudents(e.target.checked)}/>Show entire class queue</label>}<label>Queue filter<select className={field} value={filter} onChange={e=>setFilter(e.target.value)}>{['all','unmatched','ready','draft','finalized','revision'].map(f=><option key={f}>{f}</option>)}</select></label>{!attempts.length && <p>No submissions yet. Confirm a rubric, then import student work.</p>}
      {attempts.filter(a=>filter==='all'||status(a)===filter).map(a=><div className="border-b py-3 flex flex-wrap gap-3 items-center" key={a.id}><div className="flex-1"><strong>{studentName(context,a.classEnrollmentId)}</strong><p className="text-sm">{a.documents.map(d=>d.name).concat((a.imagePages??[]).map(p=>p.name)).join(', ') || (a.mode==='oral'?'Oral presentation':'Rubric only')} · {a.mode ?? 'written'} · {status(a)} · {a.createdAt}</p></div>{a.classEnrollmentId ? <button data-testid={`marking-session-open-${a.id}`} className={button} disabled={busy} onClick={()=>void open(a,status(a)==='finalized')}>{status(a)==='finalized'?'Reopen as draft revision':'Open marking'}</button> : <label>Match student<select className={field} defaultValue="" onChange={e=>{const id=e.target.value;if(id)void action(async()=>{await service.matchAttempt(a.id,id,a.version,validActor());});}}><option value="">Choose and confirm student</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label>}
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Keep student work for ${a.id}`} checked={a.keepStudentWork === true} disabled={busy} onChange={event=>{const checked=event.target.checked;void action(async()=>{await service.setKeepStudentWork(a.id,a.version,checked,validActor());});}} />Keep student work</label><p className="text-xs">When off, archiving removes submitted files, source text and visual markup from this app. Marks, rubric, written feedback and revision records remain. Exporting does not archive.</p>
      {context.commits.filter(c=>c.attemptId===a.id).map(c=><div className="flex flex-wrap gap-2" key={c.id}><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id))}>Report {c.createdAt}</button><button data-testid={`marking-pdf-${c.id}`} className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id,true))}>{supportsDesktopPdfExport() ? 'Export marked PDF' : 'Download marked report for PDF'}</button></div>)}
      <button data-testid={`marking-archive-${a.id}`} className={button} disabled={busy} onClick={()=>{if(confirm(a.keepStudentWork ? 'Move this attempt to Archive and keep its submitted work? Marks and feedback are unchanged.' : 'Archive this attempt and permanently remove its submitted files, source text and visual markup from this app, including internal history copies? Written feedback, rubric, marks and revision records remain. Existing exported files and older backups are unchanged.'))void action(async()=>{await service.archiveAttempt(a.id,a.version,validActor());if(sessionRef.current?.attemptId===a.id){sessionRef.current=null;draftRef.current=null;setSession(null);setDraft(null);}setTab('archive');});}}>Archive attempt</button></div></div>)}
    </section>
    {session && draft && activeAttempt && rubric && <section className="space-y-4" aria-label="Marking session"><div className="sticky top-0 z-10 bg-blue-50 border rounded-lg p-3 flex flex-wrap gap-3 justify-between"><div><h2 className="font-bold text-lg">{studentName(context,activeAttempt.classEnrollmentId)}</h2><p>Revision {session.revision} · {session.status === 'draft' ? 'Draft — official marks unchanged' : 'Finalized revision — current official results shown below'}</p><span role="status" data-testid="marking-save-status">{saveStatus}</span></div><div className="flex gap-2">{[-1,1].map(step=>{const list=attempts.filter(a=>a.classEnrollmentId);const next=list[list.findIndex(a=>a.id===activeAttempt.id)+step];return <button key={step} className={button} disabled={!next||busy} onClick={()=>next&&void open(next)}>{step<0?'Previous submission':'Next submission'}</button>;})}<button className={button} disabled={busy} onClick={()=>void action(async()=>{})}>Save now</button></div></div>
      {categoriesChanged && <section className="border border-amber-600 bg-amber-50 rounded p-3 space-y-2" aria-label="Category change conflict"><p role="alert">Assessment categories changed. Your pending work stays with the original categories until you review the pinned rubric and reconcile. Official marks are unchanged.</p><p>{saveStatus === 'Saved locally' ? 'Original feedback is saved locally and can be reopened after restart.' : 'Pending feedback is not yet saved. Keep this workspace open until saving succeeds.'}</p><button className={button} disabled={busy} onClick={()=>void action(reviewCategories)}>Review changed categories</button></section>}
      {categoryReview && <CategoryRecoveryReview key={categoryReview.token} review={categoryReview} onCancel={()=>setCategoryReview(null)} onReconcile={mapping=>void action(async()=>{const current=sessionRef.current!;const next=await service.reconcileCategoryChanges(current.id,current.version,categoryReview.token,mapping,validActor());validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setCategoryReview(null);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}/>}
      {!!session.retainedCategoryJudgments?.length && <section className="border rounded bg-white p-3 space-y-2" aria-label="Retained category feedback"><h3 className="font-bold">Retained category feedback</h3><p>Original judgments from category recovery are preserved here and in backups. They do not change official marks.</p>{session.retainedCategoryJudgments.map((item,index)=><div className="border rounded p-2" key={index}><p>{item.category.categoryCode} · {item.judgment.assessed ? `${item.judgment.rawScore} (${item.judgment.inputFormat})` : 'Unassessed'} · original maximum {item.category.maxScore}</p><p className="whitespace-pre-wrap">{item.judgment.feedback}</p></div>)}</section>}
      <details className="bg-white border p-3"><summary>Rubric descriptors · {rubric.title}</summary>{rubric.criteria.map(c=><div key={c.id}><h3 className="font-semibold">{c.name} ({c.categoryCode})</h3>{rubric.levels.map(l=><p key={l}><strong>{l}:</strong> {c.descriptors[l]}</p>)}</div>)}</details>
      {activeAttempt.documents.length > 0 && <div className="grid lg:grid-cols-2 gap-4"><article className="bg-white border rounded-xl p-4"><label>Document<select className={field} value={activeDocument} onChange={e=>setActiveDocument(e.target.value)}>{activeAttempt.documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><p className="text-xs my-2">Select a passage, then choose Add selected passage. Orange passages have overlapping feedback.</p><button className={button} disabled={session.status!=='draft'} onMouseDown={e=>e.preventDefault()} onClick={captureSelection}>Write a comment on selected text</button><div ref={selectionRoot} data-testid="marking-document" tabIndex={0} className="whitespace-pre-wrap leading-8 mt-4 select-text" onMouseUp={captureSelection}>{renderDocument()}</div></article>
      <aside className="bg-white border rounded-xl p-4 space-y-3"><h3 className="font-bold">Passage feedback</h3>{draft.pending && <div className="border rounded-lg p-3 space-y-2"><blockquote className="whitespace-pre-wrap">{draft.pending.quote}</blockquote><label>Criterion<select className={field} value={draft.pending.criterionId} onChange={e=>change({...draft,pending:{...draft.pending!,criterionId:e.target.value}})}>{rubric.criteria.map(c=><option key={c.id} value={c.id}>{c.name} ({c.categoryCode})</option>)}</select></label><label>Evidence level (optional)<select className={field} value={draft.pending.level} onChange={e=>change({...draft,pending:{...draft.pending!,level:e.target.value}})}><option value="">No evidence level</option>{classroomLevelOptions(rubric.levels).map(l=><option key={l}>{l}</option>)}</select></label><label>Comment<textarea data-testid="marking-feedback" className={field} value={draft.pending.text} onChange={e=>change({...draft,pending:{...draft.pending!,text:e.target.value}})} /></label><CommentBankPicker key={composerRevision} actor={actor!} disabled={busy} onDirtyChange={textComposerDirty} onSelect={text=>change({...draft,pending:{...draft.pending!,text:[draft.pending!.text,text].filter(Boolean).join('\n')}})}/><button data-testid="marking-comment-save" className={button} disabled={!draft.pending.text.trim() && !draft.pending.level} onClick={saveComment}>Save comment</button><button className={button} onClick={()=>{if(confirm('Discard this unfinished comment?'))change({...draft,pending:null});}}>Cancel comment</button></div>}
      {!draft.pending && selectedFeedbackIds.length > 0 && <p className="text-sm">Highlighted passage has {selectedFeedbackIds.length} feedback item(s). Matching feedback is outlined below.</p>}{!draft.pending && draft.annotations.map(a=><div data-selected-feedback={selectedFeedbackIds.includes(a.id) ? 'true' : undefined} key={a.id} className={`border rounded-lg p-3 ${selectedFeedbackIds.includes(a.id) ? 'ring-2 ring-blue-500' : ''}`}><p className="text-xs">{rubric.criteria.find(c=>c.id===a.criterionId)?.name} · {a.level} · {activeAttempt.documents.find(d=>d.id===a.documentId)?.name}</p><blockquote>{a.quote}</blockquote><p className="whitespace-pre-wrap">{a.text}</p><button className={button} disabled={session.status!=='draft'} onClick={()=>{if(draft.pending){setError('Save or cancel your unfinished comment first.');return;}setActiveDocument(a.documentId);change({...draft,pending:{...a}});}}>Edit feedback</button><button className={button} disabled={session.status!=='draft'} onClick={()=>change({...draft,annotations:draft.annotations.filter(item=>item.id!==a.id),pending:draft.pending?.id===a.id?null:draft.pending})}>Delete feedback</button></div>)}
      </aside></div>}
      {!!activeAttempt.imagePages?.length && <ImageMarkup actor={actor ?? undefined} onComposerDirtyChange={imageComposerDirty} key={`image:${activeAttempt.id}:${composerRevision}`} pages={activeAttempt.imagePages} feedback={draft.imageFeedback??[]} rubric={rubric} disabled={busy || session.status!=='draft'} onChange={imageFeedback=>change({...draft,imageFeedback})} onReorder={ids=>change({...draft,imageFeedback:ids.map(id=>draft.imageFeedback!.find(page=>page.pageId===id)!)})}/>}
      {activeAttempt.mode === 'oral' && draft.oral && <OralEvidenceEditor value={draft.oral} disabled={busy || session.status!=='draft'} onChange={oral=>change({...draft,oral})}/>}
      <RubricEvidenceEditor key={`rubric:${activeAttempt.id}:${composerRevision}`} actor={actor ?? undefined} annotations={draft.annotations} imageFeedback={draft.imageFeedback} onComposerDirtyChange={rubricComposerDirty} rubric={rubric} value={draft.rubricFeedback} disabled={busy || session.status!=='draft'} onChange={rubricFeedback=>change({...draft,rubricFeedback})}/>
      <section className="bg-white border rounded-xl p-4 space-y-4"><h3 className="font-bold">Category levels and feedback</h3><p>Choose a category level when you are ready. Criterion evidence stays separate until you deliberately select a category level. Feedback only does not assign a grade.</p>
      {displayJudgments.map(({judgment:j,index:i})=>{
        const cat=savedCategories.find(c=>c.id===j.assessmentCategoryId);
        const names: Record<string,string> = {K:'Knowledge/Understanding',T:'Thinking',C:'Communication',A:'Application'};
        const set=(patch:Partial<typeof j>)=>change({...draft,judgments:draft.judgments.map((old,n)=>n===i?{...old,...patch}:old)});
        return <fieldset className="border p-3 rounded-lg space-y-3" key={j.assessmentCategoryId} disabled={session.status!=='draft'} aria-label={`${cat?.categoryCode} category judgment`}>
          <legend className="font-semibold">{cat?.categoryCode} — {names[cat?.categoryCode ?? '']}</legend>
          <div className="flex gap-2" role="group" aria-label={`${cat?.categoryCode} feedback or level`}>
            <button type="button" className={`${button} ${!j.assessed?'ring-2 ring-blue-700 font-semibold':''}`} aria-pressed={!j.assessed} onClick={()=>set({assessed:false,rawScore:'',inputFormat:'classroom_level'})}>{!j.assessed?'✓ ':''}Feedback only</button>
            <button type="button" className={`${button} ${j.assessed?'ring-2 ring-blue-700 font-semibold':''}`} aria-pressed={j.assessed} onClick={()=>set({assessed:true,...(!j.assessed?{inputFormat:'classroom_level' as const,rawScore:''}:{})})}>{j.assessed?'✓ ':''}Level</button>
          </div>
          {j.assessed && <><LevelPicker label={`Official ${cat?.categoryCode} level`} value={j.inputFormat==='classroom_level'?j.rawScore:''} onChange={rawScore=>set({rawScore,inputFormat:'classroom_level',assessed:true})}/>
            {j.inputFormat!=='classroom_level' && j.rawScore && <p>Previously recorded judgment: {j.rawScore}. Its original calculation is retained unless you select a new level.</p>}
          </>}
          <label className="block">Category {cat?.categoryCode} feedback<textarea className={field} value={j.feedback} onChange={e=>set({feedback:e.target.value})}/></label>
        </fieldset>;
      })}
      <section aria-label="Overall KTCA summary" className="rounded-lg bg-blue-50 p-3"><h4 className="font-bold">Overall KTCA summary</h4>{displayJudgments.map(({judgment:j})=><p key={j.assessmentCategoryId}>{savedCategories.find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed ? (j.rawScore || 'Choose a level') : (j.feedback.trim() ? 'Feedback only' : 'Unassessed')}</p>)}</section>
      {session.status==='finalized' && <button className={button} onClick={()=>void open(activeAttempt,true)}>Reopen as draft revision</button>}<label className="block">Overall student-facing feedback<textarea className={field} disabled={session.status!=='draft'} value={draft.overallFeedback} onChange={e=>change({...draft,overallFeedback:e.target.value})}/></label>
      {session.status==='draft' && <><button data-testid="marking-finalize-preview" className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}if(draftRef.current?.pending){throw new Error('Save or cancel the pending comment before finalizing.');}if(draftRef.current?.imageFeedback?.some(page=>page.annotations.some(mark=>mark.kind==='comment'&&!mark.text.trim()))){throw new Error('Finish or delete each unfinished image comment before finalizing. Your draft is saved locally.');}setPreviewFinal(true);})}>Review finalization</button><button className={button} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}setConflictReview(true);})}>Resolve newer manual mark conflict</button></>}
      <section className="border rounded-lg p-3 bg-slate-50" aria-label="Current official results"><h4 className="font-bold">Current official results</h4>{sortCategoriesForDisplay(context.categories).map(category=>{const result=currentResults.find(r=>r.assessmentCategoryId===category.id);return <div key={category.id}><p>{category.categoryCode}: {result ? `${result.rawScore} (${result.inputFormat})` : 'Unassessed'}</p>{result?.feedback && <p className="whitespace-pre-wrap">{result.feedback}</p>}</div>;})}<p className="whitespace-pre-wrap">{currentStudentAssessment?.overallFeedback || 'No official overall feedback.'}</p><p className="text-xs">The official markbook remains authoritative. Opening another attempt or changing this draft does not change these results.</p></section>
      {conflictReview && session.status==='draft' && <section className="border-2 border-amber-600 p-4 space-y-2" aria-label="Review official mark conflict"><h4 className="font-bold">Review the current official results above</h4><p>Your draft stays separate. Accepting the current results as a baseline allows a later confirmed finalization to replace them with your reviewed draft. It does not copy or change a mark now.</p><button className={button} onClick={()=>void action(async()=>{const shown=officialSignature(context);const fresh=await service.getContext(assessmentId,validActor());if(officialSignature(fresh)!==shown)throw new Error('Official results changed again. Review the current values before accepting them.');const next=await service.refreshBaseline(session.id,sessionRef.current!.version,validActor(),shown);validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}>Accept reviewed official baseline</button><button className={button} onClick={()=>setConflictReview(false)}>Cancel conflict review</button></section>}
      {previewFinal && <div className="border-2 border-blue-700 p-4 space-y-2" role="region" aria-label="Finalization preview"><h4 className="font-bold">Commit to {studentName(context,activeAttempt.classEnrollmentId)} · {context.assessment.title}</h4>{displayJudgments.map(({judgment:j})=><p key={j.assessmentCategoryId}>{context.categories.find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed?j.rawScore:'Unassessed'} — {j.feedback}</p>)}<p className="whitespace-pre-wrap">{draft.overallFeedback}</p><p>This saves the category results and feedback to this student assessment. It replaces official results only after a successful atomic save.</p><button data-testid="marking-finalize-confirm" className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={()=>void saveFinal('stay')}>Confirm finalization</button></div>}
      <div className="flex flex-wrap gap-3 border-t pt-4" aria-label="Save assessment actions">
        <button data-testid="marking-save-next" className="rounded-lg bg-blue-700 text-white font-semibold px-4 py-3 disabled:opacity-50" disabled={busy || categoriesChanged} onClick={()=>void saveFinal('next')}>Save and next submission</button>
        <button data-testid="marking-save-markbook" className="rounded-lg border-2 border-blue-700 text-blue-900 bg-white font-semibold px-4 py-3 disabled:opacity-50" disabled={busy || categoriesChanged} onClick={()=>void saveFinal('markbook')}>Save and return to Markbook</button>
      </div>
      <p className="text-sm">These actions save the reviewed category levels and feedback to this student's Markbook. Your work stays here if saving fails.</p>
      </section>
    </section>}</fieldset>}
    {tab === 'archive' && <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="Archived assessments"><h2 className="font-bold">Archive</h2><p>Retained assessment records: student, class, assessment and date; final category judgments and marks; rubric version and written feedback; revision history. Archived work is read-only.</p>{!(context.archivedAttempts ?? []).length && <p>No archived attempts for this assessment.</p>}{(context.archivedAttempts ?? []).filter(a=>allStudents || !initialEnrollmentId || a.classEnrollmentId===initialEnrollmentId).map(a=><article key={a.id} className="space-y-2 border-t py-3" data-testid={`marking-archived-${a.id}`}><h3 className="font-semibold">{studentName(context,a.classEnrollmentId)}</h3><p>{context.assessment.title} · Archived {a.archivedAt} · {a.keepStudentWork ? 'Student work retained' : 'Student work removed'}</p><p>Rubric: {context.rubrics.find(r=>r.id===a.rubricId)?.title}</p>{context.sessions.filter(item=>item.attemptId===a.id).sort((x,y)=>x.revision-y.revision).map(item=><details key={item.id}><summary>Revision {item.revision} · {item.status} · {item.updatedAt}</summary><p className="whitespace-pre-wrap">{item.draft.overallFeedback}</p>{item.draft.judgments.map(j=><p key={j.assessmentCategoryId}>{sessionCategories(item).find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed?`${j.rawScore} (${j.inputFormat.replace(/_/g,' ')})`:'Not assessed'} · {j.feedback}</p>)}{(item.draft.rubricFeedback??[]).map(f=><p key={f.criterionId}>{context.rubrics.find(r=>r.id===a.rubricId)?.criteria.find(c=>c.id===f.criterionId)?.name}: {f.level} · {f.feedback}</p>)}{(item.draft.archivedFeedback??[]).map(f=><p key={f.id} className="whitespace-pre-wrap">{f.level} {f.text}</p>)}{item.draft.oral && <section aria-label="Private archived observations"><h4 className="font-semibold">Private presentation observations</h4><p className="whitespace-pre-wrap">{item.draft.oral.notes}</p>{item.draft.oral.items.map(check=><p key={check.id}>{check.checked?'Checked':'Unchecked'}: {check.label} · {check.note}</p>)}</section>}{item.retainedCategoryJudgments?.map((retained,index)=><p key={`retained-${index}`}>Retained {retained.category.categoryCode}: {retained.judgment.rawScore} · {retained.judgment.feedback}</p>)}</details>)}{context.commits.filter(c=>c.attemptId===a.id).map(c=><div className="flex flex-wrap gap-2" key={c.id}><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id))}>Report {c.createdAt}</button><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id,true))}>{supportsDesktopPdfExport() ? 'Export marked PDF' : 'Download marked report for PDF'}</button></div>)}</article>)}</section>}
    </fieldset>
  </div>;
}
