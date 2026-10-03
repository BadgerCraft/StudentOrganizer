import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ClassSettingsService } from './classSettingsService';
import { StudentDomainService } from './studentService';
import { PortabilityService } from './portabilityService';
import { listAccessibleClassSections } from './authHelper';
import { safePhotoSource } from '../utils/localPhoto';
import { escapeCSVCell, formatCSVCell } from '../utils/csvUtils';

const actor = { userId: 'user-tyler', deviceId: 'fictional-security-device' };
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
describe('Local data security regressions', () => {
  let db: OntarioTeacherDB;
  let service: ClassSettingsService;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async t => [t.name, await t.toArray()])));
  beforeEach(async () => { db = new OntarioTeacherDB(`security-${crypto.randomUUID()}`); await seedDatabase(db); service = new ClassSettingsService(db); });
  afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

  it.each(['https://collector.invalid/pixel?student=F001', '//collector.invalid/pixel', 'file:///tmp/pixel.png',
    'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,' + 'A'.repeat(65536), 'data:image/png;base64,not...base64'])
    ('rejects unsafe restored photo %s before changing any table', async badPhoto => {
      const portability = new PortabilityService(db);
      const backup = JSON.parse(await portability.createFullBackupJSON());
      backup.tables.students[0].photoUrl = badPhoto;
      const before = await snapshot();
      await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow('student photo must be a local');
      expect(await snapshot()).toEqual(before);
      expect(safePhotoSource(badPhoto)).toBeUndefined();
    });

  it('restores a valid local photo and retains null/absent legacy photos', async () => {
    const portability = new PortabilityService(db);
    const backup = JSON.parse(await portability.createFullBackupJSON());
    backup.tables.students[0].photoUrl = photo;
    delete backup.tables.students[1].photoUrl;
    await portability.restoreFromJSON(JSON.stringify(backup));
    expect((await db.students.get(backup.tables.students[0].id))?.photoUrl).toBe(photo);
    expect(safePhotoSource(photo)).toBe(photo);
  });

  it('denies all affected writes after assignment revocation with no data/audit/outbox changes', async () => {
    const assessment = (await db.assessments.toCollection().first())!;
    const policy = (await db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).first())!;
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).first())!;
    const student = (await db.students.get(enrollment.studentId))!;
    // Remove all assignments: a valid teacher membership alone is insufficient.
    await db.classSectionStaff.toCollection().modify({ deletedAt: new Date().toISOString() });
    const before = await snapshot();
    await expect(service.createAssessment({ ...actor, classSectionId: assessment.classSectionId, unitId: assessment.unitId,
      title: 'Fictional', assessmentType: 'summative', dueAt: assessment.dueAt,
      categories: [{ categoryCode: 'K', maxScore: 100, evidenceWeight: 1 }] })).rejects.toThrow('not assigned');
    await expect(service.archiveAssessment(assessment.id, assessment.version, actor)).rejects.toThrow('not assigned');
    await expect(service.duplicateAssessment(assessment.id, assessment.version, actor)).rejects.toThrow('not assigned');
    await expect(service.updateGradingPolicy(policy.id, policy.version, policy, actor)).rejects.toThrow('not assigned');
    await expect(new StudentDomainService(db).updateStudentProfile({ ...actor, studentId: student.id, expectedVersion: student.version,
      firstName: student.firstName, lastName: student.lastName, preferredName: null, pronouns: null, photoUrl: null })).rejects.toThrow('cannot edit');
    expect(await snapshot()).toEqual(before);
    expect(await listAccessibleClassSections(db, actor.userId)).toEqual([]);
  });

  it('creates only this class assignments and attributes every related record in one transaction', async () => {
    const unit = (await db.units.toCollection().first())!;
    const next = await service.createAssessment({ ...actor, classSectionId: unit.classSectionId, unitId: unit.id,
      title: 'Fictional Security Test', assessmentType: 'formative', dueAt: '2026-10-15T23:59:00Z',
      categories: [{ categoryCode: 'K', maxScore: 20, evidenceWeight: 1 }] });
    const assignments = await db.studentAssessments.where('assessmentId').equals(next.id).toArray();
    const enrollments = await db.classEnrollments.where('classSectionId').equals(unit.classSectionId).filter(e => e.deletedAt === null && e.enrollmentStatus === 'active').toArray();
    expect(assignments.map(a => a.classEnrollmentId).sort()).toEqual(enrollments.map(e => e.id).sort());
    const audits = await db.auditEntries.filter(a => JSON.parse(a.newStateJson ?? '{}').assessmentId === next.id || a.entityId === next.id).toArray();
    expect(audits).toHaveLength(assignments.length + 2);
    expect(audits.every(a => a.userId === actor.userId)).toBe(true);
    expect(new Set(audits.map(a => a.transactionId)).size).toBe(1);
    const mutations = await db.syncMutations.where('transactionId').equals(audits[0].transactionId).toArray();
    expect(mutations).toHaveLength(audits.length);
    expect(mutations.every(m => m.transactionSize === audits.length)).toBe(true);
    expect(mutations.map(m => m.sequenceNumber).sort((a, b) => a - b)).toEqual(audits.map((_, i) => i + 1));
  });

  it('allows authorized archive, repeated duplication and policy edits, with versions and audits', async () => {
    const assessment = (await db.assessments.toCollection().first())!;
    const first = await service.duplicateAssessment(assessment.id, assessment.version, actor);
    const second = await service.duplicateAssessment(assessment.id, assessment.version, actor);
    expect(first.code).not.toBe(second.code);
    await service.archiveAssessment(assessment.id, assessment.version, actor);
    expect((await db.assessments.get(assessment.id))?.version).toBe(assessment.version + 1);
    const policy = (await db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).first())!;
    const next = await service.updateGradingPolicy(policy.id, policy.version, { ...policy, weightK: 40, weightT: 20, weightC: 20, weightA: 20 }, actor);
    expect(next.version).toBe(policy.version + 1);
    expect((await db.auditEntries.where('entityId').equals(policy.id).first())?.userId).toBe(actor.userId);
    await expect(service.updateGradingPolicy(policy.id, policy.version, policy, actor)).rejects.toThrow('changed');
  });

  it.each(['create', 'duplicate', 'archive', 'policy', 'profile'])('rolls back %s when audit recording fails', async action => {
    const assessment = (await db.assessments.toCollection().first())!;
    const policy = (await db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).first())!;
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).first())!;
    const student = (await db.students.get(enrollment.studentId))!;
    const before = await snapshot();
    vi.spyOn(db.auditEntries, 'add').mockRejectedValueOnce(new Error('Fictional audit failure'));
    const operation = action === 'create' ? service.createAssessment({ ...actor, classSectionId: assessment.classSectionId, unitId: assessment.unitId,
      title: 'Fictional', assessmentType: 'summative', dueAt: assessment.dueAt, categories: [{ categoryCode: 'K', maxScore: 100, evidenceWeight: 1 }] })
      : action === 'duplicate' ? service.duplicateAssessment(assessment.id, assessment.version, actor)
      : action === 'archive' ? service.archiveAssessment(assessment.id, assessment.version, actor)
      : action === 'policy' ? service.updateGradingPolicy(policy.id, policy.version, { ...policy, weightK: 40, weightT: 20, weightC: 20, weightA: 20 }, actor)
      : new StudentDomainService(db).updateStudentProfile({ ...actor, studentId: student.id, expectedVersion: student.version,
        firstName: 'Fictional edit', lastName: student.lastName, preferredName: null, pronouns: null, photoUrl: null });
    await expect(operation).rejects.toThrow('Fictional audit failure');
    expect(await snapshot()).toEqual(before);
  });

  it('keeps read-only staff visible but denies edits; hides unrelated classes', async () => {
    const staff = (await db.classSectionStaff.toCollection().first())!;
    await db.classSectionStaff.toCollection().modify({ deletedAt: new Date().toISOString() });
    await db.classSectionStaff.update(staff.id, { deletedAt: null, role: 'read_only' });
    const visible = await listAccessibleClassSections(db, actor.userId);
    expect(visible.map(s => s.id)).toEqual([staff.classSectionId]);
    const assessment = (await db.assessments.where('classSectionId').equals(staff.classSectionId).first())!;
    await expect(service.archiveAssessment(assessment.id, assessment.version, actor)).rejects.toThrow('Read-only');
    expect(await listAccessibleClassSections(db, null)).toEqual([]);
  });
});

describe('Spreadsheet text export protection', () => {
  it.each(['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\u0000=1+1'])
    ('neutralizes formula-like text %j in both CSV formatters', text => {
      expect(escapeCSVCell(text).startsWith('"\'')).toBe(true);
      expect(formatCSVCell(text).replace(/^"/, '').startsWith("'")).toBe(true);
    });
  it('preserves actual numbers, ordinary text, escaping and stored input', () => {
    expect(escapeCSVCell(-2)).toBe('"-2"');
    expect(formatCSVCell(-2)).toBe('-2');
    expect(escapeCSVCell('Smith, "Fictional"')).toBe('"Smith, ""Fictional"""');
    const input = '=1+1'; escapeCSVCell(input); expect(input).toBe('=1+1');
  });
});
