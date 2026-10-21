import { expect, it } from 'vitest';
import { dashboard, fictionalTeachers, fictionalReliability, AS_OF, inWindow } from './dashboard';
it('derives meaningful activity, activation, repeat usage and mature-cohort denominators from fictional aggregates', () => {
  const m = dashboard(fictionalTeachers, AS_OF);
  expect(m).toMatchObject({ started: 8, activated: 6, active: 5, repeat: 4, week1: { eligible: 5, returned: 4 }, week4: { eligible: 4, returned: 3 } });
  expect(m.cohorts).toEqual([
    { month: '2026-09', activated: 4, week1: { eligible: 4, returned: 3 }, week4: { eligible: 4, returned: 3 } },
    { month: '2026-10', activated: 2, week1: { eligible: 1, returned: 1 }, week4: { eligible: 0, returned: 0 } }
  ]);
  expect(m.assignments.find(a => a.teacher === 'Demo teacher A' && a.title === 'Argument essay')).toMatchObject({ uses: 1, average: 78 });
  expect(m.classes.find(c => c.teacher === 'Demo teacher A')).toMatchObject({ average: 77, day: '2026-10-16' });
});
it('excludes future completions, respects inclusive calendar boundaries and avoids immature return denominators', () => {
  expect(inWindow('2026-09-23', AS_OF, 28)).toBe(true);
  expect(inWindow('2026-09-22', AS_OF, 28)).toBe(false);
  expect(inWindow('2026-10-21', AS_OF, 28)).toBe(false);
  const w = (day: string) => ({ day, course: 'TEST', assignment: 'Example', completed: 1, assignmentAverage: 80, classAverage: 78 });
  const rows = [{ label: 'Demo', started: '2026-10-01', workflows: [w('2026-10-07'), w('2026-10-14'), w('2026-10-21')] }];
  expect(dashboard(rows, '2026-10-19').week1).toEqual({ eligible: 0, returned: 0 });
  expect(dashboard(rows, AS_OF).week1).toEqual({ eligible: 1, returned: 1 });
  expect(dashboard(rows, AS_OF).assignments[0].uses).toBe(2);
  expect(dashboard([], AS_OF)).toMatchObject({ started: 0, activated: 0, active: 0, repeat: 0, week1: { eligible: 0, returned: 0 } });
});
it('contains only explicit fictional teacher/course/workflow aggregates and bounded reliability counts', () => {
  for (const teacher of fictionalTeachers) {
    expect(Object.keys(teacher).sort()).toEqual(['label', 'started', 'workflows']);
    expect(teacher.label).toMatch(/^Demo teacher /);
    for (const workflow of teacher.workflows) {
      expect(Object.keys(workflow).sort()).toEqual(['assignment', 'assignmentAverage', 'classAverage', 'completed', 'course', 'day']);
    }
  }
  for (const row of fictionalReliability) {
    expect(row.recovered).toBeLessThanOrEqual(row.retries);
    expect(row.retries).toBeLessThanOrEqual(row.failures);
    expect(row.failures).toBeLessThanOrEqual(row.attempts);
  }
});
