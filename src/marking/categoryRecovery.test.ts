import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { assertClassSectionWriteAccess, AuthorizationError } from '../services/authHelper';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { ConcurrencyConflictError, MarkbookDomainService, ValidationError } from '../services/markbookService';
import { PortabilityService } from '../services/portabilityService';
import type { AssessmentCategory } from '../types/schema';
import { MarkingService } from './markingService';
import type { MarkingActor, MarkingAnnotation, MarkingDraft, MarkingSession } from './types';

const ASSESSMENT = 'fictional-category-recovery';
const SECTION = 'class-eng4u-01';
const TEACHER = 'user-tyler';
const OTHER_TEACHER = 'fictional-recovery-co-teacher';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

describe('marking category-change recovery', () => {
  let db: OntarioTeacherDB;
  let service: MarkingService;
  let actor: MarkingActor;
  let categories: AssessmentCategory[];
  let session: MarkingSession;
  let content: MarkingDraft;
  let enrollmentId: string;

  beforeEach(async () => {
    clearActiveTeacherId();
    db = new OntarioTeacherDB(`fictional-category-recovery-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const assessment = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...assessment, id: ASSESSMENT, code: 'FICTIONAL-RECOVERY', title: 'Fictional category recovery' });
    categories = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).toArray())
      .map(category => ({ ...category, id: `recovery-${category.categoryCode}`, assessmentId: ASSESSMENT }));
    await db.assessmentCategories.bulkAdd(categories);
    enrollmentId = (await db.classEnrollments.where('classSectionId').equals(SECTION).first())!.id;
    const identity = await selectActingTeacher(db, TEACHER);
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    service = new MarkingService(db);
    const rubric = await service.saveRubric(ASSESSMENT, { title: 'Fictional pinned T rubric', levels: ['Secure'],
      criteria: [{ id: 'reasoning', name: 'Reasoning', categoryCode: 'T', descriptors: { Secure: 'Explains the evidence.' } }] }, actor);
    const text = 'A bright moon. A bright moon.\nA fictional argument.';
    const document = { id: crypto.randomUUID(), name: 'fictional-recovery.txt', text, hash: digest(text), original: null };
    const attempt = await service.importAttempt(ASSESSMENT, rubric.id, [document], enrollmentId, null, actor);
    await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: ASSESSMENT, classSectionId: SECTION,
      classEnrollmentId: enrollmentId, assessmentCategoryId: 'recovery-K', rawScore: '2+', inputFormat: 'scale_code',
      userId: actor.userId, deviceId: actor.deviceId });
    session = await service.openSession(attempt.id, actor);
    const annotation = (start: number, end: number, feedback: string): MarkingAnnotation => ({
      id: crypto.randomUUID(), documentId: document.id, start, end, quote: text.slice(start, end),
      criterionId: 'reasoning', level: 'Secure', text: feedback
    });
    content = { annotations: [annotation(0, 13, 'First fictional comment.'), annotation(15, 28, 'Second fictional comment.')],
      pending: annotation(30, 40, 'Unfinished fictional feedback.'), overallFeedback: 'Overall fictional reasoning remains intact.',
      judgments: categories.map(category => ({ assessmentCategoryId: category.id, assessed: true, rawScore: '3+',
        inputFormat: 'scale_code', feedback: `Retain ${category.categoryCode} feedback exactly.` })) };
  });

  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });

  async function official() {
    return { assessments: await db.studentAssessments.where('assessmentId').equals(ASSESSMENT).toArray(),
      results: await db.categoryResults.toArray(), commits: await db.markingCommits.toArray() };
  }
  async function snapshot() {
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  }
  // Models another authorized assessment context. Category editing currently has no public service method.
  async function changeCategories(remove: string[], replacements: AssessmentCategory[] = [], hardDelete = false) {
    await db.transaction('rw', db.tables, async () => {
      await assertClassSectionWriteAccess(db, actor.userId, SECTION);
      for (const id of remove) {
        if (hardDelete) await db.assessmentCategories.delete(id);
        else await db.assessmentCategories.update(id, { deletedAt: new Date().toISOString() });
      }
      await db.assessmentCategories.bulkAdd(replacements);
    });
  }
  function replacement(code: AssessmentCategory['categoryCode'], suffix = 'new') {
    return { ...categories.find(category => category.categoryCode === code)!, id: `recovery-${code}-${suffix}` };
  }

  function mapping(changes: Record<string, string | null>) {
    return Object.fromEntries(categories.map(category => [category.id, category.id in changes ? changes[category.id] : category.id]));
  }

  it('saves all pending feedback against the original categories after an authorized category replacement', async () => {
    const before = await official();
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    expect(saved.draft).toEqual(content);
    expect(await official()).toEqual(before);
    db.close();
    db = new OntarioTeacherDB(db.name);
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(content);
  });

  it('recovers legacy sessions from their original baseline even when a former category row is gone', async () => {
    // Sessions made before categorySnapshot was introduced retain the original category set in baseline.
    const legacy = { ...session };
    delete legacy.categorySnapshot;
    delete legacy.retainedCategoryJudgments;
    await db.markingSessions.put(legacy);
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(legacy.id, content, legacy.version, actor);
    expect(saved.draft).toEqual(content);
    expect(saved.categorySnapshot?.find(category => category.id === 'recovery-T')).toEqual(categories.find(category => category.id === 'recovery-T'));
  });

  it('preserves finalized feedback and a reopened revision through category recovery and full backup restore', async () => {
    // T has feedback but no official result: replacing its definition must not make
    // the historical commit unrestorable. Real orphaned official marks stay invalid.
    const finalDraft = { ...content, pending: null, judgments: content.judgments.map(j =>
      j.assessmentCategoryId === 'recovery-T' ? { ...j, assessed: false } : j) };
    const saved = await service.saveDraft(session.id, finalDraft, session.version, actor);
    const commit = await service.finalize(saved.id, saved.version, actor);
    const legacyFinalized = (await db.markingSessions.get(saved.id))!;
    delete legacyFinalized.categorySnapshot;
    delete legacyFinalized.retainedCategoryJudgments;
    await db.markingSessions.put(legacyFinalized);
    const before = await official();
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const revision = await service.openSession(session.attemptId, actor);
    expect(revision.draft).toEqual(finalDraft);
    expect(revision.categorySnapshot).toEqual(session.categorySnapshot);
    const pendingRevision = await service.saveDraft(revision.id, content, revision.version, actor);
    const review = await service.reviewCategoryChanges(revision.id, actor);
    const reconciled = await service.reconcileCategoryChanges(revision.id, pendingRevision.version, review.token,
      mapping({ 'recovery-T': 'recovery-T-new' }), actor);
    expect(await official()).toEqual(before);
    const portability = new PortabilityService(db);
    const backup = await portability.createFullBackupJSON();
    await portability.restoreFromJSON(backup);
    expect(await db.markingCommits.get(commit.id)).toEqual(commit);
    expect(await db.markingSessions.get(reconciled.id)).toEqual(reconciled);
    expect(await official()).toEqual(before);
  });

  it('rejects unrelated category judgments rather than broadening validation when saving a recoverable draft', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const invalid = structuredClone(content);
    invalid.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T')!.assessmentCategoryId = 'forged-category';
    const before = await snapshot();
    await expect(service.saveDraft(session.id, invalid, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it('does not report a recoverable save when the session write or audit write fails', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    for (const table of [db.markingSessions, db.auditEntries]) {
      const before = await snapshot();
      const fail = () => { throw new Error('Fictional recovery storage failure'); };
      if (table === db.markingSessions) db.markingSessions.hook('updating', fail);
      else db.auditEntries.hook('creating', fail);
      try {
        await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow('Fictional recovery storage failure');
      } finally {
        if (table === db.markingSessions) db.markingSessions.hook('updating').unsubscribe(fail);
        else db.auditEntries.hook('creating').unsubscribe(fail);
      }
      expect(await snapshot()).toEqual(before);
    }
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    expect(saved.draft).toEqual(content);
  });

  it('explicitly reconciles same-KTAC replacement while retaining old judgment history and leaving official marks unchanged', async () => {
    const before = await official();
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    expect(review.compatible).toBe(true);
    const reviewedSnapshot = await snapshot();
    await expect(service.refreshBaseline(saved.id, saved.version, actor)).rejects.toThrow();
    await expect(service.finalize(saved.id, saved.version, actor)).rejects.toThrow();
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(content);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, {}, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(reviewedSnapshot);
    const reconciled = await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor);
    expect(reconciled.draft).toEqual({ ...content, judgments: content.judgments.map(judgment =>
      judgment.assessmentCategoryId === 'recovery-T' ? { ...judgment, assessmentCategoryId: 'recovery-T-new' } : judgment) });
    expect(reconciled.retainedCategoryJudgments).toContainEqual({ category: categories.find(category => category.id === 'recovery-T'), judgment: content.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T') });
    expect(reconciled.baseline).toBe(session.baseline);
    expect(await official()).toEqual(before);
    db.close();
    db = new OntarioTeacherDB(db.name);
    expect(await db.markingSessions.get(reconciled.id)).toEqual(reconciled);
    const audit = await db.auditEntries.where('entityId').equals(session.id).toArray();
    expect(audit.some(entry => entry.userId === TEACHER && entry.previousStateJson &&
      JSON.parse(entry.previousStateJson).draft.judgments.some((judgment: { assessmentCategoryId: string }) => judgment.assessmentCategoryId === 'recovery-T') &&
      entry.newStateJson && JSON.parse(entry.newStateJson).retainedCategoryJudgments?.length > 0)).toBe(true);
  });

  it('retains removed-category feedback explicitly and leaves a declined replacement unassessed', async () => {
    await changeCategories(['recovery-C', 'recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const before = await official();
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const reconciled = await service.reconcileCategoryChanges(saved.id, saved.version, review.token,
      mapping({ 'recovery-C': null, 'recovery-T': null }), actor);
    expect(reconciled.draft.annotations).toEqual(content.annotations);
    expect(reconciled.draft.pending).toEqual(content.pending);
    expect(reconciled.draft.overallFeedback).toBe(content.overallFeedback);
    expect(reconciled.draft.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T-new')).toMatchObject({
      assessed: false, rawScore: '', feedback: ''
    });
    for (const id of ['recovery-C', 'recovery-T']) expect(reconciled.retainedCategoryJudgments).toContainEqual({
      category: categories.find(category => category.id === id), judgment: content.judgments.find(judgment => judgment.assessmentCategoryId === id)
    });
    expect(await official()).toEqual(before);
  });

  it('handles a tombstoned category without silently retaining its judgment as an active category', async () => {
    await changeCategories(['recovery-C']);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const reconciled = await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-C': null }), actor);
    expect(reconciled.draft.judgments.map(judgment => judgment.assessmentCategoryId)).not.toContain('recovery-C');
    expect(reconciled.retainedCategoryJudgments).toContainEqual({ category: categories.find(category => category.id === 'recovery-C'), judgment: content.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-C') });
    expect((await db.assessmentCategories.get('recovery-C'))?.deletedAt).not.toBeNull();
  });

  it('keeps incompatible pinned-rubric work recoverable across restart and rejects cross-KTAC remapping', async () => {
    await changeCategories(['recovery-T']);
    const before = await official();
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    expect(review.compatible).toBe(false);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-C' }), actor)).rejects.toThrow(ValidationError);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': null }), actor)).rejects.toThrow(ValidationError);
    await expect(service.refreshBaseline(saved.id, saved.version, actor)).rejects.toThrow();
    await expect(service.finalize(saved.id, saved.version, actor)).rejects.toThrow();
    expect(await official()).toEqual(before);
    db.close();
    db = new OntarioTeacherDB(db.name);
    service = new MarkingService(db);
    expect((await service.getContext(ASSESSMENT, actor)).sessions.find(row => row.id === saved.id)?.draft).toEqual(content);
  });

  it('rejects a cross-KTAC mapping even when the pinned rubric itself remains compatible', async () => {
    await changeCategories(['recovery-C']);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    expect(review.compatible).toBe(true);
    const before = await snapshot();
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-C': 'recovery-K' }), actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects stale review tokens and stale session versions before changing retained work', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const firstReview = await service.reviewCategoryChanges(saved.id, actor);
    await db.assessmentCategories.update('recovery-T-new', { maxScore: 99 });
    const before = await snapshot();
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, firstReview.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow(ConcurrencyConflictError);
    expect(await snapshot()).toEqual(before);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const newer = await service.saveDraft(saved.id, { ...content, overallFeedback: 'Newer authorized feedback.' }, saved.version, actor);
    const afterNewer = await snapshot();
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow(ConcurrencyConflictError);
    await expect(service.reconcileCategoryChanges(saved.id, newer.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow(ConcurrencyConflictError);
    expect(await snapshot()).toEqual(afterNewer);
    expect((await db.markingSessions.get(newer.id))?.draft.overallFeedback).toBe('Newer authorized feedback.');
  });

  it('rolls back reconciliation and its retained history if audit storage fails', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const before = await snapshot();
    const fail = () => { throw new Error('Fictional reconciliation audit failure'); };
    db.auditEntries.hook('creating', fail);
    try {
      await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow('Fictional reconciliation audit failure');
    } finally { db.auditEntries.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(content);
  });

  it('keeps newer manual marks conflicted after category reconciliation until separately reviewed', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, { ...content, pending: null }, session.version, actor);
    const currentAssessment = (await db.studentAssessments.where('assessmentId').equals(ASSESSMENT).first())!;
    const currentResult = (await db.categoryResults.where('studentAssessmentId').equals(currentAssessment.id).first())!;
    await new MarkbookDomainService(db).recordCategoryResult({ studentAssessmentId: currentAssessment.id,
      assessmentCategoryId: 'recovery-K', rawScore: '4-', inputFormat: 'scale_code', feedback: 'New manual official evidence.',
      expectedVersion: currentResult.version, expectedStudentAssessmentVersion: currentAssessment.version,
      userId: actor.userId, deviceId: actor.deviceId });
    const before = await official();
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const reconciled = await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor);
    await expect(service.finalize(reconciled.id, reconciled.version, actor)).rejects.toThrow(ConcurrencyConflictError);
    expect(await official()).toEqual(before);
    expect(reconciled.baseline).toBe(session.baseline);
    const accepted = await service.refreshBaseline(reconciled.id, reconciled.version, actor);
    expect(await official()).toEqual(before);
    expect(accepted.draft).toEqual(reconciled.draft);
  });


  it('preserves the original score and feedback when a replacement has an incompatible score model', async () => {
    const changed = { ...replacement('T'), maxScore: 99 };
    await changeCategories(['recovery-T'], [changed], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const before = await snapshot();
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': changed.id }), actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
    const retainedOnly = await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': null }), actor);
    expect(retainedOnly.retainedCategoryJudgments).toContainEqual({ category: categories.find(category => category.id === 'recovery-T'), judgment: content.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T') });
    expect(retainedOnly.draft.judgments.find(judgment => judgment.assessmentCategoryId === changed.id)).toMatchObject({ assessed: false, rawScore: '', feedback: '' });
  });

  it('requires the owning teacher and rejects an earlier teacher-selection epoch for review and reconciliation', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const template = (await db.users.get(TEACHER))!;
    await db.users.add({ ...template, id: OTHER_TEACHER, authSubject: OTHER_TEACHER, email: 'recovery@example.invalid', name: 'Fictional Recovery Teacher' });
    const membership = (await db.organizationMemberships.where('userId').equals(TEACHER).first())!;
    await db.organizationMemberships.add({ ...membership, id: 'fictional-recovery-membership', userId: OTHER_TEACHER });
    const staff = (await db.classSectionStaff.where('classSectionId').equals(SECTION).first())!;
    await db.classSectionStaff.add({ ...staff, id: 'fictional-recovery-staff', organizationMembershipId: 'fictional-recovery-membership', role: 'co_teacher' });
    const otherIdentity = await selectActingTeacher(db, OTHER_TEACHER);
    const otherActor = { userId: otherIdentity.userId, deviceId: otherIdentity.deviceId, epoch: getIdentityEpoch() };
    const before = await snapshot();
    await expect(service.reviewCategoryChanges(saved.id, otherActor)).rejects.toThrow(AuthorizationError);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), otherActor)).rejects.toThrow(AuthorizationError);
    expect(await snapshot()).toEqual(before);
    setActiveTeacherId(TEACHER);
    await expect(service.reviewCategoryChanges(saved.id, actor)).rejects.toThrow(AuthorizationError);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow(AuthorizationError);
    expect(await snapshot()).toEqual(before);
  });

  it('aborts reconciliation atomically if the teacher changes while its audit is being written', async () => {
    await changeCategories(['recovery-T'], [replacement('T')], true);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const before = await snapshot();
    const revoke = () => { setActiveTeacherId(OTHER_TEACHER); setActiveTeacherId(TEACHER); };
    db.auditEntries.hook('creating', revoke);
    try {
      await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': 'recovery-T-new' }), actor)).rejects.toThrow();
    } finally { db.auditEntries.hook('creating').unsubscribe(revoke); }
    expect(await snapshot()).toEqual(before);
  });

  it.each(['legacy', 'reconciled', 'incompatible'] as const)('backs up and restores %s category-recovery work without current category rows replacing original feedback', async state => {
    let expected: MarkingSession;
    if (state === 'legacy') {
      expected = { ...session, draft: content };
      delete expected.categorySnapshot;
      delete expected.retainedCategoryJudgments;
      await db.markingSessions.put(expected);
      await changeCategories(['recovery-T'], [replacement('T')], true);
    } else if (state === 'reconciled') {
      await changeCategories(['recovery-T', 'recovery-C'], [replacement('T')], true);
      const saved = await service.saveDraft(session.id, content, session.version, actor);
      const review = await service.reviewCategoryChanges(saved.id, actor);
      expected = await service.reconcileCategoryChanges(saved.id, saved.version, review.token,
        mapping({ 'recovery-T': 'recovery-T-new', 'recovery-C': null }), actor);
    } else {
      await changeCategories(['recovery-T'], [], true);
      expected = await service.saveDraft(session.id, content, session.version, actor);
    }
    const before = await official();
    const json = await new PortabilityService(db).createFullBackupJSON();
    const restored = new OntarioTeacherDB(`fictional-category-restored-${crypto.randomUUID()}`);
    try {
      await new PortabilityService(restored).restoreFromJSON(json);
      expect(await restored.markingSessions.get(expected.id)).toEqual(expected);
      expect(await restored.studentAssessments.where('assessmentId').equals(ASSESSMENT).toArray()).toEqual(before.assessments);
      expect(await restored.categoryResults.toArray()).toEqual(before.results);
      expect(await restored.markingCommits.toArray()).toEqual(before.commits);
      const reopened = (await new MarkingService(restored).getContext(ASSESSMENT, actor)).sessions.find(row => row.id === expected.id)!;
      expect(reopened.draft.annotations).toEqual(content.annotations);
      expect(reopened.draft.pending).toEqual(content.pending);
      expect(reopened.draft.overallFeedback).toBe(content.overallFeedback);
      if (state === 'legacy') {
        expect((await new MarkingService(restored).saveDraft(reopened.id, reopened.draft, reopened.version, actor)).draft).toEqual(content);
      }
    } finally { await restored.delete(); }
  });


  it('preserves all pending feedback even if every current category has been removed', async () => {
    await changeCategories(categories.map(category => category.id));
    const before = await official();
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    expect(review.currentCategories).toEqual([]);
    expect(review.compatible).toBe(false);
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token,
      Object.fromEntries(categories.map(category => [category.id, null])), actor)).rejects.toThrow(ValidationError);
    db.close();
    db = new OntarioTeacherDB(db.name);
    service = new MarkingService(db);
    expect((await service.getContext(ASSESSMENT, actor)).sessions.find(row => row.id === saved.id)?.draft).toEqual(content);
    expect(await official()).toEqual(before);
  });

  it('requires explicit archival when an existing category ID changes its score model', async () => {
    await db.assessmentCategories.update('recovery-T', { maxScore: 99 });
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    const before = await snapshot();
    await expect(service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({}), actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
    const recovered = await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-T': null }), actor);
    expect(recovered.draft.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T')).toMatchObject({ assessed: false, rawScore: '', feedback: '' });
    expect(recovered.retainedCategoryJudgments).toContainEqual({ category: categories.find(category => category.id === 'recovery-T'), judgment: content.judgments.find(judgment => judgment.assessmentCategoryId === 'recovery-T') });
    expect(recovered.draft.pending).toEqual(content.pending);
  });

  it('rejects malformed category snapshots and retained history before replacing any backup records', async () => {
    await changeCategories(['recovery-C']);
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    const review = await service.reviewCategoryChanges(saved.id, actor);
    await service.reconcileCategoryChanges(saved.id, saved.version, review.token, mapping({ 'recovery-C': null }), actor);
    const portability = new PortabilityService(db);
    const json = await portability.createFullBackupJSON();
    const before = await snapshot();
    const mutations: Array<(row: MarkingSession) => void> = [
      row => { row.categorySnapshot![0].assessmentId = 'different-assessment'; },
      row => { row.categorySnapshot!.pop(); },
      row => { row.retainedCategoryJudgments![0].judgment.assessmentCategoryId = 'different-category'; },
      row => { row.retainedCategoryJudgments![0].category.assessmentId = 'different-assessment'; },
      row => { row.retainedCategoryJudgments![0].category.maxScore = -1; }
    ];
    for (const mutate of mutations) {
      const parsed = JSON.parse(json);
      const row = parsed.tables.markingSessions.find((stored: MarkingSession) => stored.id === session.id);
      mutate(row);
      await expect(portability.restoreFromJSON(JSON.stringify(parsed))).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
  });

});
