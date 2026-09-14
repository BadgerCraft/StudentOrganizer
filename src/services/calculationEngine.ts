import type {
  AchievementCategoryCode,
  Assessment,
  AssessmentCategory,
  CategoryResult,
  GradingPolicy,
  GradeOverride,
  MarkScaleEntry,
  ScoreInputFormat,
  StudentAssessment,
  UUID
} from '../types/schema';

export interface ScoreNormalizationResult {
  normalizedPercentage: number | null;
  pointsEarned: number | null;
  pointsPossibleSnapshot: number | null;
  error?: string;
}

/**
 * Deterministically normalizes entered scores without client bias.
 * Enforces strictly:
 * - Percentages between 0 and 100.
 * - Raw points between 0 and maxScore (with exact denominator match check).
 * - Mark scale entries mapped directly to official benchmark percentages.
 */
export function normalizeEnteredScore(
  rawScore: string,
  format: ScoreInputFormat,
  maxScore: number,
  scaleEntries: MarkScaleEntry[]
): ScoreNormalizationResult {
  const trimmed = rawScore.trim();
  if (!trimmed) {
    return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore };
  }

  if (format === 'scale_code') {
    const entry = scaleEntries.find(e => e.code.toUpperCase() === trimmed.toUpperCase());
    if (!entry) {
      return {
        normalizedPercentage: null,
        pointsEarned: null,
        pointsPossibleSnapshot: maxScore,
        error: `Invalid level code: "${trimmed}"`
      };
    }
    if (!entry.isNumeric) {
      // E.g. "I" for Insufficient Evidence
      return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore };
    }
    const pct = entry.benchmarkPercentage;
    return {
      normalizedPercentage: pct,
      pointsEarned: (pct / 100) * maxScore,
      pointsPossibleSnapshot: maxScore
    };
  }

  if (format === 'percentage') {
    const cleanStr = trimmed.replace('%', '');
    const num = parseFloat(cleanStr);
    if (isNaN(num)) {
      return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: 'Invalid percentage format' };
    }
    if (num < 0 || num > 100) {
      return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: 'Percentage must be between 0 and 100' };
    }
    return {
      normalizedPercentage: num,
      pointsEarned: (num / 100) * maxScore,
      pointsPossibleSnapshot: maxScore
    };
  }

  if (format === 'raw_points') {
    if (trimmed.includes('/')) {
      const parts = trimmed.split('/');
      if (parts.length !== 2) {
        return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: 'Invalid score format. Use "pts/max" or "pts"' };
      }
      const num = parseFloat(parts[0].trim());
      const den = parseFloat(parts[1].trim());
      if (isNaN(num) || isNaN(den) || den <= 0) {
        return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: 'Points must be valid numbers' };
      }
      if (Math.abs(den - maxScore) > 0.0001) {
        return {
          normalizedPercentage: null,
          pointsEarned: null,
          pointsPossibleSnapshot: den,
          error: `This category is configured out of ${maxScore}, but entered score is out of ${den}`
        };
      }
      if (num < 0 || num > den) {
        return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: den, error: `Points earned must be between 0 and ${den}` };
      }
      return {
        normalizedPercentage: (num / den) * 100,
        pointsEarned: num,
        pointsPossibleSnapshot: den
      };
    }

    const num = parseFloat(trimmed);
    if (isNaN(num)) {
      return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: 'Invalid raw score' };
    }
    if (num < 0 || num > maxScore) {
      return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore, error: `Points earned must be between 0 and ${maxScore}` };
    }
    return {
      normalizedPercentage: (num / maxScore) * 100,
      pointsEarned: num,
      pointsPossibleSnapshot: maxScore
    };
  }

  return { normalizedPercentage: null, pointsEarned: null, pointsPossibleSnapshot: maxScore };
}

export interface CategoryScoreResult {
  categoryCode: AchievementCategoryCode;
  score: number | null; // Calculated or overridden
  calculatedScore: number | null;
  overrideScore: number | null;
  overrideRationale: string | null;
  validAssessmentCount: number;
  totalEvidenceWeight: number;
}

/**
 * Stage 1: Calculate Category Score within Category C
 */
export function calculateCategoryScore(
  classEnrollmentId: UUID,
  reportingPeriodId: UUID | null,
  categoryCode: AchievementCategoryCode,
  assessments: Assessment[],
  categories: AssessmentCategory[],
  studentAssessments: StudentAssessment[],
  categoryResults: CategoryResult[],
  policy: GradingPolicy,
  overrides: GradeOverride[]
): CategoryScoreResult {
  // Check override first
  const override = overrides.find(
    o => o.classEnrollmentId === classEnrollmentId &&
         (!reportingPeriodId || o.reportingPeriodId === reportingPeriodId) &&
         o.categoryCode === categoryCode &&
         o.deletedAt === null
  );

  // Map category definitions by ID
  const catDefMap = new Map<UUID, AssessmentCategory>();
  for (const cat of categories) {
    if (cat.categoryCode === categoryCode && cat.deletedAt === null) {
      catDefMap.set(cat.id, cat);
    }
  }

  const assessMap = new Map<UUID, Assessment>();
  for (const a of assessments) {
    if (a.deletedAt === null) {
      if (!reportingPeriodId || a.reportingPeriodId === reportingPeriodId) {
        assessMap.set(a.id, a);
      }
    }
  }

  const saMap = new Map<UUID, StudentAssessment>();
  for (const sa of studentAssessments) {
    if (sa.classEnrollmentId === classEnrollmentId && sa.deletedAt === null) {
      saMap.set(sa.id, sa);
    }
  }

  let weightedSum = 0;
  let weightSum = 0;
  let validCount = 0;

  for (const cr of categoryResults) {
    if (cr.deletedAt !== null) continue;
    const catDef = catDefMap.get(cr.assessmentCategoryId);
    if (!catDef) continue;

    const sa = saMap.get(cr.studentAssessmentId);
    if (!sa) continue;

    const assessment = assessMap.get(sa.assessmentId);
    if (!assessment) continue;

    // Filter formative if policy dictates
    if (assessment.assessmentType === 'formative' && policy.excludeFormative) {
      continue;
    }

    // Filter excused
    if (sa.completionStatus === 'excused') {
      continue;
    }

    let pct = cr.normalizedPercentage;

    // Handle missing work according to policy
    if (sa.completionStatus === 'missing') {
      if (policy.missingWorkPolicy === 'exclude') {
        continue;
      } else if (policy.missingWorkPolicy === 'zero_with_warning') {
        pct = 0;
      } else if (policy.missingWorkPolicy === 'floor_r') {
        pct = 35.0; // Level R benchmark
      }
    }

    if (pct === null) continue;

    const weight = catDef.evidenceWeight > 0 ? catDef.evidenceWeight : 1.0;
    weightedSum += weight * pct;
    weightSum += weight;
    validCount++;
  }

  const calculated = weightSum > 0 ? weightedSum / weightSum : null;
  const finalScore = override ? override.overridePercentage : calculated;

  return {
    categoryCode,
    score: finalScore,
    calculatedScore: calculated,
    overrideScore: override ? override.overridePercentage : null,
    overrideRationale: override ? override.rationale : null,
    validAssessmentCount: validCount,
    totalEvidenceWeight: weightSum
  };
}

export interface OverallCourseGradeResult {
  finalOverall: number | null;
  calculatedOverall: number | null;
  isOverridden: boolean;
  overrideRationale: string | null;
  categoryBreakdown: Record<AchievementCategoryCode, CategoryScoreResult>;
}

/**
 * Stage 2: Calculate Overall Mark across categories
 */
export function calculateOverallCourseGrade(
  classEnrollmentId: UUID,
  reportingPeriodId: UUID | null,
  assessments: Assessment[],
  categories: AssessmentCategory[],
  studentAssessments: StudentAssessment[],
  categoryResults: CategoryResult[],
  policy: GradingPolicy,
  overrides: GradeOverride[]
): OverallCourseGradeResult {
  const categoryCodes: AchievementCategoryCode[] = ['K', 'T', 'C', 'A'];
  const breakdown: Record<AchievementCategoryCode, CategoryScoreResult> = {} as any;

  for (const code of categoryCodes) {
    breakdown[code] = calculateCategoryScore(
      classEnrollmentId,
      reportingPeriodId,
      code,
      assessments,
      categories,
      studentAssessments,
      categoryResults,
      policy,
      overrides
    );
  }

  // Check overall override
  const overallOverride = overrides.find(
    o => o.classEnrollmentId === classEnrollmentId &&
         (!reportingPeriodId || o.reportingPeriodId === reportingPeriodId) &&
         o.categoryCode === 'OVERALL' &&
         o.deletedAt === null
  );

  const policyWeights: Record<AchievementCategoryCode, number> = {
    K: policy.weightK,
    T: policy.weightT,
    C: policy.weightC,
    A: policy.weightA
  };

  let sumWeighted = 0;
  let sumWeight = 0;

  for (const code of categoryCodes) {
    const catResult = breakdown[code];
    if (catResult.score !== null) {
      const w = policyWeights[code];
      sumWeighted += w * catResult.score;
      sumWeight += w;
    }
  }

  const calculated = sumWeight > 0 ? sumWeighted / sumWeight : null;
  const factor = Math.pow(10, policy.decimalPrecision);
  const roundedCalculated = calculated !== null ? Math.round(calculated * factor) / factor : null;

  const finalScore = overallOverride
    ? overallOverride.overridePercentage
    : roundedCalculated;

  return {
    finalOverall: finalScore,
    calculatedOverall: roundedCalculated,
    isOverridden: !!overallOverride,
    overrideRationale: overallOverride ? overallOverride.rationale : null,
    categoryBreakdown: breakdown
  };
}
