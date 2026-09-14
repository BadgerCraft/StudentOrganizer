import { describe, it, expect } from 'vitest';
import {
  normalizeEnteredScore,
  calculateCategoryScore,
  calculateOverallCourseGrade
} from './calculationEngine';
import type {
  Assessment,
  AssessmentCategory,
  CategoryResult,
  GradingPolicy,
  GradeOverride,
  MarkScaleEntry,
  StudentAssessment
} from '../types/schema';

describe('Calculation Engine - Normalization and Two-Stage Aggregation', () => {
  const sampleScaleEntries: MarkScaleEntry[] = [
    { id: '1', markScaleVersionId: 'v1', code: '4+', label: '4+', minimumPercentage: 90, benchmarkPercentage: 95, maximumPercentage: 100, description: '', isPassing: true, isNumeric: true, sortOrder: 1 },
    { id: '2', markScaleVersionId: 'v1', code: '4', label: '4', minimumPercentage: 85, benchmarkPercentage: 87, maximumPercentage: 89.9, description: '', isPassing: true, isNumeric: true, sortOrder: 2 },
    { id: '3', markScaleVersionId: 'v1', code: '3', label: '3', minimumPercentage: 73, benchmarkPercentage: 75, maximumPercentage: 76.9, description: '', isPassing: true, isNumeric: true, sortOrder: 3 },
    { id: '4', markScaleVersionId: 'v1', code: 'R', label: 'R', minimumPercentage: 0, benchmarkPercentage: 35, maximumPercentage: 49.9, description: '', isPassing: false, isNumeric: true, sortOrder: 4 },
    { id: '5', markScaleVersionId: 'v1', code: 'I', label: 'I', minimumPercentage: 0, benchmarkPercentage: 0, maximumPercentage: 0, description: '', isPassing: false, isNumeric: false, sortOrder: 5 }
  ];

  it('correctly maps level codes to benchmark percentages and rejects invalid levels', () => {
    const r1 = normalizeEnteredScore('4+', 'scale_code', 100, sampleScaleEntries);
    expect(r1.normalizedPercentage).toBe(95);
    expect(r1.error).toBeUndefined();

    const r2 = normalizeEnteredScore('3', 'scale_code', 20, sampleScaleEntries);
    expect(r2.normalizedPercentage).toBe(75);
    expect(r2.pointsEarned).toBe(15); // (75 / 100) * 20

    const r3 = normalizeEnteredScore('I', 'scale_code', 100, sampleScaleEntries);
    expect(r3.normalizedPercentage).toBeNull(); // Insufficient evidence is non-numeric

    const r4 = normalizeEnteredScore('5++', 'scale_code', 100, sampleScaleEntries);
    expect(r4.error).toContain('Invalid level code');
  });

  it('strictly enforces 0 to 100 for percentages and does not silently clamp', () => {
    const valid = normalizeEnteredScore('88.5%', 'percentage', 100, sampleScaleEntries);
    expect(valid.normalizedPercentage).toBe(88.5);

    const over = normalizeEnteredScore('105%', 'percentage', 100, sampleScaleEntries);
    expect(over.normalizedPercentage).toBeNull();
    expect(over.error).toContain('between 0 and 100');

    const negative = normalizeEnteredScore('-5%', 'percentage', 100, sampleScaleEntries);
    expect(negative.normalizedPercentage).toBeNull();
    expect(negative.error).toContain('between 0 and 100');
  });

  it('validates raw scores against configured denominator', () => {
    // Exact denominator match
    const valid = normalizeEnteredScore('17/20', 'raw_points', 20, sampleScaleEntries);
    expect(valid.normalizedPercentage).toBe(85);
    expect(valid.pointsEarned).toBe(17);

    // Mismatched denominator error
    const mismatch = normalizeEnteredScore('17/25', 'raw_points', 20, sampleScaleEntries);
    expect(mismatch.normalizedPercentage).toBeNull();
    expect(mismatch.error).toContain('configured out of 20, but entered score is out of 25');

    // Points earned exceeding denominator
    const excess = normalizeEnteredScore('22/20', 'raw_points', 20, sampleScaleEntries);
    expect(excess.normalizedPercentage).toBeNull();
    expect(excess.error).toContain('between 0 and 20');
  });

  it('Stage 1 & 2: Calculates weighted category score and overall grade without double-weighting', () => {
    const policy: GradingPolicy = {
      id: 'pol-1',
      classSectionId: 'cs-1',
      reportingPeriodId: 'rp-1',
      scopeKey: 'rp-1',
      weightK: 25,
      weightT: 25,
      weightC: 25,
      weightA: 25,
      excludeFormative: true,
      missingWorkPolicy: 'exclude',
      defaultMarkScaleVersionId: 'v1',
      decimalPrecision: 1,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      version: 1
    };

    const assessments: Assessment[] = [
      { id: 'a1', classSectionId: 'cs-1', unitId: 'u1', reportingPeriodId: 'rp-1', code: 'A1', title: 'Task 1', assessmentType: 'summative', assignedAt: '', dueAt: '', isLocked: false, createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      { id: 'a2', classSectionId: 'cs-1', unitId: 'u1', reportingPeriodId: 'rp-1', code: 'A2', title: 'Task 2', assessmentType: 'summative', assignedAt: '', dueAt: '', isLocked: false, createdAt: '', updatedAt: '', deletedAt: null, version: 1 }
    ];

    const categories: AssessmentCategory[] = [
      { id: 'cat-a1-k', assessmentId: 'a1', categoryCode: 'K', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: 'v1', createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      { id: 'cat-a2-k', assessmentId: 'a2', categoryCode: 'K', maxScore: 100, evidenceWeight: 2.0, markScaleVersionId: 'v1', createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      { id: 'cat-a1-t', assessmentId: 'a1', categoryCode: 'T', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: 'v1', createdAt: '', updatedAt: '', deletedAt: null, version: 1 }
    ];

    const studentAssessments: StudentAssessment[] = [
      { id: 'sa1', assessmentId: 'a1', classEnrollmentId: 'e1', workflowStatus: 'assessed', completionStatus: 'complete', isLate: false, assignedAt: '', dueAt: '', submittedAt: '', assessedAt: '', returnedAt: '', overallFeedback: null, privateNotes: null, createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      { id: 'sa2', assessmentId: 'a2', classEnrollmentId: 'e1', workflowStatus: 'assessed', completionStatus: 'complete', isLate: false, assignedAt: '', dueAt: '', submittedAt: '', assessedAt: '', returnedAt: '', overallFeedback: null, privateNotes: null, createdAt: '', updatedAt: '', deletedAt: null, version: 1 }
    ];

    const categoryResults: CategoryResult[] = [
      // K: Task 1 (weight 1.0) = 80%, Task 2 (weight 2.0) = 95%
      // Expected K = (1*80 + 2*95) / (1 + 2) = (80 + 190) / 3 = 270 / 3 = 90.0%
      { id: 'cr1', studentAssessmentId: 'sa1', assessmentCategoryId: 'cat-a1-k', rawScore: '80%', inputFormat: 'percentage', normalizedPercentage: 80, pointsEarned: 80, pointsPossibleSnapshot: 100, feedback: null, assessedAt: '', createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      { id: 'cr2', studentAssessmentId: 'sa2', assessmentCategoryId: 'cat-a2-k', rawScore: '95%', inputFormat: 'percentage', normalizedPercentage: 95, pointsEarned: 95, pointsPossibleSnapshot: 100, feedback: null, assessedAt: '', createdAt: '', updatedAt: '', deletedAt: null, version: 1 },
      // T: Task 1 (weight 1.0) = 70%
      { id: 'cr3', studentAssessmentId: 'sa1', assessmentCategoryId: 'cat-a1-t', rawScore: '70%', inputFormat: 'percentage', normalizedPercentage: 70, pointsEarned: 70, pointsPossibleSnapshot: 100, feedback: null, assessedAt: '', createdAt: '', updatedAt: '', deletedAt: null, version: 1 }
    ];

    const kScore = calculateCategoryScore('e1', 'rp-1', 'K', assessments, categories, studentAssessments, categoryResults, policy, []);
    expect(kScore.calculatedScore).toBe(90.0);

    const tScore = calculateCategoryScore('e1', 'rp-1', 'T', assessments, categories, studentAssessments, categoryResults, policy, []);
    expect(tScore.calculatedScore).toBe(70.0);

    // C and A are unassessed (null)
    const cScore = calculateCategoryScore('e1', 'rp-1', 'C', assessments, categories, studentAssessments, categoryResults, policy, []);
    expect(cScore.calculatedScore).toBeNull();

    // Stage 2 overall grade: K (25%) = 90%, T (25%) = 70%.
    // Only K and T assessed -> weighted average = (25*90 + 25*70) / (25 + 25) = 80.0%
    const overall = calculateOverallCourseGrade('e1', 'rp-1', assessments, categories, studentAssessments, categoryResults, policy, []);
    expect(overall.finalOverall).toBe(80.0);
  });

  it('respects reporting-period-aware overrides for category and overall', () => {
    const policy: GradingPolicy = {
      id: 'pol-1', classSectionId: 'cs-1', reportingPeriodId: 'rp-1', scopeKey: 'rp-1',
      weightK: 25, weightT: 25, weightC: 25, weightA: 25,
      excludeFormative: true, missingWorkPolicy: 'exclude', defaultMarkScaleVersionId: 'v1', decimalPrecision: 1,
      createdAt: '', updatedAt: '', deletedAt: null, version: 1
    };

    const overrides: GradeOverride[] = [
      { id: 'ov1', classEnrollmentId: 'e1', reportingPeriodId: 'rp-1', categoryCode: 'OVERALL', overridePercentage: 88.0, rationale: 'Teacher professional judgment based on recent synthesis', teacherUserId: 'u1', createdAt: '', updatedAt: '', deletedAt: null, version: 1 }
    ];

    const overall = calculateOverallCourseGrade('e1', 'rp-1', [], [], [], [], policy, overrides);
    expect(overall.isOverridden).toBe(true);
    expect(overall.finalOverall).toBe(88.0);
    expect(overall.overrideRationale).toContain('Teacher professional judgment');
  });
});
