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
  }
}

// Global default singleton instance
export const db = new OntarioTeacherDB();

