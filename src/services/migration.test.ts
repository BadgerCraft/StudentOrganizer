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
});
