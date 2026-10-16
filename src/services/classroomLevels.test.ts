import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { CLASSROOM_LEVELS, classroomLevelOptions } from './classroomLevels';
import { normalizeEnteredScore } from './calculationEngine';
import { MarkbookDomainService } from './markbookService';
import { PortabilityService } from './portabilityService';

const expected = [
  ['R', 50], ['1−', 51], ['1', 55], ['1+', 58], ['2−', 61], ['2', 65], ['2+', 68],
  ['3−', 71], ['3', 75], ['3+', 78], ['4−(low)', 81], ['4−(High)', 85], ['4(low)', 88],
  ['4(high)', 91], ['4+(low)', 95], ['4+(med)', 98], ['4+(high)', 100],
] as const;
const databases: OntarioTeacherDB[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });
function database() { const db = new OntarioTeacherDB(`classroom-level-${crypto.randomUUID()}`); databases.push(db); return db; }

describe('immutable built-in classroom levels', () => {
  it.each(expected)('normalizes selected %s to its exact %i equivalent without percentage bands', (label, percentage) => {
    const result = normalizeEnteredScore(label, 'classroom_level', 20, []);
    expect(result).toEqual({ normalizedPercentage: percentage, pointsEarned: percentage / 100 * 20, pointsPossibleSnapshot: 20 });
  });

  it('contains exactly the published choices and retains custom evidence labels separately', () => {
    expect(CLASSROOM_LEVELS.map(level => [level.label, level.percentage])).toEqual(expected);
    expect(classroomLevelOptions(['4+', '3', 'Custom evidence'])).toEqual([...expected.map(([label]) => label), '4+', 'Custom evidence']);
    expect(normalizeEnteredScore('4-', 'classroom_level', 100, []).error).toContain('Invalid classroom level');
    expect(normalizeEnteredScore('', 'classroom_level', 100, []).normalizedPercentage).toBeNull();
    expect(normalizeEnteredScore('feedback', 'descriptive', 100, []).normalizedPercentage).toBeNull();
    expect(normalizeEnteredScore('86.4%', 'percentage', 100, []).normalizedPercentage).toBe(86.4);
  });

  it('persists every choice, preserves historical marks and scale references, and round-trips the backup without conversion', async () => {
    const db = database(); await seedDatabase(db);
    const service = new MarkbookDomainService(db);
    const assessment = (await db.assessments.toCollection().first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;
    const enrollments = await db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).toArray();
    const historical = await db.categoryResults.toArray();
    const scaleEntries = await db.markScaleEntries.toArray();
    const categorySnapshot = await db.assessmentCategories.toArray();
    const sourceAssignment = (await db.studentAssessments.where('assessmentId').equals(assessment.id).first())!;
    const targetEnrollment = enrollments.find(enrollment => enrollment.id !== sourceAssignment.classEnrollmentId)!;
    // New categories isolate the full scale acceptance from historical fixture results.
    const newAssessments = expected.map((_, index) => ({ ...assessment, id: `classroom-level-assessment-${index}`, code: `CL-${index}` }));
    await db.assessments.bulkAdd(newAssessments);
    const newCategories = newAssessments.map((newAssessment, index) => ({ ...category, assessmentId: newAssessment.id, id: `classroom-level-category-${index}` }));
    await db.assessmentCategories.bulkAdd(newCategories);
    for (const [index, [label, percentage]] of expected.entries()) {
      const sa = await db.studentAssessments.where({ assessmentId: newAssessments[index].id, classEnrollmentId: targetEnrollment.id }).first();
      const saved = await service.saveMarkbookCell({ assessmentId: newAssessments[index].id, classSectionId: assessment.classSectionId,
        classEnrollmentId: targetEnrollment.id, assessmentCategoryId: newCategories[index].id, rawScore: label,
        inputFormat: 'classroom_level', expectedStudentAssessmentVersion: sa?.version, userId: 'user-tyler', deviceId: 'device-local-01' });
      expect(saved.categoryResult).toMatchObject({ rawScore: label, inputFormat: 'classroom_level', normalizedPercentage: percentage });
    }
    expect(await db.categoryResults.bulkGet(historical.map(result => result.id))).toEqual(historical);
    expect(await db.markScaleEntries.toArray()).toEqual(scaleEntries);
    expect(await db.assessmentCategories.bulkGet(categorySnapshot.map(category => category.id))).toEqual(categorySnapshot);
    const backup = await new PortabilityService(db).createFullBackupJSON();
    const restored = database(); await new PortabilityService(restored).restoreFromJSON(backup);
    expect(await restored.categoryResults.toArray()).toEqual(await db.categoryResults.toArray());
    expect(await restored.markScaleEntries.toArray()).toEqual(scaleEntries);
    db.close(); await db.open();
    expect((await db.categoryResults.toArray()).filter(result => result.inputFormat === 'classroom_level')).toHaveLength(17);
    const tampered = JSON.parse(backup);
    tampered.tables.categoryResults.find((result: { inputFormat: string }) => result.inputFormat === 'classroom_level').normalizedPercentage = 49;
    await expect(new PortabilityService(restored).restoreFromJSON(JSON.stringify(tampered))).rejects.toThrow('invalid classroom level');
    expect(await restored.categoryResults.toArray()).toEqual(await db.categoryResults.toArray());
  });

  it('saves feedback without assigning R or silently retaining a cleared grade', async () => {
    const db = database(); await seedDatabase(db);
    const assessment = (await db.assessments.toCollection().first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;
    const sa = (await db.studentAssessments.where('assessmentId').equals(assessment.id).first())!;
    const existing = await db.categoryResults.where({ studentAssessmentId: sa.id, assessmentCategoryId: category.id }).first();
    const saved = await new MarkbookDomainService(db).saveMarkbookCell({ assessmentId: assessment.id,
      classSectionId: assessment.classSectionId, classEnrollmentId: sa.classEnrollmentId, assessmentCategoryId: category.id,
      rawScore: '', inputFormat: 'descriptive', feedback: 'Fictional feedback without a level.',
      expectedStudentAssessmentVersion: sa.version, expectedCategoryResultVersion: existing?.version,
      userId: 'user-tyler', deviceId: 'device-local-01' });
    expect(saved.categoryResult).toMatchObject({ rawScore: '', normalizedPercentage: null, pointsEarned: null, feedback: 'Fictional feedback without a level.' });
    if (existing) expect((await db.auditEntries.where('entityId').equals(existing.id).last())?.previousStateJson).toBe(JSON.stringify(existing));
  });
  it('offers the built-in scale even when an assessment has no usable historical scale', async () => {
    const db = database(); await seedDatabase(db);
    const assessment = (await db.assessments.toCollection().first())!;
    const category = (await db.assessmentCategories.where('assessmentId').equals(assessment.id).first())!;
    const sa = (await db.studentAssessments.where('assessmentId').equals(assessment.id).first())!;
    const previous = await db.categoryResults.where({ studentAssessmentId: sa.id, assessmentCategoryId: category.id }).first();
    await db.assessmentCategories.update(category.id, { markScaleVersionId: null });
    await db.gradingPolicies.clear();
    const params = { studentAssessmentId: sa.id, assessmentCategoryId: category.id, rawScore: 'R',
      inputFormat: 'classroom_level' as const, expectedVersion: previous?.version,
      expectedStudentAssessmentVersion: sa.version, userId: 'user-tyler', deviceId: 'device-local-01' };
    const saved = await new MarkbookDomainService(db).recordCategoryResult(params);
    expect(saved).toMatchObject({ rawScore: 'R', inputFormat: 'classroom_level', normalizedPercentage: 50 });
    await expect(new MarkbookDomainService(db).recordCategoryResult({ ...params, inputFormat: 'scale_code', expectedVersion: saved.version }))
      .rejects.toThrow('No mark scale version');
  });

});
