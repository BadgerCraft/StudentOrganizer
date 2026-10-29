import { normalizeLegacyCaptureTables, validateCaptureBackup } from '../capture/portabilityValidation';
import { normalizeLegacyMarkingTables, validateMarkingBackup } from '../marking/portabilityValidation';
import { getClassroomLevel } from './classroomLevels';
import { isLocalPhoto } from '../utils/localPhoto';
export interface BackupMetadata { version: number; exportedAt: string; tableCount: number; totalRecords: number; tableSummary: Record<string, number> }
/** Trusted schema names. Parity with OntarioTeacherDB is checked in regression tests. */
export const BACKUP_TABLE_NAMES: readonly string[] = Object.freeze(["organizations", "users", "organizationMemberships", "classSectionStaff", "devices", "userPreferences", "academicYears", "terms", "reportingPeriods", "courses", "classSections", "units", "classSessions", "students", "classEnrollments", "attendanceRecords", "seatingLayouts", "seatPositions", "markScaleFamilies", "markScaleVersions", "markScaleEntries", "gradingPolicies", "gradeOverrides", "gradeSnapshots", "assessments", "assessmentCategories", "studentAssessments", "categoryResults", "participationEventTypes", "participationEvents", "participationDailySummaries", "studentNotes", "auditEntries", "syncMutations", "syncCursors", "markingRubrics", "markingAttempts", "markingSessions", "markingCommits", "captureAttachments", "captureImportReceipts"]);
export function validateBackupJSONWithTables(jsonString: string, tables: readonly { name: string }[]): BackupMetadata {
    if (!jsonString || !jsonString.trim()) {
      throw new Error('Backup file is empty.');
    }

    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch {
      throw new Error('Invalid backup file: Not a valid JSON document.');
    }

    return validateBackupDataWithTables(data, tables);
}

/** Validate an already-owned JSON snapshot without serializing the whole workspace. */
export function validateBackupDataWithTables(data: any, tables: readonly { name: string }[], verifiedCaptureBytes?: WeakSet<object>, verifiedAttempts?: WeakSet<object>): BackupMetadata {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid backup file format: Root must be a JSON object.');
    }

    // v4 adds marking records; old v2/v3 backups migrate to empty additive tables.
    if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 2 || data.schemaVersion > 5) {
      throw new Error(
        `Invalid backup file: Unsupported or missing schemaVersion (${data.schemaVersion}). Supported versions are 2, 3, 4 and 5.`
      );
    }

    if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) {
      throw new Error('Invalid backup file format: Missing "tables" dictionary.');
    }

    normalizeLegacyMarkingTables(data.tables, data.schemaVersion);
    normalizeLegacyCaptureTables(data.tables, data.schemaVersion);
    const knownTables = new Set(tables.map(t => t.name));
    for (const name of Object.keys(data.tables)) if (!knownTables.has(name)) throw new Error(`Invalid backup file: Unknown table ${name}.`);

    // Require complete backup: EVERY database table must be present as an array
    for (const table of tables) {
      const tName = table.name;
      if (!Object.prototype.hasOwnProperty.call(data.tables, tName) || data.tables[tName] === undefined) {
        throw new Error(`Invalid backup file: Incomplete backup. Missing table "${tName}".`);
      }
      if (!Array.isArray(data.tables[tName])) {
        throw new Error(`Invalid backup file: Table "${tName}" must be an array of records.`);
      }
    }

    let totalRecords = 0;
    const tableSummary: Record<string, number> = {};

    // Map of table names to Set of record IDs for referential integrity checks
    const idSets: Record<string, Set<string>> = {};
    for (const table of tables) {
      idSets[table.name] = new Set<string>();
    }

    const isNonEmptyStr = (val: any): boolean => typeof val === 'string' && val.trim().length > 0;
    const isNum = (val: any): boolean => typeof val === 'number' && !isNaN(val);

    // Compound unique index sets to catch collisions before Dexie write
    const compoundUniqueSets = {
      enrollmentSectionStudent: new Set<string>(), // &[classSectionId+studentId]
      orgStudentNumber: new Set<string>(),         // &[organizationId+localStudentNumber]
      sectionCourseTermNum: new Set<string>()       // &[courseId+termId+sectionNumber]
    };

    // PASS 1: Validate individual record shapes, types, primary key uniqueness, and collect IDs
    for (const [tblName, recs] of Object.entries(data.tables)) {
      if (!Array.isArray(recs)) {
        throw new Error(`Invalid backup file: Table "${tblName}" contains non-array data.`);
      }

      // Validate record shapes and essential fields needed by the app
      for (let i = 0; i < recs.length; i++) {
        const rec: any = recs[i];
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
          throw new Error(`Invalid backup file: Table "${tblName}" contains invalid record shape at index ${i}.`);
        }
        if (typeof rec.id !== 'string' || !rec.id.trim() || rec.id !== rec.id.trim()) {
          throw new Error(`Invalid backup file: Table "${tblName}" contains record at index ${i} with missing, invalid or noncanonical "id".`);
        }

        const recordId = rec.id;
        if (idSets[tblName].has(recordId)) {
          throw new Error(`Invalid backup file: Table "${tblName}" contains duplicate primary key "id": "${rec.id}".`);
        }
        idSets[tblName].add(recordId);

        const requireString = (field: string) => {
          if (!isNonEmptyStr(rec[field])) {
            throw new Error(
              `Invalid backup file: Table "${tblName}" contains record at index ${i} with missing or invalid required field "${field}".`
            );
          }
        };

        const requireNumber = (field: string) => {
          if (!isNum(rec[field])) {
            throw new Error(
              `Invalid backup file: Table "${tblName}" contains record at index ${i} with missing or invalid required field "${field}" (expected a valid number).`
            );
          }
        };

        const requireEnum = (field: string, allowed: string[]) => {
          if (typeof rec[field] !== 'string' || !allowed.includes(rec[field])) {
            throw new Error(
              `Invalid backup file: Table "${tblName}" contains record at index ${i} with missing or invalid required field "${field}" (expected one of: ${allowed.join(', ')}).`
            );
          }
        };

        switch (tblName) {
          case 'users':
            requireString('authSubject');
            requireString('email');
            requireString('name');
            break;

          case 'students':
            if (rec.photoUrl != null && !isLocalPhoto(rec.photoUrl)) {
              throw new Error('Invalid backup file: student photo must be a local JPEG, PNG or WebP image of at most 64 KB. Existing data has not been changed.');
            }
            requireString('organizationId');
            requireString('localStudentNumber');
            requireString('firstName');
            requireString('lastName');
            {
              const key = `${rec.organizationId}::${rec.localStudentNumber}`;
              if (compoundUniqueSets.orgStudentNumber.has(key)) {
                throw new Error(`Invalid backup file: Table "students" contains duplicate student number "${rec.localStudentNumber}" in organization at index ${i}.`);
              }
              compoundUniqueSets.orgStudentNumber.add(key);
            }
            break;

          case 'classEnrollments':
            requireString('classSectionId');
            requireString('studentId');
            requireEnum('enrollmentStatus', ['active', 'dropped', 'transferred', 'completed']);
            requireString('enrolledDate');
            {
              const key = `${rec.classSectionId}::${rec.studentId}`;
              if (compoundUniqueSets.enrollmentSectionStudent.has(key)) {
                throw new Error(`Invalid backup file: Table "classEnrollments" contains duplicate enrollment for student in section at index ${i}.`);
              }
              compoundUniqueSets.enrollmentSectionStudent.add(key);
            }
            break;

          case 'organizations':
            requireString('name');
            requireString('code');
            requireEnum('organizationType', ['board', 'school', 'program', 'personal']);
            break;

          case 'courses':
            requireString('organizationId');
            requireString('code');
            requireString('title');
            break;

          case 'classSections':
            requireString('courseId');
            requireString('termId');
            requireString('sectionNumber');
            {
              const key = `${rec.courseId}::${rec.termId}::${rec.sectionNumber}`;
              if (compoundUniqueSets.sectionCourseTermNum.has(key)) {
                throw new Error(`Invalid backup file: Table "classSections" contains duplicate section number in course and term at index ${i}.`);
              }
              compoundUniqueSets.sectionCourseTermNum.add(key);
            }
            break;

          case 'academicYears':
            requireString('organizationId');
            requireString('name');
            break;

          case 'terms':
            requireString('academicYearId');
            requireString('name');
            requireString('code');
            break;

          case 'reportingPeriods':
            requireString('termId');
            requireString('name');
            break;

          case 'units':
            requireString('classSectionId');
            requireString('code');
            requireString('title');
            break;

          case 'classSessions':
            requireString('classSectionId');
            requireString('localSchoolDate');
            break;

          case 'assessments':
            requireString('classSectionId');
            requireString('code');
            requireString('title');
            break;

          case 'assessmentCategories':
            requireString('assessmentId');
            requireString('categoryCode');
            requireNumber('maxScore');
            if (!isNum(rec.evidenceWeight) && !isNum(rec.weight)) {
              throw new Error(
                `Invalid backup file: Table "assessmentCategories" contains record at index ${i} with missing or invalid required field "evidenceWeight" (expected a valid number).`
              );
            }
            break;

          case 'studentAssessments':
            requireString('assessmentId');
            requireString('classEnrollmentId');
            break;

          case 'categoryResults':
            requireString('studentAssessmentId');
            requireString('assessmentCategoryId');
            // Validate only the new explicit scale. Never recalculate historical marks.
            if (rec.inputFormat === 'classroom_level') {
              const rawScore = typeof rec.rawScore === 'string' ? rec.rawScore.trim() : null;
              const level = rawScore ? getClassroomLevel(rawScore) : undefined;
              if (rawScore === null || (rawScore && !level) || rec.normalizedPercentage !== (level?.percentage ?? null)) {
                throw new Error(`Invalid backup file: Table "categoryResults" contains an invalid classroom level at index ${i}.`);
              }
            }
            break;

          case 'attendanceRecords':
            requireString('classEnrollmentId');
            requireString('classSessionId');
            requireString('localSchoolDate');
            requireEnum('status', ['present', 'absent', 'late', 'excused']);
            break;

          case 'seatingLayouts':
            requireString('classSectionId');
            requireString('name');
            requireNumber('rows');
            requireNumber('cols');
            break;

          case 'seatPositions':
            requireString('seatingLayoutId');
            requireString('classEnrollmentId');
            requireNumber('row');
            requireNumber('col');
            break;

          case 'participationEventTypes':
            requireString('organizationId');
            requireString('code');
            requireEnum('classification', ['positive', 'neutral', 'needs_followup']);
            // Support v3 label and v2 legacy name
            if (!isNonEmptyStr(rec.label) && !isNonEmptyStr(rec.name)) {
              throw new Error(
                `Invalid backup file: Table "participationEventTypes" contains record at index ${i} with missing or invalid required field "label" (or legacy "name").`
              );
            }
            break;

          case 'participationEvents':
            requireString('classEnrollmentId');
            requireString('classSectionId');
            requireString('localSchoolDate');
            break;

          case 'participationDailySummaries':
            requireString('classEnrollmentId');
            requireString('localSchoolDate');
            break;

          case 'studentNotes':
            requireString('classEnrollmentId');
            requireString('authorUserId');
            requireString('content');
            break;

          case 'organizationMemberships':
            requireString('organizationId');
            requireString('userId');
            requireString('role');
            break;

          case 'classSectionStaff':
            requireString('classSectionId');
            requireString('organizationMembershipId');
            requireString('role');
            break;

          case 'devices':
            requireString('userId');
            requireString('installationId');
            break;

          case 'userPreferences':
            requireString('userId');
            break;

          case 'gradingPolicies':
            requireString('classSectionId');
            requireString('scopeKey');
            break;

          case 'gradeOverrides':
            requireString('classEnrollmentId');
            requireString('reportingPeriodId');
            requireString('categoryCode');
            requireNumber('overridePercentage');
            break;

          case 'gradeSnapshots':
            requireString('classEnrollmentId');
            requireString('reportingPeriodId');
            requireNumber('revision');
            break;

          case 'markScaleFamilies':
            requireString('organizationId');
            requireString('code');
            requireString('name');
            break;

          case 'markScaleVersions':
            requireString('markScaleFamilyId');
            requireNumber('revision');
            break;

          case 'markScaleEntries':
            requireString('markScaleVersionId');
            requireString('code');
            if (!isNonEmptyStr(rec.label) && !isNonEmptyStr(rec.name)) {
              throw new Error(
                `Invalid backup file: Table "markScaleEntries" contains record at index ${i} with missing or invalid required field "label".`
              );
            }
            break;

          case 'auditEntries':
            requireString('entityName');
            requireString('entityId');
            requireEnum('action', ['INSERT', 'UPDATE', 'DELETE']);
            break;

          case 'syncMutations':
            requireString('deviceId');
            requireString('mutationId');
            requireString('entityName');
            requireString('entityId');
            requireEnum('operation', ['INSERT', 'UPDATE', 'DELETE']);
            break;

          case 'syncCursors':
            requireString('deviceId');
            requireString('organizationId');
            break;
        }
      }

      tableSummary[tblName] = recs.length;
      totalRecords += recs.length;
    }

    // PASS 2: Validate essential relationships needed for a usable restore
    const requireRef = (
      sourceTable: string,
      recordIndex: number,
      field: string,
      targetTable: string,
      value: any,
      nullable = false
    ) => {
      if (nullable && (value === null || value === undefined || value === '')) {
        return;
      }
      if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
        throw new Error(
          `Invalid backup file: Table "${sourceTable}" contains record at index ${recordIndex} with missing, invalid or noncanonical reference "${field}".`
        );
      }
      const targetSet = idSets[targetTable];
      if (!targetSet || !targetSet.has(value)) {
        throw new Error(
          `Invalid backup file: Broken reference in table "${sourceTable}" at index ${recordIndex}. Field "${field}" references nonexistent record "${value}" in table "${targetTable}".`
        );
      }
    };

    for (const [tblName, recs] of Object.entries(data.tables)) {
      for (let i = 0; i < (recs as any[]).length; i++) {
        const rec = (recs as any[])[i];

        switch (tblName) {
          case 'academicYears':
            requireRef('academicYears', i, 'organizationId', 'organizations', rec.organizationId);
            break;

          case 'terms':
            requireRef('terms', i, 'academicYearId', 'academicYears', rec.academicYearId);
            break;

          case 'reportingPeriods':
            requireRef('reportingPeriods', i, 'termId', 'terms', rec.termId);
            break;

          case 'courses':
            requireRef('courses', i, 'organizationId', 'organizations', rec.organizationId);
            break;

          case 'classSections':
            requireRef('classSections', i, 'courseId', 'courses', rec.courseId);
            requireRef('classSections', i, 'termId', 'terms', rec.termId);
            break;

          case 'units':
            requireRef('units', i, 'classSectionId', 'classSections', rec.classSectionId);
            break;

          case 'classSessions':
            requireRef('classSessions', i, 'classSectionId', 'classSections', rec.classSectionId);
            break;

          case 'students':
            requireRef('students', i, 'organizationId', 'organizations', rec.organizationId);
            break;

          case 'classEnrollments':
            requireRef('classEnrollments', i, 'studentId', 'students', rec.studentId);
            requireRef('classEnrollments', i, 'classSectionId', 'classSections', rec.classSectionId);
            break;

          case 'attendanceRecords':
            requireRef('attendanceRecords', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('attendanceRecords', i, 'classSessionId', 'classSessions', rec.classSessionId);
            break;

          case 'seatingLayouts':
            requireRef('seatingLayouts', i, 'classSectionId', 'classSections', rec.classSectionId);
            break;

          case 'seatPositions':
            requireRef('seatPositions', i, 'seatingLayoutId', 'seatingLayouts', rec.seatingLayoutId);
            requireRef('seatPositions', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            break;

          case 'markScaleFamilies':
            requireRef('markScaleFamilies', i, 'organizationId', 'organizations', rec.organizationId);
            break;

          case 'markScaleVersions':
            requireRef('markScaleVersions', i, 'markScaleFamilyId', 'markScaleFamilies', rec.markScaleFamilyId);
            break;

          case 'markScaleEntries':
            requireRef('markScaleEntries', i, 'markScaleVersionId', 'markScaleVersions', rec.markScaleVersionId);
            break;

          case 'gradingPolicies':
            requireRef('gradingPolicies', i, 'classSectionId', 'classSections', rec.classSectionId);
            requireRef('gradingPolicies', i, 'reportingPeriodId', 'reportingPeriods', rec.reportingPeriodId, true);
            break;

          case 'gradeOverrides':
            requireRef('gradeOverrides', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('gradeOverrides', i, 'reportingPeriodId', 'reportingPeriods', rec.reportingPeriodId);
            break;

          case 'gradeSnapshots':
            requireRef('gradeSnapshots', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('gradeSnapshots', i, 'reportingPeriodId', 'reportingPeriods', rec.reportingPeriodId);
            break;

          case 'assessments':
            requireRef('assessments', i, 'classSectionId', 'classSections', rec.classSectionId);
            requireRef('assessments', i, 'unitId', 'units', rec.unitId, true);
            requireRef('assessments', i, 'reportingPeriodId', 'reportingPeriods', rec.reportingPeriodId, true);
            break;

          case 'assessmentCategories':
            requireRef('assessmentCategories', i, 'assessmentId', 'assessments', rec.assessmentId);
            break;

          case 'studentAssessments':
            requireRef('studentAssessments', i, 'assessmentId', 'assessments', rec.assessmentId);
            requireRef('studentAssessments', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('studentAssessments', i, 'classSectionId', 'classSections', rec.classSectionId, true);
            break;

          case 'categoryResults':
            requireRef('categoryResults', i, 'studentAssessmentId', 'studentAssessments', rec.studentAssessmentId);
            requireRef('categoryResults', i, 'assessmentCategoryId', 'assessmentCategories', rec.assessmentCategoryId);
            break;

          case 'participationEventTypes':
            requireRef('participationEventTypes', i, 'organizationId', 'organizations', rec.organizationId);
            break;

          case 'participationEvents':
            requireRef('participationEvents', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('participationEvents', i, 'classSectionId', 'classSections', rec.classSectionId);
            requireRef('participationEvents', i, 'classSessionId', 'classSessions', rec.classSessionId, true);
            requireRef('participationEvents', i, 'eventTypeId', 'participationEventTypes', rec.eventTypeId, true);
            break;

          case 'participationDailySummaries':
            requireRef('participationDailySummaries', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            break;

          case 'studentNotes':
            requireRef('studentNotes', i, 'classEnrollmentId', 'classEnrollments', rec.classEnrollmentId);
            requireRef('studentNotes', i, 'authorUserId', 'users', rec.authorUserId);
            break;

          case 'organizationMemberships':
            requireRef('organizationMemberships', i, 'organizationId', 'organizations', rec.organizationId);
            requireRef('organizationMemberships', i, 'userId', 'users', rec.userId);
            break;

          case 'classSectionStaff':
            requireRef('classSectionStaff', i, 'classSectionId', 'classSections', rec.classSectionId);
            requireRef('classSectionStaff', i, 'organizationMembershipId', 'organizationMemberships', rec.organizationMembershipId);
            break;

          case 'devices':
            requireRef('devices', i, 'userId', 'users', rec.userId);
            break;

          case 'userPreferences':
            requireRef('userPreferences', i, 'userId', 'users', rec.userId);
            requireRef('userPreferences', i, 'lastOpenedClassSectionId', 'classSections', rec.lastOpenedClassSectionId, true);
            break;

          // Historical audit and sync records:
          // Notice: auditEntries, syncMutations, and syncCursors intentionally have NO requireRef on entityId.
          // Historical audit or sync references may legitimately outlive entities, and must not be discarded.
        }
      }
    }

    // Existence alone is insufficient: each assessment graph must describe one class.
    // Use the imported snapshot, never current data, and retain null/missing legacy
    // studentAssessment.classSectionId until the existing restore backfill runs.
    const graphTables = ['reportingPeriods', 'classSections', 'units', 'assessments', 'classEnrollments',
      'studentAssessments', 'assessmentCategories', 'classSessions', 'seatingLayouts', 'participationEventTypes', 'courses'];
    const recordsById: Record<string, Map<string, any>> = Object.fromEntries(
      graphTables.map(name => [name, new Map((data.tables[name] as any[]).map(record => [record.id, record]))])
    );
    const sameClass = (table: string, id: string, actual: string, expected: string) => {
      if (actual !== expected) throw new Error(`Invalid backup file: ${table}/${id} crosses a class boundary. Existing data has not been changed.`);
    };
    const samePeriodTerm = (table: string, record: any, classSectionId: string) => {
      if (record.reportingPeriodId == null || record.reportingPeriodId === '') return;
      const period = recordsById.reportingPeriods.get(record.reportingPeriodId);
      const section = recordsById.classSections.get(classSectionId);
      if (period.termId !== section.termId) throw new Error(`Invalid backup file: ${table}/${record.id} reporting period belongs to a different term. Existing data has not been changed.`);
    };
    for (const assessment of data.tables.assessments) {
      if (assessment.unitId) sameClass('assessments', assessment.id, recordsById.units.get(assessment.unitId).classSectionId, assessment.classSectionId);
      samePeriodTerm('assessments', assessment, assessment.classSectionId);
    }
    for (const assignment of data.tables.studentAssessments) {
      const assessment = recordsById.assessments.get(assignment.assessmentId);
      const enrollment = recordsById.classEnrollments.get(assignment.classEnrollmentId);
      sameClass('studentAssessments', assignment.id, enrollment.classSectionId, assessment.classSectionId);
      if (assignment.classSectionId) sameClass('studentAssessments', assignment.id, assignment.classSectionId, assessment.classSectionId);
    }
    for (const result of data.tables.categoryResults) {
      const assignment = recordsById.studentAssessments.get(result.studentAssessmentId);
      const category = recordsById.assessmentCategories.get(result.assessmentCategoryId);
      if (category.assessmentId !== assignment.assessmentId) throw new Error(`Invalid backup file: categoryResults/${result.id} crosses an assessment boundary. Existing data has not been changed.`);
    }
    for (const attendance of data.tables.attendanceRecords) {
      const enrollment = recordsById.classEnrollments.get(attendance.classEnrollmentId);
      sameClass('attendanceRecords', attendance.id, recordsById.classSessions.get(attendance.classSessionId).classSectionId, enrollment.classSectionId);
    }
    for (const seat of data.tables.seatPositions) {
      const enrollment = recordsById.classEnrollments.get(seat.classEnrollmentId);
      sameClass('seatPositions', seat.id, recordsById.seatingLayouts.get(seat.seatingLayoutId).classSectionId, enrollment.classSectionId);
    }
    for (const event of data.tables.participationEvents) {
      sameClass('participationEvents', event.id, recordsById.classEnrollments.get(event.classEnrollmentId).classSectionId, event.classSectionId);
      if (event.classSessionId) sameClass('participationEvents', event.id, recordsById.classSessions.get(event.classSessionId).classSectionId, event.classSectionId);
      // Historical events may legitimately have no retained event type or session.
      if (event.eventTypeId) {
        const eventType = recordsById.participationEventTypes.get(event.eventTypeId);
        const section = recordsById.classSections.get(event.classSectionId);
        if (eventType.organizationId != null && eventType.organizationId !== recordsById.courses.get(section.courseId).organizationId) {
          throw new Error(`Invalid backup file: participationEvents/${event.id} event type belongs to a different organization. Existing data has not been changed.`);
        }
      }
    }
    for (const policy of data.tables.gradingPolicies) samePeriodTerm('gradingPolicies', policy, policy.classSectionId);
    for (const name of ['gradeOverrides', 'gradeSnapshots']) {
      for (const record of data.tables[name]) samePeriodTerm(name, record, recordsById.classEnrollments.get(record.classEnrollmentId).classSectionId);
    }

    validateMarkingBackup(data.tables, verifiedAttempts);
    validateCaptureBackup(data.tables, verifiedCaptureBytes);

    return {
      version: typeof data.version === 'number' ? data.version : 1,
      exportedAt: data.exportedAt || new Date().toISOString(),
      tableCount: Object.keys(data.tables).length,
      totalRecords,
      tableSummary
    };
  
}
