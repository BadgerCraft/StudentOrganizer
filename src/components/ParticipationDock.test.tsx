import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ParticipationDock } from './ParticipationDock';
import { getSchoolLocalDate, shiftSchoolDate } from '../utils/dateUtils';
import type { ParticipationEvent, ClassEnrollment, Student } from '../types/schema';

const today = getSchoolLocalDate();
const event = (id: string, extra: Partial<ParticipationEvent> = {}) => ({ id, classEnrollmentId: 'selected', localSchoolDate: today,
  occurredAt: new Date().toISOString(), deletedAt: null, snapshottedName: 'Thoughtful contribution', ...extra } as ParticipationEvent);
function render(events: ParticipationEvent[], date = today) {
  return renderToStaticMarkup(<ParticipationDock selectedEnrollments={[{ enrollment: { id: 'selected' } as ClassEnrollment,
    student: { firstName: 'Fictional', lastName: 'Learner' } as Student }]} eventTypes={[]} selectedSchoolDate={date}
    todayEvents={events} onRetractEvent={async () => {}} onRecordEvent={() => {}} onClearSelection={() => {}}
    lastBatchUndo={null} onUndo={() => {}} />);
}
describe('participation correction display', () => {
  it('retains separate same-label occurrences and excludes deleted, other-student and historical observations', () => {
    const html = render([event('first'), event('repeat'), event('removed', { deletedAt: new Date().toISOString() }),
      event('other-student', { classEnrollmentId: 'unselected' }), event('yesterday', { localSchoolDate: shiftSchoolDate(today, -1) })]);
    expect(html.match(/data-testid="today-feedback-chip"/g)).toHaveLength(2);
    expect(html).toContain('remove that occurrence');
    expect(html).toContain('Record buttons below add another observation');
  });
  it('does not label any historical selection as today’s feedback', () => {
    expect(render([event('today')], shiftSchoolDate(today, -1))).not.toContain('data-testid="today-feedback-chip"');
  });
});
