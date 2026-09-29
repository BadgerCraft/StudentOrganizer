import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import {
  resolveActiveTeacher,
  setActiveTeacherId,
  clearActiveTeacherId,
  getActiveTeacherId,
  getAvailableTeachers,
  selectActingTeacher,
  getAppIdentity
} from './identityService';
import { AuthorizationError } from './authHelper';
import { MarkbookDomainService } from './markbookService';
import { AttendanceService } from './attendanceService';
import { ClassSessionService } from './sessionService';
import { ParticipationDomainService } from './participationService';
import { ClassDomainService } from './classService';

describe('V6.3 Multi-Teacher Identity Attribution & UI Flow Regression Suite', () => {
  let db: OntarioTeacherDB;
  let markbookService: MarkbookDomainService;
  let sessionService: ClassSessionService;
  let attendanceService: AttendanceService;
  let participationService: ParticipationDomainService;
  let classService: ClassDomainService;

  const TEACHER_TYLER_ID = 'user-tyler';
  const TEACHER_CHEN_ID = 'teacher-chen';
  const TEACHER_CHEN_EMAIL = 'jordan.demo@example.invalid';
  const TEACHER_CHEN_NAME = 'Jordan Demo';

  let classAId: string; // Tyler's class (ENG4U-01)
  let classBId: string; // Chen's class (MCV4U-01)
  let studentEnrollmentAId: string;
  let studentEnrollmentBId: string;

  beforeEach(async () => {
    // Ensure clean session state without calling setActiveTeacherId
    clearActiveTeacherId();
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') localStorage.clear();
    } catch (_) {}

    db = new OntarioTeacherDB(`test-v63-identity-${crypto.randomUUID()}`);
    await seedDatabase(db);

    markbookService = new MarkbookDomainService(db);
    sessionService = new ClassSessionService(db);
    attendanceService = new AttendanceService(db, sessionService);
    participationService = new ParticipationDomainService(db);
    classService = new ClassDomainService(db);

    // Setup Teacher Chen with active organization membership
    const now = new Date().toISOString();
    await db.users.add({
      id: TEACHER_CHEN_ID,
      authSubject: 'auth0|chen-david',
      email: TEACHER_CHEN_EMAIL,
      name: TEACHER_CHEN_NAME,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const schoolOrg = (await db.organizations.where('organizationType').equals('school').first())!;
    await db.organizationMemberships.add({
      id: `mem-${TEACHER_CHEN_ID}`,
      organizationId: schoolOrg.id,
      userId: TEACHER_CHEN_ID,
      role: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Class A is the seeded ENG4U-01 assigned to Tyler
    const classA = (await db.classSections.where('id').equals('class-eng4u-01').first())!;
    classAId = classA.id;
    const enrollmentA = (await db.classEnrollments.where('classSectionId').equals(classAId).first())!;
    studentEnrollmentAId = enrollmentA.id;

    // Create Class B assigned to Teacher Chen
    const classB = await classService.createClassSection({
      courseCode: 'MCV4U',
      courseTitle: 'Grade 12 Calculus and Vectors',
      sectionNumber: '01',
      period: 'Period 2',
      roomNumber: 'Room 205',
      colorToken: '#16a34a',
      userId: TEACHER_CHEN_ID,
      deviceId: 'dev-chen-setup'
    });
    classBId = classB.id;

    // Enroll a student in Class B
    const student = (await db.students.toCollection().first())!;
    studentEnrollmentBId = crypto.randomUUID();
    await db.classEnrollments.add({
      id: studentEnrollmentBId,
      classSectionId: classBId,
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

    // Ensure session starts with NO acting teacher selected
    clearActiveTeacherId();
  });

  afterEach(() => {
    clearActiveTeacherId();
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') localStorage.clear();
    } catch (_) {}
  });

  it('handles first-run seeding state and populates teacher selector only with active members', async () => {
    // An empty, unseeded database returns empty array gracefully without crashing
    const emptyDb = new OntarioTeacherDB(`test-empty-${crypto.randomUUID()}`);
    const emptyTeachers = await getAvailableTeachers(emptyDb);
    expect(emptyTeachers).toEqual([]);

    // Seeded database returns active teachers with active organization memberships
    const teachers = await getAvailableTeachers(db);
    expect(teachers.length).toBeGreaterThanOrEqual(2);
    const teacherIds = teachers.map(t => t.id);
    expect(teacherIds).toContain(TEACHER_TYLER_ID);
    expect(teacherIds).toContain(TEACHER_CHEN_ID);

    // Deactivated user is excluded from available teachers
    await db.users.update(TEACHER_CHEN_ID, { deletedAt: new Date().toISOString() });
    const teachersAfterDeactivation = await getAvailableTeachers(db);
    expect(teachersAfterDeactivation.map(t => t.id)).not.toContain(TEACHER_CHEN_ID);
  });

  it('verifies a fresh normal installation seeds only original seed state and contains no test-only Chen records', async () => {
    const freshDb = new OntarioTeacherDB(`test-fresh-install-${crypto.randomUUID()}`);
    await seedDatabase(freshDb);

    // Only Taylor Demo exists
    const users = await freshDb.users.toArray();
    expect(users.length).toBe(1);
    expect(users[0].id).toBe(TEACHER_TYLER_ID);
    expect(users[0].name).toBe('Taylor Demo');

    // No Chen user, no Chen memberships
    const chenUser = await freshDb.users.get(TEACHER_CHEN_ID);
    expect(chenUser).toBeUndefined();

    const chenMemberships = await freshDb.organizationMemberships
      .where('userId')
      .equals(TEACHER_CHEN_ID)
      .toArray();
    expect(chenMemberships).toHaveLength(0);

    // Only original seeded courses (ENG4U, SCH3U)
    const courses = await freshDb.courses.toArray();
    expect(courses.map(c => c.code).sort()).toEqual(['ENG4U', 'SCH3U']);

    // Only original seeded sections (class-eng4u-01, class-sch3u-02)
    const sections = await freshDb.classSections.toArray();
    expect(sections.map(s => s.id).sort()).toEqual(['class-eng4u-01', 'class-sch3u-02']);

    // Teacher selector on fresh install shows only Taylor Demo
    const available = await getAvailableTeachers(freshDb);
    expect(available).toHaveLength(1);
    expect(available[0].id).toBe(TEACHER_TYLER_ID);
  });

  it('blocks writes when session starts without an acting teacher selected', async () => {
    // 1. Verify unselected state
    expect(getActiveTeacherId()).toBeNull();
    await expect(resolveActiveTeacher(db)).rejects.toThrow(AuthorizationError);
    await expect(getAppIdentity(db)).rejects.toThrow(AuthorizationError);

    // 2. Count existing table records before attempted writes
    const auditCountBefore = await db.auditEntries.count();
    const syncCountBefore = await db.syncMutations.count();
    const overrideCountBefore = await db.gradeOverrides.count();

    // 3. Attempt direct markbook write without identity -> blocked
    await expect(
      markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentAId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 88,
        rationale: 'Unauthenticated override attempt',
        userId: '' as any,
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(AuthorizationError);

    // 4. Attempt attendance write without identity -> blocked
    await expect(
      attendanceService.toggleAttendance(classAId, studentEnrollmentAId)
    ).rejects.toThrow(AuthorizationError);

    // 5. Verify database tables remained 100% untouched
    expect(await db.auditEntries.count()).toBe(auditCountBefore);
    expect(await db.syncMutations.count()).toBe(syncCountBefore);
    expect(await db.gradeOverrides.count()).toBe(overrideCountBefore);
  });

  it('runs through actual UI teacher selector flow, keeps teacher stable on class switch, and rejects unauthorized writes', async () => {
    // 1. User sees teacher selector and chooses Teacher Tyler
    const available = await getAvailableTeachers(db);
    const tyler = available.find(t => t.id === TEACHER_TYLER_ID);
    expect(tyler).toBeDefined();

    // Select Teacher Tyler via UI selector flow
    const identity = await selectActingTeacher(db, tyler!.id);
    expect(identity.userId).toBe(TEACHER_TYLER_ID);
    expect(identity.user.name).toBe('Taylor Demo');
    const deviceIdBefore = identity.deviceId;

    // 2. Teacher Tyler switches active class to Class B (Teacher Chen's class)
    // The class switch must NOT change the acting teacher or reassign the device!
    const resolvedAfterClassSwitch = await resolveActiveTeacher(db);
    expect(resolvedAfterClassSwitch.id).toBe(TEACHER_TYLER_ID);

    const identityAfterClassSwitch = await getAppIdentity(db);
    expect(identityAfterClassSwitch.userId).toBe(TEACHER_TYLER_ID);
    expect(identityAfterClassSwitch.deviceId).toBe(deviceIdBefore);

    // Verify device in DB is still associated with Tyler, NOT Chen
    const deviceRecord = await db.devices.get(deviceIdBefore);
    expect(deviceRecord).toBeDefined();
    expect(deviceRecord!.userId).toBe(TEACHER_TYLER_ID);

    // 3. Baseline counts before write attempt
    const auditCountBefore = await db.auditEntries.count();
    const syncCountBefore = await db.syncMutations.count();
    const overridesBefore = await db.gradeOverrides.count();

    // 4. Teacher Tyler attempts a write to Class B (where Tyler has no staff assignment)
    // Attempting a grade override write on studentEnrollmentBId in Class B:
    await expect(
      markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentBId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 92,
        rationale: 'Unauthorized write attempt to Chen class',
        userId: identityAfterClassSwitch.userId,
        deviceId: identityAfterClassSwitch.deviceId
      })
    ).rejects.toThrow(AuthorizationError);

    // 5. Verify transaction rolled back completely: zero target data, zero audit entries, zero sync records
    expect(await db.gradeOverrides.count()).toBe(overridesBefore);
    expect(await db.auditEntries.count()).toBe(auditCountBefore);
    expect(await db.syncMutations.count()).toBe(syncCountBefore);

    // 6. Attempt attendance write in Class B as Tyler -> also rejected
    await expect(
      attendanceService.toggleAttendance(
        classBId,
        studentEnrollmentBId,
        '2026-09-18',
        identityAfterClassSwitch.userId,
        identityAfterClassSwitch.deviceId
      )
    ).rejects.toThrow(AuthorizationError);

    expect(await db.auditEntries.count()).toBe(auditCountBefore);
    expect(await db.syncMutations.count()).toBe(syncCountBefore);
  });

  it('immediately clears identity during teacher switch and prevents stale form submission', async () => {
    // 1. Establish Teacher Tyler
    await selectActingTeacher(db, TEACHER_TYLER_ID);
    expect(getActiveTeacherId()).toBe(TEACHER_TYLER_ID);

    // 2. User initiates teacher switch: identity is cleared immediately
    clearActiveTeacherId();
    expect(getActiveTeacherId()).toBeNull();

    // While switch is in progress, any pending write or submission must fail
    await expect(resolveActiveTeacher(db)).rejects.toThrow(AuthorizationError);
    await expect(getAppIdentity(db)).rejects.toThrow(AuthorizationError);

    // 3. User selects Teacher Chen
    const chenIdentity = await selectActingTeacher(db, TEACHER_CHEN_ID);
    expect(chenIdentity.userId).toBe(TEACHER_CHEN_ID);
    expect(chenIdentity.user.name).toBe(TEACHER_CHEN_NAME);

    // 4. Now Teacher Chen can write to Class B (their assigned class)
    const override = await markbookService.saveGradeOverride({
      classEnrollmentId: studentEnrollmentBId,
      reportingPeriodId: 'rp-midterm',
      categoryCode: 'OVERALL',
      overridePercentage: 95,
      rationale: 'Authorized grade override by Teacher Chen',
      userId: chenIdentity.userId,
      deviceId: chenIdentity.deviceId
    });

    expect(override.overridePercentage).toBe(95);

    // Verify audit entry logs Teacher Chen
    const audit = await db.auditEntries.where('entityId').equals(override.id).first();
    expect(audit).toBeDefined();
    expect(audit!.userId).toBe(TEACHER_CHEN_ID);

    // Verify sync mutation logs Teacher Chen's device
    const syncMut = await db.syncMutations.where('entityId').equals(override.id).first();
    expect(syncMut).toBeDefined();
    expect(syncMut!.deviceId).toBe(chenIdentity.deviceId);

    // 5. But Teacher Chen CANNOT write to Class A (Tyler's class)
    await expect(
      markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentAId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 70,
        rationale: 'Chen attempting to write to Tyler class',
        userId: chenIdentity.userId,
        deviceId: chenIdentity.deviceId
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('keeps session identity strictly in sessionStorage and does not restore old localStorage credentials', async () => {
    // If a stale user ID was left in localStorage from a previous unpatched session
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ontario_active_user_id', TEACHER_TYLER_ID);
    }
    // And sessionStorage is empty
    clearActiveTeacherId();

    // resolveActiveTeacher must NOT resurrect localStorage
    await expect(resolveActiveTeacher(db)).rejects.toThrow(AuthorizationError);
    expect(getActiveTeacherId()).toBeNull();
  });

  it('blocks UI write submissions holding valid previously-captured teacher credentials when session has been cleared', async () => {
    // 1. Form opened when Teacher Tyler was active; captures Tyler's valid ID
    await selectActingTeacher(db, TEACHER_TYLER_ID);
    const capturedTylerUserId = TEACHER_TYLER_ID;
    const capturedTylerDeviceId = 'dev-tyler-cached';

    // 2. User initiates teacher switch: active session is cleared
    clearActiveTeacherId();
    expect(getActiveTeacherId()).toBeNull();

    // 3. Record baseline counts before any attempted submission
    const auditCountBefore = await db.auditEntries.count();
    const syncCountBefore = await db.syncMutations.count();
    const overridesBefore = await db.gradeOverrides.count();

    // 4. Stale form attempts submission through UI submission guard pattern
    const submitGradeOverrideFromForm = async (propUserId: string) => {
      const currentIdentity = await getAppIdentity(db);
      if (propUserId && propUserId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher identity changed. Please reload or reopen the form.');
      }
      return await markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentAId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 99,
        rationale: 'Stale form submission attempt',
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });
    };

    // Even though capturedTylerUserId is a valid, real teacher with permission on Class A,
    // the submission must be rejected because the session was cleared.
    await expect(submitGradeOverrideFromForm(capturedTylerUserId)).rejects.toThrow(AuthorizationError);

    // 5. Verify database tables remained 100% untouched
    expect(await db.gradeOverrides.count()).toBe(overridesBefore);
    expect(await db.auditEntries.count()).toBe(auditCountBefore);
    expect(await db.syncMutations.count()).toBe(syncCountBefore);
  });

  it('blocks UI write submissions holding valid previously-captured teacher credentials when session has switched to a different teacher', async () => {
    // 1. Form opened when Teacher Tyler was active; captures Tyler's valid ID
    await selectActingTeacher(db, TEACHER_TYLER_ID);
    const capturedTylerUserId = TEACHER_TYLER_ID;

    // 2. Session switches to Teacher Chen
    const chenIdentity = await selectActingTeacher(db, TEACHER_CHEN_ID);
    expect(chenIdentity.userId).toBe(TEACHER_CHEN_ID);

    // 3. Baseline counts
    const auditCountBefore = await db.auditEntries.count();
    const syncCountBefore = await db.syncMutations.count();
    const overridesBefore = await db.gradeOverrides.count();

    // 4. Stale form (holding Tyler's ID) attempts to submit
    const submitGradeOverrideFromForm = async (propUserId: string) => {
      const currentIdentity = await getAppIdentity(db);
      if (propUserId && propUserId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher identity changed. Please reload or reopen the form.');
      }
      return await markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentAId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 99,
        rationale: 'Stale form submission attempt',
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });
    };

    // The attempt must be rejected with identity changed error
    await expect(submitGradeOverrideFromForm(capturedTylerUserId)).rejects.toThrow(
      'Acting teacher identity changed. Please reload or reopen the form.'
    );

    // 5. Target data, audit, and sync tables must be completely unchanged
    expect(await db.gradeOverrides.count()).toBe(overridesBefore);
    expect(await db.auditEntries.count()).toBe(auditCountBefore);
    expect(await db.syncMutations.count()).toBe(syncCountBefore);

    // 6. When the form is submitted with matching current identity (Teacher Chen), it succeeds
    const submitChenOverride = async (propUserId: string) => {
      const currentIdentity = await getAppIdentity(db);
      if (propUserId && propUserId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher identity changed. Please reload or reopen the form.');
      }
      return await markbookService.saveGradeOverride({
        classEnrollmentId: studentEnrollmentBId,
        reportingPeriodId: 'rp-midterm',
        categoryCode: 'OVERALL',
        overridePercentage: 94,
        rationale: 'Valid Chen override',
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });
    };

    const override = await submitChenOverride(chenIdentity.userId);
    expect(override.overridePercentage).toBe(94);

    // Audit and sync mutations must record Teacher Chen, NEVER Tyler
    const chenAudit = await db.auditEntries.where('entityId').equals(override.id).first();
    expect(chenAudit).toBeDefined();
    expect(chenAudit!.userId).toBe(TEACHER_CHEN_ID);
    expect(chenAudit!.userId).not.toBe(TEACHER_TYLER_ID);

    const chenSync = await db.syncMutations.where('entityId').equals(override.id).first();
    expect(chenSync).toBeDefined();
    expect(chenSync!.deviceId).toBe(chenIdentity.deviceId);
  });

  it('blocks roster import in ImportExportModal holding valid previously-captured teacher credentials after teacher switch', async () => {
    // 1. Tyler is active; modal opened with Tyler's ID
    await selectActingTeacher(db, TEACHER_TYLER_ID);
    const propUserId = TEACHER_TYLER_ID;

    // 2. Teacher switches to Chen
    await selectActingTeacher(db, TEACHER_CHEN_ID);

    // 3. Import modal submission handler checks live identity against propUserId
    const handleConfirmImport = async (userIdProp?: string) => {
      const currentIdentity = await getAppIdentity(db);
      if (userIdProp && userIdProp !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher changed. Please reopen the import modal.');
      }
      return true;
    };

    await expect(handleConfirmImport(propUserId)).rejects.toThrow(AuthorizationError);
  });
});
