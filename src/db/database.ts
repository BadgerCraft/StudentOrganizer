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

    this.version(3).stores({
      participationEventTypes: 'id, organizationId, code, &[organizationId+code], classification, isArchived, sortOrder, deletedAt',
      participationDailySummaries: 'id, classEnrollmentId, localSchoolDate, &[classEnrollmentId+localSchoolDate]'
    }).upgrade(async tx => {
      // 1. Backfill event types: recordingMode, defaultCategoryCode, sortOrder within classification
      const types = await tx.table('participationEventTypes').toArray();
      const groupCounters: Record<string, number> = { positive: 0, neutral: 0, needs_followup: 0 };
      for (const t of types) {
        const cls = t.classification || 'positive';
        groupCounters[cls] = (groupCounters[cls] || 0) + 1;
        await tx.table('participationEventTypes').update(t.id, {
          recordingMode: t.recordingMode ?? 'quick_tally',
          defaultCategoryCode: t.defaultCategoryCode ?? null,
          sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : groupCounters[cls]
        });
      }

      // 2. Backfill events: snapshottedRecordingMode, achievementLevel
      // Use collection modify to stream without allocating large in-memory arrays
      await tx.table('participationEvents').toCollection().modify((ev: any) => {
        if (!ev.snapshottedRecordingMode) {
          ev.snapshottedRecordingMode = 'quick_tally';
        }
        if (ev.achievementLevel === undefined) {
          ev.achievementLevel = null;
        }
        // eventTypeId is preserved as-is; historical null remains null!
      });

      // 3. Rebuild the entire daily-summary projection
      // Step A: Capture existing summary IDs to preserve them
      const existingSummaries = await tx.table('participationDailySummaries').toArray();
      const existingSummaryMap = new Map<string, string>();
      for (const s of existingSummaries) {
        existingSummaryMap.set(`${s.classEnrollmentId}_${s.localSchoolDate}`, s.id);
      }

      // Step B: Aggregate all active events by student and date using collection cursor
      interface DailyAgg {
        classEnrollmentId: string;
        localSchoolDate: string;
        positiveCount: number;
        needsFollowupCount: number;
        neutralCount: number;
        totalPoints: number;
        lastEventAt: string | null;
      }
      const aggregated = new Map<string, DailyAgg>();

      await tx.table('participationEvents')
        .filter((e: any) => e.deletedAt === null)
        .each((ev: any) => {
          const key = `${ev.classEnrollmentId}_${ev.localSchoolDate}`;
          let agg = aggregated.get(key);
          if (!agg) {
            agg = {
              classEnrollmentId: ev.classEnrollmentId,
              localSchoolDate: ev.localSchoolDate,
              positiveCount: 0,
              needsFollowupCount: 0,
              neutralCount: 0,
              totalPoints: 0,
              lastEventAt: null
            };
            aggregated.set(key, agg);
          }

          if (ev.snapshottedClassification === 'positive') agg.positiveCount++;
          else if (ev.snapshottedClassification === 'needs_followup') agg.needsFollowupCount++;
          else if (ev.snapshottedClassification === 'neutral') agg.neutralCount++;

          agg.totalPoints += (typeof ev.snapshottedPoints === 'number' ? ev.snapshottedPoints : 0);
          if (!agg.lastEventAt || (ev.occurredAt && ev.occurredAt.localeCompare(agg.lastEventAt) > 0)) {
            agg.lastEventAt = ev.occurredAt;
          }
        });

      // Step C: Clear old summaries to remove stale ones with no active events
      await tx.table('participationDailySummaries').clear();

      // Step D: Insert rebuilt summaries with preserved IDs
      const rebuiltSummaries: any[] = [];
      for (const [key, agg] of aggregated.entries()) {
        const existingId = existingSummaryMap.get(key);
        rebuiltSummaries.push({
          id: existingId || crypto.randomUUID(),
          classEnrollmentId: agg.classEnrollmentId,
          localSchoolDate: agg.localSchoolDate,
          positiveCount: agg.positiveCount,
          needsFollowupCount: agg.needsFollowupCount,
          neutralCount: agg.neutralCount,
          totalPoints: agg.totalPoints,
          lastEventAt: agg.lastEventAt
        });
      }

      const CHUNK_SIZE = 500;
      for (let i = 0; i < rebuiltSummaries.length; i += CHUNK_SIZE) {
        await tx.table('participationDailySummaries').bulkAdd(rebuiltSummaries.slice(i, i + CHUNK_SIZE));
      }
    });
  }
}

// Global default singleton instance
export const db = new OntarioTeacherDB();

