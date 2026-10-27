import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from './portabilityService';

type Backup = { schemaVersion: number; tables: Record<string, any[]> };

describe('Restore validates the imported assessment graph before replacing records', () => {
  let db: OntarioTeacherDB;
  let service: PortabilityService;
  let backup: Backup;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  beforeEach(async () => {
    db = new OntarioTeacherDB(`restore-graph-fictional-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new PortabilityService(db);
    backup = JSON.parse(await service.createFullBackupJSON());
    // This newer local record must survive any rejected attempt to replace the DB.
    await db.students.update(backup.tables.students[0].id, { firstName: 'Newer fictional sentinel' });
  });
  afterEach(async () => { await db.delete(); });

  const foreignPeriod = (tables: Backup['tables']) => {
    const term = { ...tables.terms[0], id: 'fictional-other-term', code: 'REVIEW' };
    const period = { ...tables.reportingPeriods[0], id: 'fictional-other-period', termId: term.id };
    tables.terms.push(term);
    tables.reportingPeriods.push(period);
    return period.id;
  };

  const corruptions: [string, (tables: Backup['tables']) => void, RegExp][] = [
    ['noncanonical primary ID', t => { t.organizations[0].id = ` ${t.organizations[0].id} `; }, /noncanonical "id"/],
    ['noncanonical required reference', t => { t.courses[0].organizationId = ` ${t.courses[0].organizationId} `; }, /noncanonical reference/],
    ['noncanonical optional reference', t => { t.assessments[0].unitId = ` ${t.assessments[0].unitId} `; }, /noncanonical reference/],
    ['another class enrollment', t => { const a = t.studentAssessments[0]; a.classEnrollmentId = t.classEnrollments.find(e => e.classSectionId !== a.classSectionId).id; }, /crosses a class boundary/],
    ['contradictory redundant section', t => { const a = t.studentAssessments[0]; a.classSectionId = t.classSections.find(s => s.id !== a.classSectionId).id; }, /crosses a class boundary/],
    ['another assessment category', t => { const r = t.categoryResults[0]; const a = t.studentAssessments.find(a => a.id === r.studentAssessmentId); r.assessmentCategoryId = t.assessmentCategories.find(c => c.assessmentId !== a.assessmentId).id; }, /crosses an assessment boundary/],
    ['another class unit', t => { const a = t.assessments[0]; a.unitId = t.units.find(u => u.classSectionId !== a.classSectionId).id; }, /crosses a class boundary/],
    ['attendance in another class session', t => { const a = t.attendanceRecords[0]; const enrollment = t.classEnrollments.find(e => e.id === a.classEnrollmentId); const session = { ...t.classSessions[0], id: 'fictional-foreign-session', classSectionId: t.classSections.find(c => c.id !== enrollment.classSectionId).id }; t.classSessions.push(session); a.classSessionId = session.id; }, /crosses a class boundary/],
    ['seat in another class layout', t => { const seat = t.seatPositions[0]; const enrollment = t.classEnrollments.find(e => e.id === seat.classEnrollmentId); const layout = { ...t.seatingLayouts[0], id: 'fictional-other-layout', classSectionId: t.classSections.find(c => c.id !== enrollment.classSectionId).id }; t.seatingLayouts.push(layout); seat.seatingLayoutId = layout.id; }, /crosses a class boundary/],
    ['participation from another class enrollment', t => { const e = t.participationEvents[0]; e.classEnrollmentId = t.classEnrollments.find(r => r.classSectionId !== e.classSectionId).id; }, /crosses a class boundary/],
    ['participation from another class session', t => { const e = t.participationEvents[0]; const session = { ...t.classSessions[0], id: 'fictional-foreign-session', classSectionId: t.classSections.find(c => c.id !== e.classSectionId).id }; t.classSessions.push(session); e.classSessionId = session.id; }, /crosses a class boundary/],
    ['participation event type from another organization', t => { const e = t.participationEvents[0]; const section = t.classSections.find(c => c.id === e.classSectionId); const course = t.courses.find(c => c.id === section.courseId); const org = t.organizations.find(o => o.id !== course.organizationId); const type = { ...t.participationEventTypes[0], id: 'fictional-foreign-type', code: 'REVIEW', organizationId: org.id }; t.participationEventTypes.push(type); e.eventTypeId = type.id; }, /different organization/],
    ['assessment period in another term', t => { t.assessments[0].reportingPeriodId = foreignPeriod(t); }, /different term/],
    ['policy period in another term', t => { t.gradingPolicies[0].reportingPeriodId = foreignPeriod(t); }, /different term/],
    ['policy with nonexistent period', t => { t.gradingPolicies[0].reportingPeriodId = 'fictional-missing-period'; }, /Broken reference/],
    ['override period in another term', t => { t.gradeOverrides.push({ id: 'fictional-override', classEnrollmentId: t.classEnrollments[0].id, reportingPeriodId: foreignPeriod(t), categoryCode: 'OVERALL', overridePercentage: 80 }); }, /different term/],
    ['snapshot period in another term', t => { t.gradeSnapshots.push({ id: 'fictional-snapshot', classEnrollmentId: t.classEnrollments[0].id, reportingPeriodId: foreignPeriod(t), revision: 1 }); }, /different term/],
  ];
  it.each(corruptions)('rejects %s and preserves all current tables', async (_label, corrupt, error) => {
    corrupt(backup.tables);
    const before = await snapshot();
    await expect(service.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(error);
    expect(await snapshot()).toEqual(before);
  });

  it('still checks the class relation when a legacy assignment omits its redundant section', async () => {
    backup.schemaVersion = 2;
    const assignment = backup.tables.studentAssessments[0];
    assignment.classEnrollmentId = backup.tables.classEnrollments.find(e => e.classSectionId !== assignment.classSectionId).id;
    for (const row of backup.tables.studentAssessments) delete row.classSectionId;
    const before = await snapshot();
    await expect(service.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow('crosses a class boundary');
    expect(await snapshot()).toEqual(before);
  });

  it.each([2, 3, 4, 5])('round trips valid schema %i with legacy optional links and historical records intact', async version => {
    backup.schemaVersion = version;
    // Older files may omit additive empty tables and the redundant assignment section.
    if (version < 4) for (const table of ['markingRubrics', 'markingAttempts', 'markingSessions', 'markingCommits']) delete backup.tables[table];
    if (version < 5) for (const table of ['captureAttachments', 'captureImportReceipts']) delete backup.tables[table];
    if (version < 3) for (const row of backup.tables.studentAssessments) delete row.classSectionId;
    backup.tables.assessments[0].unitId = null;
    backup.tables.assessments[0].reportingPeriodId = null;
    backup.tables.gradingPolicies[0].reportingPeriodId = null;
    for (const event of backup.tables.participationEvents) { event.classSessionId = ''; event.eventTypeId = null; }
    await service.restoreFromJSON(JSON.stringify(backup));
    const firstRoundTrip = await snapshot();
    await service.restoreFromJSON(await service.createFullBackupJSON());
    expect(await snapshot()).toEqual(firstRoundTrip);
    expect((await db.students.get(backup.tables.students[0].id))?.firstName).toBe(backup.tables.students[0].firstName);
    const assignments = await db.studentAssessments.toArray();
    for (const assignment of assignments) {
      expect(assignment.classSectionId).toBe((await db.assessments.get(assignment.assessmentId))?.classSectionId);
    }
  });
});
