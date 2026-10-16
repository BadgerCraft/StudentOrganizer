import type { MarkingDocument, MarkingImagePage } from '../types';
import { assertMarkingDocuments, assertMarkingImagePages } from '../validation';

export type EvidenceWork = { kind: 'documents'; document: MarkingDocument } | { kind: 'pictures'; page: MarkingImagePage };
export type EvidenceImportGroup = { key: string; enrollmentId: string; previousAttemptId: string | null } & (
  { kind: 'documents'; documents: MarkingDocument[] } | { kind: 'pictures'; pages: MarkingImagePage[] }
);
export const workId = (work: EvidenceWork) => work.kind === 'documents' ? work.document.id : work.page.id;
export const workName = (work: EvidenceWork) => work.kind === 'documents' ? work.document.name : work.page.name;
const fingerprint = (work: EvidenceWork) => work.kind === 'documents'
  ? `document:${work.document.hash}:${work.document.original?.hash ?? 'paste'}` : `picture:${work.page.hash.toLowerCase()}`;

/** Re-selecting successful files during recovery never creates additional work items. */
export function mergeEvidenceWork(existing: EvidenceWork[], incoming: EvidenceWork[]) {
  const items = [...existing], skipped: string[] = [];
  const seen = new Set(items.map(fingerprint));
  for (const item of incoming) {
    if (seen.has(fingerprint(item))) { skipped.push(workName(item)); continue; }
    seen.add(fingerprint(item)); items.push(item);
  }
  if (items.some(item => item.kind !== items[0].kind)) throw new Error('Import pictures and text as separate submissions.');
  if (items[0]?.kind === 'documents') assertMarkingDocuments(items.map(item => (item as Extract<EvidenceWork, { kind: 'documents' }>).document));
  if (items[0]?.kind === 'pictures') assertMarkingImagePages(items.map(item => (item as Extract<EvidenceWork, { kind: 'pictures' }>).page));
  return { items, skipped };
}

/** Selection changes retain only still-valid confirmed associations; they never assign work. */
export function retainEvidenceMatches(matches: Record<string, string>, selected: string[], items: EvidenceWork[]) {
  return Object.fromEntries(Object.entries(matches).filter(([id, student]) => selected.includes(student) && items.some(item => workId(item) === id)));
}

export function confirmEvidenceMatch(items: EvidenceWork[], selected: string[], matches: Record<string, string>, itemId: string, enrollmentId: string) {
  if (!items.some(item => workId(item) === itemId) || !selected.includes(enrollmentId)) throw new Error('Choose an added work item and a selected student.');
  if (matches[itemId]) throw new Error('Undo the existing match before changing this work item.');
  return { ...matches, [itemId]: enrollmentId };
}

/** Every selected student needs work, and every work item has exactly one explicit match. */
export function evidenceImportGroups(items: EvidenceWork[], selected: string[], matches: Record<string, string>, previous: Record<string, string> = {}): EvidenceImportGroup[] {
  if (!items.length || !selected.length) throw new Error('Add work and select at least one student.');
  if (new Set(selected).size !== selected.length || new Set(items.map(workId)).size !== items.length || new Set(items.map(fingerprint)).size !== items.length) throw new Error('Remove duplicate students or work items before continuing.');
  if (items.some(item => !selected.includes(matches[workId(item)]))) throw new Error('Confirm a student for every work item.');
  if (selected.some(id => !items.some(item => matches[workId(item)] === id))) throw new Error('Each selected student needs matched work. Go Back to change the student selection.');
  return selected.map(enrollmentId => {
    const work = items.filter(item => matches[workId(item)] === enrollmentId);
    const key = JSON.stringify([enrollmentId, work.map(workId)]);
    const base = { key, enrollmentId, previousAttemptId: previous[enrollmentId] || null };
    if (work.every((item): item is Extract<EvidenceWork, { kind: 'documents' }> => item.kind === 'documents')) return { ...base, kind: 'documents', documents: work.map(item => item.document) };
    if (work.every((item): item is Extract<EvidenceWork, { kind: 'pictures' }> => item.kind === 'pictures')) return { ...base, kind: 'pictures', pages: work.map(item => item.page) };
    throw new Error('Import pictures and text as separate submissions.');
  });
}

/** Persist the receipt immediately after each successful creation, before any subsequent await. */
export async function createEvidenceGroups(groups: EvidenceImportGroup[], saved: Record<string, string>, create: (group: EvidenceImportGroup) => Promise<{ attemptId: string } | null>, onSaved: (receipts: Record<string, string>) => void, validateTeacher: () => unknown) {
  for (const group of groups) {
    validateTeacher();
    if (saved[group.key]) continue;
    const result = await create(group);
    if (!result?.attemptId) throw new Error('Work was not saved. Retry to continue with your selections.');
    saved[group.key] = result.attemptId;
    validateTeacher();
    onSaved({ ...saved });
  }
  return groups.map(group => saved[group.key]);
}
