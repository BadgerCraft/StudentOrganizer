import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { AuthorizationError } from '../services/authHelper';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { ConcurrencyConflictError, MarkbookDomainService, ValidationError } from '../services/markbookService';
import { MarkingService } from './markingService';
import type { AssessmentCategory, ClassEnrollment } from '../types/schema';
import type { MarkingActor, MarkingAnnotation, MarkingAttempt, MarkingDocument, MarkingDraft, MarkingRubric, RubricContent } from './types';

const ASSESSMENT = 'fictional-marking-assessment';
const SECTION = 'class-eng4u-01';
const TEACHER = 'user-tyler';
const OTHER_TEACHER = 'fictional-other-marker';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function document(name = 'fictional-essay.txt', text = 'A bright moon. A bright moon.\nA fictional argument.'): MarkingDocument {
  return {
    id: crypto.randomUUID(), name, text, hash: hash(text),
    original: { name, mime: 'text/plain', base64: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text), hash: hash(text) }
  };
}

function rubricContent(): RubricContent {
  return {
    title: 'Fictional essay rubric', levels: ['Developing', 'Secure', 'Advanced'],
    criteria: [
      { id: 'evidence', name: 'Textual evidence', categoryCode: 'K', descriptors: { Developing: 'Some evidence.', Secure: 'Relevant evidence.', Advanced: 'Precise evidence.' } },
      { id: 'analysis', name: 'Reasoning', categoryCode: 'T', descriptors: { Developing: 'States an idea.', Secure: 'Explains the idea.', Advanced: 'Synthesizes ideas.' }, weight: 2 }
    ]
  };
}

describe('Assessment-linked marking integrity', () => {
  let db: OntarioTeacherDB;
  let service: MarkingService;
  let actor: MarkingActor;
  let categories: AssessmentCategory[];
  let enrollments: ClassEnrollment[];
  let rubric: MarkingRubric;

  beforeEach(async () => {
    clearActiveTeacherId();
    db = new OntarioTeacherDB(`fictional-marking-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...template, id: ASSESSMENT, code: 'FICTIONAL-MARKING', title: 'Fictional text analysis' });
    categories = (await db.assessmentCategories.where('assessmentId').equals(template.id).toArray())
      .map(category => ({ ...category, id: `fictional-category-${category.categoryCode}`, assessmentId: ASSESSMENT }));
    await db.assessmentCategories.bulkAdd(categories);
    enrollments = await db.classEnrollments.where('classSectionId').equals(SECTION).limit(2).toArray();
    const identity = await selectActingTeacher(db, TEACHER);
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    service = new MarkingService(db);
    rubric = await service.saveRubric(ASSESSMENT, rubricContent(), actor);
  });

  afterEach(async () => {
    clearActiveTeacherId();
    await db.delete();
  });

  async function makeAttempt(enrollmentId: string | null = enrollments[0].id, documents = [document()], previousAttemptId: string | null = null) {
    return service.importAttempt(ASSESSMENT, rubric.id, documents, enrollmentId, previousAttemptId, actor);
  }

  function annotation(attempt: MarkingAttempt, start = 15, end = 28): MarkingAnnotation {
    const doc = attempt.documents[0];
    return {
      id: crypto.randomUUID(), documentId: doc.id, start, end, quote: doc.text.slice(start, end),
      criterionId: 'evidence', level: 'Secure', text: 'Explain how this quotation supports your fictional claim.'
    };
  }

  function draft(attempt: MarkingAttempt, overallFeedback = 'Fictional overall feedback.'): MarkingDraft {
    return {
      annotations: [annotation(attempt)], pending: null, overallFeedback,
      judgments: categories.map(category => ({
        assessmentCategoryId: category.id, assessed: ['K', 'T'].includes(category.categoryCode),
        rawScore: category.categoryCode === 'K' ? '4+' : category.categoryCode === 'T' ? '78%' : '',
        inputFormat: category.categoryCode === 'T' ? 'percentage' : 'scale_code',
        feedback: category.categoryCode === 'K' ? 'Strong use of evidence.' : ''
      }))
    };
  }

  async function savedDraft(enrollmentId = enrollments[0].id) {
    const attempt = await makeAttempt(enrollmentId);
    const opened = await service.openSession(attempt.id, actor);
    const session = await service.saveDraft(opened.id, draft(attempt), opened.version, actor);
    return { attempt, session };
  }

  async function snapshot() {
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  }

  async function official(enrollmentId = enrollments[0].id) {
    const studentAssessment = await db.studentAssessments.where({ assessmentId: ASSESSMENT, classEnrollmentId: enrollmentId }).first();
    const results = studentAssessment ? await db.categoryResults.where('studentAssessmentId').equals(studentAssessment.id).toArray() : [];
    return { studentAssessment, results };
  }

  async function addOtherTeacher() {
    const template = (await db.users.get(TEACHER))!;
    await db.users.add({ ...template, id: OTHER_TEACHER, authSubject: 'fictional-other-marker', email: 'other-marker@example.invalid', name: 'Fictional Other Marker' });
    const membership = (await db.organizationMemberships.where('userId').equals(TEACHER).first())!;
    await db.organizationMemberships.add({ ...membership, id: 'fictional-other-marker-membership', userId: OTHER_TEACHER });
    const staff = (await db.classSectionStaff.where('classSectionId').equals(SECTION).first())!;
    await db.classSectionStaff.add({ ...staff, id: 'fictional-other-marker-staff', organizationMembershipId: 'fictional-other-marker-membership', role: 'co_teacher' });
  }

  it('recovers unfinished feedback, exact second-occurrence anchors and original bytes after reopening the database without touching grades', async () => {
    const attempt = await makeAttempt();
    const opened = await service.openSession(attempt.id, actor);
    const content = draft(attempt);
    content.pending = { ...annotation(attempt, 2, 13), text: 'Unfinished feedback retained after restart.' };
    const before = await official();
    const saved = await service.saveDraft(opened.id, content, opened.version, actor);
    const name = db.name;
    db.close();
    db = new OntarioTeacherDB(name);
    service = new MarkingService(db);
    const context = await service.getContext(ASSESSMENT, actor);
    expect(context.sessions.find(s => s.id === saved.id)?.draft).toEqual(content);
    expect(context.attempts.find(a => a.id === attempt.id)?.documents).toEqual(attempt.documents);
    expect(content.annotations[0]).toMatchObject({ start: 15, end: 28, quote: 'A bright moon' });
    expect(await official()).toEqual(before);
    expect(await db.markingCommits.count()).toBe(0);
  });

  it('isolates drafts for two students and protects a newer autosave from a stale workspace', async () => {
    const first = await savedDraft();
    const second = await savedDraft(enrollments[1].id);
    const firstContent = { ...first.session.draft, overallFeedback: 'First fictional student only.' };
    const saved = await service.saveDraft(first.session.id, firstContent, first.session.version, actor);
    await expect(service.saveDraft(first.session.id, { ...firstContent, overallFeedback: 'Stale overwrite.' }, first.session.version, actor)).rejects.toThrow(ConcurrencyConflictError);
    expect((await db.markingSessions.get(first.session.id))?.draft).toEqual(saved.draft);
    expect((await db.markingSessions.get(second.session.id))?.draft).toEqual(second.session.draft);
    expect(await official()).toEqual({ studentAssessment: undefined, results: [] });
    expect(await official(enrollments[1].id)).toEqual({ studentAssessment: undefined, results: [] });
  });

  it('finalizes independent KTAC judgments once through the existing markbook, preserving level suffixes and leaving unassessed categories absent', async () => {
    const { attempt, session } = await savedDraft();
    const otherStudentBefore = await official(enrollments[1].id);
    const gradeOverridesBefore = await db.gradeOverrides.toArray();
    const commit = await service.finalize(session.id, session.version, actor);
    const { studentAssessment, results } = await official();
    expect(studentAssessment).toMatchObject({ assessmentId: ASSESSMENT, classEnrollmentId: enrollments[0].id, overallFeedback: session.draft.overallFeedback, workflowStatus: 'assessed' });
    expect(results).toHaveLength(2);
    expect(results.find(r => r.assessmentCategoryId === 'fictional-category-K')).toMatchObject({ rawScore: '4+', normalizedPercentage: 95, feedback: 'Strong use of evidence.' });
    expect(results.find(r => r.assessmentCategoryId === 'fictional-category-T')).toMatchObject({ rawScore: '78%', normalizedPercentage: 78 });
    expect(commit).toMatchObject({ attemptId: attempt.id, sessionId: session.id, studentAssessmentId: studentAssessment!.id, draft: session.draft });
    expect(new Set(commit.resultIds)).toEqual(new Set(results.map(r => r.id)));
    const afterFirst = await snapshot();
    expect(await service.finalize(session.id, session.version, actor)).toEqual(commit);
    expect(await snapshot()).toEqual(afterFirst);
    expect(await official(enrollments[1].id)).toEqual(otherStudentBefore);
    expect(await db.gradeOverrides.toArray()).toEqual(gradeOverridesBefore);
    for (const result of results) {
      const audit = await db.auditEntries.where('entityId').equals(result.id).first();
      expect(audit).toMatchObject({ userId: TEACHER, action: 'INSERT' });
    }
  });

  it('keeps the finalized snapshot official while revising and reuses grade IDs on successful re-finalization', async () => {
    const { attempt, session } = await savedDraft();
    const firstCommit = await service.finalize(session.id, session.version, actor);
    const initialOfficial = await official();
    const reopened = await service.openSession(attempt.id, actor);
    expect(reopened).toMatchObject({ status: 'draft', revision: session.revision + 1, commitId: null });
    expect(reopened.id).not.toBe(session.id);
    const content = structuredClone(reopened.draft);
    content.overallFeedback = 'Revised fictional feedback.';
    content.judgments.find(j => j.assessmentCategoryId === 'fictional-category-K')!.rawScore = '3-';
    const revision = await service.saveDraft(reopened.id, content, reopened.version, actor);
    expect(await official()).toEqual(initialOfficial);
    expect(await db.markingCommits.get(firstCommit.id)).toEqual(firstCommit);
    const secondCommit = await service.finalize(revision.id, revision.version, actor);
    const updatedOfficial = await official();
    expect(secondCommit.previousCommitId).toBe(firstCommit.id);
    expect(updatedOfficial.studentAssessment?.id).toBe(initialOfficial.studentAssessment?.id);
    expect(updatedOfficial.studentAssessment?.overallFeedback).toBe(content.overallFeedback);
    expect(updatedOfficial.results.map(r => r.id).sort()).toEqual(initialOfficial.results.map(r => r.id).sort());
    expect(updatedOfficial.results.find(r => r.assessmentCategoryId === 'fictional-category-K')).toMatchObject({ rawScore: '3-', normalizedPercentage: 71 });
    expect(await db.markingCommits.get(firstCommit.id)).toEqual(firstCommit);
    expect(await db.markingCommits.count()).toBe(2);
  });

  it('serializes simultaneous finalize clicks into one official result and one immutable receipt', async () => {
    const { session } = await savedDraft();
    const [first, second] = await Promise.all([
      service.finalize(session.id, session.version, actor),
      service.finalize(session.id, session.version, actor)
    ]);
    expect(second).toEqual(first);
    expect(await db.markingCommits.count()).toBe(1);
    expect((await official()).results).toHaveLength(2);
    const commits = await db.auditEntries.where('entityName').equals('markingCommits').toArray();
    expect(commits).toHaveLength(1);
    for (const result of (await official()).results) {
      expect(await db.auditEntries.where('entityId').equals(result.id).count()).toBe(1);
    }
  });

  it('requires an explicit baseline refresh before replacing a newer manual grade and retains the manual change in audit', async () => {
    const { attempt, session } = await savedDraft();
    await service.finalize(session.id, session.version, actor);
    const revision = await service.openSession(attempt.id, actor);
    const current = await official();
    const existing = current.results.find(r => r.assessmentCategoryId === 'fictional-category-K')!;
    const manual = await new MarkbookDomainService(db).recordCategoryResult({
      studentAssessmentId: current.studentAssessment!.id, assessmentCategoryId: existing.assessmentCategoryId,
      rawScore: '2+', inputFormat: 'scale_code', feedback: 'Newer manual observation.',
      expectedVersion: existing.version, expectedStudentAssessmentVersion: current.studentAssessment!.version,
      userId: actor.userId, deviceId: actor.deviceId
    });
    const afterManual = await snapshot();
    await expect(service.finalize(revision.id, revision.version, actor)).rejects.toThrow(ConcurrencyConflictError);
    expect(await snapshot()).toEqual(afterManual);
    const refreshed = await service.refreshBaseline(revision.id, revision.version, actor);
    expect((await official()).results.find(r => r.id === manual.id)).toEqual(manual);
    expect(refreshed.draft).toEqual(revision.draft);
    await service.finalize(refreshed.id, refreshed.version, actor);
    const final = (await official()).results.find(r => r.id === manual.id)!;
    expect(final.rawScore).toBe('4+');
    const updates = await db.auditEntries.where('entityId').equals(manual.id).toArray();
    expect(updates.some(entry => entry.newStateJson && JSON.parse(entry.newStateJson).rawScore === '2+')).toBe(true);
    expect(updates.some(entry => entry.previousStateJson && JSON.parse(entry.previousStateJson).rawScore === '2+')).toBe(true);
  });

  it('rolls back every grade, feedback, session and audit write when the final commit cannot be stored', async () => {
    const { session } = await savedDraft();
    const before = await snapshot();
    const failCommit = () => { throw new Error('Fictional final-commit storage failure'); };
    db.markingCommits.hook('creating', failCommit);
    try {
      await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow('final-commit storage failure');
    } finally {
      db.markingCommits.hook('creating').unsubscribe(failCommit);
    }
    expect(await snapshot()).toEqual(before);
    await service.finalize(session.id, session.version, actor);
    expect((await official()).results).toHaveLength(2);
  });

  it('aborts all underway finalization writes when the teacher switches after grade writes but before commit', async () => {
    const { session } = await savedDraft();
    const before = await snapshot();
    let switched = false;
    const revoke = () => {
      switched = true;
      setActiveTeacherId(OTHER_TEACHER);
      setActiveTeacherId(TEACHER);
    };
    db.markingCommits.hook('creating', revoke);
    try {
      await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow();
    } finally {
      db.markingCommits.hook('creating').unsubscribe(revoke);
    }
    expect(switched).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it('preserves the recoverable draft if its audit write fails', async () => {
    const { session } = await savedDraft();
    const before = await snapshot();
    const failAudit = () => { throw new Error('Fictional audit storage failure'); };
    db.auditEntries.hook('creating', failAudit);
    try {
      await expect(service.saveDraft(session.id, { ...session.draft, overallFeedback: 'Unsaved change.' }, session.version, actor)).rejects.toThrow('audit storage failure');
    } finally {
      db.auditEntries.hook('creating').unsubscribe(failAudit);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('rejects pending feedback at finalization while retaining it for correction', async () => {
    const { attempt, session } = await savedDraft();
    const content = { ...session.draft, pending: annotation(attempt, 2, 13) };
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const before = await snapshot();
    await expect(service.finalize(saved.id, saved.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
    expect((await db.markingSessions.get(saved.id))?.draft.pending).toEqual(content.pending);
  });

  it('rejects unsupported official labels and a newly unassessed category with an existing official mark without partial writes', async () => {
    const { attempt, session } = await savedDraft();
    const invalid = structuredClone(session.draft);
    invalid.judgments.find(j => j.assessmentCategoryId === 'fictional-category-K')!.rawScore = 'Advanced';
    const invalidSaved = await service.saveDraft(session.id, invalid, session.version, actor);
    const beforeInvalid = await snapshot();
    await expect(service.finalize(invalidSaved.id, invalidSaved.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(beforeInvalid);
    const valid = await service.saveDraft(session.id, draft(attempt), invalidSaved.version, actor);
    await service.finalize(valid.id, valid.version, actor);
    const reopened = await service.openSession(attempt.id, actor);
    const unassessed = structuredClone(reopened.draft);
    unassessed.judgments.find(j => j.assessmentCategoryId === 'fictional-category-K')!.assessed = false;
    const unsavedCategory = await service.saveDraft(reopened.id, unassessed, reopened.version, actor);
    const beforeRemoval = await snapshot();
    await expect(service.finalize(unsavedCategory.id, unsavedCategory.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(beforeRemoval);
  });

  it('keeps new rubric versions and resubmissions separate from pinned originals, annotations and official marks', async () => {
    const { attempt, session } = await savedDraft();
    const commit = await service.finalize(session.id, session.version, actor);
    const oldOfficial = await official();
    const editedRubric = rubricContent();
    editedRubric.criteria[0].descriptors.Secure = 'Newer descriptor, only for new attempts.';
    const newerRubric = await service.saveRubric(ASSESSMENT, editedRubric, actor);
    expect(newerRubric.id).not.toBe(rubric.id);
    const second = await service.importAttempt(ASSESSMENT, newerRubric.id, [document('revision.txt'), document('appendix.txt')], enrollments[0].id, attempt.id, actor);
    await service.openSession(second.id, actor);
    expect(second).toMatchObject({ previousAttemptId: attempt.id, rubricId: newerRubric.id });
    expect(second.documents).toHaveLength(2);
    expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
    expect(await db.markingRubrics.get(rubric.id)).toEqual(rubric);
    expect(await db.markingCommits.get(commit.id)).toEqual(commit);
    expect(await official()).toEqual(oldOfficial);
  });

  it('requires an explicit roster match and rejects a different-class enrollment without changing the attempt', async () => {
    const attempt = await makeAttempt(null);
    await expect(service.openSession(attempt.id, actor)).rejects.toThrow(ValidationError);
    const foreign = (await db.classEnrollments.where('classSectionId').equals('class-sch3u-02').first())!;
    await expect(service.matchAttempt(attempt.id, foreign.id, attempt.version, actor)).rejects.toThrow(ValidationError);
    expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
    const matched = await service.matchAttempt(attempt.id, enrollments[0].id, attempt.version, actor);
    expect(matched.classEnrollmentId).toBe(enrollments[0].id);
    expect(await official()).toEqual({ studentAssessment: undefined, results: [] });
    await service.openSession(attempt.id, actor);
    await expect(service.matchAttempt(attempt.id, enrollments[1].id, matched.version, actor)).rejects.toThrow(ValidationError);
    expect((await db.markingAttempts.get(attempt.id))?.classEnrollmentId).toBe(enrollments[0].id);
  });

  it('rejects changed text or original bytes with stale hashes and prevents duplicate imports without losing an earlier attempt', async () => {
    const original = document();
    const attempt = await makeAttempt(enrollments[0].id, [original]);
    const before = await snapshot();
    const changedText = { ...original, id: crypto.randomUUID(), text: 'Changed text with an old hash.' };
    const changedOriginal = structuredClone(original);
    changedOriginal.id = crypto.randomUUID();
    changedOriginal.original!.base64 = Buffer.from('Changed original.').toString('base64');
    changedOriginal.original!.size = Buffer.byteLength('Changed original.');
    await expect(makeAttempt(enrollments[1].id, [changedText])).rejects.toThrow(ValidationError);
    await expect(makeAttempt(enrollments[1].id, [changedOriginal])).rejects.toThrow(ValidationError);
    await expect(makeAttempt(enrollments[0].id, [{ ...original, id: crypto.randomUUID() }])).rejects.toThrow(ValidationError);
    expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects malformed KTAC matrices and anchors bound to other text, documents, levels or criteria', async () => {
    const malformed = rubricContent();
    delete malformed.criteria[0].descriptors.Secure;
    await expect(service.saveRubric(ASSESSMENT, malformed, actor)).rejects.toThrow(ValidationError);
    const unmapped = rubricContent();
    unmapped.criteria[0].categoryCode = '' as 'K';
    await expect(service.saveRubric(ASSESSMENT, unmapped, actor)).rejects.toThrow(ValidationError);
    const { session } = await savedDraft();
    const before = await snapshot();
    for (const altered of [
      { quote: 'A different quotation' }, { documentId: 'another-document' },
      { criterionId: 'another-criterion' }, { level: 'Unconfigured label' }, { end: 100000 }
    ]) {
      const content = structuredClone(session.draft);
      Object.assign(content.annotations[0], altered);
      await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('blocks reads and writes with no active teacher and with an actor from an earlier selection epoch', async () => {
    const { session } = await savedDraft();
    const before = await snapshot();
    clearActiveTeacherId();
    await expect(service.getContext(ASSESSMENT, actor)).rejects.toThrow(AuthorizationError);
    await expect(service.saveDraft(session.id, session.draft, session.version, actor)).rejects.toThrow(AuthorizationError);
    setActiveTeacherId(TEACHER);
    await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow(AuthorizationError);
    expect(await snapshot()).toEqual(before);
  });

  it('invalidates queued autosaves after teacher A → B → A even though the current teacher ID matches again', async () => {
    const { session } = await savedDraft();
    const before = await snapshot();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { started = resolve; });
    const blocker = db.transaction('rw', db.markingSessions, async () => {
      started();
      await Dexie.waitFor(held);
    });
    await acquired;
    // This models a separate UI task, not a nested Dexie transaction.
    const queued = Dexie.ignoreTransaction(() => service.saveDraft(session.id, { ...session.draft, overallFeedback: 'Stale queued edit.' }, session.version, actor));
    const outcome = queued.then(value => ({ value, error: null }), error => ({ value: null, error }));
    setActiveTeacherId(OTHER_TEACHER);
    setActiveTeacherId(TEACHER);
    release();
    await blocker;
    expect((await outcome).error).toBeInstanceOf(AuthorizationError);
    expect(await Dexie.ignoreTransaction(snapshot)).toEqual(before);
  });

  it('does not let a valid co-teacher use another teacher’s private marking records', async () => {
    const { attempt, session } = await savedDraft();
    await addOtherTeacher();
    const other = await selectActingTeacher(db, OTHER_TEACHER);
    const otherActor = { userId: other.userId, deviceId: other.deviceId, epoch: getIdentityEpoch() };
    const before = await snapshot();
    const visible = await service.getContext(ASSESSMENT, otherActor);
    expect(visible.rubrics).toEqual([]);
    expect(visible.attempts).toEqual([]);
    expect(visible.sessions).toEqual([]);
    expect(visible.commits).toEqual([]);
    await expect(service.openSession(attempt.id, otherActor)).rejects.toThrow(AuthorizationError);
    await expect(service.saveDraft(session.id, session.draft, session.version, otherActor)).rejects.toThrow(AuthorizationError);
    await expect(service.finalize(session.id, session.version, otherActor)).rejects.toThrow(AuthorizationError);
    await expect(service.importAttempt(ASSESSMENT, rubric.id, [document()], enrollments[0].id, null, otherActor)).rejects.toThrow(AuthorizationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['assessment locked', 'reporting period closed', 'assessment deleted', 'enrollment deleted', 'student deleted', 'membership suspended'])(
    'rechecks %s after a draft has been opened and prevents finalization', async boundary => {
      const { session } = await savedDraft();
      const now = new Date().toISOString();
      if (boundary === 'assessment locked') await db.assessments.update(ASSESSMENT, { isLocked: true });
      if (boundary === 'reporting period closed') {
        const assessment = (await db.assessments.get(ASSESSMENT))!;
        await db.reportingPeriods.update(assessment.reportingPeriodId, { isClosed: true });
      }
      if (boundary === 'assessment deleted') await db.assessments.update(ASSESSMENT, { deletedAt: now });
      if (boundary === 'enrollment deleted') await db.classEnrollments.update(enrollments[0].id, { deletedAt: now });
      if (boundary === 'student deleted') await db.students.update(enrollments[0].studentId, { deletedAt: now });
      if (boundary === 'membership suspended') await db.organizationMemberships.where('userId').equals(TEACHER).modify({ status: 'suspended' });
      const before = await snapshot();
      await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
  );

  it('archives draft work with recoverable originals instead of deleting it or allowing further writes', async () => {
    const { attempt, session } = await savedDraft();
    const gradesBefore = await official();
    await service.archiveAttempt(attempt.id, attempt.version, actor);
    const stored = await db.markingAttempts.get(attempt.id);
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.documents).toEqual(attempt.documents);
    expect((await db.markingSessions.get(session.id))?.draft).toEqual(session.draft);
    await expect(service.saveDraft(session.id, session.draft, session.version, actor)).rejects.toThrow();
    await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow();
    expect(await official()).toEqual(gradesBefore);
  });

  it('retains finalized originals and returns the same receipt after locking the assessment without reopening marking', async () => {
    const { attempt, session } = await savedDraft();
    const commit = await service.finalize(session.id, session.version, actor);
    await expect(service.archiveAttempt(attempt.id, attempt.version, actor)).rejects.toThrow(ValidationError);
    await db.assessments.update(ASSESSMENT, { isLocked: true });
    const before = await snapshot();
    expect(await service.finalize(session.id, session.version, actor)).toEqual(commit);
    await expect(service.openSession(attempt.id, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
    expect((await db.markingAttempts.get(attempt.id))?.documents).toEqual(attempt.documents);
  });
  it('rejects a conflict acceptance if the displayed official result changed before its transaction', async () => {
    const { attempt, session } = await savedDraft();
    const context = await service.getContext(ASSESSMENT, actor);
    const studentAssessment = context.studentAssessments.find(a => a.classEnrollmentId === attempt.classEnrollmentId);
    const signature = JSON.stringify({ assessment: context.assessment, categories: context.categories, studentAssessment,
      results: context.currentResults.filter(r => r.studentAssessmentId === studentAssessment?.id) });
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: ASSESSMENT, classSectionId: SECTION,
      classEnrollmentId: attempt.classEnrollmentId!, assessmentCategoryId: categories[0].id, rawScore: '3', inputFormat: 'scale_code', userId: actor.userId, deviceId: actor.deviceId });
    await expect(service.refreshBaseline(session.id, session.version, actor, signature)).rejects.toThrow('changed again');
    expect((await db.markingSessions.get(session.id))!.baseline).toBe(session.baseline);
  });

});
