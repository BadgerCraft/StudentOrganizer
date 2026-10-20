import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadOnlyMarkingHistory } from './ReadOnlyMarkingHistory';
import type { MarkingAttempt, MarkingCommit, MarkingContext, MarkingDraft, MarkingSession } from '../types';
import { archiveDraft } from '../archive';

const draft: MarkingDraft = {
  judgments: [], overallFeedback: 'Fictional overall feedback',
  annotations: [{ id: 'edit', documentId: 'doc', start: 0, end: 4, quote: 'Work', criterionId: 'reason', level: '3', text: 'Old saved text' }],
  pending: { id: 'edit', documentId: 'doc', start: 0, end: 4, quote: 'Work', criterionId: 'reason', level: '4', text: 'Unfinished replacement' },
  imageFeedback: [{ pageId: 'photo', rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [
    { id: 'photo-comment', kind: 'comment', points: [{ x: .5, y: .5 }], color: 'red', width: .01, text: 'Fictional photo feedback', criterionId: 'reason', level: '3' },
    { id: 'unfinished-photo', kind: 'comment', points: [{ x: .4, y: .4 }], color: 'red', width: .01, text: '', criterionId: null, level: '' }
  ] }]
};
function render(value: MarkingDraft, archived = false, published?: MarkingDraft) {
  // These are complete persisted-record fixtures: read validation now runs before display.
  if (value.archivedFeedback) { archived = true; published = value; }
  const base = { assessmentId: 'assessment', classSectionId: 'class', createdBy: 'fictional-teacher', createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', deletedAt: null, version: 1 };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=';
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const attempt: MarkingAttempt = { ...base, id: 'attempt', archivedAt: archived ? base.createdAt : null, keepStudentWork: false, rubricId: 'rubric', classEnrollmentId: 'enrollment', previousAttemptId: null,
    documents: archived ? [] : [{ id: 'doc', name: 'fictional.txt', text: 'Work', hash: hash('Work'), original: null }],
    imagePages: archived ? [] : [{ id: 'photo', name: 'fictional.png', base64: png, mime: 'image/png', size: Buffer.from(png, 'base64').length, hash: hash(Buffer.from(png, 'base64')), width: 1, height: 1 }] };
  const session: MarkingSession = { ...base, id: 'session', attemptId: 'attempt', rubricId: 'rubric', revision: 2, status: published ? 'finalized' : 'draft', commitId: published ? 'commit' : null, categorySnapshot: [], baseline: JSON.stringify({ categories: [] }), draft: value };
  const context = { rubrics: [{ ...base, id: 'rubric', confirmed: true, title: 'Fictional rubric', levels: ['3', '4'], criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'K', descriptors: { '3': 'Clear', '4': 'Strong' } }] }], sessions: [session], commits: published ? [{ ...base, id: 'commit', sessionId: session.id, attemptId: attempt.id, draft: published } as MarkingCommit] : [] } as unknown as MarkingContext;
  return renderToStaticMarkup(<ReadOnlyMarkingHistory attempt={attempt} context={context} />);
}
describe('read-only retained revision feedback', () => {
  it('isolates malformed feedback without mutating the supplied record', () => {
    const malformed = structuredClone(draft); malformed.imageFeedback![0].annotations = null as never;
    const before = JSON.stringify(malformed), html = render(malformed);
    expect(html).toContain('This saved revision could not be displayed');
    expect(html).toContain('Original work and saved records have not been changed');
    expect(JSON.stringify(malformed)).toBe(before);
  });
  it('does not erase valid feedback after a failed read or require an editable history form', () => {
    const html = render(draft);
    expect(html).toContain('Unfinished replacement');
    expect(html).not.toContain('Retry display');
  });
  it('renders a legacy finalized archive exclusively from its commit, never newer session edits', () => {
    const html = render(draft, true, { annotations: [], pending: null, judgments: [], overallFeedback: 'Published committed feedback' });
    expect(html).toContain('Published committed feedback');
    expect(html).not.toContain('Fictional overall feedback');
    expect(html).not.toContain('Unfinished replacement');
    expect(html).not.toContain('Fictional photo feedback');
  });
  it('does not render unfinished legacy archived sessions or hidden draft sections', () => {
    const html = render(draft, true);
    expect(html).toContain('No finalized feedback was published');
    expect(html).not.toContain('Unfinished replacement');
    expect(html).not.toContain('Fictional overall feedback');
    expect(html).not.toContain('<details');
  });
  it('shows text edits, photo feedback and unfinished work without duplicate saved comments or edit controls', () => {
    const html = render(draft);
    expect(html).toContain('Unfinished replacement'); expect(html).not.toContain('Old saved text');
    expect(html).toContain('Fictional photo feedback'); expect(html).toContain('Unfinished comment — no text entered.');
    expect(html).toContain('fictional.txt'); expect(html).toContain('fictional.png'); expect(html).toContain('Reasoning');
    expect(html).not.toMatch(/<(input|textarea|button|select)\b/);
  });
  it('renders redacted archived feedback once with no source quote or original inline comments', () => {
    const html = render(archiveDraft(draft));
    expect(html).not.toContain('Unfinished replacement');
    expect(html.split('Fictional photo feedback')).toHaveLength(2);
    expect(html).not.toContain('<blockquote'); expect(html).toContain('Old saved text');
  });
});
