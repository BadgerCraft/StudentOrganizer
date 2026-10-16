import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RubricEvidenceEditor } from './ModeEvidence';
import { CLASSROOM_LEVEL_LABELS } from '../../services/classroomLevels';
import type { MarkingRubric } from '../types';

const rubric: MarkingRubric = {
  id: 'rubric', assessmentId: 'assessment', classSectionId: 'class', createdBy: 'teacher', createdAt: '2026-10-15', updatedAt: '2026-10-15', version: 1, deletedAt: null, confirmed: true,
  title: 'Fictional inquiry', levels: ['Emerging', 'Secure'],
  criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'T', descriptors: { Emerging: 'Limited support', Secure: 'Clear evidence' } }],
};

describe('criterion review evidence', () => {
  it('keeps descriptors, criterion feedback, text evidence and image evidence together without a composer', () => {
    const html = renderToStaticMarkup(<RubricEvidenceEditor rubric={rubric} value={[{ criterionId: 'reason', level: '4+(high)', feedback: 'Criterion feedback' }]}
      annotations={[{ id: 'text-comment', documentId: 'work', start: 0, end: 8, quote: 'A claim.', criterionId: 'reason', level: '3', text: 'Text evidence feedback' }]}
      imageFeedback={[{ pageId: 'page-1', rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [{ id: 'image-comment', kind: 'comment', points: [{ x: .3, y: .4 }], color: 'red', width: .004, criterionId: 'reason', level: '2+', text: 'Photo evidence feedback' }] }]}
      onChange={() => {}} disabled={false} />);
    for (const text of ['Reasoning', 'Clear evidence', 'Limited support', 'Criterion feedback', 'A claim.', 'Text evidence feedback', 'Photo evidence feedback', 'Image page 1', 'Selected level: 4+(high)', 'Edit comment']) expect(html).toContain(text);
    expect(html).not.toContain('<textarea');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?4\+\(high\)/);
  });

  it('offers all shared levels and retains saved rubric labels without assigning a level to unassessed work', () => {
    const html = renderToStaticMarkup(<RubricEvidenceEditor rubric={rubric} value={undefined} onChange={() => {}} disabled={false} />);
    for (const level of CLASSROOM_LEVEL_LABELS) expect(html).toContain(`>${level}</button>`);
    expect(html).toContain('value="Emerging"'); expect(html).toContain('value="Secure"');
    expect(html).toContain('Selected level: Not selected'); expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain('Write a comment'); expect(html).toContain('No feedback recorded yet.');
  });
});
