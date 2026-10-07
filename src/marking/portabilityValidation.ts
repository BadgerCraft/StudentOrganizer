import type { MarkingAttempt, MarkingBase, MarkingCommit, MarkingSession } from './types';
import { assertMarkingDraft, assertMarkingRecord, sessionCategories } from './validation';

export const MARKING_TABLE_NAMES = ['markingRubrics', 'markingAttempts', 'markingSessions', 'markingCommits'] as const;

type BackupTables = Record<string, any[]>;
function fail(message: string): never { throw new Error(`Invalid backup file: Marking ${message}. Existing data has not been changed.`); }

/** Missing additive tables are valid only for an actual pre-marking backup. Never drop supplied data. */
export function normalizeLegacyMarkingTables(tables: BackupTables, schemaVersion: number): void {
  if (schemaVersion < 4) {
    for (const name of MARKING_TABLE_NAMES) {
      if (!Object.prototype.hasOwnProperty.call(tables, name)) tables[name] = [];
      else if (!Array.isArray(tables[name]) || tables[name].length !== 0) fail('records require schema version 4');
    }
  }
}

/** Validate links in the imported snapshot, never against the database that will be replaced. */
export function validateMarkingBackup(tables: BackupTables): void {
  const maps = Object.fromEntries(Object.entries(tables).map(([name, records]) => [name, new Map(records.map(record => [record.id, record]))]));
  function ref(table: string, id: string): any {
    const record = maps[table]?.get(id);
    if (!record) fail(`reference ${table}/${id} is missing`);
    return record;
  }
  function sameScope(record: MarkingBase, related: MarkingBase, label: string) {
    if (record.assessmentId !== related.assessmentId || record.classSectionId !== related.classSectionId || record.createdBy !== related.createdBy) fail(`${label} crosses an assessment, class or teacher boundary`);
  }
  function base(record: MarkingBase) {
    const assessment = ref('assessments', record.assessmentId);
    const section = ref('classSections', record.classSectionId);
    ref('users', record.createdBy);
    if (assessment.classSectionId !== section.id) fail('assessment is in a different class');
    // Historical revoked/deleted memberships remain valid history. Access is checked afresh
    // by the domain service after restore; a backup cannot grant ongoing teacher authority.
    const organizationId = ref('courses', section.courseId).organizationId;
    const organizations = new Set<string>();
    let current: string | null = organizationId;
    while (current) {
      if (organizations.has(current)) fail('organization hierarchy contains a cycle');
      organizations.add(current);
      current = ref('organizations', current).parentOrganizationId;
    }
    const memberships = tables.organizationMemberships.filter(member => member.userId === record.createdBy && organizations.has(member.organizationId));
    const ownsClass = memberships.some(member => member.role === 'admin' || member.role === 'department_head') || tables.classSectionStaff.some(staff => staff.classSectionId === record.classSectionId && memberships.some(member => member.id === staff.organizationMembershipId));
    if (!ownsClass) fail('owner has no retained membership or staff connection to the class');
  }
  function draft(record: MarkingSession | MarkingCommit, attempt: MarkingAttempt) {
    const rubric = ref('markingRubrics', record.rubricId);
    // Draft recovery may refer to categories removed after marking began. Only a
    // validated, assessment-bound session snapshot can stand in for a missing row.
    const savedCategories = sessionCategories('baseline' in record ? record : ref('markingSessions', record.sessionId));
    assertMarkingDraft(record.draft, rubric, attempt.documents, savedCategories?.map(c => c.id));
    for (const judgment of record.draft.judgments) {
      const category = maps.assessmentCategories?.get(judgment.assessmentCategoryId) ?? savedCategories?.find(c => c.id === judgment.assessmentCategoryId);
      if (!category) fail('judgment has no assessment category or retained snapshot');
      if (category.assessmentId !== record.assessmentId) fail('judgment refers to a different assessment');
    }
  }
  function acyclic(table: string, field: string) {
    const complete = new Set<string>();
    for (const record of tables[table]) {
      const visiting = new Set<string>();
      let current = record;
      while (current && !complete.has(current.id)) {
        if (visiting.has(current.id)) fail(`${field} history contains a cycle`);
        visiting.add(current.id);
        current = current[field] === null ? null : ref(table, current[field]);
      }
      for (const id of visiting) complete.add(id);
    }
  }
  for (const name of MARKING_TABLE_NAMES) {
    for (const record of tables[name]) {
      assertMarkingRecord(name, record);
      base(record);
    }
  }
  for (const rubric of tables.markingRubrics) {
    const categories = tables.assessmentCategories.filter(category => category.assessmentId === rubric.assessmentId);
    for (const session of tables.markingSessions as MarkingSession[]) {
      if (session.rubricId === rubric.id && session.assessmentId === rubric.assessmentId && session.classSectionId === rubric.classSectionId && session.createdBy === rubric.createdBy) {
        categories.push(...sessionCategories(session), ...(session.retainedCategoryJudgments ?? []).map(item => item.category));
      }
    }
    if (rubric.criteria.some((criterion: { categoryCode: string }) => !categories.some(category => category.categoryCode === criterion.categoryCode))) fail('rubric mapping refers to an absent assessment category');
  }
  for (const attempt of tables.markingAttempts as MarkingAttempt[]) {
    sameScope(attempt, ref('markingRubrics', attempt.rubricId), 'rubric');
    if (attempt.classEnrollmentId !== null) {
      const enrollment = ref('classEnrollments', attempt.classEnrollmentId);
      if (enrollment.classSectionId !== attempt.classSectionId) fail('attempt belongs to an enrollment in a different class');
      const student = ref('students', enrollment.studentId);
      const course = ref('courses', ref('classSections', attempt.classSectionId).courseId);
      if (student.organizationId !== course.organizationId) fail('attempt student belongs to another organization');
    }
    if (attempt.previousAttemptId !== null) {
      const previous = ref('markingAttempts', attempt.previousAttemptId);
      sameScope(attempt, previous, 'resubmission');
      if (!attempt.classEnrollmentId || previous.classEnrollmentId !== attempt.classEnrollmentId) fail('resubmission does not belong to the same matched student');
    }
  }
  const revisions = new Set<string>();
  for (const session of tables.markingSessions as MarkingSession[]) {
    const attempt = ref('markingAttempts', session.attemptId) as MarkingAttempt;
    sameScope(session, attempt, 'session');
    if (session.rubricId !== attempt.rubricId) fail('session does not use its attempt rubric version');
    const key = JSON.stringify([session.attemptId, session.createdBy, session.revision]);
    if (revisions.has(key)) fail('session revision is duplicated');
    revisions.add(key);
    draft(session, attempt);
    if (session.commitId !== null) {
      const commit = ref('markingCommits', session.commitId);
      if (commit.sessionId !== session.id) fail('session points to a different finalization');
      // These are two copies of the same immutable saved feedback, not the mutable
      // markbook result which can legitimately change later through manual entry.
      if (stableJSON(session.draft) !== stableJSON(commit.draft)) fail('finalized session differs from its committed feedback');
    }
  }
  const committedSessions = new Set<string>();
  for (const commit of tables.markingCommits as MarkingCommit[]) {
    const session = ref('markingSessions', commit.sessionId) as MarkingSession;
    const attempt = ref('markingAttempts', commit.attemptId) as MarkingAttempt;
    sameScope(commit, session, 'finalization');
    sameScope(commit, attempt, 'finalization attempt');
    if (session.status !== 'finalized' || session.commitId !== commit.id || session.attemptId !== commit.attemptId || session.rubricId !== commit.rubricId) fail('finalization does not match its saved session');
    if (committedSessions.has(commit.sessionId)) fail('session has duplicate finalizations');
    committedSessions.add(commit.sessionId);
    const studentAssessment = ref('studentAssessments', commit.studentAssessmentId);
    if (!attempt.classEnrollmentId || studentAssessment.classEnrollmentId !== attempt.classEnrollmentId || studentAssessment.assessmentId !== commit.assessmentId || studentAssessment.classSectionId !== commit.classSectionId) fail('finalization is attached to a different student or assessment');
    draft(commit, attempt);
    const resultCategories = new Set<string>();
    for (const id of commit.resultIds) {
      const result = ref('categoryResults', id);
      if (result.studentAssessmentId !== studentAssessment.id) fail('committed result belongs to a different student assessment');
      if (resultCategories.has(result.assessmentCategoryId)) fail('finalization contains duplicate category results');
      resultCategories.add(result.assessmentCategoryId);
    }
    const assessed = commit.draft.judgments.filter(judgment => judgment.assessed);
    if (assessed.length !== resultCategories.size || assessed.some(judgment => !resultCategories.has(judgment.assessmentCategoryId))) fail('committed results do not cover the saved assessed categories');
    if (commit.previousCommitId !== null) {
      const previous = ref('markingCommits', commit.previousCommitId);
      // Different authorized teachers may contribute official results over time, while
      // each marking draft remains private to its own creator.
      if (previous.studentAssessmentId !== commit.studentAssessmentId || previous.assessmentId !== commit.assessmentId || previous.classSectionId !== commit.classSectionId) fail('previous finalization belongs to a different student assessment');
    }
  }
  acyclic('markingAttempts', 'previousAttemptId');
  acyclic('markingCommits', 'previousCommitId');
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Crypto and bounded archive inspection finish before the restore write transaction begins. */
export async function validateMarkingBackupFiles(tables: BackupTables): Promise<void> {
  if (!tables.markingAttempts.length) return;
  const { sha256, normalizeMarkingText, parseMarkingFiles } = await import('./importDocuments');
  for (const attempt of tables.markingAttempts as MarkingAttempt[]) {
    for (const document of attempt.documents) {
      if (document.text !== normalizeMarkingText(document.text) || await sha256(new TextEncoder().encode(document.text)) !== document.hash) fail('document text does not match its immutable hash');
      if (document.original === null) continue;
      const original = document.original;
      if (original.name !== document.name || original.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(original.name)) fail('original filename is unsafe or mismatched');
      const bytes = Uint8Array.from(atob(original.base64), char => char.charCodeAt(0));
      if (await sha256(bytes) !== original.hash) fail('original file does not match its retained hash');
      if (original.mime === 'text/plain' && /\.txt$/i.test(original.name)) {
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('original text file is not valid UTF-8'); }
        if (normalizeMarkingText(text) !== document.text) fail('original text file does not match the normalized document');
      } else if (original.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && /\.docx$/i.test(original.name)) {
        const parsed = await parseMarkingFiles([new File([new Uint8Array(bytes)], original.name, { type: original.mime })]);
        if (parsed.errors.length || parsed.documents.length !== 1) fail(`original DOCX is invalid: ${parsed.errors[0]?.message ?? 'Unable to parse original file'}`);
        if (parsed.documents[0].text !== document.text) fail('original DOCX does not match the normalized document');
      } else fail('original file type is unsupported');
    }
  }
}
