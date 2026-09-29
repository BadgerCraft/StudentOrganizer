import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { OntarioTeacherDB } from '../db/database';

describe('Dexie v1 to v2 Migration Suite', () => {
  it('correctly migrates v1 mutations: backfills organizationId, maps status, and quarantines orphans', async () => {
    const dbName = `migration-test-${Date.now()}`;

    // 1. Open database at version 1 and populate baseline entities and v1 mutations
    const v1Db = new Dexie(dbName);
    v1Db.version(1).stores({
      organizations: 'id, parentOrganizationId, parentScopeKey, organizationType, &[parentScopeKey+code], deletedAt',
      users: 'id, &authSubject, &email, deletedAt',
      organizationMemberships: 'id, organizationId, userId, &[organizationId+userId], deletedAt',
      courses: 'id, organizationId, code, &[organizationId+code], deletedAt',
      classSections: 'id, courseId, termId, &[courseId+termId+sectionNumber], deletedAt',
      classEnrollments: 'id, classSectionId, studentId, &[classSectionId+studentId], [classSectionId+enrollmentStatus], deletedAt',
      studentAssessments: 'id, assessmentId, classEnrollmentId, &[assessmentId+classEnrollmentId], workflowStatus, completionStatus, isLate, deletedAt',
      categoryResults: 'id, studentAssessmentId, assessmentCategoryId, &[studentAssessmentId+assessmentCategoryId], deletedAt',
      participationEvents: 'id, classEnrollmentId, classSectionId, occurredAt, deletedAt',
      syncMutations: 'id, deviceId, &mutationId, transactionId, entityName, entityId, createdAt, acknowledgedAt'
    });

    await v1Db.open();

    const now = new Date().toISOString();
    const targetOrgId = 'org-pcss-target';

    await v1Db.table('courses').add({
      id: 'course-1',
      organizationId: targetOrgId,
      code: 'ENG4U',
      title: 'English 12',
      department: 'English',
      gradeLevel: 12,
      creditValue: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await v1Db.table('classSections').add({
      id: 'section-1',
      courseId: 'course-1',
      termId: 'term-1',
      sectionNumber: '01',
      period: 'P1',
      roomNumber: '101',
      colorToken: '#3b82f6',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await v1Db.table('classEnrollments').add({
      id: 'enr-1',
      classSectionId: 'section-1',
      studentId: 'std-1',
      enrollmentStatus: 'active',
      enrolledDate: '2026-09-02',
      droppedDate: null,
      customDisplayOrder: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await v1Db.table('studentAssessments').add({
      id: 'sa-1',
      assessmentId: 'assess-1',
      classEnrollmentId: 'enr-1',
      workflowStatus: 'assessed',
      completionStatus: 'complete',
      isLate: false,
      assignedAt: now,
      dueAt: now,
      submittedAt: now,
      assessedAt: now,
      returnedAt: now,
      overallFeedback: null,
      privateNotes: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await v1Db.table('categoryResults').add({
      id: 'cr-1',
      studentAssessmentId: 'sa-1',
      assessmentCategoryId: 'cat-1',
      rawScore: '85%',
      inputFormat: 'percentage',
      normalizedPercentage: 85,
      pointsEarned: 85,
      pointsPossibleSnapshot: 100,
      feedback: null,
      assessedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    await v1Db.table('participationEvents').add({
      id: 'pe-1',
      classEnrollmentId: 'enr-1',
      classSectionId: 'section-1',
      occurredAt: now,
      deletedAt: null
    });

    // Populate v1 mutations:
    // 1. Resolvable & Acknowledged
    await v1Db.table('syncMutations').add({
      id: 'mut-ack',
      deviceId: 'dev-1',
      mutationId: 'm-ack',
      transactionId: 'tx-1',
      entityName: 'categoryResults',
      entityId: 'cr-1',
      createdAt: now,
      acknowledgedAt: now
    });

    // 2. Resolvable & Pending (acknowledgedAt is null)
    await v1Db.table('syncMutations').add({
      id: 'mut-pend',
      deviceId: 'dev-1',
      mutationId: 'm-pend',
      transactionId: 'tx-2',
      entityName: 'participationEvents',
      entityId: 'pe-1',
      createdAt: now,
      acknowledgedAt: null
    });

    // 3. Orphan mutation (entity does not exist)
    await v1Db.table('syncMutations').add({
      id: 'mut-orphan',
      deviceId: 'dev-1',
      mutationId: 'm-orphan',
      transactionId: 'tx-3',
      entityName: 'categoryResults',
      entityId: 'cr-nonexistent',
      createdAt: now,
      acknowledgedAt: null
    });

    v1Db.close();

    // 2. Open via OntarioTeacherDB which declares version(2) with .upgrade()
    const v2Db = new OntarioTeacherDB(dbName);
    await v2Db.open();

    // Verify Resolvable & Acknowledged
    const mutAck = await v2Db.syncMutations.get('mut-ack');
    expect(mutAck).toBeDefined();
    expect(mutAck!.organizationId).toBe(targetOrgId);
    expect(mutAck!.status).toBe('acknowledged');

    // Verify Resolvable & Pending
    const mutPend = await v2Db.syncMutations.get('mut-pend');
    expect(mutPend).toBeDefined();
    expect(mutPend!.organizationId).toBe(targetOrgId);
    expect(mutPend!.status).toBe('pending');

    // Verify Orphan Quarantine
    const mutOrphan = await v2Db.syncMutations.get('mut-orphan');
    expect(mutOrphan).toBeDefined();
    expect(mutOrphan!.status).toBe('failed');
    expect(mutOrphan!.lastError).toContain('QUARANTINED_ORPHAN_MUTATION');

    // Verify studentAssessments classSectionId backfill
    const migratedSa = await v2Db.studentAssessments.get('sa-1');
    expect(migratedSa!.classSectionId).toBe('section-1');

    v2Db.close();
  });

  it('correctly migrates v2 to v3: backfills v3 fields, rebuilds daily summaries with multiple classifications and neutral events, deletes stale summaries, and preserves null eventTypeId', async () => {
    const dbName = `migration-v3-test-${Date.now()}`;

    // 1. Open database at version 2 and populate legacy records
    const v2Db = new Dexie(dbName);
    v2Db.version(1).stores({
      organizations: 'id, parentOrganizationId, parentScopeKey, organizationType, &[parentScopeKey+code], deletedAt',
      users: 'id, &authSubject, &email, deletedAt',
      organizationMemberships: 'id, organizationId, userId, &[organizationId+userId], deletedAt',
      classSectionStaff: 'id, classSectionId, organizationMembershipId, &[classSectionId+organizationMembershipId], deletedAt',
      devices: 'id, userId, installationId, &[userId+installationId]',
      userPreferences: 'id, &userId',
      academicYears: 'id, organizationId, isCurrent, &[organizationId+name], deletedAt',
      terms: 'id, academicYearId, code, &[academicYearId+code], deletedAt',
      reportingPeriods: 'id, termId, sequenceNumber, &[termId+sequenceNumber], deletedAt',
      courses: 'id, organizationId, code, &[organizationId+code], deletedAt',
      classSections: 'id, courseId, termId, &[courseId+termId+sectionNumber], deletedAt',
      units: 'id, classSectionId, code, &[classSectionId+code], sortOrder, deletedAt',
      classSessions: 'id, classSectionId, localSchoolDate, startsAt, deletedAt',
      students: 'id, organizationId, localStudentNumber, &[organizationId+localStudentNumber], lastName, deletedAt',
      classEnrollments: 'id, classSectionId, studentId, &[classSectionId+studentId], [classSectionId+enrollmentStatus], deletedAt',
      attendanceRecords: 'id, classEnrollmentId, classSessionId, localSchoolDate, &[classEnrollmentId+classSessionId], deletedAt',
      seatingLayouts: 'id, classSectionId, deletedAt',
      seatPositions: 'id, seatingLayoutId, classEnrollmentId, &[seatingLayoutId+row+col], &[seatingLayoutId+classEnrollmentId], deletedAt',
      markScaleFamilies: 'id, organizationId, code, &[organizationId+code], deletedAt',
      markScaleVersions: 'id, markScaleFamilyId, revision, &[markScaleFamilyId+revision], deletedAt',
      markScaleEntries: 'id, markScaleVersionId, code, &[markScaleVersionId+code], sortOrder',
      gradingPolicies: 'id, classSectionId, scopeKey, &[classSectionId+scopeKey], deletedAt',
      gradeOverrides: 'id, classEnrollmentId, reportingPeriodId, categoryCode, &[classEnrollmentId+reportingPeriodId+categoryCode], deletedAt',
      gradeSnapshots: 'id, classEnrollmentId, reportingPeriodId, revision, &[classEnrollmentId+reportingPeriodId+revision]',
      assessments: 'id, classSectionId, unitId, reportingPeriodId, code, &[classSectionId+code], dueDate, deletedAt',
      assessmentCategories: 'id, assessmentId, categoryCode, &[assessmentId+categoryCode], deletedAt',
      studentAssessments: 'id, assessmentId, classEnrollmentId, classSectionId, &[assessmentId+classEnrollmentId], workflowStatus, completionStatus, isLate, [classSectionId+deletedAt], deletedAt',
      categoryResults: 'id, studentAssessmentId, assessmentCategoryId, &[studentAssessmentId+assessmentCategoryId], [assessmentCategoryId+deletedAt], deletedAt',
      participationEventTypes: 'id, organizationId, code, &[organizationId+code], classification, isArchived, deletedAt',
      participationEvents: 'id, classEnrollmentId, classSectionId, classSessionId, eventTypeId, studentAssessmentId, batchId, localSchoolDate, occurredAt, [classEnrollmentId+localSchoolDate], [classSectionId+localSchoolDate], [classSectionId+occurredAt], [classSessionId+occurredAt], [eventTypeId+occurredAt], [batchId+occurredAt], deletedAt',
      participationDailySummaries: 'id, classEnrollmentId, localSchoolDate, &[classEnrollmentId+localSchoolDate]',
      studentNotes: 'id, classEnrollmentId, authorUserId, isConfidential, deletedAt',
      auditEntries: 'id, entityName, entityId, transactionId, timestamp, [entityName+entityId]',
      syncMutations: 'id, deviceId, &mutationId, transactionId, organizationId, status, entityName, entityId, createdAt, [deviceId+organizationId+status]',
      syncCursors: 'id, deviceId, organizationId, &[deviceId+organizationId]'
    });
    v2Db.version(2).stores({});

    await v2Db.open();

    const now = new Date().toISOString();
    const targetDate = '2026-09-10';

    // Legacy event type without v3 fields (no recordingMode, defaultCategoryCode, sortOrder)
    await v2Db.table('participationEventTypes').add({
      id: 'pet-legacy-1',
      organizationId: 'org-1',
      code: 'LEGACY_TYPE',
      name: 'Legacy Type',
      icon: 'Star',
      color: '#10b981',
      classification: 'positive',
      defaultPoints: 2.0,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Populate events on student-1:
    // Event 1: Positive, points 2.0, historical eventTypeId: null (MUST remain null)
    await v2Db.table('participationEvents').add({
      id: 'pe-hist-1',
      classEnrollmentId: 'enr-1',
      classSectionId: 'sec-1',
      classSessionId: 'sess-1',
      eventTypeId: null,
      snapshottedName: 'Old Positive Discussion',
      snapshottedClassification: 'positive',
      snapshottedPoints: 2.0,
      categoryCode: 'C',
      localSchoolDate: targetDate,
      occurredAt: `${targetDate}T10:00:00.000Z`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Event 2: Neutral, points 0.0, historical eventTypeId: null
    await v2Db.table('participationEvents').add({
      id: 'pe-hist-2',
      classEnrollmentId: 'enr-1',
      classSectionId: 'sec-1',
      classSessionId: 'sess-1',
      eventTypeId: null,
      snapshottedName: 'Old Neutral Observation',
      snapshottedClassification: 'neutral',
      snapshottedPoints: 0.0,
      categoryCode: null,
      localSchoolDate: targetDate,
      occurredAt: `${targetDate}T10:15:00.000Z`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Event 3: Needs Followup, points -1.0
    await v2Db.table('participationEvents').add({
      id: 'pe-hist-3',
      classEnrollmentId: 'enr-1',
      classSectionId: 'sec-1',
      classSessionId: 'sess-1',
      eventTypeId: 'pet-offtask',
      snapshottedName: 'Off task',
      snapshottedClassification: 'needs_followup',
      snapshottedPoints: -1.0,
      categoryCode: null,
      localSchoolDate: targetDate,
      occurredAt: `${targetDate}T10:30:00.000Z`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Event 4: Soft-deleted event (must NOT be counted in daily summary)
    await v2Db.table('participationEvents').add({
      id: 'pe-hist-4-deleted',
      classEnrollmentId: 'enr-1',
      classSectionId: 'sec-1',
      classSessionId: 'sess-1',
      eventTypeId: null,
      snapshottedName: 'Deleted Event',
      snapshottedClassification: 'positive',
      snapshottedPoints: 5.0,
      categoryCode: null,
      localSchoolDate: targetDate,
      occurredAt: `${targetDate}T10:45:00.000Z`,
      createdAt: now,
      updatedAt: now,
      deletedAt: `${targetDate}T11:00:00.000Z`,
      version: 2
    });

    // Event 5: Event for student-2 on same date (missing summary)
    await v2Db.table('participationEvents').add({
      id: 'pe-hist-5',
      classEnrollmentId: 'enr-2',
      classSectionId: 'sec-1',
      classSessionId: 'sess-1',
      eventTypeId: null,
      snapshottedName: 'Independent reading check',
      snapshottedClassification: 'neutral',
      snapshottedPoints: 0.0,
      categoryCode: null,
      localSchoolDate: targetDate,
      occurredAt: `${targetDate}T10:20:00.000Z`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Stale summary for student-1: had outdated points (99) and counts
    await v2Db.table('participationDailySummaries').add({
      id: 'summary-enr-1-targetDate',
      classEnrollmentId: 'enr-1',
      localSchoolDate: targetDate,
      totalPoints: 99,
      positiveCount: 99,
      needsFollowupCount: 0,
      lastEventAt: `${targetDate}T09:00:00.000Z`,
      updatedAt: now
    });

    // Stale orphaned summary for non-existent / empty student-3: must be purged
    await v2Db.table('participationDailySummaries').add({
      id: 'summary-enr-3-stale',
      classEnrollmentId: 'enr-3',
      localSchoolDate: targetDate,
      totalPoints: 10,
      positiveCount: 5,
      needsFollowupCount: 0,
      lastEventAt: `${targetDate}T09:00:00.000Z`,
      updatedAt: now
    });

    v2Db.close();

    // 2. Open via OntarioTeacherDB which declares version(3) with .upgrade()
    const v3Db = new OntarioTeacherDB(dbName);
    await v3Db.open();

    // Verify event types backfilled
    const migratedType = await v3Db.participationEventTypes.get('pet-legacy-1');
    expect(migratedType).toBeDefined();
    expect(migratedType!.recordingMode).toBe('quick_tally');
    expect(migratedType!.defaultCategoryCode).toBeNull();
    expect(typeof migratedType!.sortOrder).toBe('number');

    // Verify historical events: eventTypeId remains strictly null, snapshottedRecordingMode backfilled
    const ev1 = await v3Db.participationEvents.get('pe-hist-1');
    expect(ev1!.eventTypeId).toBeNull();
    expect(ev1!.snapshottedRecordingMode).toBe('quick_tally');
    expect(ev1!.achievementLevel).toBeNull();
    expect(ev1!.snapshottedPoints).toBe(2.0);

    const ev2 = await v3Db.participationEvents.get('pe-hist-2');
    expect(ev2!.eventTypeId).toBeNull();
    expect(ev2!.snapshottedRecordingMode).toBe('quick_tally');
    expect(ev2!.achievementLevel).toBeNull();
    expect(ev2!.snapshottedClassification).toBe('neutral');

    // Verify daily summary for student-1 on targetDate:
    // Existing summary ID must be preserved
    const summary1 = await v3Db.participationDailySummaries
      .where({ classEnrollmentId: 'enr-1', localSchoolDate: targetDate })
      .first();
    expect(summary1).toBeDefined();
    expect(summary1!.id).toBe('summary-enr-1-targetDate');
    expect(summary1!.positiveCount).toBe(1);
    expect(summary1!.neutralCount).toBe(1);
    expect(summary1!.needsFollowupCount).toBe(1);
    expect(summary1!.totalPoints).toBe(1.0); // 2.0 (ev1) + 0.0 (ev2) + -1.0 (ev3) = 1.0 (ev4 excluded)
    expect(summary1!.lastEventAt).toBe(`${targetDate}T10:30:00.000Z`);

    // Verify missing summary for student-2 was created
    const summary2 = await v3Db.participationDailySummaries
      .where({ classEnrollmentId: 'enr-2', localSchoolDate: targetDate })
      .first();
    expect(summary2).toBeDefined();
    expect(summary2!.positiveCount).toBe(0);
    expect(summary2!.neutralCount).toBe(1);
    expect(summary2!.needsFollowupCount).toBe(0);
    expect(summary2!.totalPoints).toBe(0.0);

    // Verify stale orphaned summary for student-3 was purged
    const summary3 = await v3Db.participationDailySummaries
      .where({ classEnrollmentId: 'enr-3', localSchoolDate: targetDate })
      .first();
    expect(summary3).toBeUndefined();

    v3Db.close();
  });
});
