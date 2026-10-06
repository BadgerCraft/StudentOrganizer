import type { MarkingAnnotation, MarkingAttempt, MarkingCommit, MarkingDocument, MarkingDraft, MarkingRubric, MarkingSession, RubricContent } from './types';
import { MARKING_LIMITS } from './types';
import { ValidationError } from '../services/markbookService';

export type MarkingTableName = 'markingRubrics' | 'markingAttempts' | 'markingSessions' | 'markingCommits';
function fail(message: string): never { throw new ValidationError(message); }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string, max = 2000, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\u0000')) fail(`${label} is missing, too large, or invalid.`);
}
function arr(value: unknown, label: string, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array with at most ${max} items.`);
}
function integer(value: unknown, label: string, min = 1): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min) fail(`${label} must be an integer of at least ${min}.`);
}
function unique(values: unknown[], label: string) { if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`); }
function time(value: unknown, label: string) { str(value, label, 40); if (!Number.isFinite(Date.parse(value))) fail(`${label} is invalid.`); }
function nullableId(value: unknown, label: string) { if (value !== null) str(value, label, 200); }
function base(value: Record<string, unknown>) {
  for (const field of ['id', 'assessmentId', 'classSectionId', 'createdBy']) str(value[field], field, 200);
  time(value.createdAt, 'createdAt'); time(value.updatedAt, 'updatedAt');
  if (value.deletedAt !== null) time(value.deletedAt, 'deletedAt');
  integer(value.version, 'version');
}

export function assertRubricContent(value: unknown): asserts value is RubricContent {
  const v = object(value, 'Rubric'); str(v.title, 'Rubric title', 500);
  arr(v.levels, 'Rubric levels', MARKING_LIMITS.levels);
  if (!v.levels.length) fail('At least one rubric level is required.');
  v.levels.forEach(level => str(level, 'Rubric level', 100)); unique(v.levels, 'Rubric levels');
  arr(v.criteria, 'Rubric criteria', MARKING_LIMITS.criteria);
  if (!v.criteria.length) fail('At least one rubric criterion is required.');
  const ids: unknown[] = [];
  for (const item of v.criteria) {
    const criterion = object(item, 'Criterion'); str(criterion.id, 'Criterion ID', 200); ids.push(criterion.id);
    str(criterion.name, 'Criterion name', 500);
    if (!['K', 'T', 'A', 'C'].includes(criterion.categoryCode as string)) fail('Confirm a KTAC category for every criterion.');
    const descriptors = object(criterion.descriptors, 'Descriptors');
    if (Object.keys(descriptors).length !== v.levels.length) fail('Each criterion must preserve the complete descriptor matrix.');
    for (const level of v.levels as string[]) {
      if (!Object.prototype.hasOwnProperty.call(descriptors, level)) fail(`Missing descriptor for ${level}.`);
      str(descriptors[level], 'Descriptor', 10000, true);
    }
    if (criterion.weight !== undefined && (typeof criterion.weight !== 'number' || !Number.isFinite(criterion.weight) || criterion.weight < 0 || criterion.weight > 10000)) fail('Criterion weight is invalid.');
  }
  unique(ids, 'Criterion IDs');
}

export function assertMarkingDocument(value: unknown): asserts value is MarkingDocument {
  const v = object(value, 'Document'); str(v.id, 'Document ID', 200); str(v.name, 'Document name', 255);
  if (/[\u0000-\u001f\u007f/\\]/u.test(v.name as string)) fail('Document name must not contain paths or control characters.');
  str(v.text, 'Document text', MARKING_LIMITS.textCharacters);
  if (/[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(v.text as string)) fail('Document text must use the supported canonical normalization.');
  str(v.hash, 'Document hash', 128);
  if (!/^[a-f0-9]{64}$/i.test(v.hash as string)) fail('Document hash must be SHA-256.');
  if (v.original !== null) {
    const original = object(v.original, 'Original file'); str(original.name, 'Original filename', 500);
    str(original.mime, 'Original MIME type', 200); str(original.hash, 'Original file hash', 128);
    if (!/^[a-f0-9]{64}$/i.test(original.hash as string)) fail('Original file hash must be SHA-256.');
    if (original.name !== v.name || !((original.mime === 'text/plain' && /\.txt$/i.test(original.name as string)) || (original.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && /\.docx$/i.test(original.name as string)))) fail('Original file name or type is unsupported.');
    integer(original.size, 'Original file size', 0);
    if ((original.size as number) > MARKING_LIMITS.fileBytes) fail('Original file exceeds size limit.');
    str(original.base64, 'Original bytes', 4 * Math.ceil(MARKING_LIMITS.fileBytes / 3), true);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(original.base64 as string)) fail('Original file is not valid base64.');
    const encoded = original.base64 as string;
    const decodedSize = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (decodedSize !== original.size) fail('Original file size does not match its bytes.');
  }
}
export function assertMarkingDocuments(value: unknown): asserts value is MarkingDocument[] {
  arr(value, 'Documents', MARKING_LIMITS.documents);
  if (!value.length) fail('Import at least one document.');
  value.forEach(assertMarkingDocument); const documents = value as MarkingDocument[]; unique(documents.map(item => item.id), 'Document IDs');
  if (documents.reduce((total, item) => total + (item.original?.size ?? new TextEncoder().encode(item.text).byteLength), 0) > MARKING_LIMITS.batchBytes) fail('Combined documents exceed batch size limit.');
}
function annotation(value: unknown): asserts value is MarkingAnnotation {
  const v = object(value, 'Annotation');
  for (const field of ['id', 'documentId', 'criterionId']) str(v[field], field, 200);
  str(v.level, 'Annotation level', 100, true); str(v.quote, 'Annotation quotation', MARKING_LIMITS.textCharacters);
  str(v.text, 'Annotation comment', 20000, true); integer(v.start, 'Annotation start', 0); integer(v.end, 'Annotation end', 1);
  if ((v.end as number) <= (v.start as number)) fail('Annotation end must follow its start.');
}
export function assertMarkingDraft(value: unknown, rubric?: MarkingRubric, documents?: MarkingDocument[], categoryIds?: string[]): asserts value is MarkingDraft {
  const v = object(value, 'Draft'); arr(v.annotations, 'Annotations', MARKING_LIMITS.annotations);
  v.annotations.forEach(annotation); const savedAnnotations = v.annotations as MarkingAnnotation[]; unique(savedAnnotations.map(item => item.id), 'Annotation IDs');
  if (v.pending !== null) annotation(v.pending);
  arr(v.judgments, 'Category judgments', 4); const ids: unknown[] = [];
  for (const item of v.judgments) {
    const judgment = object(item, 'Category judgment'); str(judgment.assessmentCategoryId, 'Assessment category ID', 200); ids.push(judgment.assessmentCategoryId);
    if (typeof judgment.assessed !== 'boolean') fail('Category judgment must explicitly state whether it is assessed.');
    str(judgment.rawScore, 'Official score', 200, true); str(judgment.feedback, 'Category feedback', 20000, true);
    if (!['scale_code', 'raw_points', 'percentage', 'descriptive'].includes(judgment.inputFormat as string)) fail('Unsupported official score format.');
  }
  unique(ids, 'Category judgments'); str(v.overallFeedback, 'Overall feedback', 50000, true);
  if (categoryIds && (ids.length !== categoryIds.length || ids.some(id => !categoryIds.includes(id as string)))) fail('Review judgments for every current assessment category.');
  const annotations: MarkingAnnotation[] = [...savedAnnotations, ...(v.pending === null ? [] : [v.pending as MarkingAnnotation])];
  for (const item of annotations) {
    if (rubric && (!rubric.criteria.some(c => c.id === item.criterionId) || (item.level !== '' && !rubric.levels.includes(item.level)))) fail('Annotation criterion or level does not belong to this rubric version.');
    if (documents) {
      const doc = documents.find(d => d.id === item.documentId);
      if (!doc || doc.text.slice(item.start, item.end) !== item.quote || item.end > doc.text.length) fail('Annotation does not match its immutable document range.');
    }
  }
}

export function assertMarkingRecord(table: MarkingTableName, value: unknown): asserts value is MarkingRubric | MarkingAttempt | MarkingSession | MarkingCommit {
  const v = object(value, table); base(v);
  if (table === 'markingRubrics') {
    assertRubricContent(v); if (v.confirmed !== true) fail('Stored rubric must have confirmed KTAC mapping.');
  } else if (table === 'markingAttempts') {
    str(v.rubricId, 'Rubric ID', 200); nullableId(v.classEnrollmentId, 'Enrollment ID'); nullableId(v.previousAttemptId, 'Previous attempt ID'); assertMarkingDocuments(v.documents);
  } else if (table === 'markingSessions') {
    str(v.attemptId, 'Attempt ID', 200); str(v.rubricId, 'Rubric ID', 200); integer(v.revision, 'Revision');
    if (!['draft', 'finalized'].includes(v.status as string)) fail('Unsupported session status.');
    str(v.baseline, 'Official-result baseline', 1000000); nullableId(v.commitId, 'Commit ID'); assertMarkingDraft(v.draft);
    if ((v.status === 'draft' && v.commitId !== null) || (v.status === 'finalized' && v.commitId === null)) fail('Session finalization state is inconsistent.');
  } else {
    for (const field of ['sessionId', 'attemptId', 'rubricId', 'studentAssessmentId']) str(v[field], field, 200);
    nullableId(v.previousCommitId, 'Previous commit ID'); assertMarkingDraft(v.draft);
    if (v.draft.pending !== null) fail('Finalized commit cannot contain pending comments.');
    arr(v.resultIds, 'Committed result IDs', 4); v.resultIds.forEach(id => str(id, 'Result ID', 200)); unique(v.resultIds, 'Result IDs');
  }
}
