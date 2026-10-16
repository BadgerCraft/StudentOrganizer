import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { initializeDatabase, seedDatabase } from '../db/seeds';
import { createTeacherProfile, updateTeacherProfile } from './teacherProfileService';
import { clearActiveTeacherId, getActiveTeacherId, getAppIdentity, getAvailableTeachers, selectActingTeacher } from './identityService';
import { AuthorizationError, assertClassSectionWriteAccess, listAccessibleClassSections } from './authHelper';
import { ClassDomainService } from './classService';
import { MarkbookDomainService } from './markbookService';
import { PortabilityService } from './portabilityService';

describe('Local teacher setup and historical ownership', () => {
  let db: OntarioTeacherDB;
  beforeEach(() => { clearActiveTeacherId(); db = new OntarioTeacherDB(`fictional-profiles-${crypto.randomUUID()}`); });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });

  it('starts without a named teacher, classroom, student or fabricated assessment and initializes idempotently', async () => {
    await Promise.all([initializeDatabase(db), initializeDatabase(db)]);
    expect(await getAvailableTeachers(db)).toEqual([]);
    expect(await db.users.count()).toBe(0);
    expect(await db.students.count()).toBe(0);
    expect(await db.classSections.count()).toBe(0);
    expect(await db.categoryResults.count()).toBe(0);
    expect(await db.terms.count()).toBe(1);
    expect(await db.reportingPeriods.count()).toBe(1);
    await expect(getAppIdentity(db)).rejects.toThrow(AuthorizationError);
  });

  it('creates first and second teachers without selecting either automatically, then creates each teacher’s own class', async () => {
    const first = await createTeacherProfile(db, { name: '  Avery Fictional  ' });
    const second = await createTeacherProfile(db, { name: 'Blair Fictional', email: 'BLAIR@example.invalid' });
    expect(first.name).toBe('Avery Fictional');
    expect(first.authSubject).toMatch(/^local-profile:/);
    expect(second.email).toBe('blair@example.invalid');
    expect(getActiveTeacherId()).toBeNull();
    expect((await getAvailableTeachers(db)).map(t => t.id)).toEqual([first.id, second.id]);
    expect(await db.classSectionStaff.count()).toBe(0);
    const service = new ClassDomainService(db);
    const firstIdentity = await selectActingTeacher(db, first.id);
    const classA = await service.createClassSection({ courseCode: 'TEST1', courseTitle: 'Fictional A', sectionNumber: '01', period: '1', roomNumber: '1', colorToken: '#123456', userId: first.id, deviceId: firstIdentity.deviceId });
    await selectActingTeacher(db, second.id);
    expect(await listAccessibleClassSections(db, second.id)).toEqual([]);
    await expect(assertClassSectionWriteAccess(db, second.id, classA.id)).rejects.toThrow(AuthorizationError);
    const policyA = await db.gradingPolicies.where('classSectionId').equals(classA.id).first();
    expect(await db.markScaleVersions.get(policyA!.defaultMarkScaleVersionId)).toBeDefined();
    const classB = await service.createClassSection({ courseCode: 'TEST2', courseTitle: 'Fictional B', sectionNumber: '02', period: '2', roomNumber: '2', colorToken: '#123456', userId: second.id, deviceId: firstIdentity.deviceId });
    expect((await listAccessibleClassSections(db, second.id)).map(c => c.id)).toEqual([classB.id]);
    expect((await listAccessibleClassSections(db, first.id)).map(c => c.id)).toEqual([classA.id]);
  });

  it('persists profiles and edits after closing and reopening the database, while a new session still requires an explicit choice', async () => {
    const first = await createTeacherProfile(db, { name: 'Avery Fictional', email: 'avery@example.invalid' });
    await createTeacherProfile(db, { name: 'Blair Fictional' });
    await selectActingTeacher(db, first.id);
    const edited = await updateTeacherProfile(db, first.id, { name: 'Avery Updated', email: 'updated@example.invalid' });
    expect(edited.id).toBe(first.id);
    expect(edited.authSubject).toBe(first.authSubject);
    expect(edited.version).toBe(first.version + 1);
    const dbName = db.name;
    db.close(); clearActiveTeacherId();
    db = new OntarioTeacherDB(dbName);
    await initializeDatabase(db);
    expect((await getAvailableTeachers(db)).map(t => t.name)).toEqual(['Avery Updated', 'Blair Fictional']);
    await expect(getAppIdentity(db)).rejects.toThrow(AuthorizationError);
    expect((await selectActingTeacher(db, first.id)).user.name).toBe('Avery Updated');
  });

  it('never renames saved profiles on startup or while adding a new teacher', async () => {
    await seedDatabase(db);
    await db.users.update('user-tyler', { name: 'Tyler Henderson' });
    const before = await db.users.get('user-tyler');
    const marks = await db.categoryResults.toArray();
    const staff = await db.classSectionStaff.toArray();
    await initializeDatabase(db);
    await createTeacherProfile(db, { name: 'Blair Fictional' });
    expect(await db.users.get('user-tyler')).toEqual(before);
    expect(await db.categoryResults.toArray()).toEqual(marks);
    expect(await db.classSectionStaff.toArray()).toEqual(staff);
  });

  it('requires explicit self selection for edits and never changes historical ownership when switching or editing', async () => {
    await seedDatabase(db);
    const second = await createTeacherProfile(db, { name: 'Blair Fictional' });
    await expect(updateTeacherProfile(db, 'user-tyler', { name: 'Changed' })).rejects.toThrow(AuthorizationError);
    await selectActingTeacher(db, 'user-tyler');
    await expect(updateTeacherProfile(db, second.id, { name: 'Changed' })).rejects.toThrow(AuthorizationError);
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    const identity = await getAppIdentity(db);
    await new MarkbookDomainService(db).saveGradeOverride({ classEnrollmentId: enrollment.id, reportingPeriodId: 'rp-midterm', categoryCode: 'OVERALL', overridePercentage: 83, rationale: 'Fictional retained mark', userId: identity.userId, deviceId: identity.deviceId });
    const history = { overrides: await db.gradeOverrides.toArray(), audits: await db.auditEntries.toArray(), sync: await db.syncMutations.toArray(), results: await db.categoryResults.toArray(), staff: await db.classSectionStaff.toArray() };
    await selectActingTeacher(db, second.id);
    await updateTeacherProfile(db, second.id, { name: 'Blair Updated' });
    await expect(assertClassSectionWriteAccess(db, second.id, 'class-eng4u-01')).rejects.toThrow(AuthorizationError);
    expect({ overrides: await db.gradeOverrides.toArray(), audits: await db.auditEntries.toArray(), sync: await db.syncMutations.toArray(), results: await db.categoryResults.toArray(), staff: await db.classSectionStaff.toArray() }).toEqual(history);
    expect((await selectActingTeacher(db, 'user-tyler')).userId).toBe('user-tyler');
  });

  it('rejects invalid and duplicate emails atomically without leaving partial users or memberships', async () => {
    await expect(createTeacherProfile(db, { name: '  ' })).rejects.toThrow('teacher name');
    await expect(createTeacherProfile(db, { name: 'Avery', email: 'not-an-email' })).rejects.toThrow('valid email');
    const first = await createTeacherProfile(db, { name: 'Avery', email: 'avery@example.invalid' });
    await expect(createTeacherProfile(db, { name: 'Duplicate', email: 'AVERY@example.invalid' })).rejects.toThrow('already belongs');
    expect(await db.users.count()).toBe(1);
    expect(await db.organizationMemberships.count()).toBe(1);
    const second = await createTeacherProfile(db, { name: 'Blair' });
    await selectActingTeacher(db, second.id);
    await expect(updateTeacherProfile(db, second.id, { name: 'Blair Changed', email: first.email })).rejects.toThrow('already belongs');
    expect((await db.users.get(second.id))!.name).toBe('Blair');
  });

  it('backs up and restores newly created local profiles, class ownership and exact production scale references', async () => {
    const teacher = await createTeacherProfile(db, { name: 'Avery Fictional' });
    const identity = await selectActingTeacher(db, teacher.id);
    const section = await new ClassDomainService(db).createClassSection({ courseCode: 'TEST', courseTitle: 'Fictional backup class', sectionNumber: '01', period: '1', roomNumber: '1', colorToken: '#123456', userId: teacher.id, deviceId: identity.deviceId });
    const portability = new PortabilityService(db);
    const backup = await portability.createFullBackupJSON();
    expect(() => portability.validateBackupJSON(backup)).not.toThrow();
    const restored = new OntarioTeacherDB(`fictional-profile-restore-${crypto.randomUUID()}`);
    try {
      await new PortabilityService(restored).restoreFromJSON(backup);
      expect(await restored.users.get(teacher.id)).toEqual(teacher);
      expect((await listAccessibleClassSections(restored, teacher.id)).map(row => row.id)).toEqual([section.id]);
      expect(await restored.markScaleEntries.toArray()).toEqual(await db.markScaleEntries.toArray());
      expect(await restored.classSectionStaff.toArray()).toEqual(await db.classSectionStaff.toArray());
    } finally { await restored.delete(); }
  });

  it('does not establish an acting teacher if device/session activation fails', async () => {
    const teacher = await createTeacherProfile(db, { name: 'Avery Fictional' });
    vi.spyOn(db.devices, 'put').mockRejectedValueOnce(new Error('Fictional storage failure'));
    await expect(selectActingTeacher(db, teacher.id)).rejects.toThrow('Fictional storage failure');
    expect(getActiveTeacherId()).toBeNull();
    expect(await db.users.get(teacher.id)).toBeDefined();
    await expect(selectActingTeacher(db, teacher.id)).resolves.toMatchObject({ userId: teacher.id });
    expect(await db.users.count()).toBe(1);
  });

  it('aborts a profile edit when teacher authority is revoked during the final database write', async () => {
    const teacher = await createTeacherProfile(db, { name: 'Avery Fictional', email: 'avery@example.invalid' });
    await selectActingTeacher(db, teacher.id);
    const revoke = () => { clearActiveTeacherId(); };
    db.users.hook('updating', revoke);
    try {
      await expect(updateTeacherProfile(db, teacher.id, { name: 'Stale changed name', email: 'changed@example.invalid' })).rejects.toThrow();
    } finally { db.users.hook('updating').unsubscribe(revoke); }
    expect(getActiveTeacherId()).toBeNull();
    expect(await db.users.get(teacher.id)).toEqual(teacher);
    // A fresh explicit choice can retry successfully after the aborted transaction.
    await selectActingTeacher(db, teacher.id);
    await expect(updateTeacherProfile(db, teacher.id, { name: 'Avery Updated', email: 'avery@example.invalid' })).resolves.toMatchObject({ name: 'Avery Updated' });
  });

  it('blocks edits for deactivated membership even if the user record remains active', async () => {
    const teacher = await createTeacherProfile(db, { name: 'Avery Fictional' });
    await selectActingTeacher(db, teacher.id);
    await db.organizationMemberships.where('userId').equals(teacher.id).modify({ status: 'suspended' });
    await expect(updateTeacherProfile(db, teacher.id, { name: 'Changed' })).rejects.toThrow(AuthorizationError);
    expect((await db.users.get(teacher.id))!.name).toBe('Avery Fictional');
  });
});
