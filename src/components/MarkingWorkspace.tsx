import { DictationFeedback } from '../dictation/DictationFeedback';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { getAppIdentity, getIdentityEpoch, getActiveTeacherId, subscribeIdentityChange } from '../services/identityService';
import { MarkingService } from '../marking/markingService';
import type { MarkingActor, MarkingDocument, MarkingDraft, MarkingSession, MarkingAnnotation, MarkingAttempt, MarkingContext, KTAC, CategoryChangeReview, MarkingMode, MarkingImagePage } from '../marking/types';
import { EvidenceImportWizard } from '../marking/ui/EvidenceImportWizard';
import { ReadOnlyMarkingHistory, ReadOnlyOriginalWork } from '../marking/ui/ReadOnlyMarkingHistory';
import { LevelPicker } from './LevelPicker';
import { classroomLevelOptions } from '../services/classroomLevels';
import { useFeedbackPressedKeys } from '../marking/ui/useFeedbackPressedKeys';
import { FeedbackKeyboardControl } from '../marking/ui/FeedbackKeyboardControl';

import { OralEvidenceEditor, RubricEvidenceEditor } from '../marking/ui/ModeEvidence';
import { ImageMarkup } from '../marking/ui/ImageMarkup';
import { exportMarkingReport } from '../marking/report';
import { exportAnnotatedMarkingReport, supportsDesktopPdfExport } from '../marking/annotatedReport';
import { CommentBankPicker } from '../marking/ui/CommentBankPicker';
import { RubricEditor } from '../marking/ui/RubricEditor';
import { CategoryRecoveryReview } from '../marking/ui/CategoryRecoveryReview';
import { categorySignature } from '../marking/categoryRecovery';
import { assertMarkingImagePages, assertMarkingRecord, sessionCategories } from '../marking/validation';
import { sortCategoriesForDisplay } from '../utils/categoryDisplay';
import { AuthorizationError } from '../services/authHelper';
import { DocumentErrorBoundary } from './DocumentErrorBoundary';
import { validateSavedMarkingSession } from '../marking/readValidation';

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
  const feedbackPressedKeys = useFeedbackPressedKeys();
  const epoch = useSyncExternalStore(subscribeIdentityChange, getIdentityEpoch);
  const [actor, setActor] = useState<MarkingActor | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [identityError, setIdentityError] = useState('');
  const [retainedContext, setRetainedContext] = useState<{ scope: string; value: MarkingContext } | null>(null);
  const deniedContextScope = useRef<string | null>(null);
  const contextReadGeneration = useRef(0);
  const currentRead = useRef({ scope: '', request: 0 });
  const [error, setError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [tab, setTab] = useState<'setup' | 'queue' | 'session' | 'rubric' | 'import' | 'archive' | 'history'>('setup');
  const [stage, setStage] = useState<'annotation' | 'final'>('annotation');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [completedCategories, setCompletedCategories] = useState<string[]>([]);
  const [session, setSession] = useState<MarkingSession | null>(null);
  const [draft, setDraft] = useState<MarkingDraft | null>(null);
  const sessionRef = useRef<MarkingSession | null>(null), draftRef = useRef<MarkingDraft | null>(null);
  const actorRef = useRef<MarkingActor | null>(null);
  const generation = useRef(0), savedGeneration = useRef(0), saving = useRef<Promise<void> | null>(null);
  const [saveStatus, setSaveStatus] = useState('Saved locally');
  const [actionBusy, setBusy] = useState(false), [previewFinal, setPreviewFinal] = useState(false);
  const busyRef = useRef(false);
  const rubricDirty = useRef(false), importDirty = useRef(false), composerDirty = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const importBusyRef = useRef(false);
  const [composerRevision, setComposerRevision] = useState(0);
  const importBusyChanged = useCallback((value: boolean) => { importBusyRef.current = value; setImportBusy(value); }, []);
  const composerSources = useRef(new Set<string>());
  const privateSaveSources = useRef(new Set<string>());
  const [privateSaveCount, setPrivateSaveCount] = useState(0);
  const busy = actionBusy || privateSaveCount > 0;
  const trackPrivateSave = useCallback((source: string, saving: boolean) => { if (saving) privateSaveSources.current.add(source); else privateSaveSources.current.delete(source); setPrivateSaveCount(privateSaveSources.current.size); }, []);
  const textBankSaving = useCallback((saving: boolean) => trackPrivateSave('text', saving), [trackPrivateSave]);
  const imageBankSaving = useCallback((saving: boolean) => trackPrivateSave('image', saving), [trackPrivateSave]);
  const rubricBankSaving = useCallback((saving: boolean) => trackPrivateSave('rubric', saving), [trackPrivateSave]);
  const trackComposer = useCallback((source: string, dirty: boolean) => {
    if (dirty) composerSources.current.add(source); else composerSources.current.delete(source);
    composerDirty.current = composerSources.current.size > 0;
  }, []);
  const textComposerDirty = useCallback((dirty: boolean) => trackComposer('text', dirty), [trackComposer]);
  const rubricComposerDirty = useCallback((dirty: boolean) => trackComposer('rubric', dirty), [trackComposer]);
  const imageFeedbackActive = useRef(false);
  const [imageFeedbackOpen, setImageFeedbackOpen] = useState(false);
  const imageCropEditing = useRef(false);
  const imageCropEditingChanged = useCallback((editing: boolean) => { imageCropEditing.current = editing; }, []);
  const imageFeedbackActiveChanged = useCallback((active: boolean) => { imageFeedbackActive.current = active; setImageFeedbackOpen(active); }, []);
  function allowCropDeparture() {
    if (imageCropEditing.current) { setError('Apply or cancel the photo crop before leaving this page. Your saved crop is unchanged.'); return false; }
    return true;
  }
  function allowFeedbackDeparture() {
    if (privateSaveSources.current.size) { setError('Wait for the reviewed comment-bank save to finish before changing feedback.'); return false; }
    if (!allowCropDeparture()) return false;
    if (imageFeedbackActive.current || draftRef.current?.pending) { setError('Save or cancel feedback for the current mark first. Your work is retained.'); return false; }
    return true;
  }
  function confirmWorkspaceDeparture(destination: 'leave marking' | 'switch teacher' | 'switch submission' = 'leave marking') {
    if (privateSaveSources.current.size) { setError('Wait for the reviewed comment-bank save to finish before changing workspace.'); return false; }
    if (!allowCropDeparture()) return false;
    return !(imageFeedbackActive.current || draftRef.current?.pending) || confirm(`Keep unfinished feedback saved as a draft and ${destination}?`);
  }
  const imageComposerDirty = useCallback((dirty: boolean) => trackComposer('image', dirty), [trackComposer]);
  const importDirtyChanged = useCallback((dirty: boolean) => { importDirty.current = dirty; }, []);
  function confirmComposerDeparture(switchSubmission = false) {
    if (privateSaveSources.current.size) { setError('Wait for the reviewed comment-bank save to finish before leaving this feedback context.'); return false; }
    if (!(switchSubmission ? confirmWorkspaceDeparture('switch submission') : allowFeedbackDeparture())) return false;
    if (composerDirty.current && !confirm('Discard the unfinished comment-bank import review? Comments already added to student work are saved.')) return false;
    if (composerDirty.current) setComposerRevision(value => value + 1);
    composerSources.current.clear(); composerDirty.current = false; return true;
  }

  const [conflictReview, setConflictReview] = useState(false);
  const [imageCommentContainer, setImageCommentContainer] = useState<HTMLDivElement | null>(null);
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
    setIdentityError('');
    getAppIdentity(db).then(identity => {
      if (!cancelled && identity.userId === userId && getIdentityEpoch() === started) {
        const value = { userId, deviceId: identity.deviceId, epoch: started }; actorRef.current = value; setActor(value);
      }
    }).catch(e => { if (!cancelled && getIdentityEpoch() === started) setIdentityError(e instanceof Error ? e.message : 'Could not load the acting teacher.'); });
    return () => { cancelled = true; };
  }, [userId, loadRevision]);
  const contextScope = `${assessmentId}:${userId}:${epoch}:${actor?.deviceId ?? ''}`;
  currentRead.current = { scope: contextScope, request: loadRevision };
  const loaded = useLiveQuery(async () => {
    const base = { scope: contextScope, request: loadRevision };
    const readGeneration = ++contextReadGeneration.current;
    const current = () => readGeneration === contextReadGeneration.current && currentRead.current.scope === contextScope && currentRead.current.request === loadRevision && getIdentityEpoch() === epoch && getActiveTeacherId() === userId;
    if (!actor || actor.epoch !== epoch || getActiveTeacherId() !== userId) return { ...base, status: 'inactive' as const };
    try {
      const value = await service.getContext(assessmentId, actor);
      if (!current()) return { ...base, status: 'inactive' as const };
      deniedContextScope.current = null;
      return { ...base, status: 'ready' as const, value };
    } catch (cause) {
      // A retry must not flash the previously authorized snapshot while access is denied.
      if (current() && cause instanceof AuthorizationError) deniedContextScope.current = contextScope;
      return { ...base, status: 'error' as const, denied: cause instanceof AuthorizationError,
        message: cause instanceof Error ? cause.message : 'Could not load marking. Retry when this device is ready.' };
    }
  }, [assessmentId, actor, epoch, userId, contextScope, loadRevision]);
  const load = loaded?.scope === contextScope && loaded.request === loadRevision ? loaded : undefined;
  const context = load?.status === 'ready' ? load.value : (load?.status === 'error' && load.denied) || deniedContextScope.current === contextScope ? null :
    retainedContext?.scope === contextScope ? retainedContext.value : null;
  const loadError = load?.status === 'error' ? load.message : identityError;
  useEffect(() => {
    if (load?.status === 'ready') setRetainedContext({ scope: contextScope, value: load.value });
  }, [load, contextScope]);
  useEffect(() => {
    if (context && !rubricId && context.rubrics.length) setRubricId(context.rubrics[context.rubrics.length - 1].id);
  }, [context, rubricId]);
  function change(next: MarkingDraft) {
    if (busyRef.current || importBusyRef.current || activeRead.error || sessionRef.current?.status !== 'draft') return;
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
    const guard = (event: BeforeUnloadEvent) => { if (rubricDirty.current || importDirty.current || composerDirty.current || imageCropEditing.current || imageFeedbackActive.current || draftRef.current?.pending || savedGeneration.current < generation.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function action(work: () => Promise<void>, rethrow = false) {
    if (busyRef.current || importBusyRef.current || privateSaveSources.current.size) return; busyRef.current = true; setBusy(true); setError('');
    try { validActor(); await flush(); validActor(); await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); if (rethrow) throw e; } finally { busyRef.current = false; setBusy(false); }
  }
  function useSession(next: MarkingSession, attempt: MarkingAttempt, pinned = context?.rubrics.find(item => item.id === next.rubricId)) {
    if (!pinned) throw new Error('The saved rubric is unavailable. Retry loading marking.');
    validateSavedMarkingSession(next, attempt, pinned);
    validActor(); sessionRef.current = next; draftRef.current = next.draft; generation.current = 0; savedGeneration.current = 0;
    setSession(next); setDraft(next.draft); setSaveStatus('Saved locally'); setActiveDocument(attempt.documents[0]?.id ?? ''); setTab('session'); setStage(next.status === 'finalized' ? 'final' : 'annotation'); setSelectedCategory(null); setCompletedCategories([]); setPreviewFinal(false); setConflictReview(false); setCategoryReview(null); setSelectedFeedbackIds([]);
  }
  async function reviewCategories() {
    const current = sessionRef.current;
    if (!current) return;
    const review = await service.reviewCategoryChanges(current.id, validActor());
    validActor(); setCategoryReview(review); setConflictReview(false); setPreviewFinal(false);
  }
  async function open(attempt: MarkingAttempt, reopen = false) {
    if (!confirmComposerDeparture(sessionRef.current?.attemptId !== attempt.id)) return;
    await action(async () => {
      const fresh = await service.getContext(assessmentId, validActor());
      const history = fresh.sessions.filter(s => s.attemptId === attempt.id).sort((a,b) => b.revision-a.revision);
      // Merely navigating across the class set must not create revisions of finished work.
      const latest = history[0];
      const next = latest?.status === 'finalized' && !reopen ? latest : await service.openSession(attempt.id, validActor());
      useSession(next, attempt, fresh.rubrics.find(item => item.id === next.rubricId));
    });
  }
  const activeRead = useMemo(() => {
    const attempt = context?.attempts.find(a => a.id === session?.attemptId && a.deletedAt === null);
    const rubric = context?.rubrics.find(r => r.id === session?.rubricId);
    try {
      if (attempt) assertMarkingRecord('markingAttempts', attempt);
      if (rubric) assertMarkingRecord('markingRubrics', rubric);
      return { attempt, rubric, error: '' };
    } catch { return { attempt: undefined, rubric: undefined, error: 'This submission could not refresh safely. Original work and your open draft are retained. Retry loading marking before continuing.' }; }
  }, [context, session?.attemptId, session?.rubricId]);
  const lastActiveRead = useRef<{ scope: string; attemptId: string; value: typeof activeRead } | null>(null);
  if (!activeRead.error && activeRead.attempt) lastActiveRead.current = { scope: contextScope, attemptId: activeRead.attempt.id, value: activeRead };
  const displayRead = activeRead.error && lastActiveRead.current?.scope === contextScope && lastActiveRead.current.attemptId === session?.attemptId ? lastActiveRead.current.value : activeRead;
  const activeAttempt = displayRead.attempt;
  const rubric = displayRead.rubric;
  const doc = activeAttempt?.documents.find(d => d.id === activeDocument);
  function captureSelection() {
    if (imageFeedbackActive.current) { setError('Save or cancel feedback for the current mark first. Your work is retained.'); return; }
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
    if (privateSaveSources.current.size) return;
    if (!draft?.pending || (!draft.pending.text.trim() && !draft.pending.level)) return;
    if (composerSources.current.has('text') && !confirm('Discard the unfinished comment-bank import review and save this passage comment? The bank review has not been saved.')) return;
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
        if (!allowFeedbackDeparture()) return;
        setSelectedFeedbackIds(covering.map(a => a.id));
      }}>{text}</mark> : <span key={start}>{text}</span>;
    });
  }

  if (actor && (actor.epoch !== epoch || getActiveTeacherId() !== userId)) return <div className="p-8"><p role="alert">Teacher changed. Protected marking content is hidden. Pending writes from the previous context were blocked. Saved drafts remain with their teacher.</p><button className={button} onClick={onClose}>Close marking</button></div>;
  if (!context) return <div className="p-8 space-y-3"><p role={loadError ? 'alert' : 'status'}>{loadError ? `Marking could not load: ${loadError}` : 'Opening marking…'}</p>{error && <p role="alert">{error}</p>}<button className={button} onClick={() => setLoadRevision(value => value + 1)}>Retry loading marking</button><button className={button} onClick={onClose}>Close marking</button></div>;
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
      useSession(saved, activeAttempt, fresh.rubrics.find(item => item.id === saved.rubricId)); setSaveStatus('Assessment saved to Markbook'); onRefresh();
      if (destination === 'markbook') { (onReturnToMarkbook ?? onClose)(); return; }
      if (destination === 'next') {
        const list = fresh.attempts.filter(item => item.deletedAt === null && item.classEnrollmentId);
        const index = list.findIndex(item => item.id === activeAttempt.id);
        const next = list[index + 1];
        if (next) {
          const history = fresh.sessions.filter(item => item.attemptId === next.id).sort((a,b)=>b.revision-a.revision);
          const opened = history[0]?.status === 'finalized' ? history[0] : await service.openSession(next.id, validActor());
          useSession(opened, next, fresh.rubrics.find(item => item.id === opened.rubricId));
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
  const renderCategoryJudgment = (categoryId: string) => {
    const entry = displayJudgments.find(item => item.judgment.assessmentCategoryId === categoryId);
    if (!entry || !draft || !session) return null;
    const { judgment: j, index: i } = entry;
        const cat=savedCategories.find(c=>c.id===j.assessmentCategoryId);
        const names: Record<string,string> = {K:'Knowledge/Understanding',T:'Thinking',C:'Communication',A:'Application'};
        const set=(patch:Partial<typeof j>)=>{ setCompletedCategories(ids => ids.filter(id => id !== j.assessmentCategoryId)); change({...draft,judgments:draft.judgments.map((old,n)=>n===i?{...old,...patch}:old)}); };
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
  };
  return <div className="max-w-7xl mx-auto p-4 space-y-4 text-slate-900">
    {activeRead.error && <div role="alert" className="rounded border border-amber-500 bg-amber-50 p-3">{activeRead.error} <button className={button} onClick={() => setLoadRevision(value => value + 1)}>Retry loading marking</button></div>}
    {loadError && <div role="alert" className="rounded border border-amber-500 bg-amber-50 p-3">Marking could not refresh: {loadError}. Your open draft is retained. <button className={button} onClick={() => setLoadRevision(value => value + 1)}>Retry loading marking</button></div>}
    <header className="flex flex-wrap gap-3 items-center justify-between border-b pb-3"><div><h1 className="text-xl font-bold">Marking · {context.assessment.title}</h1><p className="text-sm">Draft feedback stays local. Only confirmed finalization changes official marks.</p></div><div className="flex gap-2"><button data-testid="marking-back" className={button} disabled={busy || importBusy} onClick={() => { if (!confirmWorkspaceDeparture()) return; void action(async () => { if ((!rubricDirty.current && !importDirty.current && !composerDirty.current) || confirm('Leave marking and discard unsaved rubric, comment-bank or import preparation? Saved marking feedback is retained.')) onClose(); }); }}>Back to Organizer</button>{onSwitchTeacher && <button className={button} disabled={busy || importBusy} onClick={() => { if (!confirmWorkspaceDeparture('switch teacher')) return; void action(async () => { if ((!rubricDirty.current && !importDirty.current && !composerDirty.current) || confirm('Switch teacher and discard unsaved rubric, comment-bank or import preparation? Saved marking feedback is retained.')) onSwitchTeacher(); }); }}>Switch teacher</button>}</div></header>
    {error && <div role="alert" className="bg-red-50 border border-red-200 p-3 whitespace-pre-wrap">{error}<button className={`${button} ml-3`} onClick={() => void action(async () => {})}>Retry save</button></div>}
    {exportStatus && <p role="status">{exportStatus}</p>}
    <fieldset disabled={busy} className="space-y-4">
    <nav className="flex flex-wrap gap-2" aria-label="Assignment workspace">{(['setup','rubric','import','queue','archive'] as const).filter(t => t !== 'queue' || context.attempts.length > 0).map(t => <button className={button} key={t} disabled={busy || importBusy} aria-pressed={tab === t} onClick={() => { if (confirmComposerDeparture()) void action(async () => setTab(t)); }}>{t === 'setup' ? 'Assignment setup' : t === 'queue' ? 'Marking queue' : t === 'rubric' ? 'Rubric editor' : t === 'archive' ? 'Archive' : context.attempts.length ? 'Add later submissions' : 'Add student work'}</button>)}{session && <button className={button} disabled={busy || importBusy} aria-pressed={tab === 'session'} onClick={() => { if (confirmComposerDeparture()) void action(async () => setTab('session')); }}>Resume current submission</button>}</nav>
    {tab === 'setup' && <section className="space-y-4" aria-label="Assignment setup"><h2 className="text-lg font-semibold">Prepare this assignment</h2><p>Confirm a rubric and add student work, or choose oral or rubric-only assessment.</p><div className="grid gap-4 sm:grid-cols-2"><button className={`${button} bg-white p-6 text-left`} onClick={() => setTab('rubric')}><strong className="block text-lg">Rubric</strong><span>{context.rubrics.length ? `${context.rubrics.length} confirmed version(s). Review or import a new rubric.` : 'Import or paste a rubric, review criteria, then confirm K/T/C/A.'}</span></button><button className={`${button} bg-white p-6 text-left`} onClick={() => setTab('import')}><strong className="block text-lg">Upload</strong><span>{context.attempts.length ? 'Add later submissions or start another assessment mode.' : 'Choose photo ZIP, DOCX batch, single files, oral or rubric-only.'}</span></button></div>{context.attempts.length > 0 && <button className={`${button} bg-blue-700 text-white`} onClick={() => setTab('queue')}>Open marking queue</button>}</section>}
    {!!context.historicalAttempts?.length && <details className="text-sm text-slate-600"><summary>Historical records</summary><button className="underline py-2" disabled={busy || importBusy} aria-pressed={tab === 'history'} onClick={() => { if (allowCropDeparture()) void action(async () => setTab('history')); }}>Former students</button></details>}
    <div hidden={tab !== 'rubric'}>
      {context.rubrics.length > 0 && <section className="bg-white border rounded-xl p-4 space-y-3"><h2 className="font-bold">Choose a confirmed rubric</h2><label>Confirmed rubric<select aria-label="Choose confirmed rubric" className={field} value={rubricId} onChange={e=>setRubricId(e.target.value)}><option value="">Choose a confirmed rubric</option>{context.rubrics.map(r=><option key={r.id} value={r.id}>{r.title} · version {r.version}</option>)}</select></label><p>Using a saved version retains its confirmed criteria and KTCA mappings.</p><button className={button} disabled={!rubricId} onClick={()=>void action(async()=>setTab('import'))}>Continue with confirmed rubric</button></section>}
      <RubricEditor onDirtyChange={dirty => { rubricDirty.current = dirty; }} rubrics={context.rubrics} categories={context.categories.map(c => c.categoryCode as KTAC)} onSave={content => action(async () => { const saved = await service.saveRubric(assessmentId,content,validActor()); validActor(); setRubricId(saved.id); setTab('import'); }, true)} /></div>
    <section hidden={tab !== 'import'} className="bg-white border rounded-xl p-4 space-y-3"><h2 className="font-bold">{context.attempts.length ? 'Add later submissions' : 'Add student work'}</h2><label className="block">Marking mode<select data-testid="marking-import-mode" disabled={importBusy} className={field} value={importMode} onChange={e=>setImportMode(e.target.value as MarkingMode)}><option value="written">Written markup + rubric</option><option value="oral">Oral presentation + rubric</option><option value="rubric">Rubric only</option></select></label>
      <label className="block">Confirmed rubric<select className={field} value={rubricId} disabled={importBusy} onChange={e => setRubricId(e.target.value)}><option value="">Choose a confirmed rubric</option>{context.rubrics.map(r => <option key={r.id} value={r.id}>{r.title} · {r.createdAt}</option>)}</select></label>
      {!context.rubrics.length && <p>Create and confirm a rubric before importing.</p>}
      {importMode !== 'written' && <div className="space-y-3"><p>{importMode === 'oral' ? 'Customize presentation checks and private notes alongside the pinned rubric. Checks do not calculate grades.' : 'Assess the pinned rubric without attaching student work.'}</p><label className="block">Confirm student<select data-testid="marking-mode-student" className={field} value={modeEnrollment} onChange={e=>setModeEnrollment(e.target.value)}><option value="">Choose and confirm student</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label><button data-testid="marking-mode-create" className={button} disabled={!rubricId || !modeEnrollment || busy} onClick={()=>{if(!confirmComposerDeparture())return;void action(async()=>{const attempt=await service.createModeAttempt(assessmentId,rubricId,importMode,modeEnrollment,validActor());const opened=await service.openSession(attempt.id,validActor());useSession(opened,attempt);});}}>Create marking session</button></div>}
      {importMode === 'written' && rubricId && <div><EvidenceImportWizard userId={userId} context={context} rubricId={rubricId} identityKey={`${userId}:${epoch}:${assessmentId}`} validateTeacher={validActor} disabled={busy}
        onDirtyChange={importDirtyChanged} onBusyChange={importBusyChanged}
        onCreate={async group => {
          await flush(); validActor();
          const attempt = group.kind === 'pictures'
            ? await service.importImageAttempt(assessmentId, rubricId, group.pages, group.enrollmentId, validActor())
            : await service.importAttempt(assessmentId, rubricId, group.documents, group.enrollmentId, group.previousAttemptId, validActor());
          return { attemptId: attempt.id };
        }} onStart={async ids => {
          if (!confirmComposerDeparture()) return false;
          await flush(); validActor();
          const fresh = await service.getContext(assessmentId, validActor());
          const attempt = fresh.attempts.find(item => item.id === ids[0]);
          if (!attempt) throw new Error('Saved work is unavailable. Reopen it from the marking queue.');
          const opened = await service.openSession(attempt.id, validActor());
          useSession(opened, attempt, fresh.rubrics.find(item => item.id === opened.rubricId)); return true;
        }} /></div>}
    </section>
    {tab === 'queue' && <fieldset disabled={importBusy}><section className="border rounded-xl bg-white p-4 space-y-3">{initialEnrollmentId && <label className="flex gap-2"><input type="checkbox" checked={allStudents} onChange={e=>setAllStudents(e.target.checked)}/>Show entire class queue</label>}<label>Queue filter<select className={field} value={filter} onChange={e=>setFilter(e.target.value)}>{['all','unmatched','ready','draft','finalized','revision'].map(f=><option key={f}>{f}</option>)}</select></label>{!attempts.length && <p>No submissions yet. Confirm a rubric, then import student work.</p>}
      {attempts.filter(a=>filter==='all'||status(a)===filter).map(a=><div className="border-b py-3 flex flex-wrap gap-3 items-center" key={a.id}><div className="flex-1"><strong>{studentName(context,a.classEnrollmentId)}</strong><p className="text-sm">{(Array.isArray(a.documents)?a.documents:[]).map(d=>d?.name).concat((Array.isArray(a.imagePages)?a.imagePages:[]).map(p=>p?.name)).join(', ') || (a.mode==='oral'?'Oral presentation':'Rubric only')} · {a.mode ?? 'written'} · {status(a)} · {a.createdAt}</p></div>{a.classEnrollmentId ? <button data-testid={`marking-session-open-${a.id}`} className={button} disabled={busy} onClick={()=>void open(a,status(a)==='finalized')}>{status(a)==='finalized'?'Reopen as draft revision':'Open marking'}</button> : <label>Match student<select className={field} defaultValue="" onChange={e=>{const id=e.target.value;if(id)void action(async()=>{await service.matchAttempt(a.id,id,a.version,validActor());});}}><option value="">Choose and confirm student</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label>}
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Keep student work for ${a.id}`} checked={a.keepStudentWork === true} disabled={busy} onChange={event=>{const checked=event.target.checked;void action(async()=>{await service.setKeepStudentWork(a.id,a.version,checked,validActor());});}} />Keep student work</label><p className="text-xs">When off, archiving removes submitted files, source text and visual markup from this app. Marks, rubric, finalized feedback and final revision records remain. Unpublished drafts are discarded only when you confirm Archive. Exporting does not archive.</p>
      {context.commits.filter(c=>c.attemptId===a.id).map(c=><div className="flex flex-wrap gap-2" key={c.id}><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id))}>Report {c.createdAt}</button><button data-testid={`marking-pdf-${c.id}`} className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id,true))}>{supportsDesktopPdfExport() ? 'Export marked PDF' : 'Download marked report for PDF'}</button></div>)}
      <button data-testid={`marking-archive-${a.id}`} className={button} disabled={busy} onClick={()=>{if(!allowCropDeparture())return;if(confirm(a.keepStudentWork ? 'Move this attempt to Archive and keep its submitted work? Only finalized feedback is retained. Unpublished drafts and unfinished edits are discarded. Official marks are unchanged.' : 'Archive this attempt and permanently remove its submitted files, source text and visual markup from this app, including internal history copies? Only finalized feedback, rubric, marks and final revision records remain. Unpublished drafts and unfinished edits are discarded. Existing exported files and older backups are unchanged.'))void action(async()=>{await service.archiveAttempt(a.id,a.version,validActor());if(sessionRef.current?.attemptId===a.id){sessionRef.current=null;draftRef.current=null;setSession(null);setDraft(null);}setTab('archive');});}}>Archive attempt</button></div></div>)}
    </section></fieldset>}
    {tab === 'session' && session && draft && activeAttempt && rubric && <fieldset disabled={Boolean(activeRead.error)}><section className="space-y-4" aria-label="Marking session"><div className="sticky top-0 z-10 bg-blue-50 border rounded-lg p-3 flex flex-wrap gap-3 justify-between"><div><h2 className="font-bold text-lg">{studentName(context,activeAttempt.classEnrollmentId)}</h2><p>Revision {session.revision} · {session.status === 'draft' ? 'Draft — official marks unchanged' : 'Finalized revision — current official results shown below'}</p><span role="status" data-testid="marking-save-status">{saveStatus}</span></div><div className="flex flex-wrap items-center gap-2"><label className="text-sm">Submission<select aria-label="Current submission" className={field} disabled={busy} value={activeAttempt.id} onChange={event => { const target = attempts.find(attempt => attempt.id === event.target.value); if (target) void open(target); }}>{attempts.filter(attempt => attempt.classEnrollmentId).map(attempt => <option key={attempt.id} value={attempt.id}>{studentName(context, attempt.classEnrollmentId)} · {status(attempt)}</option>)}</select></label>{[-1,1].map(step=>{const list=attempts.filter(a=>a.classEnrollmentId);const next=list[list.findIndex(a=>a.id===activeAttempt.id)+step];return <button key={step} className={button} disabled={!next||busy} onClick={()=>next&&void open(next)}>{step<0?'Previous submission':'Next submission'}</button>;})}<button className={button} disabled={busy} onClick={()=>void action(async()=>{})}>Save now</button></div></div>
      {categoriesChanged && <section className="border border-amber-600 bg-amber-50 rounded p-3 space-y-2" aria-label="Category change conflict"><p role="alert">Assessment categories changed. Your pending work stays with the original categories until you review the pinned rubric and reconcile. Official marks are unchanged.</p><p>{saveStatus === 'Saved locally' ? 'Original feedback is saved locally and can be reopened after restart.' : 'Pending feedback is not yet saved. Keep this workspace open until saving succeeds.'}</p><button className={button} disabled={busy} onClick={()=>void action(reviewCategories)}>Review changed categories</button></section>}
      {categoryReview && <CategoryRecoveryReview key={categoryReview.token} review={categoryReview} onCancel={()=>setCategoryReview(null)} onReconcile={mapping=>void action(async()=>{const current=sessionRef.current!;const next=await service.reconcileCategoryChanges(current.id,current.version,categoryReview.token,mapping,validActor());validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setSelectedCategory(null);setCompletedCategories([]);setCategoryReview(null);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}/>}
      {!!session.retainedCategoryJudgments?.length && <section className="border rounded bg-white p-3 space-y-2" aria-label="Retained category feedback"><h3 className="font-bold">Retained category feedback</h3><p>Original judgments from category recovery are preserved here and in backups. They do not change official marks.</p>{session.retainedCategoryJudgments.map((item,index)=><div className="border rounded p-2" key={index}><p>{item.category.categoryCode} · {item.judgment.assessed ? `${item.judgment.rawScore} (${item.judgment.inputFormat})` : 'Unassessed'} · original maximum {item.category.maxScore}</p><p className="whitespace-pre-wrap">{item.judgment.feedback}</p></div>)}</section>}
      <nav aria-label="Marking stages" className="flex flex-wrap gap-2"><button className={button} aria-pressed={stage === 'annotation'} disabled={busy} onClick={() => { if (confirmComposerDeparture()) setStage('annotation'); }}>Annotation and evidence</button><button className={`${button} ${stage === 'annotation' && !draft.pending && !imageFeedbackOpen ? 'bg-blue-700 text-white' : ''}`} aria-pressed={stage === 'final'} disabled={busy} onClick={() => { if (confirmComposerDeparture()) void action(async () => setStage('final')); }}>Final grading</button></nav>
      <details className="bg-white border p-3"><summary>Rubric descriptors · {rubric.title}</summary>{rubric.criteria.map(c=><div key={c.id}><h3 className="font-semibold">{c.name} ({c.categoryCode})</h3>{rubric.levels.map(l=><p key={l}><strong>{l}:</strong> {c.descriptors[l]}</p>)}</div>)}</details>
      <div hidden={stage !== 'annotation'}><div className={`marking-session-layout ${!activeAttempt.documents.length && !activeAttempt.imagePages?.length ? 'marking-session-no-work' : ''}`}>
      <div className="marking-work-pane" data-testid="marking-work-pane">
      {activeAttempt.documents.length > 0 && <div><article className="bg-white border rounded-xl p-4"><label>Document<select className={field} value={activeDocument} onChange={e=>{if(allowFeedbackDeparture())setActiveDocument(e.target.value);}}>{activeAttempt.documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><p className="text-xs my-2">Select a passage to write feedback immediately. Orange passages have overlapping feedback.</p><button className={button} disabled={session.status!=='draft'} onMouseDown={e=>e.preventDefault()} onClick={captureSelection}>Write a comment on selected text</button><div ref={selectionRoot} data-testid="marking-document" tabIndex={0} className="whitespace-pre-wrap leading-8 mt-4 select-text" onMouseUp={captureSelection}>{renderDocument()}</div></article>
      {imageCommentContainer && createPortal(<aside className="bg-white border rounded-xl p-4 space-y-3"><h3 className="font-bold">{draft.pending ? 'Passage feedback' : 'Saved evidence'}</h3><p className="text-sm">{draft.annotations.length} evidence item(s) · in document order</p>{draft.pending && <div className="border rounded-lg p-3 space-y-2"><blockquote className="whitespace-pre-wrap">{draft.pending.quote}</blockquote><FeedbackKeyboardControl pressedKeys={feedbackPressedKeys} key={`${contextScope}:${session.id}:${activeDocument}:${draft.pending.id}`} categories={rubric.criteria.map(item => item.categoryCode)} category={rubric.criteria.find(item => item.id === draft.pending?.criterionId)?.categoryCode} level={draft.pending.level} disabled={busy || Boolean(activeRead.error) || session.status !== 'draft' || stage !== 'annotation' || tab !== 'session'} onCategory={category => { const current = draftRef.current; const criterion = rubric.criteria.find(item => item.id === current?.pending?.criterionId && item.categoryCode === category) ?? rubric.criteria.find(item => item.categoryCode === category); if (current?.pending && criterion) change({ ...current, pending: { ...current.pending, criterionId: criterion.id } }); }} onLevel={level => { const current = draftRef.current; if (current?.pending) change({ ...current, pending: { ...current.pending, level } }); }} /><label>Criterion<select aria-label="Criterion" className={field} value={draft.pending.criterionId} onChange={e=>change({...draft,pending:{...draft.pending!,criterionId:e.target.value}})}>{rubric.criteria.map(c=><option key={c.id} value={c.id}>{c.name} ({c.categoryCode})</option>)}</select></label><label>Evidence level (optional)<select aria-label="Evidence level (optional)" className={field} value={draft.pending.level} onChange={e=>change({...draft,pending:{...draft.pending!,level:e.target.value}})}><option value="">No evidence level</option>{classroomLevelOptions(rubric.levels).map(l=><option key={l}>{l}</option>)}</select></label><div>Comment<DictationFeedback target={`${contextScope}:${session.id}:${draft.pending.id}`} maxLength={20000} aria-label="Comment" data-testid="marking-feedback" className={field} disabled={busy || Boolean(activeRead.error) || session.status!=='draft'} value={draft.pending.text} onValue={text=>change({...draft,pending:{...draft.pending!,text}})} /></div><CommentBankPicker key={composerRevision} actor={actor!} disabled={busy} onDirtyChange={textComposerDirty} onSavingChange={textBankSaving} onSelect={text=>change({...draft,pending:{...draft.pending!,text:[draft.pending!.text,text].filter(Boolean).join('\n')}})}/><button data-testid="marking-comment-save" className={`${button} bg-blue-700 text-white`} disabled={busy || (!draft.pending.text.trim() && !draft.pending.level)} onClick={saveComment}>Save comment</button><button className={button} disabled={busy} onClick={()=>{if(confirm(composerSources.current.has('text') ? 'Discard this unfinished comment and its unsaved comment-bank import review?' : 'Discard this unfinished comment?'))change({...draft,pending:null});}}>Cancel comment</button></div>}
      {!draft.pending && selectedFeedbackIds.length > 0 && <p className="text-sm">Highlighted passage has {selectedFeedbackIds.length} feedback item(s). Matching feedback is outlined below.</p>}{[...draft.annotations].filter(a => a.id !== draft.pending?.id).sort((a,b) => activeAttempt.documents.findIndex(d => d.id === a.documentId) - activeAttempt.documents.findIndex(d => d.id === b.documentId) || a.start - b.start || a.end - b.end).map(a=><div data-selected-feedback={selectedFeedbackIds.includes(a.id) ? 'true' : undefined} key={a.id} className={`border rounded-lg p-3 ${selectedFeedbackIds.includes(a.id) ? 'ring-2 ring-blue-500' : ''}`}><p className="text-xs">{rubric.criteria.find(c=>c.id===a.criterionId)?.categoryCode} · {a.level || 'Feedback'} · {rubric.criteria.find(c=>c.id===a.criterionId)?.name} · {activeAttempt.documents.find(d=>d.id===a.documentId)?.name}</p><blockquote>{a.quote}</blockquote><p className="whitespace-pre-wrap">{a.text}</p><button className={button} disabled={session.status!=='draft'} onClick={()=>{if(draft.pending){setError('Save or cancel your unfinished comment first.');return;}setActiveDocument(a.documentId);change({...draft,pending:{...a}});}}>Edit feedback</button><button className={button} disabled={session.status!=='draft'} onClick={()=>change({...draft,annotations:draft.annotations.filter(item=>item.id!==a.id),pending:draft.pending?.id===a.id?null:draft.pending})}>Delete feedback</button></div>)}
      </aside>, imageCommentContainer)}</div>}
      {!!activeAttempt.imagePages?.length && <DocumentErrorBoundary resetKey={`image:${activeAttempt.id}:${composerRevision}`} label="This photo editor"><ImageMarkup pressedKeys={feedbackPressedKeys} keyboardActive={tab === 'session' && stage === 'annotation'} dictationScope={`${contextScope}:${session.id}`} onCropEditingChange={imageCropEditingChanged} commentContainer={imageCommentContainer} actor={actor ?? undefined} onComposerDirtyChange={imageComposerDirty} onBankSavingChange={imageBankSaving} onFeedbackActiveChange={imageFeedbackActiveChanged} key={`image:${activeAttempt.id}:${composerRevision}`} pages={activeAttempt.imagePages} feedback={draft.imageFeedback??[]} rubric={rubric} readOnly={session.status!=='draft'} disabled={busy || Boolean(activeRead.error) || session.status!=='draft'} onChange={imageFeedback=>change({...draft,imageFeedback})} onReorder={ids=>change({...draft,imageFeedback:ids.map(id=>draft.imageFeedback!.find(page=>page.pageId===id)!)})}/></DocumentErrorBoundary>}
      </div>
      <aside className="marking-review-pane space-y-4" data-testid="marking-review-pane" aria-label="Rubric and feedback">
      <div ref={setImageCommentContainer} />
      {activeAttempt.mode === 'oral' && draft.oral && <OralEvidenceEditor value={draft.oral} disabled={busy || session.status!=='draft'} onChange={oral=>change({...draft,oral})}/>}
      {(!activeAttempt.documents.length && !activeAttempt.imagePages?.length) && <RubricEvidenceEditor key={`rubric:${activeAttempt.id}:${composerRevision}`} actor={actor ?? undefined} annotations={draft.annotations} imageFeedback={draft.imageFeedback} onComposerDirtyChange={rubricComposerDirty} onBankSavingChange={rubricBankSaving} rubric={rubric} value={draft.rubricFeedback} disabled={busy || session.status!=='draft'} onChange={rubricFeedback=>change({...draft,rubricFeedback})}/>}
      </aside></div></div>
      {stage === 'final' && <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]" data-testid="final-grading-workspace">
      <aside aria-label="Final category decisions" className="space-y-2 md:sticky md:top-4 self-start"><h3 className="font-semibold">Category decisions</h3>{displayJudgments.map(({judgment:j}) => { const category = savedCategories.find(c => c.id === j.assessmentCategoryId); return <button key={j.assessmentCategoryId} className={`${button} block w-full text-left ${selectedCategory === j.assessmentCategoryId ? 'ring-2 ring-blue-500' : ''}`} aria-pressed={selectedCategory === j.assessmentCategoryId} onClick={() => { if (confirmComposerDeparture()) setSelectedCategory(j.assessmentCategoryId); }}><strong>{category?.categoryCode} · {{K:'Knowledge',T:'Thinking',C:'Communication',A:'Application'}[category?.categoryCode ?? 'K']}</strong><span className="block text-sm">{j.assessed ? j.rawScore || 'Choose a level' : j.feedback.trim() ? 'Feedback only' : 'Unassessed'}{completedCategories.includes(j.assessmentCategoryId) ? ' · reviewed' : ''}</span></button>; })}</aside>
      <section className="bg-white border rounded-xl p-4 space-y-4"><h3 className="font-bold">Category judgments and final review</h3><p>Choose a category on the left, review its evidence and make your judgment. Evidence levels are never averaged. Only finalization transfers these decisions to Markbook.</p>
      {selectedCategory ? <section aria-label="Selected category evidence" className="space-y-3"><RubricEvidenceEditor key={`final:${activeAttempt.id}:${selectedCategory}:${composerRevision}`} actor={actor ?? undefined} annotations={draft.annotations} imageFeedback={draft.imageFeedback} onComposerDirtyChange={rubricComposerDirty} onBankSavingChange={rubricBankSaving} rubric={rubric} categoryCode={savedCategories.find(c => c.id === selectedCategory)?.categoryCode} renderCategory={criterion => rubric.criteria.filter(c => c.categoryCode === criterion.categoryCode).length === 1 ? renderCategoryJudgment(selectedCategory) : null} value={draft.rubricFeedback} disabled={busy || session.status!=='draft'} onChange={rubricFeedback=>change({...draft,rubricFeedback})}/>{rubric.criteria.filter(c => c.categoryCode === savedCategories.find(category => category.id === selectedCategory)?.categoryCode).length !== 1 && renderCategoryJudgment(selectedCategory)}<button className={`${button} bg-blue-700 text-white`} disabled={busy || displayJudgments.some(({judgment:j}) => j.assessmentCategoryId === selectedCategory && j.assessed && !j.rawScore)} onClick={() => { if (!confirmComposerDeparture()) return; void action(async () => { setCompletedCategories(ids => [...new Set([...ids, selectedCategory])]); setSelectedCategory(null); }); }}>Finish category</button></section> : <p className="rounded-lg border border-dashed p-5">Choose any category to review or revise its grade.</p>}
      <div hidden={selectedCategory !== null} className="space-y-4"><section aria-label="Overall KTCA summary" className="rounded-lg bg-blue-50 p-3"><h4 className="font-bold">Overall KTCA summary</h4>{displayJudgments.map(({judgment:j})=><p key={j.assessmentCategoryId}>{savedCategories.find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed ? (j.rawScore || 'Choose a level') : (j.feedback.trim() ? 'Feedback only' : 'Unassessed')}</p>)}</section>
      {session.status==='finalized' && <button className={button} onClick={()=>void open(activeAttempt,true)}>Reopen as draft revision</button>}<label className="block">Overall student-facing feedback<textarea className={field} disabled={session.status!=='draft'} value={draft.overallFeedback} onChange={e=>change({...draft,overallFeedback:e.target.value})}/></label>
      {session.status==='draft' && <><button data-testid="marking-finalize-preview" className={`${button} ${previewFinal ? '' : 'bg-blue-700 text-white'}`} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}if(draftRef.current?.pending){throw new Error('Save or cancel the pending comment before finalizing.');}if(draftRef.current?.imageFeedback?.some(page=>page.annotations.some(mark=>mark.kind==='comment'&&!mark.text.trim()))){throw new Error('Finish or delete each unfinished image comment before finalizing. Your draft is saved locally.');}setPreviewFinal(true);})}>Review finalization</button><button className={button} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}setConflictReview(true);})}>Resolve newer manual mark conflict</button></>}
      <section className="border rounded-lg p-3 bg-slate-50" aria-label="Current official results"><h4 className="font-bold">Current official results</h4>{sortCategoriesForDisplay(context.categories).map(category=>{const result=currentResults.find(r=>r.assessmentCategoryId===category.id);return <div key={category.id}><p>{category.categoryCode}: {result ? `${result.rawScore} (${result.inputFormat})` : 'Unassessed'}</p>{result?.feedback && <p className="whitespace-pre-wrap">{result.feedback}</p>}</div>;})}<p className="whitespace-pre-wrap">{currentStudentAssessment?.overallFeedback || 'No official overall feedback.'}</p><p className="text-xs">The official markbook remains authoritative. Opening another attempt or changing this draft does not change these results.</p></section>
      {conflictReview && session.status==='draft' && <section className="border-2 border-amber-600 p-4 space-y-2" aria-label="Review official mark conflict"><h4 className="font-bold">Review the current official results above</h4><p>Your draft stays separate. Accepting the current results as a baseline allows a later confirmed finalization to replace them with your reviewed draft. It does not copy or change a mark now.</p><button className={button} onClick={()=>void action(async()=>{const shown=officialSignature(context);const fresh=await service.getContext(assessmentId,validActor());if(officialSignature(fresh)!==shown)throw new Error('Official results changed again. Review the current values before accepting them.');const next=await service.refreshBaseline(session.id,sessionRef.current!.version,validActor(),shown);validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}>Accept reviewed official baseline</button><button className={button} onClick={()=>setConflictReview(false)}>Cancel conflict review</button></section>}
      {previewFinal && <div className="border-2 border-blue-700 p-4 space-y-2" role="region" aria-label="Finalization preview"><h4 className="font-bold">Commit to {studentName(context,activeAttempt.classEnrollmentId)} · {context.assessment.title}</h4>{displayJudgments.map(({judgment:j})=><p key={j.assessmentCategoryId}>{context.categories.find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed?j.rawScore:'Unassessed'} — {j.feedback}</p>)}<p className="whitespace-pre-wrap">{draft.overallFeedback}</p><p>This saves the category results and feedback to this student assessment. It replaces official results only after a successful atomic save.</p><button data-testid="marking-finalize-confirm" className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={()=>void saveFinal('stay')}>Confirm finalization</button></div>}
      <div className="flex flex-wrap gap-3 border-t pt-4" aria-label="Save assessment actions">
        <button data-testid="marking-save-next" className="rounded-lg border border-blue-700 font-semibold px-4 py-3 disabled:opacity-50" disabled={busy || categoriesChanged} onClick={()=>void saveFinal('next')}>Save and next submission</button>
        <button data-testid="marking-save-markbook" className="rounded-lg border-2 border-blue-700 text-blue-900 bg-white font-semibold px-4 py-3 disabled:opacity-50" disabled={busy || categoriesChanged} onClick={()=>void saveFinal('markbook')}>Save and return to Markbook</button>
      </div>
      <p className="text-sm">These actions save the reviewed category levels and feedback to this student's Markbook. Your work stays here if saving fails.</p></div>
      </section>
      </div>}
    </section></fieldset>}
    {(tab === 'history' || tab === 'archive') && initialEnrollmentId && <label className="flex gap-2"><input type="checkbox" checked={allStudents} onChange={e => setAllStudents(e.target.checked)} />Show entire class history</label>}
    {tab === 'history' && <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="Former student assessments"><h2 className="font-bold">Former students</h2><p>Historical submissions and saved feedback for students no longer active in this class. Read-only: viewing does not enroll a student, create a revision or change marks.</p>{!(context.historicalAttempts ?? []).length && <p>No former-student submissions for this assessment.</p>}{(context.historicalAttempts ?? []).filter(a => allStudents || !initialEnrollmentId || a.classEnrollmentId === initialEnrollmentId).map(a => <article key={a.id} className="space-y-2 border-t py-3" data-testid={`marking-historical-${a.id}`}><h3 className="font-semibold">{studentName(context, a.classEnrollmentId)}</h3><p>{a.mode ?? 'written'} · Submitted {a.createdAt}</p><ReadOnlyMarkingHistory attempt={a} context={context} /><DocumentErrorBoundary resetKey={`${a.id}:${a.version}`} label="This saved original"><ReadOnlyOriginalWork attempt={a}/></DocumentErrorBoundary>{context.commits.filter(c => c.attemptId === a.id).map(c => <button key={c.id} className={button} disabled={busy} onClick={() => void action(() => exportCommit(c.id))}>Report {c.createdAt}</button>)}</article>)}</section>}
    {tab === 'archive' && <section className="space-y-4 rounded-xl border bg-white p-4" aria-label="Archived assessments"><h2 className="font-bold">Archive</h2><p>Retained assessment records: student, class, assessment and date; final category judgments and marks; rubric version and finalized feedback; final revision history. Archived work is read-only.</p>{!(context.archivedAttempts ?? []).length && <p>No archived attempts for this assessment.</p>}{(context.archivedAttempts ?? []).filter(a=>allStudents || !initialEnrollmentId || a.classEnrollmentId===initialEnrollmentId).map(a=><article key={a.id} className="space-y-2 border-t py-3" data-testid={`marking-archived-${a.id}`}><h3 className="font-semibold">{studentName(context,a.classEnrollmentId)}</h3><p>{context.assessment.title} · Archived {a.archivedAt} · {a.keepStudentWork ? 'Student work retained' : 'Student work removed'}</p><ReadOnlyMarkingHistory attempt={a} context={context} />{context.commits.filter(c=>c.attemptId===a.id).map(c=><div className="flex flex-wrap gap-2" key={c.id}><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id))}>Report {c.createdAt}</button><button className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id,true))}>{supportsDesktopPdfExport() ? 'Export marked PDF' : 'Download marked report for PDF'}</button></div>)}</article>)}</section>}
    </fieldset>
  </div>;
}
