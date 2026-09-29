import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService, type CandidateStudentRow } from './portabilityService';
import { parseRosterText } from './rosterParser';

describe('Roster Conflict, In-Transaction Validation & Mutation Sizing Suite', () => {
  let db: OntarioTeacherDB;
  let portability: PortabilityService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-conflict-${crypto.randomUUID()}`);
    await seedDatabase(db);
    portability = new PortabilityService(db);
  });

  it('detects intra-batch duplicate student numbers during candidate validation', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const paste = `Smith, Jordan\t0010981\nSmith, Jordan\t0010981`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    expect(candidates.length).toBe(2);
    expect(candidates[1].status).toBe('error');
    expect(candidates[1].error).toContain('Duplicate student number "0010981"');
  });

  it('flags existing student number with conflicting name as a blocking error', async () => {
    const section = (await db.classSections.toCollection().first())!;
    // Avery Jordan is student S10482 in seed
    const paste = `ConflictingLastName, OtherFirst\tS10482`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    expect(candidates.length).toBe(1);
    expect(candidates[0].status).toBe('error');
    expect(candidates[0].error).toContain('Name conflict: Student number S10482');
  });

  it('marks existing student already enrolled in section as already_enrolled', async () => {
    const section = (await db.classSections.toCollection().first())!;
    // Avery Jordan is already enrolled in section 1
    const paste = `Avery, Jordan\tS10482`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    expect(candidates.length).toBe(1);
    expect(candidates[0].status).toBe('already_enrolled');
    expect(candidates[0].warning).toContain('Already in this class');
  });

  it('marks existing unenrolled student as existing_enrolling', async () => {
    // Create section 2 in same organization
    const section1 = (await db.classSections.toCollection().first())!;
    const section2Id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.classSections.add({
      id: section2Id,
      courseId: section1.courseId,
      termId: section1.termId,
      sectionNumber: '02',
      period: 'Period 2',
      roomNumber: '205',
      colorToken: '#2563eb',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Avery Jordan exists in org, but is not enrolled in section 2
    const paste = `Avery, Jordan\tS10482`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section2Id, parsed.rows);

    expect(candidates.length).toBe(1);
    expect(candidates[0].status).toBe('existing_enrolling');
    expect(candidates[0].existingStudentId).toBeDefined();
  });

  it('aborts import batch if any candidate has a blocking error', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const candidates: CandidateStudentRow[] = [
      {
        rowNumber: 1,
        rawText: 'Smith, Jordan\t0010981',
        firstName: 'Jordan',
        lastName: 'Smith',
        studentNumber: '0010981',
        status: 'new',
        error: null,
        warning: null
      },
      {
        rowNumber: 2,
        rawText: 'Bad, Row\tS10482',
        firstName: 'Row',
        lastName: 'Bad',
        studentNumber: 'S10482',
        status: 'error',
        error: 'Conflicting name in database',
        warning: null
      }
    ];

    await expect(
      portability.importRosterBatch({
        classSectionId: section.id,
        rows: candidates,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow('Cannot import class list with blocking errors');
  });

  it('re-verifies conflicts in-transaction and rolls back if database state changed before confirmation', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const paste = `Concurrent, Student\t0099999`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);
    expect(candidates[0].status).toBe('new');

    const course = (await db.courses.get(section.courseId))!;
    const orgId = course.organizationId;

    // Simulate concurrent tab inserting a conflicting student with same number 0099999 before confirmation
    const now = new Date().toISOString();
    await db.students.add({
      id: crypto.randomUUID(),
      organizationId: orgId,
      localStudentNumber: '0099999',
      firstName: 'Different',
      lastName: 'Name',
      preferredName: null,
      pronouns: null,
      oenEncrypted: null,
      photoUrl: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // In-transaction re-check must catch this and abort
    await expect(
      portability.importRosterBatch({
        classSectionId: section.id,
        rows: candidates,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow('Transaction aborted due to name conflict: Student number "0099999"');
  });

  it('calculates exact mathematical SyncMutation.transactionSize for mixed new and existing students', async () => {
    // Create new section 2
    const section1 = (await db.classSections.toCollection().first())!;
    const section2Id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.classSections.add({
      id: section2Id,
      courseId: section1.courseId,
      termId: section1.termId,
      sectionNumber: '03',
      period: 'Period 3',
      roomNumber: '206',
      colorToken: '#2563eb',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Assign user-tyler to section2
    const staff1 = (await db.classSectionStaff.where('classSectionId').equals(section1.id).first())!;
    await db.classSectionStaff.add({
      id: crypto.randomUUID(),
      classSectionId: section2Id,
      organizationMembershipId: staff1.organizationMembershipId,
      role: 'primary_teacher',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // 1 brand new student (2 mutations: student + enrollment)
    // 1 existing student (1 mutation: enrollment)
    // Total exact mutations = 2 + 1 = 3
    const paste = `BrandNew, Kid\t0088888\nAvery, Jordan\tS10482`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section2Id, parsed.rows);

    expect(candidates[0].status).toBe('new');
    expect(candidates[1].status).toBe('existing_enrolling');

    const result = await portability.importRosterBatch({
      classSectionId: section2Id,
      rows: candidates,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(result.importedCount).toBe(2);
    expect(result.newStudentsCount).toBe(1);
    expect(result.existingLinkedCount).toBe(1);

    // Verify all sync mutations produced by this import transaction
    const mutations = await db.syncMutations
      .where('entityName')
      .anyOf(['students', 'classEnrollments'])
      .toArray();

    const newStudentMut = mutations.find(m => m.entityName === 'students');
    expect(newStudentMut).toBeDefined();
    expect(newStudentMut!.transactionSize).toBe(3); // EXACT transactionSize = 3

    const enrollMutations = mutations.filter(m => m.entityName === 'classEnrollments');
    for (const em of enrollMutations) {
      expect(em.transactionSize).toBe(3); // Every mutation in this tx reports exact size 3
    }
  });

  it('rejects unauthorized teacher import via assertClassSectionWriteAccess inside transaction', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const paste = `Test, Student\t0077777`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    // Provide user with no staff role for this section
    await expect(
      portability.importRosterBatch({
        classSectionId: section.id,
        rows: candidates,
        userId: 'unassigned-user-id',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow();
  });

  it('successfully previews and re-imports previously dropped student without unique-index ConstraintError and preserves history', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const student = (await db.students.toCollection().first())!;
    const originalEnrollment = (await db.classEnrollments
      .where({ classSectionId: section.id, studentId: student.id })
      .first())!;

    // 1. Attach historical data to this enrollment (attendance, notes)
    const now = new Date().toISOString();
    const noteId = crypto.randomUUID();
    await db.studentNotes.add({
      id: noteId,
      classEnrollmentId: originalEnrollment.id,
      authorUserId: 'user-tyler',
      content: 'Important historical note for student.',
      isConfidential: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const attId = crypto.randomUUID();
    await db.attendanceRecords.add({
      id: attId,
      classEnrollmentId: originalEnrollment.id,
      classSessionId: 'sess-test',
      localSchoolDate: '2026-09-08',
      status: 'present',
      reason: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // 2. Mark this student's enrollment as dropped
    await db.classEnrollments.update(originalEnrollment.id, {
      enrollmentStatus: 'dropped',
      droppedDate: '2026-09-12',
      updatedAt: now
    });

    const droppedEnrollment = (await db.classEnrollments.get(originalEnrollment.id))!;
    expect(droppedEnrollment.enrollmentStatus).toBe('dropped');

    // 3. Re-import roster containing this student
    const paste = `${student.lastName}, ${student.firstName}\t${student.localStudentNumber}`;
    const parsed = parseRosterText(paste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    // Preview assertions:
    expect(candidates.length).toBe(1);
    expect(candidates[0].status).toBe('existing_enrolling');
    expect(candidates[0].warning).toContain('Re-enrolling previously dropped student (historical attendance and marks preserved).');
    expect(candidates[0].existingStudentId).toBe(student.id);

    // 4. Run importRosterBatch
    const importResult = await portability.importRosterBatch({
      classSectionId: section.id,
      rows: candidates,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(importResult.importedCount).toBe(1);
    expect(importResult.newStudentsCount).toBe(0);
    expect(importResult.existingLinkedCount).toBe(1);
    expect(importResult.skippedDuplicates).toBe(0);

    // 5. Verify enrollment is reactivated with preserved ID (no ConstraintError occurred!)
    const reactivatedEnrollment = (await db.classEnrollments.get(originalEnrollment.id))!;
    expect(reactivatedEnrollment.enrollmentStatus).toBe('active');
    expect(reactivatedEnrollment.droppedDate).toBeNull();
    expect(reactivatedEnrollment.studentId).toBe(student.id);
    expect(reactivatedEnrollment.classSectionId).toBe(section.id);

    // 6. Verify historical records remain fully preserved and attached
    const note = await db.studentNotes.get(noteId);
    expect(note).toBeDefined();
    expect(note!.classEnrollmentId).toBe(originalEnrollment.id);

    const att = await db.attendanceRecords.get(attId);
    expect(att).toBeDefined();
    expect(att!.classEnrollmentId).toBe(originalEnrollment.id);
  });
});
