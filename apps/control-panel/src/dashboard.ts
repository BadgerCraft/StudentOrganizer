// Hand-authored demonstration aggregates. No student rows, collection SDK or ingestion path.
export type Workflow = { day: string; course: string; assignment: string; completed: number; assignmentAverage: number; classAverage: number };
export type FictionalTeacher = { label: string; started: string; workflows: Workflow[] };
export const AS_OF = '2026-10-20';
const work = (day: string, course: string, assignment: string, completed = 1, assignmentAverage = 76, classAverage = 75): Workflow => ({ day, course, assignment, completed, assignmentAverage, classAverage });
export const fictionalTeachers: FictionalTeacher[] = [
  { label: 'Demo teacher A', started: '2026-08-30', workflows: [work('2026-09-01', 'ENG3U', 'Argument essay'), work('2026-09-09', 'ENG3U', 'Argument essay'), work('2026-10-01', 'ENG3U', 'Poetry response', 2, 79), work('2026-10-16', 'ENG3U', 'Argument essay', 1, 78, 77)] },
  { label: 'Demo teacher B', started: '2026-09-01', workflows: [work('2026-09-03', 'ENG3U', 'Argument essay', 1, 72, 74), work('2026-09-12', 'ENG3U', 'Poetry response'), work('2026-10-04', 'ENG3U', 'Argument essay', 2, 74, 75)] },
  { label: 'Demo teacher C', started: '2026-09-01', workflows: [work('2026-09-05', 'MCV4U', 'Rates of change', 1, 82, 80)] },
  { label: 'Demo teacher D', started: '2026-09-04', workflows: [] },
  { label: 'Demo teacher E', started: '2026-09-14', workflows: [work('2026-09-16', 'SCH3U', 'Reaction lab', 1, 78), work('2026-09-24', 'SCH3U', 'Reaction lab'), work('2026-10-16', 'SCH3U', 'Bonding explanation', 1, 81, 79)] },
  { label: 'Demo teacher F', started: '2026-10-05', workflows: [work('2026-10-06', 'ENG3U', 'Argument essay', 1, 73), work('2026-10-14', 'ENG3U', 'Poetry response', 1, 77)] },
  { label: 'Demo teacher G', started: '2026-10-17', workflows: [work('2026-10-18', 'MCV4U', 'Rates of change', 1, 80, 78)] },
  { label: 'Demo teacher H', started: '2026-10-18', workflows: [] }
];
export const fictionalReliability = [
  { version: '1.0.1', attempts: 120, failures: 9, retries: 8, recovered: 7 },
  { version: '1.0.2', attempts: 160, failures: 4, retries: 4, recovered: 4 }
];
const days = (a: string, b: string) => (Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
export const inWindow = (day: string, end: string, length: number) => days(end, day) >= 0 && days(end, day) < length;
export function dashboard(teachers: FictionalTeacher[], asOf: string) {
  const rows = teachers.map(teacher => ({ ...teacher, workflows: teacher.workflows.filter(w => w.completed > 0 && days(asOf, w.day) >= 0) }));
  const first = (teacher: FictionalTeacher) => teacher.workflows.map(w => w.day).sort()[0];
  const activated = rows.filter(t => first(t));
  const active = rows.filter(t => t.workflows.some(w => inWindow(w.day, asOf, 28)));
  const repeat = active.filter(t => new Set(t.workflows.map(w => JSON.stringify([w.course, w.assignment]))).size >= 2);
  function retention(start: number, end: number) {
    const eligible = activated.filter(t => days(asOf, first(t)) >= end);
    return { eligible: eligible.length, returned: eligible.filter(t => t.workflows.some(w => days(w.day, first(t)) >= start && days(w.day, first(t)) <= end)).length };
  }
  const cohorts = [...new Set(activated.map(t => first(t).slice(0, 7)))].sort().map(month => {
    const cohort = activated.filter(t => first(t).startsWith(month));
    return { month, activated: cohort.length, ...Object.fromEntries([[7, 13], [28, 34]].map(([start, end]) => {
      const eligible = cohort.filter(t => days(asOf, first(t)) >= end);
      return [start === 7 ? 'week1' : 'week4', { eligible: eligible.length, returned: eligible.filter(t => t.workflows.some(w => days(w.day, first(t)) >= start && days(w.day, first(t)) <= end)).length }];
    })) } as { month: string; activated: number; week1: { eligible: number; returned: number }; week4: { eligible: number; returned: number } };
  });
  const assignments = rows.flatMap(t => {
    const recent = t.workflows.filter(w => inWindow(w.day, asOf, 28));
    return [...new Set(recent.map(w => JSON.stringify([w.course, w.assignment])))].map(key => {
      const [course, title] = JSON.parse(key) as [string, string];
      const uses = recent.filter(w => w.course === course && w.assignment === title);
      return { teacher: t.label, course, title, uses: uses.reduce((sum, w) => sum + w.completed, 0),
        average: uses.reduce((sum, w) => sum + w.assignmentAverage * w.completed, 0) / uses.reduce((sum, w) => sum + w.completed, 0) };
    });
  });
  const classes = rows.flatMap(t => [...new Set(t.workflows.filter(w => inWindow(w.day, asOf, 28)).map(w => w.course))].map(course => {
    const latest = t.workflows.filter(w => w.course === course && inWindow(w.day, asOf, 28)).sort((a, b) => b.day.localeCompare(a.day))[0];
    return { teacher: t.label, course, average: latest.classAverage, day: latest.day };
  }));
  return { started: rows.filter(t => days(asOf, t.started) >= 0).length, activated: activated.length, active: active.length,
    repeat: repeat.length, week1: retention(7, 13), week4: retention(28, 34), cohorts, assignments, classes };
}
export const definitions = {
  active: 'Meaningful active teacher: at least one completed marking workflow in the trailing 28 calendar days, including the as-of day. Opening the app is not activity.',
  activation: 'Activation: first completed marking workflow since the fictional installation start. The denominator is all fictional starts by the as-of day; this is cumulative, not a signup-conversion claim.',
  retention: 'Cohorts use month of first completed workflow. Week 1 return is another completion on days 7–13 after activation; week 4 is days 28–34. Only teachers whose entire return window has elapsed are eligible. Counts are teachers, not sessions.',
  repeat: 'Repeat assignment adoption: active teachers who have completed at least two distinct course/title pairs since starting. Usage counts are completed marking workflows, not student submissions. Reusing the same title counts as another use, not another distinct assignment.',
  averages: 'Assignment averages are workflow-weighted means of fictional assignment-level averages, not student-weighted averages. Class averages are the latest fictional class aggregate in the 28-day window. Marks provide context, not proof of adoption or teacher quality.',
  reliability: 'Fictional local save operations in the 28-day window, grouped by app version. Failure rate = failed initial operations / initial attempts. Retries count operations retried once; recovered counts successful retries. No event payloads are collected.'
};
