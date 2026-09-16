import Dexie, { type Table } from 'dexie';
import type {
  Organization,
  User,
  OrganizationMembership,
  ClassSectionStaff,
  Device,
  UserPreference,
  AcademicYear,
  Term,
  ReportingPeriod,
  Course,
  ClassSection,
  Unit,
  ClassSession,
  Student,
  ClassEnrollment,
  AttendanceRecord,
  SeatingLayout,
  SeatPosition,
  MarkScaleFamily,
  MarkScaleVersion,
  MarkScaleEntry,
  GradingPolicy,
  GradeOverride,
  GradeSnapshot,
  Assessment,
  AssessmentCategory,
  StudentAssessment,
  CategoryResult,
  ParticipationEventType,
  ParticipationEvent,
  ParticipationDailySummary,
  StudentNote,
  AuditEntry,
  SyncMutation,
  SyncCursor
} from '../types/schema';

export class OntarioTeacherDB extends Dexie {
  organizations!: Table<Organization, string>;
  users!: Table<User, string>;
  organizationMemberships!: Table<OrganizationMembership, string>;
  classSectionStaff!: Table<ClassSectionStaff, string>;
  devices!: Table<Device, string>;
  userPreferences!: Table<UserPreference, string>;

  academicYears!: Table<AcademicYear, string>;
  terms!: Table<Term, string>;
  reportingPeriods!: Table<ReportingPeriod, string>;
  courses!: Table<Course, string>;
  classSections!: Table<ClassSection, string>;
  units!: Table<Unit, string>;
  classSessions!: Table<ClassSession, string>;

  students!: Table<Student, string>;
  classEnrollments!: Table<ClassEnrollment, string>;
  attendanceRecords!: Table<AttendanceRecord, string>;
  seatingLayouts!: Table<SeatingLayout, string>;
  seatPositions!: Table<SeatPosition, string>;

  markScaleFamilies!: Table<MarkScaleFamily, string>;
  markScaleVersions!: Table<MarkScaleVersion, string>;
  markScaleEntries!: Table<MarkScaleEntry, string>;
  gradingPolicies!: Table<GradingPolicy, string>;
  gradeOverrides!: Table<GradeOverride, string>;
  gradeSnapshots!: Table<GradeSnapshot, string>;

  assessments!: Table<Assessment, string>;
  assessmentCategories!: Table<AssessmentCategory, string>;
  studentAssessments!: Table<StudentAssessment, string>;
  categoryResults!: Table<CategoryResult, string>;

  participationEventTypes!: Table<ParticipationEventType, string>;
  participationEvents!: Table<ParticipationEvent, string>;
  participationDailySummaries!: Table<ParticipationDailySummary, string>;

  studentNotes!: Table<StudentNote, string>;
  auditEntries!: Table<AuditEntry, string>;
  syncMutations!: Table<SyncMutation, string>;
  syncCursors!: Table<SyncCursor, string>;

  constructor(databaseName = 'OntarioTeacherAssessmentDB') {
    super(databaseName);

    this.version(1).stores({
      // Organizations & Identity
      organizations: 'id, parentOrganizationId, parentScopeKey, organizationType, &[parentScopeKey+code], deletedAt',
      users: 'id, &authSubject, &email, deletedAt',
      organizationMemberships: 'id, organizationId, userId, &[organizationId+userId], deletedAt',
      classSectionStaff: 'id, classSectionId, organizationMembershipId, &[classSectionId+organizationMembershipId], deletedAt',
      devices: 'id, userId, installationId, &[userId+installationId]',
      userPreferences: 'id, &userId',

      // Academic Calendar & Course Structure
      academicYears: 'id, organizationId, isCurrent, &[organizationId+name], deletedAt',
      terms: 'id, academicYearId, code, &[academicYearId+code], deletedAt',
      reportingPeriods: 'id, termId, sequenceNumber, &[termId+sequenceNumber], deletedAt',
      courses: 'id, organizationId, code, &[organizationId+code], deletedAt',
      classSections: 'id, courseId, termId, &[courseId+termId+sectionNumber], deletedAt',
      units: 'id, classSectionId, code, &[classSectionId+code], sortOrder, deletedAt',
      classSessions: 'id, classSectionId, localSchoolDate, startsAt, deletedAt',

      // Students & Class Membership
      students: 'id, organizationId, localStudentNumber, &[organizationId+localStudentNumber], lastName, deletedAt',
      classEnrollments: 'id, classSectionId, studentId, &[classSectionId+studentId], [classSectionId+enrollmentStatus], deletedAt',
      attendanceRecords: 'id, classEnrollmentId, classSessionId, localSchoolDate, &[classEnrollmentId+classSessionId], deletedAt',
      seatingLayouts: 'id, classSectionId, deletedAt',
      seatPositions: 'id, seatingLayoutId, classEnrollmentId, &[seatingLayoutId+row+col], &[seatingLayoutId+classEnrollmentId], deletedAt',

      // Mark Scales & Grading Policies
      markScaleFamilies: 'id, organizationId, code, &[organizationId+code], deletedAt',
      markScaleVersions: 'id, markScaleFamilyId, revision, &[markScaleFamilyId+revision], deletedAt',
      markScaleEntries: 'id, markScaleVersionId, code, &[markScaleVersionId+code], sortOrder',
      gradingPolicies: 'id, classSectionId, scopeKey, &[classSectionId+scopeKey], deletedAt',
      gradeOverrides: 'id, classEnrollmentId, reportingPeriodId, categoryCode, &[classEnrollmentId+reportingPeriodId+categoryCode], deletedAt',
      gradeSnapshots: 'id, classEnrollmentId, reportingPeriodId, revision, &[classEnrollmentId+reportingPeriodId+revision]',

      // Assessments & Results
      assessments: 'id, classSectionId, unitId, reportingPeriodId, code, &[classSectionId+code], dueDate, deletedAt',
      assessmentCategories: 'id, assessmentId, categoryCode, &[assessmentId+categoryCode], deletedAt',
      studentAssessments: 'id, assessmentId, classEnrollmentId, &[assessmentId+classEnrollmentId], workflowStatus, completionStatus, isLate, deletedAt',
      categoryResults: 'id, studentAssessmentId, assessmentCategoryId, &[studentAssessmentId+assessmentCategoryId], deletedAt',

      // Participation
      participationEventTypes: 'id, organizationId, code, &[organizationId+code], classification, isArchived, deletedAt',
      participationEvents: 'id, classEnrollmentId, classSectionId, classSessionId, eventTypeId, studentAssessmentId, batchId, localSchoolDate, occurredAt, [classEnrollmentId+localSchoolDate], [classSectionId+localSchoolDate], [classSectionId+occurredAt], [classSessionId+occurredAt], [eventTypeId+occurredAt], [batchId+occurredAt], deletedAt',
      participationDailySummaries: 'id, classEnrollmentId, localSchoolDate, &[classEnrollmentId+localSchoolDate]',

      // Notes, Audit & Synchronization
      studentNotes: 'id, classEnrollmentId, authorUserId, isConfidential, deletedAt',
      auditEntries: 'id, entityName, entityId, transactionId, timestamp, [entityName+entityId]',
      syncMutations: 'id, deviceId, &mutationId, transactionId, entityName, entityId, createdAt, acknowledgedAt',
      syncCursors: 'id, deviceId, organizationId, &[deviceId+organizationId]'
    });

    this.version(2).stores({
      studentAssessments: 'id, assessmentId, classEnrollmentId, classSectionId, &[assessmentId+classEnrollmentId], workflowStatus, completionStatus, isLate, [classSectionId+deletedAt], deletedAt',
      categoryResults: 'id, studentAssessmentId, assessmentCategoryId, &[studentAssessmentId+assessmentCategoryId], [assessmentCategoryId+deletedAt], deletedAt',
      syncMutations: 'id, deviceId, &mutationId, transactionId, organizationId, status, entityName, entityId, createdAt, [deviceId+organizationId+status]'
    }).upgrade(async tx => {
      const mutations = await tx.table('syncMutations').toArray();
      for (const m of mutations) {
        let orgId: string | null = null;
        try {
          if (m.entityName === 'categoryResults') {
            const cr = await tx.table('categoryResults').get(m.entityId);
            if (cr) {
              const sa = await tx.table('studentAssessments').get(cr.studentAssessmentId);
              if (sa) {
                const enr = await tx.table('classEnrollments').get(sa.classEnrollmentId);
                if (enr) {
                  const sec = await tx.table('classSections').get(enr.classSectionId);
                  if (sec) {
                    const course = await tx.table('courses').get(sec.courseId);
                    if (course) orgId = course.organizationId;
                  }
                }
              }
            }
          } else if (m.entityName === 'studentAssessments') {
            const sa = await tx.table('studentAssessments').get(m.entityId);
            if (sa) {
              const enr = await tx.table('classEnrollments').get(sa.classEnrollmentId);
              if (enr) {
                const sec = await tx.table('classSections').get(enr.classSectionId);
                if (sec) {
                  const course = await tx.table('courses').get(sec.courseId);
                  if (course) orgId = course.organizationId;
                }
              }
            }
          } else if (m.entityName === 'participationEvents') {
            const pe = await tx.table('participationEvents').get(m.entityId);
            if (pe) {
              const sec = await tx.table('classSections').get(pe.classSectionId);
              if (sec) {
                const course = await tx.table('courses').get(sec.courseId);
                if (course) orgId = course.organizationId;
              }
            }
          } else if (m.entityName === 'seatPositions') {
            const sp = await tx.table('seatPositions').get(m.entityId);
            if (sp) {
              const layout = await tx.table('seatingLayouts').get(sp.seatingLayoutId);
              if (layout) {
                const sec = await tx.table('classSections').get(layout.classSectionId);
                if (sec) {
                  const course = await tx.table('courses').get(sec.courseId);
                  if (course) orgId = course.organizationId;
                }
              }
            }
          } else if (m.entityName === 'gradeOverrides') {
            const ov = await tx.table('gradeOverrides').get(m.entityId);
            if (ov) {
              const enr = await tx.table('classEnrollments').get(ov.classEnrollmentId);
              if (enr) {
                const sec = await tx.table('classSections').get(enr.classSectionId);
                if (sec) {
                  const course = await tx.table('courses').get(sec.courseId);
                  if (course) orgId = course.organizationId;
                }
              }
            }
          } else if (m.entityName === 'studentNotes') {
            const note = await tx.table('studentNotes').get(m.entityId);
            if (note) {
              const enr = await tx.table('classEnrollments').get(note.classEnrollmentId);
              if (enr) {
                const sec = await tx.table('classSections').get(enr.classSectionId);
                if (sec) {
                  const course = await tx.table('courses').get(sec.courseId);
                  if (course) orgId = course.organizationId;
                }
              }
            }
          } else if (m.entityName === 'assessments') {
            const a = await tx.table('assessments').get(m.entityId);
            if (a) {
              const sec = await tx.table('classSections').get(a.classSectionId);
              if (sec) {
                const course = await tx.table('courses').get(sec.courseId);
                if (course) orgId = course.organizationId;
              }
            }
          }
        } catch {
          orgId = null;
        }

        const isAcknowledged = m.acknowledgedAt != null;
        if (orgId) {
          await tx.table('syncMutations').update(m.id, {
            organizationId: orgId,
            status: isAcknowledged ? 'acknowledged' : 'pending'
          });
        } else {
          await tx.table('syncMutations').update(m.id, {
            organizationId: '00000000-0000-0000-0000-000000000000',
            status: 'failed',
            lastError: 'QUARANTINED_ORPHAN_MUTATION: Unable to determine organizationId during v1-to-v2 upgrade'
          });
        }
      }

      // Backfill classSectionId on existing studentAssessments if missing
      const sas = await tx.table('studentAssessments').toArray();
      for (const sa of sas) {
        if (!sa.classSectionId) {
          try {
            const enr = await tx.table('classEnrollments').get(sa.classEnrollmentId);
            if (enr) {
              await tx.table('studentAssessments').update(sa.id, { classSectionId: enr.classSectionId });
            }
          } catch {
            // Ignore
          }
        }
      }
    });
  }
}

// Global default singleton instance
export const db = new OntarioTeacherDB();

