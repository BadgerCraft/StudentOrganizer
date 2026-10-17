import type { ArchivedMarkingFeedback, MarkingDraft } from './types';

/** Preserve teacher comments, never the student's source, quote or drawing coordinates. */
export function archiveDraft(draft: MarkingDraft): MarkingDraft {
  const comments: ArchivedMarkingFeedback[] = [...(draft.archivedFeedback ?? [])];
  // Source IDs can already fill the 200-character limit. Use bounded, deterministic
  // archive-local IDs so matching session/commit snapshots still match on restore.
  const ids = new Set(comments.map(comment => comment.id));
  let sequence = 0;
  const feedbackId = (kind: 'text' | 'image') => {
    let id: string;
    do { id = `${kind}:${sequence++}`; } while (ids.has(id));
    ids.add(id); return id;
  };
  // Only finalized annotations belong in an archive; pending edits are discarded.
  const textAnnotations = new Map(draft.annotations.map(annotation => [annotation.id, annotation]));
  for (const annotation of textAnnotations.values()) {
    comments.push({ id: feedbackId('text'), criterionId: annotation.criterionId, level: annotation.level, text: annotation.text });
  }
  for (const page of draft.imageFeedback ?? []) {
    for (const annotation of page.annotations) {
      if (annotation.text || annotation.criterionId || annotation.level) comments.push({ id: feedbackId('image'), criterionId: annotation.criterionId, level: annotation.level, text: annotation.text });
    }
  }
  const { imageFeedback: _pages, ...rest } = draft;
  return { ...rest, annotations: [], pending: null, archivedFeedback: comments };
}

/** Audit snapshots use the same redaction as live rows; preserve their event metadata. */
export function archiveSnapshot(json: string | null, entityName: string, archivedAt: string): string | null {
  if (json === null) return null;
  const value = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A retained marking snapshot is invalid. Archive was cancelled without changes.');
  if (entityName === 'markingAttempts') return JSON.stringify({ ...value, documents: [], imagePages: [], archivedAt, keepStudentWork: false });
  if (!value.draft) throw new Error('A retained marking draft snapshot is invalid. Archive was cancelled without changes.');
  return JSON.stringify({ ...value, draft: archiveDraft(value.draft) });
}

/** Empty schema-compatible shell for an unfinished session at the archive boundary. */
export function discardUnfinishedDraft(draft: MarkingDraft, keepStudentWork: boolean): MarkingDraft {
  return {
    annotations: [], pending: null, overallFeedback: '',
    judgments: draft.judgments.map(j => ({ ...j, assessed: false, rawScore: '', feedback: '' })),
    ...(draft.rubricFeedback ? { rubricFeedback: draft.rubricFeedback.map(row => ({ criterionId: row.criterionId, level: '', feedback: '' })) } : {}),
    ...(draft.oral ? { oral: { items: [], notes: '' } } : {}),
    ...(keepStudentWork && draft.imageFeedback ? { imageFeedback: draft.imageFeedback.map(page => ({ pageId: page.pageId, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] })) } : {}),
  };
}
