import type { ArchivedMarkingFeedback, MarkingDraft } from './types';

/** Preserve teacher comments, never the student's source, quote or drawing coordinates. */
export function archiveDraft(draft: MarkingDraft): MarkingDraft {
  const comments: ArchivedMarkingFeedback[] = [...(draft.archivedFeedback ?? [])];
  // A pending edit can refer to an already saved comment. Preserve the edited
  // version once, rather than producing an invalid duplicate archive ID.
  const textAnnotations = new Map(draft.annotations.map(annotation => [annotation.id, annotation]));
  if (draft.pending) textAnnotations.set(draft.pending.id, draft.pending);
  for (const annotation of textAnnotations.values()) {
    comments.push({ id: `text:${annotation.id}`, criterionId: annotation.criterionId, level: annotation.level, text: annotation.text });
  }
  for (const page of draft.imageFeedback ?? []) {
    for (const annotation of page.annotations) {
      if (annotation.text || annotation.criterionId || annotation.level) comments.push({ id: `image:${annotation.id}`, criterionId: annotation.criterionId, level: annotation.level, text: annotation.text });
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
