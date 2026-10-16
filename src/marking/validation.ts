import { getClassroomLevel } from '../services/classroomLevels';
import type { MarkingAnnotation, MarkingAttempt, MarkingCommit, MarkingDocument, MarkingDraft, MarkingRubric, MarkingSession, RubricContent } from './types';
import { MARKING_LIMITS } from './types';
import { ValidationError } from '../services/markbookService';
import type { AssessmentCategory } from '../types/schema';
import type { MarkingImagePage, MarkingPageFeedback } from './types';

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

export function assertCategorySnapshot(value: unknown, assessmentId: string): asserts value is AssessmentCategory[] {
  arr(value, 'Saved assessment categories', 4);
  for (const item of value) {
    const category = object(item, 'Saved assessment category');
    str(category.id, 'Saved category ID', 200);
    if (category.assessmentId !== assessmentId) fail('Saved category belongs to a different assessment.');
    if (!['K', 'T', 'A', 'C'].includes(category.categoryCode as string)) fail('Saved category must use KTCA.');
    if (typeof category.maxScore !== 'number' || !Number.isFinite(category.maxScore) || category.maxScore <= 0) fail('Saved category maximum is invalid.');
    if (typeof category.evidenceWeight !== 'number' || !Number.isFinite(category.evidenceWeight) || category.evidenceWeight < 0) fail('Saved category weight is invalid.');
    nullableId(category.markScaleVersionId, 'Saved category scale');
    time(category.createdAt, 'Saved category creation'); time(category.updatedAt, 'Saved category update');
    if (category.deletedAt !== null) fail('Saved category must have been active when pinned.');
    integer(category.version, 'Saved category version');
  }
  unique(value.map(item => (item as AssessmentCategory).id), 'Saved category IDs');
  unique(value.map(item => (item as AssessmentCategory).categoryCode), 'Saved category codes');
}

export function sessionCategories(session: Pick<MarkingSession, 'categorySnapshot' | 'baseline' | 'assessmentId'>): AssessmentCategory[] {
  let categories: unknown = session.categorySnapshot;
  if (categories === undefined) {
    try { categories = JSON.parse(session.baseline).categories; } catch { fail('Saved category baseline is invalid. Keep this draft and restore a valid backup.'); }
  }
  assertCategorySnapshot(categories, session.assessmentId);
  return categories;
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
    if (!['K', 'T', 'A', 'C'].includes(criterion.categoryCode as string)) fail('Confirm a KTCA category for every criterion.');
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
export function assertMarkingDocuments(value: unknown, allowEmpty = false): asserts value is MarkingDocument[] {
  arr(value, 'Documents', MARKING_LIMITS.documents);
  if (!value.length && !allowEmpty) fail('Import at least one document.');
  value.forEach(assertMarkingDocument); const documents = value as MarkingDocument[]; unique(documents.map(item => item.id), 'Document IDs');
  if (documents.reduce((total, item) => total + (item.original?.size ?? new TextEncoder().encode(item.text).byteLength), 0) > MARKING_LIMITS.batchBytes) fail('Combined documents exceed batch size limit.');
}

export function assertMarkingImagePages(value: unknown): asserts value is MarkingImagePage[] {
  arr(value, 'Image pages', MARKING_LIMITS.imagePages);
  const ids: string[] = []; let bytes = 0;
  for (const item of value) {
    const page = object(item, 'Image page');
    if (Object.keys(page).some(key => !['id', 'name', 'mime', 'base64', 'size', 'hash', 'width', 'height'].includes(key))) fail('Image pages must contain local bytes, never URLs or unknown source fields.');
    str(page.id, 'Image page ID', 200); ids.push(page.id);
    str(page.name, 'Image name', 255);
    if (/[\u0000-\u001f\u007f/\\]/u.test(page.name as string)) fail('Image name contains paths or control characters.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(page.mime as string)) fail('Only local PNG, JPEG and WebP pages are supported.');
    str(page.hash, 'Image hash', 64);
    if (!/^[a-f0-9]{64}$/i.test(page.hash)) fail('Image hash must be SHA-256.');
    integer(page.size, 'Image bytes');
    if (page.size > MARKING_LIMITS.imageBytes) fail('Image exceeds the page size limit.');
    bytes += page.size;
    str(page.base64, 'Image bytes', 4 * Math.ceil(MARKING_LIMITS.imageBytes / 3));
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.base64)) fail('Image bytes must be plain base64, never a URL.');
    const size = page.base64.length / 4 * 3 - (page.base64.endsWith('==') ? 2 : page.base64.endsWith('=') ? 1 : 0);
    if (size !== page.size) fail('Image size does not match its retained bytes.');
    integer(page.width, 'Image width'); integer(page.height, 'Image height');
    if (page.width * page.height > MARKING_LIMITS.imagePixels) fail('Image exceeds the pixel limit.');
  }
  unique(ids, 'Image page IDs');
  if (bytes > MARKING_LIMITS.imageBatchBytes) fail('Combined image pages exceed the batch size limit.');
}

function normalized(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 1 || value < 0 || (positive && value === 0)) fail(`${label} must be a bounded normalized coordinate.`);
}
function extraDraft(v: Record<string, unknown>) {
  if (v.archivedFeedback !== undefined) {
    arr(v.archivedFeedback, 'Archived written feedback', MARKING_LIMITS.annotations + MARKING_LIMITS.imagePages * MARKING_LIMITS.visualAnnotations + 1);
    const ids: string[] = [];
    for (const item of v.archivedFeedback) {
      const entry = object(item, 'Archived written feedback');
      if (Object.keys(entry).some(key => !['id', 'criterionId', 'level', 'text'].includes(key))) fail('Archived feedback cannot retain source anchors or quotations.');
      str(entry.id, 'Archived feedback ID', 200); ids.push(entry.id); nullableId(entry.criterionId, 'Archived criterion');
      str(entry.level, 'Archived level', 100, true); str(entry.text, 'Archived comment', 20000, true);
    }
    unique(ids, 'Archived feedback IDs');
  }
  if (v.rubricFeedback !== undefined) {
    arr(v.rubricFeedback, 'Rubric evidence', MARKING_LIMITS.criteria);
    let total = 0; const ids: string[] = [];
    for (const item of v.rubricFeedback) {
      const entry = object(item, 'Rubric evidence'); str(entry.criterionId, 'Evidence criterion', 200); ids.push(entry.criterionId);
      str(entry.level, 'Evidence level', 100, true); str(entry.feedback, 'Criterion feedback', 20000, true); total += entry.feedback.length;
    }
    unique(ids, 'Evidence criteria'); if (total > 50000) fail('Combined rubric feedback exceeds its limit.');
  }
  if (v.oral !== undefined) {
    const oral = object(v.oral, 'Presentation evidence'); arr(oral.items, 'Checklist items', MARKING_LIMITS.checklistItems); str(oral.notes, 'Private presentation notes', 50000, true);
    let total = oral.notes.length; const ids: string[] = [];
    for (const item of oral.items) {
      const entry = object(item, 'Checklist item'); str(entry.id, 'Checklist ID', 200); ids.push(entry.id);
      str(entry.label, 'Checklist label', 500, true); str(entry.note, 'Checklist note', 20000, true); total += entry.note.length;
      if (typeof entry.checked !== 'boolean') fail('Checklist status must be explicit.');
    }
    unique(ids, 'Checklist IDs'); if (total > 50000) fail('Combined presentation notes exceed their limit.');
  }
  if (v.imageFeedback !== undefined) {
    arr(v.imageFeedback, 'Page feedback', MARKING_LIMITS.imagePages); const pageIds: string[] = [], annotationIds: string[] = [];
    for (const item of v.imageFeedback) {
      const page = object(item, 'Page feedback'); str(page.pageId, 'Feedback page ID', 200); pageIds.push(page.pageId);
      if (![0, 90, 180, 270].includes(page.rotation as number)) fail('Page rotation must be a right angle.');
      const crop = object(page.crop, 'Page crop'); normalized(crop.x, 'Crop left'); normalized(crop.y, 'Crop top'); normalized(crop.width, 'Crop width', true); normalized(crop.height, 'Crop height', true);
      if (crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) fail('Page crop must stay inside the retained original.');
      arr(page.annotations, 'Visual annotations', MARKING_LIMITS.visualAnnotations);
      for (const value of page.annotations) {
        const mark = object(value, 'Visual annotation'); str(mark.id, 'Visual annotation ID', 200); annotationIds.push(mark.id);
        if (!['pen', 'highlight', 'comment'].includes(mark.kind as string) || !['red', 'blue', 'yellow'].includes(mark.color as string)) fail('Unsupported visual annotation tool or color.');
        normalized(mark.width, 'Visual stroke width', true);
        arr(mark.points, 'Visual points', MARKING_LIMITS.strokePoints);
        if (!mark.points.length || (mark.kind === 'comment' && mark.points.length !== 1)) fail('Visual annotations require original-page anchors.');
        for (const point of mark.points) { const p = object(point, 'Visual point'); normalized(p.x, 'Point x'); normalized(p.y, 'Point y'); }
        str(mark.text, 'Visual comment', 20000, true); nullableId(mark.criterionId, 'Visual criterion'); str(mark.level, 'Visual evidence level', 100, true);
      }
    }
    unique(pageIds, 'Feedback page IDs'); unique(annotationIds, 'Visual annotation IDs');
  }
}

/** Links extension data to the immutable attempt, not the current import UI. */
export function assertAttemptDraft(draft: MarkingDraft, attempt: MarkingAttempt, rubric: MarkingRubric) {
  assertMarkingDraft(draft, rubric, attempt.documents);
  const mode = attempt.mode ?? 'written', pages = attempt.imagePages ?? [];
  if (draft.archivedFeedback?.length && !attempt.archivedAt) fail('Archived written feedback belongs only to an archived attempt.');
  if (attempt.archivedAt && !attempt.keepStudentWork && (draft.annotations.length || draft.pending || (draft.imageFeedback?.length ?? 0))) fail('Archived source material must have been removed.');
  for (const entry of draft.archivedFeedback ?? []) {
    if ((entry.criterionId !== null && !rubric.criteria.some(c => c.id === entry.criterionId)) || (entry.level && (!entry.criterionId || (!rubric.levels.includes(entry.level) && !getClassroomLevel(entry.level))))) fail('Archived feedback must use the pinned rubric.');
  }
  if (mode !== 'oral' && draft.oral !== undefined) fail('Presentation evidence belongs only to an oral attempt.');
  if (mode === 'oral' && draft.oral === undefined) fail('Oral attempts must retain their presentation evidence.');
  const feedback = draft.imageFeedback ?? [];
  if (feedback.length !== pages.length || feedback.some(p => !pages.some(original => original.id === p.pageId))) fail('Review feedback for every retained original image page.');
  if (mode !== 'written' && (pages.length || draft.annotations.length || draft.pending)) fail('This marking mode cannot contain written-page annotations.');
  if (draft.rubricFeedback !== undefined && draft.rubricFeedback.length !== rubric.criteria.length) fail('Retain feedback for every pinned rubric criterion.');
  for (const entry of draft.rubricFeedback ?? []) {
    if (!rubric.criteria.some(c => c.id === entry.criterionId) || (entry.level && (!rubric.levels.includes(entry.level) && !getClassroomLevel(entry.level)))) fail('Rubric evidence must use the pinned criterion and achievement labels.');
  }
  for (const entry of feedback.flatMap(p => p.annotations)) {
    if ((entry.criterionId !== null && !rubric.criteria.some(c => c.id === entry.criterionId)) || (entry.level && (!entry.criterionId || (!rubric.levels.includes(entry.level) && !getClassroomLevel(entry.level))))) fail('Visual evidence must use the pinned rubric.');
  }
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
  extraDraft(v);
  v.annotations.forEach(annotation); const savedAnnotations = v.annotations as MarkingAnnotation[]; unique(savedAnnotations.map(item => item.id), 'Annotation IDs');
  if (v.pending !== null) annotation(v.pending);
  arr(v.judgments, 'Category judgments', 4); const ids: unknown[] = [];
  for (const item of v.judgments) {
    const judgment = object(item, 'Category judgment'); str(judgment.assessmentCategoryId, 'Assessment category ID', 200); ids.push(judgment.assessmentCategoryId);
    if (typeof judgment.assessed !== 'boolean') fail('Category judgment must explicitly state whether it is assessed.');
    str(judgment.rawScore, 'Official score', 200, true); str(judgment.feedback, 'Category feedback', 20000, true);
    if (!['scale_code', 'classroom_level', 'raw_points', 'percentage', 'descriptive'].includes(judgment.inputFormat as string)) fail('Unsupported official score format.');
  }
  unique(ids, 'Category judgments'); str(v.overallFeedback, 'Overall feedback', 50000, true);
  if (categoryIds && (ids.length !== categoryIds.length || ids.some(id => !categoryIds.includes(id as string)))) fail('Review judgments for every current assessment category.');
  const annotations: MarkingAnnotation[] = [...savedAnnotations, ...(v.pending === null ? [] : [v.pending as MarkingAnnotation])];
  for (const item of annotations) {
    if (rubric && (!rubric.criteria.some(c => c.id === item.criterionId) || (item.level !== '' && (!rubric.levels.includes(item.level) && !getClassroomLevel(item.level))))) fail('Annotation criterion or level does not belong to this rubric version.');
    if (documents) {
      const doc = documents.find(d => d.id === item.documentId);
      if (!doc || doc.text.slice(item.start, item.end) !== item.quote || item.end > doc.text.length) fail('Annotation does not match its immutable document range.');
    }
  }
}

export function assertMarkingRecord(table: MarkingTableName, value: unknown): asserts value is MarkingRubric | MarkingAttempt | MarkingSession | MarkingCommit {
  const v = object(value, table); base(v);
  if (table === 'markingRubrics') {
    assertRubricContent(v); if (v.confirmed !== true) fail('Stored rubric must have confirmed KTCA mapping.');
  } else if (table === 'markingAttempts') {
    str(v.rubricId, 'Rubric ID', 200); nullableId(v.classEnrollmentId, 'Enrollment ID'); nullableId(v.previousAttemptId, 'Previous attempt ID');
    if (v.mode !== undefined && !['written', 'oral', 'rubric'].includes(v.mode as string)) fail('Unsupported marking mode.');
    if (v.archivedAt !== undefined && v.archivedAt !== null) time(v.archivedAt, 'Archived date');
    if (v.keepStudentWork !== undefined && typeof v.keepStudentWork !== 'boolean') fail('Student-work retention must be explicit.');
    if (v.imagePages !== undefined) assertMarkingImagePages(v.imagePages);
    const pages = (v.imagePages ?? []) as MarkingImagePage[];
    assertMarkingDocuments(v.documents, !!v.archivedAt || v.mode === 'oral' || v.mode === 'rubric' || pages.length > 0);
    if (v.archivedAt && !v.keepStudentWork && (v.documents.length || pages.length)) fail('Archived source material must have been removed.');
    if ((v.mode === 'oral' || v.mode === 'rubric') && (v.documents.length || pages.length)) fail('Oral and rubric-only attempts do not import written sources.');
  } else if (table === 'markingSessions') {
    str(v.attemptId, 'Attempt ID', 200); str(v.rubricId, 'Rubric ID', 200); integer(v.revision, 'Revision');
    if (!['draft', 'finalized'].includes(v.status as string)) fail('Unsupported session status.');
    str(v.baseline, 'Official-result baseline', 1000000); nullableId(v.commitId, 'Commit ID'); assertMarkingDraft(v.draft);
    const categories = sessionCategories(v as unknown as MarkingSession);
    assertMarkingDraft(v.draft, undefined, undefined, categories.map(c => c.id));
    if (v.retainedCategoryJudgments !== undefined) {
      arr(v.retainedCategoryJudgments, 'Retained category feedback', 200);
      for (const item of v.retainedCategoryJudgments) {
        const retained = object(item, 'Retained category feedback');
        assertCategorySnapshot([retained.category], v.assessmentId as string);
        assertMarkingDraft({ annotations: [], pending: null, overallFeedback: '', judgments: [retained.judgment] }, undefined, undefined, [(retained.category as AssessmentCategory).id]);
      }
    }
    if ((v.status === 'draft' && v.commitId !== null) || (v.status === 'finalized' && v.commitId === null)) fail('Session finalization state is inconsistent.');
  } else {
    for (const field of ['sessionId', 'attemptId', 'rubricId', 'studentAssessmentId']) str(v[field], field, 200);
    nullableId(v.previousCommitId, 'Previous commit ID'); assertMarkingDraft(v.draft);
    if (v.draft.pending !== null) fail('Finalized commit cannot contain pending comments.');
    arr(v.resultIds, 'Committed result IDs', 4); v.resultIds.forEach(id => str(id, 'Result ID', 200)); unique(v.resultIds, 'Result IDs');
  }
}
