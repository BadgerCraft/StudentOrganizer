import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { getAppIdentity, getIdentityEpoch, getActiveTeacherId, subscribeIdentityChange } from '../services/identityService';
import { MarkingService } from '../marking/markingService';
import type { MarkingActor, MarkingDocument, MarkingDraft, MarkingSession, MarkingAnnotation, MarkingAttempt, MarkingContext, KTAC, CategoryChangeReview } from '../marking/types';
import { parseMarkingFiles, createPastedDocument } from '../marking/importDocuments';
import { exportMarkingReport } from '../marking/report';
import { RubricEditor } from '../marking/ui/RubricEditor';
import { CategoryRecoveryReview } from '../marking/ui/CategoryRecoveryReview';
import { categorySignature } from '../marking/categoryRecovery';
import { sessionCategories } from '../marking/validation';

const button = 'border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50';
const field = 'border border-slate-300 rounded-lg p-2 w-full bg-white text-slate-900';
const service = new MarkingService(db);
interface Props { assessmentId: string; userId: string; initialEnrollmentId?: string; onClose: () => void; onRefresh: () => void; onSwitchTeacher?: () => void }
function studentName(context: MarkingContext, enrollmentId: string | null) {
  const enrollment = context.enrollments.find(e => e.id === enrollmentId);
  const student = context.students.find(s => s.id === enrollment?.studentId);
  return student ? `${student.firstName} ${student.lastName} (${student.localStudentNumber})` : 'Unmatched submission';
}
export function MarkingWorkspace({ assessmentId, userId, initialEnrollmentId, onClose, onRefresh, onSwitchTeacher }: Props) {
  const epoch = useSyncExternalStore(subscribeIdentityChange, getIdentityEpoch);
  const [actor, setActor] = useState<MarkingActor | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'queue' | 'rubric' | 'import'>('queue');
  const [session, setSession] = useState<MarkingSession | null>(null);
  const [draft, setDraft] = useState<MarkingDraft | null>(null);
  const sessionRef = useRef<MarkingSession | null>(null), draftRef = useRef<MarkingDraft | null>(null);
  const actorRef = useRef<MarkingActor | null>(null);
  const generation = useRef(0), savedGeneration = useRef(0), saving = useRef<Promise<void> | null>(null);
  const [saveStatus, setSaveStatus] = useState('Saved locally');
  const [busy, setBusy] = useState(false), [previewFinal, setPreviewFinal] = useState(false);
  const busyRef = useRef(false);
  const rubricDirty = useRef(false);
  const [conflictReview, setConflictReview] = useState(false);
  const [categoryReview, setCategoryReview] = useState<CategoryChangeReview | null>(null);
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<string[]>([]);
  const [allStudents, setAllStudents] = useState(!initialEnrollmentId);
  const [activeDocument, setActiveDocument] = useState('');
  const [rubricId, setRubricId] = useState('');
  const [paste, setPaste] = useState(''), [importError, setImportError] = useState('');
  const [incoming, setIncoming] = useState<MarkingDocument[]>([]);
  const [match, setMatch] = useState<Record<string,string>>({});
  const [previous, setPrevious] = useState<Record<string,string>>({});
  const [groupFiles, setGroupFiles] = useState(false), [filter, setFilter] = useState('all');
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
    if (busyRef.current || sessionRef.current?.status !== 'draft') return;
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
    const guard = (event: BeforeUnloadEvent) => { if (rubricDirty.current || savedGeneration.current < generation.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function action(work: () => Promise<void>, rethrow = false) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try { validActor(); await flush(); validActor(); await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); if (rethrow) throw e; } finally { busyRef.current = false; setBusy(false); }
  }
  function useSession(next: MarkingSession, attempt: MarkingAttempt) {
    validActor(); sessionRef.current = next; draftRef.current = next.draft; generation.current = 0; savedGeneration.current = 0;
    setSession(next); setDraft(next.draft); setSaveStatus('Saved locally'); setActiveDocument(attempt.documents[0].id); setTab('queue'); setPreviewFinal(false); setConflictReview(false); setCategoryReview(null); setSelectedFeedbackIds([]);
  }
  async function reviewCategories() {
    const current = sessionRef.current;
    if (!current) return;
    const review = await service.reviewCategoryChanges(current.id, validActor());
    validActor(); setCategoryReview(review); setConflictReview(false); setPreviewFinal(false);
  }
  async function open(attempt: MarkingAttempt, reopen = false) {
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
  const exportCommit = async (commitId: string) => {
    const saved = await service.exportContext(commitId, validActor());
    validActor(); await exportMarkingReport(saved);
  };
  return <div className="max-w-7xl mx-auto p-4 space-y-4 text-slate-900">
    <header className="flex flex-wrap gap-3 items-center justify-between border-b pb-3"><div><h1 className="text-xl font-bold">Marking · {context.assessment.title}</h1><p className="text-sm">Draft feedback stays local. Only confirmed finalization changes official marks.</p></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={() => void action(async () => { if (!rubricDirty.current || confirm('Discard your unsaved rubric edits and close marking?')) onClose(); })}>Back to Organizer</button>{onSwitchTeacher && <button className={button} disabled={busy} onClick={() => void action(async () => { if (!rubricDirty.current || confirm('Discard your unsaved rubric edits and switch teacher?')) onSwitchTeacher(); })}>Switch teacher</button>}</div></header>
    {error && <div role="alert" className="bg-red-50 border border-red-200 p-3 whitespace-pre-wrap">{error}<button className={`${button} ml-3`} onClick={() => void action(async () => {})}>Retry save</button></div>}
    <fieldset disabled={busy} className="space-y-4">
    <nav className="flex gap-2">{(['queue','rubric','import'] as const).map(t => <button className={button} key={t} disabled={busy} aria-pressed={tab === t} onClick={() => void action(async () => setTab(t))}>{t === 'queue' ? 'Marking queue' : t === 'rubric' ? 'Rubric editor' : 'Import submissions'}</button>)}</nav>
    <div hidden={tab !== 'rubric'}><RubricEditor onDirtyChange={dirty => { rubricDirty.current = dirty; }} rubrics={context.rubrics} categories={context.categories.map(c => c.categoryCode as KTAC)} onSave={content => action(async () => { const saved = await service.saveRubric(assessmentId,content,validActor()); validActor(); setRubricId(saved.id); setTab('import'); }, true)} /></div>
    {tab === 'import' && <section className="bg-white border rounded-xl p-4 space-y-3"><h2 className="font-bold">Preview and match student work</h2><p className="text-sm">TXT, DOCX or pasted text. Original files are retained locally. Up to 10 files, 2 MB each and 10 MB per batch. Replacement work creates a new attempt; official marks stay unchanged.</p>
      <label className="block">Confirmed rubric<select className={field} value={rubricId} onChange={e => setRubricId(e.target.value)}><option value="">Choose a confirmed rubric</option>{context.rubrics.map(r => <option key={r.id} value={r.id}>{r.title} · {r.createdAt}</option>)}</select></label>
      {!context.rubrics.length && <p>Create and confirm a rubric before importing.</p>}
      <label className="block">Student files<input data-testid="marking-files" className={field} type="file" multiple accept=".txt,.docx" onChange={async e => {const files=Array.from(e.target.files ?? []); e.target.value=''; try { const result=await parseMarkingFiles(files); validActor(); setIncoming(result.documents); setImportError(result.errors.map(e => `${e.name}: ${e.message}`).join('\n')); setMatch({}); setPrevious({}); } catch(e) { setImportError(e instanceof Error ? e.message : 'Files could not be parsed.'); }}} /></label>
      <label className="block">Paste student text<textarea data-testid="marking-paste-text" className={field} value={paste} onChange={e=>setPaste(e.target.value)} /></label><button className={button} disabled={!paste.trim()} onClick={async()=>{try {const document=await createPastedDocument('Pasted text',paste);validActor();setIncoming([document]);setImportError('');setMatch({});setPrevious({});}catch(e){setImportError(String(e));}}}>Preview pasted text</button>
      <label className="flex gap-2"><input type="checkbox" checked={groupFiles} onChange={e=>setGroupFiles(e.target.checked)} />Keep all these files as separate attachments within one student's attempt</label>
      {importError && <p role="alert" className="text-red-700 whitespace-pre-wrap">{importError}</p>}
      {incoming.map((document,index)=><div key={document.id} className="border rounded-lg p-3"><h3 className="font-semibold">{document.name}</h3><details><summary>Review normalized text ({document.text.length} characters)</summary><pre className="whitespace-pre-wrap max-h-64 overflow-auto">{document.text}</pre></details>{(!groupFiles || index===0) && <><label className="block">Confirm student for {document.name}<select className={field} value={match[document.id]||''} onChange={e=>{setMatch({...match,[document.id]:e.target.value});setPrevious({...previous,[document.id]:''});}}><option value="">Unmatched — resolve in queue</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label><label className="block">Attempt relationship<select className={field} value={previous[document.id]||''} onChange={e=>setPrevious({...previous,[document.id]:e.target.value})}><option value="">New attempt</option>{context.attempts.filter(a=>a.classEnrollmentId===match[document.id]).map(a=><option key={a.id} value={a.id}>Resubmission after {a.createdAt}</option>)}</select></label></>}</div>)}
      <button data-testid="marking-import-confirm" className={`${button} bg-blue-700 text-white`} disabled={!incoming.length || !rubricId || busy} onClick={()=>void action(async()=>{const groups=groupFiles?[incoming]:incoming.map(d=>[d]);for(const documents of groups){const id=documents[0].id;await service.importAttempt(assessmentId,rubricId,documents,match[id]||null,previous[id]||null,validActor());validActor();setIncoming(items=>items.filter(item=>!documents.some(saved=>saved.id===item.id)));}setIncoming([]);setPaste('');setTab('queue');})}>Confirm import and roster matches</button>
      <p className="text-xs">Each attempt is committed atomically. If a later item fails, earlier successful imports remain visible in the queue; duplicate imports are rejected.</p>
    </section>}
    {tab === 'queue' && <><section className="border rounded-xl bg-white p-4 space-y-3">{initialEnrollmentId && <label className="flex gap-2"><input type="checkbox" checked={allStudents} onChange={e=>setAllStudents(e.target.checked)}/>Show entire class queue</label>}<label>Queue filter<select className={field} value={filter} onChange={e=>setFilter(e.target.value)}>{['all','unmatched','ready','draft','finalized','revision'].map(f=><option key={f}>{f}</option>)}</select></label>{!attempts.length && <p>No submissions yet. Confirm a rubric, then import student work.</p>}
      {attempts.filter(a=>filter==='all'||status(a)===filter).map(a=><div className="border-b py-3 flex flex-wrap gap-3 items-center" key={a.id}><div className="flex-1"><strong>{studentName(context,a.classEnrollmentId)}</strong><p className="text-sm">{a.documents.map(d=>d.name).join(', ')} · {status(a)} · {a.createdAt}</p></div>{a.classEnrollmentId ? <button data-testid={`marking-session-open-${a.id}`} className={button} disabled={busy} onClick={()=>void open(a,status(a)==='finalized')}>{status(a)==='finalized'?'Reopen as draft revision':'Open marking'}</button> : <label>Match student<select className={field} defaultValue="" onChange={e=>{const id=e.target.value;if(id)void action(async()=>{await service.matchAttempt(a.id,id,a.version,validActor());});}}><option value="">Choose and confirm student</option>{context.enrollments.map(e=><option key={e.id} value={e.id}>{studentName(context,e.id)}</option>)}</select></label>}
      {context.commits.filter(c=>c.attemptId===a.id).map(c=><button key={c.id} className={button} disabled={busy} onClick={()=>void action(()=>exportCommit(c.id))}>Report {c.createdAt}</button>)}<button className={button} disabled={busy || session?.attemptId===a.id} onClick={()=>{if(confirm('Archive this attempt? Its originals and marking history remain in backups.'))void action(async()=>{await service.archiveAttempt(a.id,a.version,validActor());});}}>Archive attempt</button></div>)}
    </section>
    {session && draft && activeAttempt && rubric && <section className="space-y-4" aria-label="Marking session"><div className="sticky top-0 z-10 bg-blue-50 border rounded-lg p-3 flex flex-wrap gap-3 justify-between"><div><h2 className="font-bold text-lg">{studentName(context,activeAttempt.classEnrollmentId)}</h2><p>Revision {session.revision} · {session.status === 'draft' ? 'Draft — official marks unchanged' : 'Finalized revision — current official results shown below'}</p><span role="status" data-testid="marking-save-status">{saveStatus}</span></div><div className="flex gap-2">{[-1,1].map(step=>{const list=attempts.filter(a=>a.classEnrollmentId);const next=list[list.findIndex(a=>a.id===activeAttempt.id)+step];return <button key={step} className={button} disabled={!next||busy} onClick={()=>next&&void open(next)}>{step<0?'Previous submission':'Next submission'}</button>;})}<button className={button} disabled={busy} onClick={()=>void action(async()=>{})}>Save now</button></div></div>
      {categoriesChanged && <section className="border border-amber-600 bg-amber-50 rounded p-3 space-y-2" aria-label="Category change conflict"><p role="alert">Assessment categories changed. Your pending work stays with the original categories until you review the pinned rubric and reconcile. Official marks are unchanged.</p><p>{saveStatus === 'Saved locally' ? 'Original feedback is saved locally and can be reopened after restart.' : 'Pending feedback is not yet saved. Keep this workspace open until saving succeeds.'}</p><button className={button} disabled={busy} onClick={()=>void action(reviewCategories)}>Review changed categories</button></section>}
      {categoryReview && <CategoryRecoveryReview key={categoryReview.token} review={categoryReview} onCancel={()=>setCategoryReview(null)} onReconcile={mapping=>void action(async()=>{const current=sessionRef.current!;const next=await service.reconcileCategoryChanges(current.id,current.version,categoryReview.token,mapping,validActor());validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setCategoryReview(null);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}/>}
      {!!session.retainedCategoryJudgments?.length && <section className="border rounded bg-white p-3 space-y-2" aria-label="Retained category feedback"><h3 className="font-bold">Retained category feedback</h3><p>Original judgments from category recovery are preserved here and in backups. They do not change official marks.</p>{session.retainedCategoryJudgments.map((item,index)=><div className="border rounded p-2" key={index}><p>{item.category.categoryCode} · {item.judgment.assessed ? `${item.judgment.rawScore} (${item.judgment.inputFormat})` : 'Unassessed'} · original maximum {item.category.maxScore}</p><p className="whitespace-pre-wrap">{item.judgment.feedback}</p></div>)}</section>}
      <details className="bg-white border p-3"><summary>Rubric descriptors · {rubric.title}</summary>{rubric.criteria.map(c=><div key={c.id}><h3 className="font-semibold">{c.name} ({c.categoryCode})</h3>{rubric.levels.map(l=><p key={l}><strong>{l}:</strong> {c.descriptors[l]}</p>)}</div>)}</details>
      <div className="grid lg:grid-cols-2 gap-4"><article className="bg-white border rounded-xl p-4"><label>Document<select className={field} value={activeDocument} onChange={e=>setActiveDocument(e.target.value)}>{activeAttempt.documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><p className="text-xs my-2">Select a passage, then choose Add selected passage. Orange passages have overlapping feedback.</p><button className={button} disabled={session.status!=='draft'} onMouseDown={e=>e.preventDefault()} onClick={captureSelection}>Add selected passage</button><div ref={selectionRoot} data-testid="marking-document" tabIndex={0} className="whitespace-pre-wrap leading-8 mt-4 select-text" onMouseUp={captureSelection}>{renderDocument()}</div></article>
      <aside className="bg-white border rounded-xl p-4 space-y-3"><h3 className="font-bold">Passage feedback</h3>{draft.pending && <div className="border rounded-lg p-3 space-y-2"><blockquote className="whitespace-pre-wrap">{draft.pending.quote}</blockquote><label>Criterion<select className={field} value={draft.pending.criterionId} onChange={e=>change({...draft,pending:{...draft.pending!,criterionId:e.target.value}})}>{rubric.criteria.map(c=><option key={c.id} value={c.id}>{c.name} ({c.categoryCode})</option>)}</select></label><label>Evidence level (optional)<select className={field} value={draft.pending.level} onChange={e=>change({...draft,pending:{...draft.pending!,level:e.target.value}})}><option value="">No evidence level</option>{rubric.levels.map(l=><option key={l}>{l}</option>)}</select></label><label>Comment<textarea data-testid="marking-feedback" className={field} value={draft.pending.text} onChange={e=>change({...draft,pending:{...draft.pending!,text:e.target.value}})} /></label><button data-testid="marking-comment-save" className={button} disabled={!draft.pending.text.trim() && !draft.pending.level} onClick={saveComment}>Save comment</button><button className={button} onClick={()=>{if(confirm('Discard this unfinished comment?'))change({...draft,pending:null});}}>Cancel comment</button></div>}
      {selectedFeedbackIds.length > 0 && <p className="text-sm">Highlighted passage has {selectedFeedbackIds.length} feedback item(s). Matching feedback is outlined below.</p>}{draft.annotations.map(a=><div data-selected-feedback={selectedFeedbackIds.includes(a.id) ? 'true' : undefined} key={a.id} className={`border rounded-lg p-3 ${selectedFeedbackIds.includes(a.id) ? 'ring-2 ring-blue-500' : ''}`}><p className="text-xs">{rubric.criteria.find(c=>c.id===a.criterionId)?.name} · {a.level} · {activeAttempt.documents.find(d=>d.id===a.documentId)?.name}</p><blockquote>{a.quote}</blockquote><p className="whitespace-pre-wrap">{a.text}</p><button className={button} disabled={session.status!=='draft'} onClick={()=>{if(draft.pending){setError('Save or cancel your unfinished comment first.');return;}setActiveDocument(a.documentId);change({...draft,pending:{...a}});}}>Edit feedback</button><button className={button} disabled={session.status!=='draft'} onClick={()=>change({...draft,annotations:draft.annotations.filter(item=>item.id!==a.id),pending:draft.pending?.id===a.id?null:draft.pending})}>Delete feedback</button></div>)}
      </aside></div>
      <section className="bg-white border rounded-xl p-4 space-y-4"><h3 className="font-bold">Review and official category judgments</h3><p>Evidence labels do not calculate grades. Select the official judgment using the assessment's grading scale. Unassessed is never zero; an existing official mark must be explicitly confirmed or changed.</p>
      {draft.judgments.map((j,i)=>{const cat=savedCategories.find(c=>c.id===j.assessmentCategoryId);const set=(patch:Partial<typeof j>)=>change({...draft,judgments:draft.judgments.map((old,n)=>n===i?{...old,...patch}:old)});return <fieldset className="border p-3 rounded-lg space-y-2" key={j.assessmentCategoryId} disabled={session.status!=='draft'}><legend>{cat?.categoryCode}</legend><label className="flex gap-2"><input type="checkbox" checked={j.assessed} onChange={e=>set({assessed:e.target.checked})} />Assess {cat?.categoryCode}</label>{j.assessed && <><label>Score representation<select className={field} value={j.inputFormat} onChange={e=>set({inputFormat:e.target.value as typeof j.inputFormat,rawScore:''})}><option value="scale_code">Existing achievement scale</option><option value="percentage">Direct percentage</option><option value="raw_points">Points earned</option><option value="descriptive">Descriptive evidence</option></select></label><label>Official {cat?.categoryCode} judgment{j.inputFormat==='scale_code'?<select aria-label={`Official ${cat?.categoryCode} judgment`} className={field} value={j.rawScore} onChange={e=>set({rawScore:e.target.value})}><option value="">Choose supported level</option>{Array.from(new Set([...(context.scaleOptions[cat?.id||'']||[]), ...(j.rawScore ? [j.rawScore] : [])])).map(l=><option key={l}>{l}</option>)}</select>:<input aria-label={`Official ${cat?.categoryCode} judgment`} className={field} value={j.rawScore} onChange={e=>set({rawScore:e.target.value})}/>}</label></>}<label>Category {cat?.categoryCode} feedback<textarea className={field} value={j.feedback} onChange={e=>set({feedback:e.target.value})}/></label></fieldset>})}
      {session.status==='finalized' && <button className={button} onClick={()=>void open(activeAttempt,true)}>Reopen as draft revision</button>}<label className="block">Overall student-facing feedback<textarea className={field} disabled={session.status!=='draft'} value={draft.overallFeedback} onChange={e=>change({...draft,overallFeedback:e.target.value})}/></label>
      {session.status==='draft' && <><button data-testid="marking-finalize-preview" className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}if(draftRef.current?.pending){throw new Error('Save or cancel the pending comment before finalizing.');}setPreviewFinal(true);})}>Review finalization</button><button className={button} disabled={busy} onClick={()=>void action(async()=>{if(categoriesChanged){await reviewCategories();return;}setConflictReview(true);})}>Resolve newer manual mark conflict</button></>}
      <section className="border rounded-lg p-3 bg-slate-50" aria-label="Current official results"><h4 className="font-bold">Current official results</h4>{context.categories.map(category=>{const result=currentResults.find(r=>r.assessmentCategoryId===category.id);return <div key={category.id}><p>{category.categoryCode}: {result ? `${result.rawScore} (${result.inputFormat})` : 'Unassessed'}</p>{result?.feedback && <p className="whitespace-pre-wrap">{result.feedback}</p>}</div>;})}<p className="whitespace-pre-wrap">{currentStudentAssessment?.overallFeedback || 'No official overall feedback.'}</p><p className="text-xs">The official markbook remains authoritative. Opening another attempt or changing this draft does not change these results.</p></section>
      {conflictReview && session.status==='draft' && <section className="border-2 border-amber-600 p-4 space-y-2" aria-label="Review official mark conflict"><h4 className="font-bold">Review the current official results above</h4><p>Your draft stays separate. Accepting the current results as a baseline allows a later confirmed finalization to replace them with your reviewed draft. It does not copy or change a mark now.</p><button className={button} onClick={()=>void action(async()=>{const shown=officialSignature(context);const fresh=await service.getContext(assessmentId,validActor());if(officialSignature(fresh)!==shown)throw new Error('Official results changed again. Review the current values before accepting them.');const next=await service.refreshBaseline(session.id,sessionRef.current!.version,validActor(),shown);validActor();sessionRef.current=next;draftRef.current=next.draft;setSession(next);setDraft(next.draft);setConflictReview(false);setPreviewFinal(false);setSaveStatus('Saved locally');})}>Accept reviewed official baseline</button><button className={button} onClick={()=>setConflictReview(false)}>Cancel conflict review</button></section>}
      {previewFinal && <div className="border-2 border-blue-700 p-4 space-y-2" role="region" aria-label="Finalization preview"><h4 className="font-bold">Commit to {studentName(context,activeAttempt.classEnrollmentId)} · {context.assessment.title}</h4>{draft.judgments.map(j=><p key={j.assessmentCategoryId}>{context.categories.find(c=>c.id===j.assessmentCategoryId)?.categoryCode}: {j.assessed?j.rawScore:'Unassessed'} — {j.feedback}</p>)}<p className="whitespace-pre-wrap">{draft.overallFeedback}</p><p>This saves the category results and feedback to this student assessment. It replaces official results only after a successful atomic save.</p><button data-testid="marking-finalize-confirm" className={`${button} bg-blue-700 text-white`} disabled={busy} onClick={()=>void action(async()=>{await service.finalize(session.id,sessionRef.current!.version,validActor());const fresh=await service.getContext(assessmentId,validActor());const saved=fresh.sessions.find(s=>s.id===session.id)!;sessionRef.current=saved;setSession(saved);setPreviewFinal(false);onRefresh();})}>Confirm finalization</button></div>}
      </section>
    </section>}</>}
    </fieldset>
  </div>;
}
