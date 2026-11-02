import type { MarkingActor, MarkingAttempt, MarkingContext, MarkingSession } from '../types';
import { assertMarkingRecord, sessionCategories } from '../validation';
import { useEffect, useState } from 'react';
import { db } from '../../db/database';
import { MarkingService } from '../markingService';
import { getActiveTeacherId, getIdentityEpoch } from '../../services/identityService';
import { queueCapturePage } from '../capturePageQueue';
import { DocumentDisplayFailure, DocumentErrorBoundary } from '../../components/DocumentErrorBoundary';
import { validateSavedMarkingSession } from '../readValidation';

/** Validation and rendering run inside the caller's document boundary. */
export function ReadOnlyOriginalWork({ attempt, actor }: { attempt: MarkingAttempt; actor?: MarkingActor }) {
  const [, retry] = useState(0);
  try { assertMarkingRecord('markingAttempts', attempt); }
  catch { return <DocumentDisplayFailure label="This saved original" onRetry={() => retry(value => value + 1)}/>; }
  return <>{attempt.imagePages?.some(page => page.captureRef) && <CapturedOriginal attempt={attempt} actor={actor}/>} {attempt.documents.map(doc => <details key={doc.id}><summary>Submitted document: {doc.name}</summary><p className="whitespace-pre-wrap">{doc.text}</p></details>)}{!attempt.imagePages?.some(page => page.captureRef) && attempt.imagePages?.map(page => <details key={page.id}><summary>Submitted photo: {page.name}</summary><img alt={page.name} className="max-w-full" src={`data:${page.mime};base64,${page.base64}`} /></details>)}</>;
}

/** No editing callbacks: browsing retained or former-student work never opens a session. */
export function ReadOnlyMarkingHistory({ attempt, context }: { attempt: MarkingAttempt; context: MarkingContext }) {
  const rubric = context.rubrics.find(row => row.id === attempt.rubricId);
  const criterion = (id: string | null) => rubric?.criteria.find(row => row.id === id)?.name ?? 'Feedback';
  const revisions = context.sessions.filter(row => row.attemptId === attempt.id).flatMap(session => {
    if (!attempt.archivedAt) return [session];
    const commit = context.commits.find(row => row.id === session.commitId && row.sessionId === session.id && row.attemptId === attempt.id);
    // Legacy backups may still carry draft sessions. Archive is committed-only,
    // without destructively migrating any historical records on read.
    return session.status === 'finalized' && commit ? [{ ...session, draft: commit.draft }] : [];
  }).sort((a, b) => a.revision - b.revision);
  function Feedback({ session }: { session: MarkingSession }) {
    const [, retry] = useState(0);
    try {
      if (!rubric) throw new Error('The saved rubric is unavailable.');
      validateSavedMarkingSession(session, attempt, rubric);
    } catch { return <DocumentDisplayFailure label="This saved revision" onRetry={() => retry(value => value + 1)}/>; }
    const draft = session.draft;
    // A pending edit replaces its saved annotation, rather than appearing twice.
    const annotations = draft.annotations.filter(row => row.id !== draft.pending?.id);
    return <>
      <p className="whitespace-pre-wrap">{draft.overallFeedback}</p>
      {draft.judgments.map(j => <p key={j.assessmentCategoryId}>{sessionCategories(session).find(c => c.id === j.assessmentCategoryId)?.categoryCode}: {j.assessed ? `${j.rawScore} (${j.inputFormat.replace(/_/g, ' ')})` : 'Not assessed'} · {j.feedback}</p>)}
      {(draft.rubricFeedback ?? []).map(row => <p key={row.criterionId}>{criterion(row.criterionId)}: {row.level} · {row.feedback}</p>)}
      {(draft.archivedFeedback ?? []).map(row => <p key={row.id} className="whitespace-pre-wrap">{criterion(row.criterionId)}: {row.level} {row.text}</p>)}
      {[...annotations, ...(draft.pending ? [draft.pending] : [])].map(row => <section key={row.id} className="border-l pl-3" aria-label={row.id === draft.pending?.id ? 'Unfinished text feedback' : 'Retained text feedback'}>
        <h4 className="font-semibold">{row.id === draft.pending?.id ? 'Unfinished comment' : 'Text comment'} · {attempt.documents.find(doc => doc.id === row.documentId)?.name} · {criterion(row.criterionId)}</h4>
        <blockquote className="whitespace-pre-wrap">{row.quote}</blockquote><p className="whitespace-pre-wrap">{row.level} {row.text || 'No comment text entered.'}</p>
      </section>)}
      {(draft.imageFeedback ?? []).flatMap(page => page.annotations.filter(row => row.kind === 'comment' || row.text || row.level).map(row => <section key={`${page.pageId}:${row.id}`} className="border-l pl-3" aria-label="Retained photo feedback">
        <h4 className="font-semibold">Photo comment · {attempt.imagePages?.find(image => image.id === page.pageId)?.name} · {criterion(row.criterionId)}</h4><p className="whitespace-pre-wrap">{row.level} {row.text || 'Unfinished comment — no text entered.'}</p>
      </section>))}
      {draft.oral && <section aria-label="Private archived observations"><h4 className="font-semibold">Private presentation observations</h4><p className="whitespace-pre-wrap">{draft.oral.notes}</p>{draft.oral.items.map(row => <p key={row.id}>{row.checked ? 'Checked' : 'Unchecked'}: {row.label} · {row.note}</p>)}</section>}
      {session.retainedCategoryJudgments?.map((row, index) => <p key={index}>Retained {row.category.categoryCode}: {row.judgment.rawScore} · {row.judgment.feedback}</p>)}
    </>;
  }
  return <><p>Rubric: {rubric?.title}</p>{!revisions.length && <p>{attempt.archivedAt ? 'No finalized feedback was published for this submission.' : 'No marking session was started for this submission.'}</p>}{revisions.map(session => <details key={session.id}><summary>Revision {session.revision} · {session.status} · {session.updatedAt}</summary><DocumentErrorBoundary resetKey={`${session.id}:${session.version}:${session.updatedAt}`} label="This saved revision"><Feedback session={session} /></DocumentErrorBoundary></details>)}</>;
}

/** Retained reference originals are deliberately selected one at a time. */
function CapturedOriginal({ attempt, actor }: { attempt: MarkingAttempt; actor?: MarkingActor }) {
  const [selected, setSelected] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false, sourceUrl = ''; setUrl(''); setError('');
    if (!selected) return;
    void queueCapturePage(async () => {
      try {
        if (cancelled) return;
        if (!actor) throw new Error('Choose the owning teacher to view this saved original.');
        const page = await new MarkingService(db).readImagePage(attempt.id, selected, actor);
        if (cancelled) return;
        const bytes = Uint8Array.from(atob(page.base64), c => c.charCodeAt(0));
        sourceUrl = URL.createObjectURL(new Blob([bytes], { type: page.mime }));
        const image = new Image(); image.src = sourceUrl; await image.decode();
        if (cancelled || getIdentityEpoch() !== actor.epoch || getActiveTeacherId() !== actor.userId) return;
        setUrl(sourceUrl);
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Original unavailable. Retry or restore a complete backup.'); }
    });
    return () => { cancelled = true; if (sourceUrl) URL.revokeObjectURL(sourceUrl); };
  }, [attempt.id, attempt.version, selected, actor?.userId, actor?.epoch, retry]);
  return <section><label>Saved original page<select aria-label="Saved original page" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a page</option>{attempt.imagePages?.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>{error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry original</button></p>}{url && <img alt={attempt.imagePages?.find(page => page.id === selected)?.name ?? 'Saved original'} className="max-w-full" src={url}/>}</section>;
}
