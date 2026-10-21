import { Event, Namespace, localDay } from './schema';
export type QueryPolicy = { minimumTeachers: number; allowAcademic: boolean; minimumSamples: number };
export const conservativePolicy: QueryPolicy = {minimumTeachers:5, allowAcademic:false, minimumSamples:10};
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
export function queryDashboard(events: Event[], namespace: Namespace, asOf: string, observedSince: string, policy = conservativePolicy) {
  if (!Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(observedSince)) || observedSince > asOf || !Number.isInteger(policy.minimumTeachers) || policy.minimumTeachers < 2 || !Number.isInteger(policy.minimumSamples) || policy.minimumSamples < 10) throw new Error('Invalid query policy/window');
  const source = events.filter(e => e.namespace === namespace && e.at >= observedSince && e.at <= asOf);
  const workflows = source.filter((e): e is Extract<Event,{kind:'workflow_completed'}> => e.kind === 'workflow_completed');
  const teachers = new Set(workflows.map(e => e.teacher));
  const elapsed = (e: Event) => dayNumber(localDay(asOf,e.timezone)) - dayNumber(localDay(e.at,e.timezone));
  const active = (days: number) => new Set(workflows.filter(e => elapsed(e) >= 0 && elapsed(e) < days).map(e => e.teacher));
  const weekly = active(7), monthly = active(30);
  const first = [...teachers].map(teacher => workflows.filter(e => e.teacher === teacher).sort((a,b)=>a.at.localeCompare(b.at))[0]);
  const retention = (days: number) => {
    // Activation cohort is observable only with the full return window [d, 2d).
    const mature = first.filter(e => elapsed(e) >= days * 2);
    const returned = mature.filter(e => workflows.some(w => w.teacher === e.teacher && dayNumber(localDay(w.at,e.timezone)) - dayNumber(localDay(e.at,e.timezone)) >= days && dayNumber(localDay(w.at,e.timezone)) - dayNumber(localDay(e.at,e.timezone)) < days*2));
    return {eligible:mature.length, returned:returned.length, rate:mature.length >= policy.minimumTeachers ? returned.length / mature.length : null, withheld:mature.length < policy.minimumTeachers};
  };
  const usage = [...teachers].sort().map(teacher => {
    const rows = workflows.filter(e => e.teacher === teacher);
    const assignments = new Set(rows.map(e=>`${e.course}:${e.assignment}`));
    const counts = new Map<string,number>(); rows.forEach(e=>counts.set(`${e.course}:${e.assignment}`,(counts.get(`${e.course}:${e.assignment}`)??0)+1));
    return {teacher, assignments:assignments.size, repeatAssignments:[...counts.values()].filter(n=>n>1).length};
  });
  const academic = new Map<string, typeof workflows>();
  for (const e of workflows) {
    const key = `${e.teacher}:${e.course}:${e.assignment}`;
    academic.set(key,[...(academic.get(key)??[]),e]);
  }
  const assignmentRows = [...academic.values()].map(rows => {
    const e = rows.sort((a,b)=>b.at.localeCompare(a.at))[0];
    const s = e.summary;
    return {teacher:e.teacher, course:e.course, assignment:e.assignment, label:e.label ?? 'Title omitted', workflows:rows.length,
      academic: policy.allowAcademic && teachers.size >= policy.minimumTeachers && s && s.sampleSize >= policy.minimumSamples ? s : null,
      academicWithheld: !(policy.allowAcademic && teachers.size >= policy.minimumTeachers && s && s.sampleSize >= policy.minimumSamples)};
  });
  const reliability = new Map<string,{version:string; failures:number; retries:number}>();
  source.forEach(e=>{ if(e.kind !== 'reliability') return; const row = reliability.get(e.version)??{version:e.version,failures:0,retries:0}; if(e.code==='retry') row.retries+=e.count; else row.failures+=e.count; reliability.set(e.version,row); });
  const assignments = workflows.filter(e=>monthly.has(e.teacher) && elapsed(e)<30);
  const distinctAssignments = new Set(assignments.map(e=>`${e.teacher}:${e.course}:${e.assignment}`)).size;
  return {schema:1, namespace, asOf, observedSince, identityNotice:'Fictional teacher tokens; installations are not unique teachers. No identity verification.',
    adoption:{activated:teachers.size, installations:new Set(workflows.map(e=>e.install)).size, weeklyActive:weekly.size, monthlyActive:monthly.size,
      assignmentsPerMonthlyActive:monthly.size >= policy.minimumTeachers ? distinctAssignments/monthly.size:null,
      repeatingTeachers:usage.filter(u=>u.repeatAssignments>0).length, weeklyRetention:retention(7), monthlyRetention:retention(30), suppressed:teachers.size<policy.minimumTeachers},
    // Academic rows are intentionally separate from adoption, never a ranking.
    teacherCourseAssignments: assignmentRows.sort((a,b)=>a.teacher.localeCompare(b.teacher)||a.course.localeCompare(b.course)||a.assignment.localeCompare(b.assignment)),
    reliability:[...reliability.values()].sort((a,b)=>a.version.localeCompare(b.version)),
    privacyNotice:'Academic summaries withheld by default. Configured thresholds reduce exposure; they do not prove anonymity.'};
}
