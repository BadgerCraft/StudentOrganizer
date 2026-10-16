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
  it('shows KTCA order without changing saved judgments, category IDs or weights', () => {
    const input = reportInput();
    input.categories = (['A', 'C', 'T', 'K'] as const).map((code, index) => ({ ...input.categories[0], id: `category-${code}`, categoryCode: code, evidenceWeight: index + 1 }));
    input.commit.draft.judgments = input.categories.map(c => ({ ...input.commit.draft.judgments[0], assessmentCategoryId: c.id, feedback: `Saved ${c.categoryCode} feedback` }));
    const before = structuredClone(input);
    const html = renderMarkingReport(input);
    const names = ['Knowledge / Understanding', 'Thinking', 'Communication', 'Application'];
    const positions = names.map(name => html.indexOf(`<th>${name}</th>`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const code of ['K', 'T', 'C', 'A']) expect(html).toContain(`Saved ${code} feedback`);
    expect(input).toEqual(before);
  });
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
    expect(renderMarkingReport(input)).toContain('Feedback only');
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
  it.each(['oral', 'rubric'] as const)('exports explicit %s rubric feedback while retaining oral observations privately', mode => {
    const input = reportInput();
    input.attempt.mode = mode;
    input.attempt.documents = [];
    input.commit.draft.annotations = [];
    input.commit.draft.rubricFeedback = [{ criterionId: 'criterion', level: '3+', feedback: 'The claim uses clear evidence.' }];
    if (mode === 'oral') input.commit.draft.oral = { items: [{ id: 'eye-contact', label: 'PRIVATE CHECKLIST', checked: true, note: 'PRIVATE ITEM NOTE' }], notes: 'PRIVATE TEACHER NOTES' };
    const html = renderMarkingReport(input);
    expect(html).toContain('Criterion feedback');
    expect(html).toContain('The claim uses clear evidence.');
    expect(html).toContain('<th>Reasoning</th><td>3+</td>');
    expect(html).not.toContain('PRIVATE');
  });
  it('exports escaped photo comments with pinned criterion evidence without original images or strokes', () => {
    const input = reportInput();
    input.attempt.mode = 'written';
    input.attempt.documents = [];
    const original = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
    input.attempt.imagePages = [{ id: 'page', name: 'Fictional.png', mime: 'image/png', base64: original, size: atob(original).length, hash: 'b'.repeat(64), width: 1, height: 1 }];
    input.commit.draft.annotations = [];
    input.commit.draft.imageFeedback = [{ pageId: 'page', rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [
      { id: 'pen', kind: 'pen', points: [{ x: .1, y: .2 }, { x: .3, y: .4 }], color: 'red', width: .01, text: '', criterionId: null, level: '' },
      { id: 'comment', kind: 'comment', points: [{ x: .5, y: .5 }], color: 'blue', width: .01, text: '<script>Fictional evidence</script>', criterionId: 'criterion', level: '3+' },
    ] }];
    const html = renderMarkingReport(input);
    expect(html).toContain('Supporting page comments');
    expect(html).toContain('Reasoning — 3+');
    expect(html).toContain('Fictional.png');
    expect(html).toContain('&lt;script&gt;Fictional evidence&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain(original);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
  });
  it('exports archived written feedback without retaining deleted source quotations or images', () => {
    const input = reportInput();
    input.attempt.archivedAt = '2026-10-14T13:00:00.000Z'; input.attempt.keepStudentWork = false;
    input.attempt.documents = []; input.commit.draft.annotations = [];
    input.commit.draft.archivedFeedback = [{ id: 'archived-comment', criterionId: 'criterion', level: '3+', text: '<script>Archived feedback</script>' }];
    const html = renderMarkingReport(input);
    expect(html).toContain('Student work removed; assessment records and written feedback retained.');
    expect(html).toContain('&lt;script&gt;Archived feedback&lt;/script&gt;');
    expect(html).not.toContain('A repeated idea.');
    expect(html).not.toContain('<script>');
  });
  it('rejects missing page and criterion references or teacher mismatches in saved reports', () => {
    const input = reportInput();
    input.commit.draft.rubricFeedback = [{ criterionId: 'missing', level: '3+', feedback: 'Fictional feedback' }];
    expect(() => renderMarkingReport(input)).toThrow();
    input.commit.draft.rubricFeedback = [{ criterionId: 'criterion', level: 'missing', feedback: 'Fictional feedback' }];
    expect(() => renderMarkingReport(input)).toThrow();
    delete input.commit.draft.rubricFeedback;
    input.commit.draft.imageFeedback = [{ pageId: 'missing', rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] }];
    expect(() => renderMarkingReport(input)).toThrow();
    delete input.commit.draft.imageFeedback;
    input.rubric.createdBy = 'other-teacher';
    expect(() => renderMarkingReport(input)).toThrow('do not match');
  });
});
