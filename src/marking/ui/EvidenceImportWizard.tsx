import { useEffect, useRef, useState } from 'react';
import { createPastedDocument, parseMarkingFiles } from '../importDocuments';
import { parseMarkingImages } from '../importImages';
import type { MarkingContext } from '../types';
import { confirmEvidenceMatch, createEvidenceGroups, evidenceImportGroups, mergeEvidenceWork, retainEvidenceMatches, workId, workName, type EvidenceImportGroup, type EvidenceWork } from './evidenceImport';

const buttonBase = 'border border-slate-400 rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed';
const button = `${buttonBase} bg-white text-slate-900`;
const primary = `${buttonBase} bg-blue-700 text-white font-semibold`;
const field = 'border border-slate-400 rounded-lg p-2 w-full bg-white text-slate-900';
type Source = 'documents' | 'paste' | 'pictures';
type Step = 'source' | 'add' | 'students' | 'match' | 'review';
export interface EvidenceImportWizardProps {
  context: MarkingContext;
  rubricId: string;
  /** Include both teacher ID and identity epoch. Changing it discards the previous teacher's preview. */
  identityKey: string;
  validateTeacher: () => unknown;
  disabled?: boolean;
  onCreate: (group: EvidenceImportGroup) => Promise<{ attemptId: string } | null>;
  /** Return true only after the first saved attempt has successfully opened for marking. */
  onStart: (attemptIds: string[]) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** A keyed child also makes asynchronous previews from a departed teacher harmless. */
export function EvidenceImportWizard(props: EvidenceImportWizardProps) {
  return <EvidenceImportSteps key={props.identityKey} {...props} />;
}

function EvidenceImportSteps({ context, rubricId, validateTeacher, disabled = false, onCreate, onStart, onDirtyChange, onBusyChange }: EvidenceImportWizardProps) {
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<Source | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState(''), [name, setName] = useState('Pasted work');
  const [items, setItems] = useState<EvidenceWork[]>([]);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multiple'>('single');
  const [selected, setSelected] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [previous, setPrevious] = useState<Record<string, string>>({});
  const [itemChoice, setItemChoice] = useState(''), [studentChoice, setStudentChoice] = useState('');
  const [readErrors, setReadErrors] = useState<{ name: string; message: string; file: File; source: 'documents' | 'pictures' }[]>([]);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [savedCount, setSavedCount] = useState(0);
  const alive = useRef(true), locked = useRef(false);
  const receipts = useRef<Record<string, string>>({});
  const creationRubric = useRef('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = items.length > 0 || paste.trim().length > 0 || files.length > 0 || readErrors.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  const inactive = busy || disabled;
  const partial = savedCount > 0;
  const studentLabel = (id: string) => {
    const enrollment = context.enrollments.find(row => row.id === id);
    const student = context.students.find(row => row.id === enrollment?.studentId);
    return student ? `${student.firstName} ${student.lastName} (${student.localStudentNumber})` : 'Student no longer enrolled';
  };
  const matchedCount = (id: string) => items.filter(item => matches[workId(item)] === id).length;
  const rosterIds = context.enrollments.map(row => row.id);
  let groups: EvidenceImportGroup[] = [], reviewError = '';
  try {
    if (selected.some(id => !rosterIds.includes(id))) throw new Error('The class list changed. Go Back and select current students.');
    groups = evidenceImportGroups(items, selected, matches, previous);
  } catch (e) { reviewError = e instanceof Error ? e.message : 'Review work and student matches.'; }

  async function addWork(retry?: typeof readErrors[number]) {
    if (locked.current || inactive || !source) return;
    locked.current = true; onBusyChange?.(true); setBusy(true); setError(''); setNotice('');
    try {
      validateTeacher();
      const inputSource = retry?.source ?? source, inputFiles = retry ? [retry.file] : files;
      let incoming: EvidenceWork[] = [], errors: { name: string; message: string; file: File }[] = [];
      if (inputSource === 'paste') incoming = [{ kind: 'documents', document: await createPastedDocument(name.trim(), paste) }];
      else if (inputSource === 'documents') {
        const result = await parseMarkingFiles(inputFiles);
        incoming = result.documents.map(document => ({ kind: 'documents', document })); errors = result.errors;
      } else {
        const result = await parseMarkingImages(inputFiles);
        incoming = result.pages.map(page => ({ kind: 'pictures', page })); errors = result.errors;
      }
      validateTeacher();
      if (!alive.current) return;
      const merged = mergeEvidenceWork(items, incoming);
      setItems(merged.items);
      // A retry replaces errors only for the files explicitly retried; other failures remain visible.
      // File object identity is deliberate: names (and metadata) can match different work.
      // Retry uses the retained original File, including after a transient read failure.
      setReadErrors(current => [...current.filter(row => inputSource === 'paste' || !inputFiles.includes(row.file)),
        ...errors.map(row => ({ ...row, source: inputSource as 'documents' | 'pictures' }))]);
      setAcceptPartial(false);
      setNotice(merged.skipped.length ? `Already added; no extra copies: ${merged.skipped.join(', ')}.` : '');
      if (merged.items.length && (incoming.length || merged.skipped.length)) {
        if (retry) {
          // Retrying an older failure must not consume a newer, unadded file selection.
          setFiles(current => current.filter(file => file !== retry.file));
        } else { setFiles([]); setStep('students'); }
      } else if (!errors.length) setError('Choose work to add.');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to add work. Your earlier work is preserved.'); }
    finally { locked.current = false; onBusyChange?.(false); if (alive.current) setBusy(false); }
  }

  function continueStudents() {
    try {
      validateTeacher();
      if (!selected.length || (selectionMode === 'single' && selected.length !== 1)) throw new Error('Select and confirm the intended student.');
      if (readErrors.length && !acceptPartial) throw new Error('Retry the files that were not added, or confirm that you want to continue without them.');
      const kept = retainEvidenceMatches(matches, selected, items);
      // The button explicitly confirms all listed work for this one selected student.
      setMatches(selected.length === 1 ? Object.fromEntries(items.map(item => [workId(item), selected[0]])) : kept);
      setError(''); setStep(selected.length === 1 ? 'review' : 'match');
    } catch (e) { setError(e instanceof Error ? e.message : 'Check your student selection.'); }
  }

  async function startMarking() {
    if (locked.current || inactive) return;
    locked.current = true; onBusyChange?.(true); setBusy(true); setError('');
    try {
      validateTeacher();
      if (!rubricId || reviewError || (readErrors.length && !acceptPartial)) throw new Error(reviewError || 'Confirm the rubric and review files that were not added.');
      if (Object.keys(receipts.current).length && creationRubric.current !== rubricId) throw new Error('The rubric changed after work was saved. Open the saved submissions from the class queue.');
      creationRubric.current = rubricId;
      const ids = await createEvidenceGroups(groups, receipts.current, onCreate, next => {
        if (alive.current) setSavedCount(Object.keys(next).length);
      }, validateTeacher);
      validateTeacher();
      if (!alive.current) return;
      const started = await onStart(ids);
      validateTeacher();
      if (!alive.current) return;
      if (!started) throw new Error('Work is saved locally. Retry to open marking; saved submissions will not be imported again.');
      receipts.current = {}; creationRubric.current = '';
      setItems([]); setFiles([]); setPaste(''); setSelected([]); setMatches({}); setPrevious({});
      setReadErrors([]); setAcceptPartial(false); setSavedCount(0); setStep('source');
      onDirtyChange?.(false);
      setNotice('Work saved locally and ready for marking.');
    } catch (e) { if (alive.current) { setSavedCount(Object.keys(receipts.current).length); setError(e instanceof Error ? e.message : 'Saving failed. Your work and matches are preserved. Retry to continue.'); } }
    finally { locked.current = false; onBusyChange?.(false); if (alive.current) setBusy(false); }
  }

  const reviewWork = (item: EvidenceWork) => item.kind === 'documents'
    ? <pre className="whitespace-pre-wrap max-h-56 overflow-auto bg-slate-50 p-2 border rounded" tabIndex={0}>{item.document.text}</pre>
    : <img className="max-h-56 max-w-full object-contain" alt={`Added work: ${item.page.name}`} src={`data:${item.page.mime};base64,${item.page.base64}`} />;
  const removeWork = (id: string) => {
    setItems(current => current.filter(item => workId(item) !== id));
    setMatches(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };
  return <section className="border rounded-xl bg-white p-4 space-y-4" aria-label="Add student work" data-testid="evidence-import-wizard" aria-busy={busy}>
    <p className="text-sm text-slate-600">{({ source: '1 · Choose source', add: '2 · Add work', students: '3 · Select students', match: '4 · Match work to students', review: '5 · Review and start marking' })[step]}</p>
    {error && <p role="alert" className="text-red-800 whitespace-pre-wrap">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!!readErrors.length && <div className="border border-amber-500 bg-amber-50 p-3"><p className="font-semibold">These files were not added</p><ul>{readErrors.map((row, index) => <li key={`${row.name}:${index}`}>{row.name}: {row.message} <button type="button" className={button} disabled={inactive || partial} onClick={() => void addWork(row)}>Retry {row.name}</button></li>)}</ul><p>Retry the original file above. To use a corrected file, go Back and add it, then explicitly continue without the failed original. Successfully added work and matches are kept.</p>{step !== 'add' && <label className="flex gap-2 mt-2"><input type="checkbox" checked={acceptPartial} disabled={inactive || partial} onChange={e => setAcceptPartial(e.target.checked)} />Continue with only the work successfully added; leave these files out.</label>}</div>}
    {step === 'source' && <>
      <h3 className="font-bold text-lg">Where is the student work?</h3>
      <div className="grid gap-3 sm:grid-cols-3">{(['documents', 'paste', 'pictures'] as const).map(value => <label key={value} className={`border rounded-lg p-3 flex gap-2 ${source === value ? 'border-blue-700 bg-blue-50' : ''}`}><input type="radio" name="evidence-source" checked={source === value} disabled={inactive || (!!items.length && (value === 'pictures') !== (items[0].kind === 'pictures'))} onChange={() => { setSource(value); setFiles([]); setError(''); }} />{value === 'documents' ? 'Upload a text/document file' : value === 'paste' ? 'Paste text' : 'Upload a picture'}</label>)}</div>
      {!!items.length && <p>Added work is kept. To switch between pictures and text, remove the added work in the next step.</p>}
      <button className={primary} disabled={!source || inactive} onClick={() => setStep('add')}>Continue</button>
    </>}
    {step === 'add' && <>
      <h3 className="font-bold text-lg">{source === 'paste' ? 'Paste student work' : source === 'pictures' ? 'Add pictures of student work' : 'Add text or document files'}</h3>
      {source === 'paste' ? <><label className="block">Work title<input className={field} value={name} disabled={inactive} onChange={e => setName(e.target.value)} /></label><label className="block">Student work<textarea className={`${field} min-h-48`} value={paste} disabled={inactive} onChange={e => setPaste(e.target.value)} placeholder="Paste the student's text here. You can review it before marking." /></label></> : <>
        <p>{source === 'pictures' ? 'PNG, JPEG and WebP are supported. Up to 10 pages, 8 MB each and 32 MB total. Images stay on this device; text is not extracted.' : 'UTF-8 .txt and Word .docx are supported: up to 10 files, 2 MB each and 10 MB total. Older .doc files are not supported. Save a .doc as .docx or .txt in Word first.'}</p>
        <label className="block">{source === 'pictures' ? 'Choose pictures' : 'Choose text/document files'}<input className={field} type="file" multiple accept={source === 'pictures' ? '.png,.jpg,.jpeg,.webp' : '.txt,.docx'} disabled={inactive} onChange={e => { const next = Array.from(e.target.files ?? []); e.target.value = ''; if (next.length) setFiles(next); }} /></label>
        {!!files.length && <ul aria-label="Files to add">{files.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
      </>}
      {!!items.length && <details><summary>{items.length} work item(s) already added</summary>{items.map(item => <article className="border rounded p-2 space-y-2" key={workId(item)}><strong>{workName(item)}</strong>{reviewWork(item)}<button className={button} disabled={inactive} onClick={() => removeWork(workId(item))}>Remove {workName(item)}</button></article>)}</details>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={inactive} onClick={() => setStep('source')}>Back</button>{(source === 'paste' ? !!paste.trim() : !!files.length) ? <button className={primary} disabled={inactive || (source === 'paste' && !name.trim())} onClick={() => void addWork()}>Add work and select students</button> : <button className={primary} disabled={inactive || !items.length} onClick={() => setStep('students')}>Continue with added work</button>}</div>
    </>}
    {step === 'students' && <>
      <h3 className="font-bold text-lg">Who does this work belong to?</h3>
      <p>{items.length} work item(s) added. {items.map(workName).join(', ')}</p>
      <fieldset className="flex gap-4"><legend className="font-semibold">Select one or several students</legend>{(['single', 'multiple'] as const).map(value => <label className="flex gap-2" key={value}><input type="radio" name="evidence-selection-mode" checked={selectionMode === value} disabled={inactive} onChange={() => setSelectionMode(value)} />{value === 'single' ? 'One student' : 'Several students'}</label>)}</fieldset>
      {selectionMode === 'single' ? <p>Choose a student, then confirm that all added work belongs to them.</p> : <p>Select students now. On the next screen, confirm one student for each work item. Work is never copied to the whole group.</p>}
      <div className="max-h-80 overflow-auto border rounded divide-y" role="group" aria-label="Class students">{context.enrollments.map(row => <label className={`flex gap-3 p-3 ${selected.includes(row.id) ? 'bg-blue-50 font-semibold' : ''}`} key={row.id}><input type={selectionMode === 'single' ? 'radio' : 'checkbox'} name="evidence-students" checked={selected.includes(row.id) && (selectionMode === 'multiple' || selected.length === 1)} disabled={inactive} onChange={e => setSelected(selectionMode === 'single' ? [row.id] : e.target.checked ? [...selected.filter(id => id !== row.id), row.id] : selected.filter(id => id !== row.id))} />{studentLabel(row.id)}</label>)}</div>
      {!context.enrollments.length && <p role="alert">Add students to this class before importing work.</p>}
      <div className="flex gap-2"><button className={button} disabled={inactive} onClick={() => setStep('add')}>Back</button><button className={primary} disabled={inactive || !selected.length || (selectionMode === 'single' && selected.length !== 1) || (!!readErrors.length && !acceptPartial)} onClick={continueStudents}>{selected.length === 1 ? 'Confirm student and review work' : 'Continue to matching'}</button></div>
    </>}
    {step === 'match' && <>
      <h3 className="font-bold text-lg">Match work to students</h3>
      <p>Choose a work item and a student, then confirm the match. A student can receive several pages or files.</p>
      <div className="grid md:grid-cols-2 gap-4"><fieldset className="border rounded p-3 space-y-2"><legend>Work items · {items.filter(item => !matches[workId(item)]).length} unmatched</legend>{[...items].sort((a, b) => Number(!!matches[workId(a)]) - Number(!!matches[workId(b)])).map(item => <div className={`border rounded p-2 ${matches[workId(item)] ? 'bg-slate-100 text-slate-600' : ''}`} key={workId(item)}><label className="flex gap-2"><input type="radio" name="evidence-work-match" checked={itemChoice === workId(item)} disabled={inactive || !!matches[workId(item)]} onChange={() => setItemChoice(workId(item))} />{workName(item)}</label>{matches[workId(item)] ? <><p>Confirmed: {studentLabel(matches[workId(item)])}</p><button className={button} disabled={inactive} onClick={() => { setMatches(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== workId(item)))); setItemChoice(workId(item)); }}>Undo / change match</button></> : <p>Unmatched</p>}</div>)}</fieldset>
        <fieldset className="border rounded p-3 space-y-2"><legend>Students · {selected.filter(id => !matchedCount(id)).length} without work</legend>{[...selected].sort((a, b) => Number(matchedCount(a) > 0) - Number(matchedCount(b) > 0)).map(id => <label className={`block border rounded p-2 ${matchedCount(id) ? 'bg-slate-100 text-slate-600' : ''}`} key={id}><span className="flex gap-2"><input type="radio" name="evidence-student-match" checked={studentChoice === id} disabled={inactive} onChange={() => setStudentChoice(id)} />{studentLabel(id)}</span><span>{matchedCount(id) ? `${matchedCount(id)} confirmed · available for more pages` : 'No work matched yet'}</span></label>)}</fieldset></div>
      {itemChoice && items.find(item => workId(item) === itemChoice) && <details><summary>Read or view selected work</summary>{reviewWork(items.find(item => workId(item) === itemChoice)!)}</details>}
      {reviewError && <p role="status">{reviewError}</p>}
      <div className="flex gap-2"><button className={button} disabled={inactive} onClick={() => setStep('students')}>Back</button>{items.some(item => !matches[workId(item)]) ? <button className={primary} disabled={inactive || !itemChoice || !studentChoice || !!matches[itemChoice]} onClick={() => { try { validateTeacher(); setMatches(confirmEvidenceMatch(items, selected, matches, itemChoice, studentChoice)); setItemChoice(''); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Choose work and a student.'); } }}>Confirm match</button> : <button className={primary} disabled={inactive || !!reviewError} onClick={() => { setError(''); setStep('review'); }}>Review matches</button>}</div>
    </>}
    {step === 'review' && <>
      <h3 className="font-bold text-lg">Review student work</h3>
      <p>Each student receives one submission containing only their matched files or pages. Confirming saves the work locally and opens the first student for marking.</p>
      {partial && <p role="status">{savedCount} student submission(s) saved locally. Retry continues with unsaved work and opens marking without importing saved work again.</p>}
      {reviewError && <p role="alert">{reviewError}</p>}
      {groups.map(group => <article className="border rounded-lg p-3 space-y-2" key={group.key}><h4 className="font-semibold">{studentLabel(group.enrollmentId)}{receipts.current[group.key] ? ' · Saved locally' : ''}</h4>{items.filter(item => matches[workId(item)] === group.enrollmentId).map(item => <details key={workId(item)}><summary>{workName(item)}</summary>{reviewWork(item)}</details>)}{group.kind === 'documents' && context.attempts.some(attempt => attempt.classEnrollmentId === group.enrollmentId) && <label className="block">Submission relationship<select className={field} value={previous[group.enrollmentId] ?? ''} disabled={inactive || partial} onChange={e => setPrevious(current => ({ ...current, [group.enrollmentId]: e.target.value }))}><option value="">New submission</option>{context.attempts.filter(attempt => attempt.classEnrollmentId === group.enrollmentId).map(attempt => <option key={attempt.id} value={attempt.id}>Resubmission after {attempt.createdAt} · {attempt.documents.map(doc => doc.name).join(', ')}</option>)}</select></label>}</article>)}
      <div className="flex gap-2"><button className={button} disabled={inactive || partial} onClick={() => { setError(''); setStep(selected.length === 1 ? 'students' : 'match'); }}>Back</button><button className={primary} disabled={inactive || !rubricId || !!reviewError || (!!readErrors.length && !acceptPartial)} onClick={() => void startMarking()}>{busy ? 'Saving and opening…' : partial ? 'Retry and start marking' : 'Confirm and start marking'}</button></div>
    </>}
  </section>;
}
