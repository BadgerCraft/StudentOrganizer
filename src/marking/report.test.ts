import { describe, expect, it, vi } from 'vitest';
import { exportMarkingReport, renderMarkingReport, type MarkingReportInput } from './report';

const native = vi.hoisted(() => ({ usesNativeFiles: vi.fn(() => true), exportNativeBackup: vi.fn(async () => true) }));
vi.mock('../services/nativeFiles', () => native);

function reportInput(): MarkingReportInput {
  const base = { assessmentId: 'assessment', classSectionId: 'class', createdBy: 'teacher', createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z', deletedAt: null, version: 1 };
  return {
    assessment: { id: 'assessment', classSectionId: 'class', unitId: 'unit', reportingPeriodId: 'period', code: 'FIC', title: 'Fictional Essay', assessmentType: 'summative', assignedAt: base.createdAt, dueAt: base.createdAt, isLocked: false, ...{ createdAt: base.createdAt, updatedAt: base.updatedAt, deletedAt: null, version: 1 } },
    student: { id: 'student', organizationId: 'org', localStudentNumber: 'FICTIONAL-1', oenEncrypted: null, firstName: 'Fictional', lastName: 'Learner', preferredName: null, pronouns: null, photoUrl: null, createdAt: base.createdAt, updatedAt: base.updatedAt, deletedAt: null, version: 1 },
    categories: [{ id: 'category', assessmentId: 'assessment', categoryCode: 'T', maxScore: 100, evidenceWeight: 1, markScaleVersionId: 'scale', createdAt: base.createdAt, updatedAt: base.updatedAt, deletedAt: null, version: 1 }],
    rubric: { ...base, id: 'rubric', confirmed: true, title: 'Argument', levels: ['3+'], criteria: [{ id: 'criterion', name: 'Reasoning', categoryCode: 'T', descriptors: { '3+': 'Supports claims with clear evidence.' } }] },
    attempt: { ...base, id: 'attempt', classEnrollmentId: 'enrollment', rubricId: 'rubric', previousAttemptId: null, documents: [{ id: 'document', name: 'Fictional.txt', text: 'A repeated idea. A repeated idea.', hash: 'a'.repeat(64), original: null }] },
    commit: { ...base, id: 'commit', sessionId: 'session', attemptId: 'attempt', rubricId: 'rubric', studentAssessmentId: 'student-assessment', resultIds: ['result'], previousCommitId: null, draft: {
      annotations: [{ id: 'annotation', documentId: 'document', start: 17, end: 33, quote: 'A repeated idea.', criterionId: 'criterion', level: '3+', text: 'Support the second claim.' }], pending: null,
      judgments: [{ assessmentCategoryId: 'category', assessed: true, rawScore: '3+', inputFormat: 'scale_code', feedback: 'Clear reasoning.' }], overallFeedback: 'Saved feedback only.',
    } },
  };
}

describe('saved marking report', () => {
  it('exports saved judgments and exact repeated-text quote anchors with pinned rubric descriptors', () => {
    const input = reportInput();
    const html = renderMarkingReport(input);
    expect(html).toContain('Fictional Learner');
    expect(html).toContain('3+ (scale code)');
    expect(html).toContain('Saved feedback only.');
    expect(html).toContain('characters 18–33');
    expect(html).toContain('Supports claims with clear evidence.');
    expect(html).toContain('Save as PDF');
    expect(html).not.toContain('A repeated idea. A repeated idea.');
  });
  it('renders hostile imported strings as escaped text with a no-network/no-script CSP', () => {
    const input = reportInput();
    const hostile = '<img src="https://example.invalid/private" onerror="alert(1)"><script>fetch("secret")</script>';
    input.student.preferredName = hostile;
    input.assessment.title = hostile;
    input.commit.draft.overallFeedback = hostile;
    input.commit.draft.annotations[0].text = hostile;
    input.rubric.criteria[0].descriptors['3+'] = hostile;
    const html = renderMarkingReport(input);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  it('does not manufacture a zero for unassessed categories and rejects mismatched saved versions', () => {
    const input = reportInput();
    input.commit.draft.judgments[0].assessed = false;
    input.commit.draft.judgments[0].rawScore = '';
    expect(renderMarkingReport(input)).toContain('Not assessed');
    input.attempt.id = 'other-attempt';
    expect(() => renderMarkingReport(input)).toThrow('do not match');
    input.attempt.id = 'attempt';
    input.attempt.documents[0].text = 'Replaced document';
    expect(() => renderMarkingReport(input)).toThrow('does not match');
  });
  it('does not export pending draft annotations or stale cross-assessment category joins', () => {
    const input = reportInput();
    input.commit.draft.pending = input.commit.draft.annotations[0];
    expect(() => renderMarkingReport(input)).toThrow('do not match');
    input.commit.draft.pending = null;
    input.categories[0].assessmentId = 'other-assessment';
    expect(() => renderMarkingReport(input)).toThrow('unavailable');
  });
  it('uses the native Files completion/cancel result for safe HTML export', async () => {
    const input = reportInput();
    expect(await exportMarkingReport(input)).toBe(true);
    expect(native.exportNativeBackup).toHaveBeenLastCalledWith('assessment-report-commit.html', expect.stringContaining('Saved feedback only.'));
    native.exportNativeBackup.mockResolvedValueOnce(false);
    expect(await exportMarkingReport(input)).toBe(false);
  });
});
