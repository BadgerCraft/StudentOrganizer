import type { OntarioTeacherDB } from '../db/database';
import { calculateOverallCourseGrade } from './calculationEngine';
import type { UUID } from '../types/schema';

export interface CSVParseResult {
  headers: string[];
  rows: Record<string, string>[];
  validCount: number;
  errorCount: number;
  errors: string[];
}

export class PortabilityService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Generates a clean Ontario-formatted Class Markbook CSV export.
   */
  async exportClassMarkbookCSV(classSectionId: UUID, reportingPeriodId: UUID | null): Promise<string> {
    const section = await this.db.classSections.get(classSectionId);
    if (!section) throw new Error('Class section not found');

    const course = await this.db.courses.get(section.courseId);
    const policy = await this.db.gradingPolicies
      .where({ classSectionId, scopeKey: reportingPeriodId ?? 'DEFAULT' })
      .first() || (await this.db.gradingPolicies.where({ classSectionId, scopeKey: 'DEFAULT' }).first())!;

    const enrollments = await this.db.classEnrollments
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const activeEnrollments = enrollments.filter(e => e.deletedAt === null);
    const students = await this.db.students.bulkGet(activeEnrollments.map(e => e.studentId));

    // Sort alphabetically by student last name
    const studentEnrollmentPairs = activeEnrollments.map((enr, i) => ({
      enr,
      student: students[i]
    })).filter(p => p.student && p.student.deletedAt === null);

    studentEnrollmentPairs.sort((a, b) => {
      const l = (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? '');
      if (l !== 0) return l;
      return (a.student?.firstName ?? '').localeCompare(b.student?.firstName ?? '');
    });

    const allAssessments = await this.db.assessments
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const assessments = allAssessments.filter(
      a => a.deletedAt === null && (!reportingPeriodId || a.reportingPeriodId === reportingPeriodId)
    );

    const categories = await this.db.assessmentCategories
      .where('assessmentId')
      .anyOf(assessments.map(a => a.id))
      .toArray();

    const activeCategories = categories.filter(c => c.deletedAt === null);

    const studentAssessments = await this.db.studentAssessments
      .where('classEnrollmentId')
      .anyOf(activeEnrollments.map(e => e.id))
      .toArray();

    const categoryResults = await this.db.categoryResults
      .where('studentAssessmentId')
      .anyOf(studentAssessments.map(sa => sa.id))
      .toArray();

    const overrides = await this.db.gradeOverrides
      .where('classEnrollmentId')
      .anyOf(activeEnrollments.map(e => e.id))
      .toArray();

    // Build Headers
    const headers = ['Student ID', 'Last Name', 'First Name', 'Status'];

    // Map assessment columns
    interface ColDef {
      assessmentId: UUID;
      categoryId: UUID;
      headerLabel: string;
    }
    const columnDefs: ColDef[] = [];

    for (const a of assessments) {
      const catsForA = activeCategories.filter(c => c.assessmentId === a.id);
      for (const cat of catsForA) {
        columnDefs.push({
          assessmentId: a.id,
          categoryId: cat.id,
          headerLabel: `"${a.code} - ${cat.categoryCode} (${cat.maxScore} pts)"`
        });
        headers.push(`"${a.code} - ${cat.categoryCode} (${cat.maxScore} pts)"`);
      }
    }

    headers.push('Overall Calculated %', 'Overall Final %');

    const csvLines: string[] = [headers.join(',')];

    // Build Rows
    for (const pair of studentEnrollmentPairs) {
      const enr = pair.enr;
      const std = pair.student!;

      const grade = calculateOverallCourseGrade(
        enr.id,
        reportingPeriodId,
        assessments,
        activeCategories,
        studentAssessments,
        categoryResults,
        policy,
        overrides
      );

      const rowValues = [
        `"${std.localStudentNumber}"`,
        `"${std.lastName}"`,
        `"${std.preferredName || std.firstName}"`,
        `"${enr.enrollmentStatus}"`
      ];

      for (const col of columnDefs) {
        const sa = studentAssessments.find(s => s.classEnrollmentId === enr.id && s.assessmentId === col.assessmentId);
        if (!sa) {
          rowValues.push('""');
          continue;
        }

        if (sa.completionStatus === 'excused') {
          rowValues.push('"EXC"');
          continue;
        }
        if (sa.completionStatus === 'missing') {
          rowValues.push('"MISS"');
          continue;
        }

        const cr = categoryResults.find(r => r.studentAssessmentId === sa.id && r.assessmentCategoryId === col.categoryId);
        if (!cr) {
          rowValues.push('""');
        } else {
          rowValues.push(`"${cr.rawScore}"`);
        }
      }

      rowValues.push(
        grade.calculatedOverall !== null ? grade.calculatedOverall.toString() : '""',
        grade.finalOverall !== null ? grade.finalOverall.toString() : '""'
      );

      csvLines.push(rowValues.join(','));
    }

    return csvLines.join('\r\n');
  }

  /**
   * Exports raw participation events with timestamps and notes.
   */
  async exportParticipationEventsCSV(classSectionId: UUID): Promise<string> {
    const events = await this.db.participationEvents
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const activeEvents = events.filter(e => e.deletedAt === null);
    activeEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const enrollments = await this.db.classEnrollments.bulkGet(activeEvents.map(e => e.classEnrollmentId));
    const studentIds = enrollments.map(enr => enr?.studentId).filter(Boolean) as UUID[];
    const students = await this.db.students.bulkGet(studentIds);

    const studentMap = new Map<UUID, { num: string; name: string }>();
    enrollments.forEach((enr, i) => {
      if (!enr) return;
      const std = students[i];
      if (std) {
        studentMap.set(enr.id, {
          num: std.localStudentNumber,
          name: `${std.lastName}, ${std.preferredName || std.firstName}`
        });
      }
    });

    const headers = [
      'Event ID',
      'Student ID',
      'Student Name',
      'Date',
      'Time (UTC)',
      'Classification',
      'Event Name',
      'Points',
      'Category',
      'Note'
    ];

    const csvLines: string[] = [headers.join(',')];

    for (const ev of activeEvents) {
      const stdInfo = studentMap.get(ev.classEnrollmentId) || { num: '', name: '' };
      const timePart = ev.occurredAt.slice(11, 19);

      csvLines.push([
        `"${ev.id}"`,
        `"${stdInfo.num}"`,
        `"${stdInfo.name}"`,
        `"${ev.localSchoolDate}"`,
        `"${timePart}"`,
        `"${ev.snapshottedClassification}"`,
        `"${ev.snapshottedName}"`,
        ev.snapshottedPoints.toString(),
        `"${ev.categoryCode || ''}"`,
        `"${(ev.note || '').replace(/"/g, '""')}"`
      ].join(','));
    }

    return csvLines.join('\r\n');
  }

  /**
   * Full database JSON backup.
   */
  async createFullBackupJSON(): Promise<string> {
    const backup: Record<string, any> = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: {}
    };

    for (const table of this.db.tables) {
      backup.tables[table.name] = await table.toArray();
    }

    return JSON.stringify(backup, null, 2);
  }

  /**
   * Restores full database from JSON backup.
   */
  async restoreFromJSON(jsonString: string): Promise<{ restoredTables: number; totalRecords: number }> {
    const data = JSON.parse(jsonString);
    if (!data.tables) throw new Error('Invalid backup file format.');

    let totalRecords = 0;
    let restoredTables = 0;

    await this.db.transaction('rw', this.db.tables, async () => {
      for (const table of this.db.tables) {
        if (data.tables[table.name]) {
          await table.clear();
          const records = data.tables[table.name];
          if (records.length > 0) {
            await table.bulkAdd(records);
            totalRecords += records.length;
          }
          restoredTables++;
        }
      }
    });

    return { restoredTables, totalRecords };
  }
}
