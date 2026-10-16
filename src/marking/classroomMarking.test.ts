import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { CLASSROOM_LEVELS } from '../services/classroomLevels';
import { MarkbookDomainService } from '../services/markbookService';
import { PortabilityService } from '../services/portabilityService';
import { calculateOverallCourseGrade } from '../services/calculationEngine';
import { MarkingService } from './markingService';
import { renderMarkingReport } from './report';
import type { Assessment, AssessmentCategory, ClassEnrollment } from '../types/schema';
import type { MarkingActor, MarkingDraft, MarkingRubric } from './types';

/** Classroom integration: official judgments and supporting evidence remain independent. */
describe('classroom level finalization and feedback-only recovery', () => {
  let db: OntarioTeacherDB;
  let service: MarkingService;
  let actor: MarkingActor;
  let assessment: Assessment;
  let categories: AssessmentCategory[];
  let enrollment: ClassEnrollment;
  let rubric: MarkingRubric;
  const restoredDatabases: OntarioTeacherDB[] = [];
  beforeEach(async () => {
    clearActiveTeacherId();
    db = new OntarioTeacherDB(`fictional-classroom-marking-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    assessment = { ...template, id: 'classroom-marking-assessment', code: 'CLASSROOM-TEST' };
    await db.assessments.add(assessment);
    categories = (await db.assessmentCategories.where('assessmentId').equals(template.id).toArray()).map(category => ({ ...category,
      id: `classroom-${category.categoryCode}`, assessmentId: assessment.id }));
    await db.assessmentCategories.bulkAdd(categories);
    enrollment = (await db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).first())!;
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    service = new MarkingService(db);
    rubric = await service.saveRubric(assessment.id, { title: 'Fictional classroom rubric', levels: ['Developing', 'Secure'], criteria: [
      { id: 'knowledge-evidence', name: 'Use evidence', categoryCode: 'K', descriptors: { Developing: 'Some support.', Secure: 'Clear support.' } },
      { id: 'thinking-evidence', name: 'Explain reasoning', categoryCode: 'T', descriptors: { Developing: 'Some reasons.', Secure: 'Clear reasons.' } },
    ] }, actor);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); for (const restored of restoredDatabases.splice(0)) await restored.delete(); });

  async function draft(level: string | null) {
    const attempt = await service.createModeAttempt(assessment.id, rubric.id, 'rubric', enrollment.id, actor);
    const opened = await service.openSession(attempt.id, actor);
    const content: MarkingDraft = { ...opened.draft, overallFeedback: 'Fictional overall feedback.',
      // Supporting evidence deliberately differs from the official K judgment.
      rubricFeedback: [{ criterionId: 'knowledge-evidence', level: '4+(high)', feedback: 'Fictional supporting evidence.' }, { criterionId: 'thinking-evidence', level: '', feedback: '' }],
      judgments: categories.map(category => ({ assessmentCategoryId: category.id, assessed: category.categoryCode === 'K' && level !== null,
        rawScore: category.categoryCode === 'K' && level !== null ? level : '', inputFormat: 'classroom_level',
        feedback: category.categoryCode === 'T' ? 'Fictional category feedback without a grade.' : '' })),
    };
    const session = await service.saveDraft(opened.id, content, opened.version, actor);
    return { attempt, session, content };
  }

  async function official() {
    const sa = await db.studentAssessments.where({ assessmentId: assessment.id, classEnrollmentId: enrollment.id }).first();
    return { sa, results: sa ? await db.categoryResults.where('studentAssessmentId').equals(sa.id).toArray() : [] };
  }

  it.each(CLASSROOM_LEVELS)('finalizes $label to $percentage, preserves independent evidence and restores the saved report', async ({ label, percentage }) => {
    const historical = await db.categoryResults.toArray();
    const { attempt, session } = await draft(label);
    const commit = await service.finalize(session.id, session.version, actor);
    const saved = await official();
    expect(saved.results.find(result => result.assessmentCategoryId === 'classroom-K')).toMatchObject({
      rawScore: label, inputFormat: 'classroom_level', normalizedPercentage: percentage,
    });
    const feedback = saved.results.find(result => result.assessmentCategoryId === 'classroom-T');
    expect(feedback).toMatchObject({ rawScore: '', inputFormat: 'descriptive', normalizedPercentage: null, pointsEarned: null,
      feedback: 'Fictional category feedback without a grade.' });
    expect(saved.results.some(result => result.assessmentCategoryId === 'classroom-C' || result.assessmentCategoryId === 'classroom-A')).toBe(false);
    expect(commit.resultIds).toContain(feedback!.id);
    expect(commit.draft.rubricFeedback![0].level).toBe('4+(high)');
    expect(await db.categoryResults.bulkGet(historical.map(result => result.id))).toEqual(historical);
    const student = (await db.students.get(enrollment.studentId))!;
    const report = renderMarkingReport({ assessment, categories, attempt, rubric, commit, student });
    expect(report).toContain(`${label} (classroom level)`);
    expect(report).toContain('Fictional category feedback without a grade.');
    expect(report).toContain('Feedback only');
    expect(report).toContain('Criterion / KTCA');
    const restored = new OntarioTeacherDB(`fictional-restored-classroom-${crypto.randomUUID()}`); restoredDatabases.push(restored);
    await new PortabilityService(restored).restoreFromJSON(await new PortabilityService(db).createFullBackupJSON());
    expect(await restored.categoryResults.toArray()).toEqual(await db.categoryResults.toArray());
    expect((await restored.markingCommits.get(commit.id))?.draft).toEqual(commit.draft);
    db.close(); await db.open();
    expect((await new MarkingService(db).getContext(assessment.id, actor)).commits.find(saved => saved.id === commit.id)?.resultIds).toEqual(commit.resultIds);
  });

  it('finalizes category feedback with no assigned levels and leaves the assessment ungraded', async () => {
    const { session } = await draft(null);
    const commit = await service.finalize(session.id, session.version, actor);
    const saved = await official();
    expect(saved.results).toHaveLength(1);
    expect(saved.results[0].normalizedPercentage).toBeNull();
    expect(saved.results[0].rawScore).toBe('');
    expect(saved.sa?.workflowStatus).not.toBe('assessed');
    const policy = (await db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).first())!;
    expect(calculateOverallCourseGrade(enrollment.id, null, [assessment], categories, [saved.sa!], saved.results, policy, []).finalOverall).toBeNull();
    expect(commit.draft.judgments.every(judgment => !judgment.assessed)).toBe(true);
    expect(commit.draft.rubricFeedback![0].level).toBe('4+(high)');
    const backup = await new PortabilityService(db).createFullBackupJSON();
    const restored = new OntarioTeacherDB(`fictional-feedback-restore-${crypto.randomUUID()}`); restoredDatabases.push(restored);
    await new PortabilityService(restored).restoreFromJSON(backup);
    expect(await restored.categoryResults.get(saved.results[0].id)).toEqual(saved.results[0]);
  });

  it('rolls back failed finalization, retains the draft and retries without duplicate official records', async () => {
    const { session, content } = await draft('3+');
    const before = await official();
    const failFeedback = function (_key: unknown, result: { assessmentCategoryId?: string }) {
      if (result.assessmentCategoryId === 'classroom-T') throw new Error('Fictional category write failure');
    };
    db.categoryResults.hook('creating', failFeedback);
    await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow('Fictional category write failure');
    db.categoryResults.hook('creating').unsubscribe(failFeedback);
    expect(await official()).toEqual(before);
    expect((await db.markingSessions.get(session.id))?.draft).toEqual(content);
    expect((await db.markingSessions.get(session.id))?.status).toBe('draft');
    expect(await db.markingCommits.where('sessionId').equals(session.id).count()).toBe(0);
    const commit = await service.finalize(session.id, session.version, actor);
    expect((await official()).results).toHaveLength(2);
    expect(await db.markingCommits.where('sessionId').equals(session.id).count()).toBe(1);
    expect((await service.finalize(session.id, session.version, actor)).id).toBe(commit.id);
    expect((await official()).results).toHaveLength(2);
  });

  it('does not replace an existing official grade with feedback-only work', async () => {
    const original = await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: assessment.id, classSectionId: assessment.classSectionId,
      classEnrollmentId: enrollment.id, assessmentCategoryId: 'classroom-K', rawScore: '86.4%', inputFormat: 'percentage',
      userId: actor.userId, deviceId: actor.deviceId });
    const { session } = await draft(null);
    await expect(service.finalize(session.id, session.version, actor)).rejects.toThrow('already has an official result');
    expect(await db.categoryResults.get(original.categoryResult!.id)).toEqual(original.categoryResult);
    expect((await db.markingSessions.get(session.id))?.status).toBe('draft');
  });
  it('revises feedback-only results while preserving the previous immutable feedback commit through restore', async () => {
    const first = await draft(null);
    const firstCommit = await service.finalize(first.session.id, first.session.version, actor);
    const firstResult = (await official()).results[0];
    const second = await draft(null);
    const nextContent = { ...second.content, judgments: second.content.judgments.map(judgment => judgment.assessmentCategoryId === 'classroom-T'
      ? { ...judgment, feedback: 'Revised fictional feedback without a grade.' } : judgment) };
    const revised = await service.saveDraft(second.session.id, nextContent, second.session.version, actor);
    const secondCommit = await service.finalize(revised.id, revised.version, actor);
    const results = (await official()).results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: firstResult.id, normalizedPercentage: null, feedback: 'Revised fictional feedback without a grade.' });
    expect((await db.markingCommits.get(firstCommit.id))?.draft.judgments.find(judgment => judgment.assessmentCategoryId === 'classroom-T')?.feedback)
      .toBe('Fictional category feedback without a grade.');
    const restored = new OntarioTeacherDB(`fictional-feedback-revision-${crypto.randomUUID()}`); restoredDatabases.push(restored);
    await new PortabilityService(restored).restoreFromJSON(await new PortabilityService(db).createFullBackupJSON());
    expect(await restored.markingCommits.get(firstCommit.id)).toEqual(await db.markingCommits.get(firstCommit.id));
    expect(await restored.markingCommits.get(secondCommit.id)).toEqual(await db.markingCommits.get(secondCommit.id));
  });

  it('rejects a backup commit with an unexpected feedback-only result reference and preserves the current database', async () => {
    const { session } = await draft('3');
    const commit = await service.finalize(session.id, session.version, actor);
    const sa = (await official()).sa!;
    const extra = await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: assessment.id, classSectionId: assessment.classSectionId,
      classEnrollmentId: enrollment.id, assessmentCategoryId: 'classroom-C', rawScore: '', inputFormat: 'descriptive',
      feedback: 'Not part of the finalized marking commit.', expectedStudentAssessmentVersion: sa.version,
      userId: actor.userId, deviceId: actor.deviceId });
    const backup = JSON.parse(await new PortabilityService(db).createFullBackupJSON());
    backup.tables.markingCommits.find((item: { id: string }) => item.id === commit.id).resultIds.push(extra.categoryResult!.id);
    const before = await official();
    await expect(new PortabilityService(db).restoreFromJSON(JSON.stringify(backup))).rejects.toThrow();
    expect(await official()).toEqual(before);
    expect((await db.markingCommits.get(commit.id))?.resultIds).toEqual(commit.resultIds);
  });

  it('clears current feedback-only text explicitly while preserving the earlier immutable feedback commit and a restorable backup', async () => {
    const first = await draft(null);
    const firstCommit = await service.finalize(first.session.id, first.session.version, actor);
    const originalFeedback = (await official()).results[0];
    const reopened = await service.openSession(first.attempt.id, actor);
    const cleared = { ...reopened.draft, judgments: reopened.draft.judgments.map(judgment => ({ ...judgment, feedback: '' })) };
    const saved = await service.saveDraft(reopened.id, cleared, reopened.version, actor);
    const clearedCommit = await service.finalize(saved.id, saved.version, actor);
    const current = (await official()).results;
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ id: originalFeedback.id, rawScore: '', inputFormat: 'descriptive', normalizedPercentage: null, feedback: '' });
    expect(clearedCommit.resultIds).toEqual([]);
    expect((await db.markingCommits.get(firstCommit.id))?.draft.judgments.find(judgment => judgment.assessmentCategoryId === 'classroom-T')?.feedback)
      .toBe('Fictional category feedback without a grade.');
    const restored = new OntarioTeacherDB(`fictional-cleared-feedback-${crypto.randomUUID()}`); restoredDatabases.push(restored);
    await new PortabilityService(restored).restoreFromJSON(await new PortabilityService(db).createFullBackupJSON());
    expect(await restored.categoryResults.get(originalFeedback.id)).toEqual(current[0]);
    expect(await restored.markingCommits.get(firstCommit.id)).toEqual(await db.markingCommits.get(firstCommit.id));
    expect(await restored.markingCommits.get(clearedCommit.id)).toEqual(clearedCommit);
  });

});
