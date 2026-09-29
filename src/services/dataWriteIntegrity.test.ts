import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { MarkbookDomainService } from './markbookService';
import { StudentDomainService } from './studentService';
import { PortabilityService } from './portabilityService';
import { AuthorizationError } from './authHelper';
import { resolveActiveTeacher, setActiveTeacherId, clearActiveTeacherId } from './identityService';

describe('V6 Data-Write Integrity & Domain Services Suite', () => {
  let db: OntarioTeacherDB;
  let markbookService: MarkbookDomainService;
  let studentService: StudentDomainService;
  let portabilityService: PortabilityService;

  const AUTHORIZED_TEACHER_ID = 'user-tyler';
  const UNAUTHORIZED_TEACHER_ID = 'teacher-unauthorized';
  const DEVICE_ID = 'device-test-01';

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-datawrite-${crypto.randomUUID()}`);
    await seedDatabase(db);

    markbookService = new MarkbookDomainService(db);
    studentService = new StudentDomainService(db);
    portabilityService = new PortabilityService(db);

    // Create unauthorized teacher account (with membership in org, but NO assignment to class-eng4u-01)
    const now = new Date().toISOString();
    await db.users.add({
      id: UNAUTHORIZED_TEACHER_ID,
      authSubject: 'auth0|unauthorized-teacher',
      email: 'unauthorized@example.invalid',
      name: 'Unauthorized Teacher',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const org = (await db.organizations.toCollection().first())!;
    await db.organizationMemberships.add({
      id: `mem-${UNAUTHORIZED_TEACHER_ID}`,
      organizationId: org.id,
      userId: UNAUTHORIZED_TEACHER_ID,
      role: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });
  });

  afterEach(() => {
    clearActiveTeacherId();
  });

  it('handles first save and second save of a grade override under the same ID without ConstraintError', async () => {
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    const reportingPeriodId = 'rp-midterm';
    const categoryCode = 'OVERALL';

    const initialAuditCount = await db.auditEntries.count();
    const initialSyncCount = await db.syncMutations.count();

    // 1. First save: should INSERT new override with version 1
    const ov1 = await markbookService.saveGradeOverride({
      classEnrollmentId: enrollment.id,
      reportingPeriodId,
      categoryCode,
      overridePercentage: 88,
      rationale: 'Strong performance on oral seminar and term portfolio.',
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    expect(ov1.id).toBeDefined();
    expect(ov1.version).toBe(1);
    expect(ov1.overridePercentage).toBe(88);
    expect(ov1.teacherUserId).toBe(AUTHORIZED_TEACHER_ID);

    // Verify exactly one record exists in DB
    const stored1 = await db.gradeOverrides.get(ov1.id);
    expect(stored1).toBeDefined();
    expect(stored1!.version).toBe(1);
    expect(stored1!.overridePercentage).toBe(88);

    // Verify audit entry for INSERT
    expect(await db.auditEntries.count()).toBe(initialAuditCount + 1);
    const audit1 = await db.auditEntries.where({ entityName: 'gradeOverrides', entityId: ov1.id }).first();
    expect(audit1).toBeDefined();
    expect(audit1!.action).toBe('INSERT');

    // Verify sync mutation for INSERT
    expect(await db.syncMutations.count()).toBe(initialSyncCount + 1);
    const sync1 = await db.syncMutations.where({ entityName: 'gradeOverrides', entityId: ov1.id }).first();
    expect(sync1).toBeDefined();
    expect(sync1!.operation).toBe('INSERT');
    expect(sync1!.baseVersion).toBe(0);

    // 2. Second save: should UPDATE existing override under the SAME ID (no ConstraintError!)
    const ov2 = await markbookService.saveGradeOverride({
      classEnrollmentId: enrollment.id,
      reportingPeriodId,
      categoryCode,
      overridePercentage: 93,
      rationale: 'Revised upward after culminating inquiry resubmission.',
      expectedVersion: 1,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    // ID must be preserved
    expect(ov2.id).toBe(ov1.id);
    // Version must increment to 2
    expect(ov2.version).toBe(2);
    expect(ov2.overridePercentage).toBe(93);
    expect(ov2.createdAt).toBe(ov1.createdAt);

    // Total gradeOverrides records for this enrollment/period/category MUST still be 1 (not duplicated)
    const matchingOverrides = await db.gradeOverrides
      .where({
        classEnrollmentId: enrollment.id,
        reportingPeriodId,
        categoryCode
      })
      .toArray();
    expect(matchingOverrides.length).toBe(1);
    expect(matchingOverrides[0].id).toBe(ov1.id);
    expect(matchingOverrides[0].overridePercentage).toBe(93);
    expect(matchingOverrides[0].version).toBe(2);

    // Verify audit entry for UPDATE
    expect(await db.auditEntries.count()).toBe(initialAuditCount + 2);
    const audit2 = await db.auditEntries
      .where({ entityName: 'gradeOverrides', entityId: ov1.id })
      .filter(a => a.action === 'UPDATE')
      .first();
    expect(audit2).toBeDefined();
    const diff = JSON.parse(audit2!.diffJson!);
    expect(diff.overridePercentage.old).toBe(88);
    expect(diff.overridePercentage.new).toBe(93);

    // Verify sync mutation for UPDATE
    expect(await db.syncMutations.count()).toBe(initialSyncCount + 2);
    const sync2 = await db.syncMutations
      .where({ entityName: 'gradeOverrides', entityId: ov1.id })
      .filter(m => m.operation === 'UPDATE')
      .first();
    expect(sync2).toBeDefined();
    expect(sync2!.baseVersion).toBe(1);
  });

  it('handles repeated Markbook actions: initial score, score revision, and status-only toggle atomically', async () => {
    const assessment = (await db.assessments.where('classSectionId').equals('class-eng4u-01').first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;

    // Action 1: Initial markbook entry with score and completion status
    const res1 = await markbookService.saveMarkbookCell({
      assessmentId: assessment.id,
      classEnrollmentId: enrollment.id,
      classSectionId: 'class-eng4u-01',
      completionStatus: 'complete',
      isLate: false,
      assessmentCategoryId: category.id,
      rawScore: '80%',
      inputFormat: 'percentage',
      feedback: 'Good initial draft.',
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    expect(res1.studentAssessment.id).toBeDefined();
    expect(res1.studentAssessment.workflowStatus).toBe('assessed');
    expect(res1.studentAssessment.completionStatus).toBe('complete');
    expect(res1.studentAssessment.isLate).toBe(false);
    expect(res1.categoryResult).toBeDefined();
    expect(res1.categoryResult!.normalizedPercentage).toBe(80);

    const saId = res1.studentAssessment.id;
    const crId = res1.categoryResult!.id;

    // Action 2: Revision of score on the same cell
    const res2 = await markbookService.saveMarkbookCell({
      assessmentId: assessment.id,
      classEnrollmentId: enrollment.id,
      classSectionId: 'class-eng4u-01',
      completionStatus: 'complete',
      isLate: false,
      assessmentCategoryId: category.id,
      rawScore: '92%',
      inputFormat: 'percentage',
      feedback: 'Significant revision in argument clarity.',
      expectedStudentAssessmentVersion: res1.studentAssessment.version,
      expectedCategoryResultVersion: res1.categoryResult!.version,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    expect(res2.studentAssessment.id).toBe(saId);
    expect(res2.studentAssessment.version).toBe(res1.studentAssessment.version + 1);
    expect(res2.categoryResult!.id).toBe(crId);
    expect(res2.categoryResult!.version).toBe(res1.categoryResult!.version + 1);
    expect(res2.categoryResult!.normalizedPercentage).toBe(92);

    // Action 3: Status-only toggle (no score entered)
    const res3 = await markbookService.saveMarkbookCell({
      assessmentId: assessment.id,
      classEnrollmentId: enrollment.id,
      classSectionId: 'class-eng4u-01',
      completionStatus: 'excused',
      isLate: true,
      rawScore: '',
      expectedStudentAssessmentVersion: res2.studentAssessment.version,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    expect(res3.studentAssessment.id).toBe(saId);
    expect(res3.studentAssessment.version).toBe(res2.studentAssessment.version + 1);
    expect(res3.studentAssessment.completionStatus).toBe('excused');
    expect(res3.studentAssessment.isLate).toBe(true);
    expect(res3.categoryResult).toBeUndefined();

    // Verify existing categoryResult was not wiped
    const currentCr = await db.categoryResults.get(crId);
    expect(currentCr).toBeDefined();
    expect(currentCr!.normalizedPercentage).toBe(92);
  });

  it('creates student note with in-transaction authorization, audit log, and sync mutation', async () => {
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;

    const note = await studentService.createStudentNote({
      classEnrollmentId: enrollment.id,
      content: 'Student demonstrated advanced critical thinking during the dialectical seminar.',
      isConfidential: true,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    expect(note.id).toBeDefined();
    expect(note.authorUserId).toBe(AUTHORIZED_TEACHER_ID);
    expect(note.classEnrollmentId).toBe(enrollment.id);
    expect(note.version).toBe(1);

    // Verify stored record
    const stored = await db.studentNotes.get(note.id);
    expect(stored).toBeDefined();
    expect(stored!.content).toContain('dialectical seminar');

    // Verify audit entry in same transaction
    const audit = await db.auditEntries.where({ entityName: 'studentNotes', entityId: note.id }).first();
    expect(audit).toBeDefined();
    expect(audit!.action).toBe('INSERT');
    expect(audit!.userId).toBe(AUTHORIZED_TEACHER_ID);

    // Verify sync mutation in same transaction
    const sync = await db.syncMutations.where({ entityName: 'studentNotes', entityId: note.id }).first();
    expect(sync).toBeDefined();
    expect(sync!.operation).toBe('INSERT');
    expect(sync!.deviceId).toBe(DEVICE_ID);
  });

  it('rejects unauthorized teacher attempts and leaves data, audit, and sync records completely unchanged', async () => {
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    const assessment = (await db.assessments.where('classSectionId').equals('class-eng4u-01').first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;

    // Snapshot counts before unauthorized attempts
    const countOverridesBefore = await db.gradeOverrides.count();
    const countSABefore = await db.studentAssessments.count();
    const countCRBefore = await db.categoryResults.count();
    const countNotesBefore = await db.studentNotes.count();
    const countAuditBefore = await db.auditEntries.count();
    const countSyncBefore = await db.syncMutations.count();

    // 1. Unauthorized grade override attempt
    await expect(
      markbookService.saveGradeOverride({
        classEnrollmentId: enrollment.id,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 99,
        rationale: 'Hacked override',
        userId: UNAUTHORIZED_TEACHER_ID,
        deviceId: DEVICE_ID
      })
    ).rejects.toThrow(AuthorizationError);

    // 2. Unauthorized Markbook cell write attempt
    await expect(
      markbookService.saveMarkbookCell({
        assessmentId: assessment.id,
        classEnrollmentId: enrollment.id,
        classSectionId: 'class-eng4u-01',
        completionStatus: 'complete',
        isLate: false,
        assessmentCategoryId: category.id,
        rawScore: '100%',
        userId: UNAUTHORIZED_TEACHER_ID,
        deviceId: DEVICE_ID
      })
    ).rejects.toThrow(AuthorizationError);

    // 3. Unauthorized student note creation attempt
    await expect(
      studentService.createStudentNote({
        classEnrollmentId: enrollment.id,
        content: 'Unauthorized observation note',
        isConfidential: true,
        userId: UNAUTHORIZED_TEACHER_ID,
        deviceId: DEVICE_ID
      })
    ).rejects.toThrow(AuthorizationError);

    // Assert ALL table counts remain 100% unchanged
    expect(await db.gradeOverrides.count()).toBe(countOverridesBefore);
    expect(await db.studentAssessments.count()).toBe(countSABefore);
    expect(await db.categoryResults.count()).toBe(countCRBefore);
    expect(await db.studentNotes.count()).toBe(countNotesBefore);
    expect(await db.auditEntries.count()).toBe(countAuditBefore);
    expect(await db.syncMutations.count()).toBe(countSyncBefore);
  });

  it('exports valid full backup after all these write operations that validates and restores successfully', async () => {
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    const assessment = (await db.assessments.where('classSectionId').equals('class-eng4u-01').first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;

    // 1. Perform valid grade override (first save + second save)
    const ov = await markbookService.saveGradeOverride({
      classEnrollmentId: enrollment.id,
      reportingPeriodId: 'rp-midterm',
      categoryCode: 'OVERALL',
      overridePercentage: 85,
      rationale: 'Midterm override',
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    await markbookService.saveGradeOverride({
      classEnrollmentId: enrollment.id,
      reportingPeriodId: 'rp-midterm',
      categoryCode: 'OVERALL',
      overridePercentage: 91,
      rationale: 'Updated midterm override',
      expectedVersion: ov.version,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    // 2. Perform valid markbook cell write
    await markbookService.saveMarkbookCell({
      assessmentId: assessment.id,
      classEnrollmentId: enrollment.id,
      classSectionId: 'class-eng4u-01',
      completionStatus: 'complete',
      isLate: false,
      assessmentCategoryId: category.id,
      rawScore: '89%',
      inputFormat: 'percentage',
      feedback: 'Excellent synthesis',
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    // 3. Perform valid student note creation
    const note = await studentService.createStudentNote({
      classEnrollmentId: enrollment.id,
      content: 'Consistently demonstrates strong text-to-world connections.',
      isConfidential: true,
      userId: AUTHORIZED_TEACHER_ID,
      deviceId: DEVICE_ID
    });

    // 4. Export full backup
    const backupJson = await portabilityService.createFullBackupJSON();
    expect(backupJson.length).toBeGreaterThan(100);

    // 5. Pre-validate backup: must pass referential integrity and essential fields
    const meta = portabilityService.validateBackupJSON(backupJson);
    expect(meta.tableSummary.gradeOverrides).toBeGreaterThanOrEqual(1);
    expect(meta.tableSummary.studentNotes).toBeGreaterThanOrEqual(1);
    expect(meta.tableSummary.syncMutations).toBeGreaterThan(0);
    expect(meta.tableSummary.auditEntries).toBeGreaterThan(0);

    // 6. Restore into fresh database
    const freshDb = new OntarioTeacherDB(`test-fresh-write-restore-${crypto.randomUUID()}`);
    const freshPortability = new PortabilityService(freshDb);
    const restoreRes = await freshPortability.restoreFromJSON(backupJson);

    expect(restoreRes.restoredTables).toBeGreaterThan(20);
    expect(restoreRes.totalRecords).toBe(meta.totalRecords);

    // 7. Verify restored entities in fresh database
    const restoredOv = await freshDb.gradeOverrides.get(ov.id);
    expect(restoredOv).toBeDefined();
    expect(restoredOv!.version).toBe(2);
    expect(restoredOv!.overridePercentage).toBe(91);
    expect(restoredOv!.rationale).toContain('Updated midterm override');

    const restoredNote = await freshDb.studentNotes.get(note.id);
    expect(restoredNote).toBeDefined();
    expect(restoredNote!.content).toContain('text-to-world connections');

    const restoredSyncCount = await freshDb.syncMutations.count();
    expect(restoredSyncCount).toBe(meta.tableSummary.syncMutations);
  });
});
