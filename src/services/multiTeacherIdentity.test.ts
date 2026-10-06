import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { resolveActiveTeacher, setActiveTeacherId, clearActiveTeacherId, getAppIdentity } from './identityService';
import { ParticipationDomainService } from './participationService';
import { ClassSessionService } from './sessionService';
import { AttendanceService } from './attendanceService';
import { StudentDomainService } from './studentService';
import { ClassDomainService } from './classService';
import { PortabilityService } from './portabilityService';
import { parseRosterText } from './rosterParser';

describe('Multi-Teacher Identity & Dynamic Authorization Suite', () => {
  let db: OntarioTeacherDB;
  let sessionService: ClassSessionService;
  let participationService: ParticipationDomainService;
  let attendanceService: AttendanceService;
  let studentService: StudentDomainService;
  let classService: ClassDomainService;
  let portabilityService: PortabilityService;

  const SECOND_TEACHER_ID = 'teacher-chen';
  const SECOND_TEACHER_EMAIL = 'jordan.demo@example.invalid';
  const SECOND_TEACHER_NAME = 'Jordan Demo';

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-identity-${crypto.randomUUID()}`);
    await seedDatabase(db);

    sessionService = new ClassSessionService(db);
    participationService = new ParticipationDomainService(db);
    attendanceService = new AttendanceService(db, sessionService);
    studentService = new StudentDomainService(db);
    classService = new ClassDomainService(db);
    portabilityService = new PortabilityService(db);

    // Seed second fictional teacher account
    const now = new Date().toISOString();
    await db.users.add({
      id: SECOND_TEACHER_ID,
      authSubject: 'auth0|chen-david',
      email: SECOND_TEACHER_EMAIL,
      name: SECOND_TEACHER_NAME,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Create organization membership for teacher-chen in the school
    const org = (await db.organizations.toCollection().first())!;
    const membershipId = `mem-${SECOND_TEACHER_ID}`;
    await db.organizationMemberships.add({
      id: membershipId,
      organizationId: org.id,
      userId: SECOND_TEACHER_ID,
      role: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Set active teacher in session storage to teacher-chen
    setActiveTeacherId(SECOND_TEACHER_ID);
  });

  afterEach(() => {
    clearActiveTeacherId();
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch (_) {}
  });

  it('dynamically resolves active teacher as teacher-chen without falling back to user-tyler', async () => {
    const activeTeacher = await resolveActiveTeacher(db);
    expect(activeTeacher.id).toBe(SECOND_TEACHER_ID);
    expect(activeTeacher.name).toBe(SECOND_TEACHER_NAME);

    const identity = await getAppIdentity(db);
    expect(identity.userId).toBe(SECOND_TEACHER_ID);
    expect(identity.deviceId).toBeDefined();
  });

  it('records and undoes participation under second fictional teacher account', async () => {
    const identity = await getAppIdentity(db);
    const org = (await db.organizations.toCollection().first())!;

    // Create class section assigned to teacher-chen
    const newSection = await classService.createClassSection({
      courseCode: 'ENG4U',
      courseTitle: 'Grade 12 English',
      sectionNumber: '09',
      period: 'Period 3',
      roomNumber: '310',
      colorToken: '#16a34a',
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    // Enroll a student in this section
    const student = (await db.students.toCollection().first())!;
    const enrollmentId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.classEnrollments.add({
      id: enrollmentId,
      classSectionId: newSection.id,
      studentId: student.id,
      enrollmentStatus: 'active',
      enrolledDate: now.slice(0, 10),
      droppedDate: null,
      customDisplayOrder: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Create session
    const session = await sessionService.getOrCreateSession(newSection.id, '2026-09-18');
    const eventType = (await db.participationEventTypes.toCollection().first())!;

    // Record participation under teacher-chen
    const events = await participationService.recordParticipation({
      classEnrollmentIds: [enrollmentId],
      classSectionId: newSection.id,
      classSessionId: session.id,
      eventTypeId: eventType.id,
      categoryOverride: 'C',
      note: 'Fictional QA evaluation note.',
      localSchoolDate: '2026-09-18',
      occurredAt: '2026-09-18T14:30:00.000Z',
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    expect(events.length).toBe(1);
    expect(events[0].createdByUserId).toBe(SECOND_TEACHER_ID);

    // Verify sync mutation logs teacher-chen's device
    const syncMut = await db.syncMutations
      .where('entityId')
      .equals(events[0].id)
      .first();
    expect(syncMut).toBeDefined();
    expect(syncMut!.deviceId).toBe(identity.deviceId);

    // Undo batch under teacher-chen
    const undoResult = await participationService.undoBatch(
      events[0].batchId,
      identity.userId,
      identity.deviceId
    );
    expect(undoResult.undoneCount).toBe(1);

    // Verify undo audit entry logs teacher-chen
    const undoAudits = await db.auditEntries
      .where('entityId')
      .equals(events[0].id)
      .filter(a => a.action === 'DELETE')
      .toArray();
    expect(undoAudits.length).toBeGreaterThanOrEqual(1);
    expect(undoAudits[0].userId).toBe(SECOND_TEACHER_ID);
  });

  it('updates student profile under second teacher account logging teacher-chen in audit', async () => {
    const identity = await getAppIdentity(db);
    const student = (await db.students.toCollection().first())!;

    // An unrelated teacher must be rejected, with no profile or audit writes.
    const request = { studentId: student.id, expectedVersion: student.version,
      firstName: student.firstName, lastName: student.lastName, preferredName: 'Johnny',
      pronouns: 'he/him', photoUrl: null, userId: identity.userId, deviceId: identity.deviceId };
    const auditBefore = await db.auditEntries.toArray();
    await expect(studentService.updateStudentProfile(request)).rejects.toThrow('Teacher cannot edit');
    expect(await db.students.get(student.id)).toEqual(student);
    expect(await db.auditEntries.toArray()).toEqual(auditBefore);
    const enrollment = (await db.classEnrollments.where('studentId').equals(student.id).first())!;
    const assignment = (await db.classSectionStaff.where('classSectionId').equals(enrollment.classSectionId).first())!;
    await db.classSectionStaff.add({ ...assignment, id: crypto.randomUUID(),
      organizationMembershipId: `mem-${SECOND_TEACHER_ID}`, role: 'co_teacher' });

    const updated = await studentService.updateStudentProfile({
      studentId: student.id,
      expectedVersion: student.version,
      firstName: student.firstName,
      lastName: student.lastName,
      preferredName: 'Johnny',
      pronouns: 'he/him',
      photoUrl: null,
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    expect(updated.preferredName).toBe('Johnny');

    // Verify audit entry logs teacher-chen
    const audits = await db.auditEntries
      .where('entityId')
      .equals(student.id)
      .toArray();
    const updateAudit = audits.find(a => a.action === 'UPDATE');
    expect(updateAudit).toBeDefined();
    expect(updateAudit!.userId).toBe(SECOND_TEACHER_ID);
  });

  it('toggles attendance under second teacher account logging teacher-chen in audit and sync', async () => {
    const identity = await getAppIdentity(db);

    // Create section for teacher-chen
    const section = await classService.createClassSection({
      courseCode: 'ENG4U',
      courseTitle: 'Grade 12 English',
      sectionNumber: '10',
      period: 'Period 4',
      roomNumber: '312',
      colorToken: '#9333ea',
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    // Enroll student
    const student = (await db.students.toCollection().first())!;
    const enrollmentId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.classEnrollments.add({
      id: enrollmentId,
      classSectionId: section.id,
      studentId: student.id,
      enrollmentStatus: 'active',
      enrolledDate: now.slice(0, 10),
      droppedDate: null,
      customDisplayOrder: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Toggle attendance
    const record = await attendanceService.toggleAttendance(
      section.id,
      enrollmentId,
      '2026-09-18',
      identity.userId,
      identity.deviceId
    );

    expect(record.status).toBe('absent');

    // Check audit entry has teacher-chen
    const audit = await db.auditEntries
      .where('entityId')
      .equals(record.id)
      .first();
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(SECOND_TEACHER_ID);
  });

  it('imports class roster under second teacher account and assigns audit to teacher-chen', async () => {
    const identity = await getAppIdentity(db);

    // Create section for teacher-chen
    const section = await classService.createClassSection({
      courseCode: 'ENG4U',
      courseTitle: 'Grade 12 English',
      sectionNumber: '11',
      period: 'Period 5',
      roomNumber: '314',
      colorToken: '#ea580c',
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    const paste = `Patel, Aarav\t9900111\nNguyen, Mai\t9900222`;
    const parsed = parseRosterText(paste);
    const candidates = await portabilityService.validateRosterCandidates(section.id, parsed.rows);

    const result = await portabilityService.importRosterBatch({
      classSectionId: section.id,
      rows: candidates,
      userId: identity.userId,
      deviceId: identity.deviceId
    });

    expect(result.importedCount).toBe(2);
    expect(result.newStudentsCount).toBe(2);

    // Verify all created audit entries log teacher-chen
    const importedStudent = await db.students.where('localStudentNumber').equals('9900111').first();
    expect(importedStudent).toBeDefined();

    const studentAudit = await db.auditEntries
      .where('entityId')
      .equals(importedStudent!.id)
      .first();
    expect(studentAudit).toBeDefined();
    expect(studentAudit!.userId).toBe(SECOND_TEACHER_ID);
  });
});
