import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { initializeDatabase, seedDatabase } from '../db/seeds';
import { createTeacherProfile } from './teacherProfileService';
import { selectActingTeacher, getIdentityEpoch, clearActiveTeacherId, setActiveTeacherId } from './identityService';
import { ClassDomainService } from './classService';
import { PortabilityService } from './portabilityService';
import { MarkbookDomainService } from './markbookService';
import { ProfileAssessmentService, profileReportingPeriods, type CreateIndividualAssessment } from './profileAssessmentService';

describe('profile assessment atomic operations', () => {
  let db: OntarioTeacherDB, service: ProfileAssessmentService, input: CreateIndividualAssessment;
  beforeEach(async () => {
    clearActiveTeacherId(); db = new OntarioTeacherDB(`profile-repair-${crypto.randomUUID()}`);
    await initializeDatabase(db);
    const teacher = await createTeacherProfile(db, { name: 'Fictional Review Teacher' });
    const actor = await selectActingTeacher(db, teacher.id);
    const section = await new ClassDomainService(db).createClassSection({ ...actor, courseCode: 'TEST1', courseTitle: 'Fictional Course', sectionNumber: '1', period: '1', roomNumber: '1', colorToken: '#ffffff' });
    const portability = new PortabilityService(db);
    const rows = await portability.validateRosterCandidates(section.id, [{ rowNumber: 1, rawText: 'Fictional Student 001', firstName: 'Fictional', lastName: 'Student', studentNumber: '001', error: null, warning: null }]);
    await portability.importRosterBatch({ ...actor, classSectionId: section.id, rows });
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    const policy = (await db.gradingPolicies.where('classSectionId').equals(section.id).first())!;
    input = { ...actor, identityEpoch: getIdentityEpoch(), enrollmentId: enrollment.id, classSectionId: section.id, policyId: policy.id, operationId: crypto.randomUUID(), title: 'Fictional individual work', assessmentType: 'summative', categoryCode: 'K', rawPercentage: '88%', feedback: 'Fictional feedback' };
    service = new ProfileAssessmentService(db);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  const counts = async (database: OntarioTeacherDB) => Promise.all([database.units, database.assessments, database.assessmentCategories, database.studentAssessments, database.categoryResults, database.auditEntries, database.syncMutations].map(t => t.count()));
  it('fresh initialization resolves the real period, keeps direct percentage and complete backup roundtrips', async () => {
    expect(await db.reportingPeriods.get('rp-midterm')).toBeUndefined();
    const result = await service.createIndividual(input);
    expect(result.reportingPeriodId).toBe('local-reporting-period');
    const sa = (await db.studentAssessments.where('assessmentId').equals(result.id).first())!;
    const mark = (await db.categoryResults.where('studentAssessmentId').equals(sa.id).first())!;
    expect(mark).toMatchObject({ rawScore: '88%', inputFormat: 'percentage', normalizedPercentage: 88 });
    expect(sa).toMatchObject({ workflowStatus: 'assessed', completionStatus: 'complete' });
    const override = await service.saveOverride({ ...input, categoryCode: 'OVERALL', overridePercentage: 91, rationale: 'Fictional judgment', expected: null });
    expect(override.reportingPeriodId).toBe(result.reportingPeriodId);
    const p = new PortabilityService(db); const backup = await p.createFullBackupJSON();
    await p.restoreFromJSON(backup);
    expect(await db.categoryResults.get(mark.id)).toEqual(mark);
    expect(await db.gradeOverrides.get(override.id)).toEqual(override);
    const restoredCounts = await counts(db);
    await service.createIndividual(input); expect(await counts(db)).toEqual(restoredCounts);
    const current = (await db.studentAssessments.get(sa.id))!;
    const newer = await new MarkbookDomainService(db).recordCategoryResult({ studentAssessmentId: sa.id, assessmentCategoryId: mark.assessmentCategoryId, rawScore: '93', inputFormat: 'percentage', expectedVersion: mark.version, expectedStudentAssessmentVersion: current.version, userId: input.userId, deviceId: input.deviceId });
    await service.createIndividual(input); expect(await db.categoryResults.get(mark.id)).toEqual(newer);
    const mutations = await db.syncMutations.where('transactionId').equals(result.id).toArray();
    expect(mutations.map(row => row.sequenceNumber).sort()).toEqual([1, 2, 3]);
    expect(mutations.every(row => row.transactionSize === 3)).toBe(true);
    const audits = await db.auditEntries.where('transactionId').equals(result.id).toArray();
    expect(audits.map(row => row.entityId).sort()).toEqual(mutations.map(row => row.entityId).sort());
  });
  it('rolls back invalid score and injected late outbox failure, then retries once without duplicate records', async () => {
    // Exercise optional unit creation too.
    await db.units.clear(); const before = await counts(db);
    await expect(service.createIndividual({ ...input, rawPercentage: '4+' })).rejects.toThrow('percentage');
    expect(await counts(db)).toEqual(before);
    const fail = (_: unknown, row: { entityName: string }) => { if (row.entityName === 'categoryResults') throw new Error('Fictional interrupted outbox'); };
    db.syncMutations.hook('creating', fail);
    await expect(service.createIndividual(input)).rejects.toThrow('interrupted');
    db.syncMutations.hook('creating').unsubscribe(fail);
    expect(await counts(db)).toEqual(before);
    const [a, b] = await Promise.all([service.createIndividual(input), service.createIndividual(input)]);
    expect(a.id).toBe(b.id); const after = await counts(db);
    await service.createIndividual(input); expect(await counts(db)).toEqual(after);
    expect(await db.assessments.count()).toBe(1); expect(await db.categoryResults.count()).toBe(1);
    await expect(service.createIndividual({ ...input, rawPercentage: '90' })).rejects.toThrow('different work');
    expect(await counts(db)).toEqual(after);
  });
  it('denies read-only and stale actor before any blank-score records, and aborts mid-write teacher changes', async () => {
    const staff = (await db.classSectionStaff.where('classSectionId').equals(input.classSectionId).first())!;
    await db.classSectionStaff.update(staff.id, { role: 'read_only' }); const before = await counts(db);
    await expect(service.createIndividual({ ...input, rawPercentage: '' })).rejects.toThrow(); expect(await counts(db)).toEqual(before);
    await db.classSectionStaff.update(staff.id, { role: 'primary_teacher' });
    await expect(service.createIndividual({ ...input, identityEpoch: input.identityEpoch! - 1 })).rejects.toThrow('teacher changed');
    const switchActor = () => { setActiveTeacherId('another-fictional-teacher'); };
    db.assessments.hook('creating', switchActor);
    await expect(service.createIndividual(input)).rejects.toThrow();
    db.assessments.hook('creating').unsubscribe(switchActor); expect(await counts(db)).toEqual(before);
  });
  it('requires deliberate choice for ambiguous terms and rejects closed/wrong-term periods', async () => {
    const first = (await db.reportingPeriods.get('local-reporting-period'))!;
    await db.reportingPeriods.add({ ...first, id: 'second-open', name: 'Second period', sequenceNumber: 2 });
    expect((await profileReportingPeriods(db, input.classSectionId, input.policyId)).suggestedId).toBe('');
    const before = await counts(db); await expect(service.createIndividual(input)).rejects.toThrow('Choose an open');
    await db.reportingPeriods.add({ ...first, id: 'foreign-period', termId: 'foreign-term' });
    await expect(service.createIndividual({ ...input, reportingPeriodId: 'foreign-period' })).rejects.toThrow('Choose an open');
    await db.reportingPeriods.update(first.id, { isClosed: true });
    await expect(service.createIndividual({ ...input, reportingPeriodId: first.id })).rejects.toThrow('Choose an open');
    expect(await counts(db)).toEqual(before);
    expect((await service.createIndividual({ ...input, reportingPeriodId: 'second-open', rawPercentage: '' })).reportingPeriodId).toBe('second-open');
    expect((await db.studentAssessments.toArray())[0]).toMatchObject({ completionStatus: 'not_assessed', workflowStatus: 'assigned', assessedAt: null });
  });
  it('preserves retained U1 tombstones when a fallback unit is needed', async () => {
    const original = (await db.units.where('classSectionId').equals(input.classSectionId).first())!;
    const deleted = { ...original, deletedAt: new Date().toISOString(), version: original.version + 1 };
    await db.units.put(deleted);
    const assessment = await service.createIndividual(input);
    expect(await db.units.get(original.id)).toEqual(deleted);
    expect(await db.units.get(assessment.unitId)).toMatchObject({ code: 'U2', deletedAt: null });
    const portability = new PortabilityService(db);
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect(await db.units.get(original.id)).toEqual(deleted);
  });
  it('uses opening override versions and absence; never re-reads a newer version to authorize overwrite', async () => {
    const request = { ...input, categoryCode: 'OVERALL' as const, overridePercentage: 91, rationale: 'Fictional judgment', expected: null };
    const first = await service.saveOverride(request);
    await expect(service.saveOverride(request)).rejects.toThrow('changed since');
    const updated = await service.saveOverride({ ...request, overridePercentage: 92, expected: first });
    await expect(service.saveOverride({ ...request, expected: first })).rejects.toThrow('changed since');
    expect((await db.gradeOverrides.get(first.id))!.overridePercentage).toBe(92); expect(updated.version).toBe(first.version + 1);
    await expect(service.saveOverride({ ...request, expected: updated, identityEpoch: input.identityEpoch! - 1 })).rejects.toThrow('teacher changed');
  });
  it('retains valid legacy explicit policy reporting periods', async () => {
    const legacy = new OntarioTeacherDB(`legacy-profile-${crypto.randomUUID()}`);
    try {
      await seedDatabase(legacy); const actor = await selectActingTeacher(legacy, 'user-tyler');
      const enrollment = (await legacy.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
      const policy = (await legacy.gradingPolicies.where('classSectionId').equals(enrollment.classSectionId).first())!;
      await legacy.gradingPolicies.update(policy.id, { reportingPeriodId: 'rp-midterm', scopeKey: 'rp-midterm' });
      const result = await new ProfileAssessmentService(legacy).createIndividual({ ...input, ...actor, identityEpoch: getIdentityEpoch(), enrollmentId: enrollment.id, classSectionId: enrollment.classSectionId, policyId: policy.id });
      expect(result.reportingPeriodId).toBe('rp-midterm');
    } finally { await legacy.delete(); }
  });
});
