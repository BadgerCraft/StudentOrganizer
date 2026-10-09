import type { Assessment, AssessmentCategory, ClassEnrollment, Student, StudentAssessment, CategoryResult, ScoreInputFormat } from '../types/schema';
export type KTAC = 'K' | 'T' | 'A' | 'C';
export interface MarkingActor { userId: string; deviceId: string; epoch: number }
export interface MarkingBase { id: string; assessmentId: string; classSectionId: string; createdBy: string; createdAt: string; updatedAt: string; version: number; deletedAt: string | null }
export interface RubricCriterion { id: string; name: string; categoryCode: KTAC; descriptors: Record<string,string>; weight?: number }
export interface RubricContent { title: string; levels: string[]; criteria: RubricCriterion[] }
export interface MarkingRubric extends MarkingBase, RubricContent { confirmed: true }
export interface MarkingDocument { id: string; name: string; text: string; hash: string; original: null | { name: string; mime: string; base64: string; size: number; hash: string } }
export interface MarkingAttempt extends MarkingBase { classEnrollmentId: string | null; rubricId: string; documents: MarkingDocument[]; previousAttemptId: string | null }
export interface MarkingAnnotation { id: string; documentId: string; start: number; end: number; quote: string; criterionId: string; level: string; text: string }
export interface MarkingJudgment { assessmentCategoryId: string; assessed: boolean; rawScore: string; inputFormat: ScoreInputFormat; feedback: string }
export interface MarkingDraft { annotations: MarkingAnnotation[]; pending: MarkingAnnotation | null; judgments: MarkingJudgment[]; overallFeedback: string }
export interface RetainedCategoryJudgment { category: AssessmentCategory; judgment: MarkingJudgment }
export interface CategoryChangeReview { token: string; compatible: boolean; reasons: string[]; previousCategories: AssessmentCategory[]; currentCategories: AssessmentCategory[]; rubricTitle: string; criteria: Pick<RubricCriterion, 'name' | 'categoryCode'>[] }
export interface MarkingSession extends MarkingBase {
  attemptId: string; rubricId: string; revision: number; status: 'draft' | 'finalized'; draft: MarkingDraft; baseline: string; commitId: string | null;
  /** Older sessions recover this snapshot from their saved official baseline. */
  categorySnapshot?: AssessmentCategory[];
  /** Original judgments retained by explicit reconciliation, never official results. */
  retainedCategoryJudgments?: RetainedCategoryJudgment[];
}
export interface MarkingCommit extends MarkingBase { sessionId: string; attemptId: string; rubricId: string; studentAssessmentId: string; draft: MarkingDraft; resultIds: string[]; previousCommitId: string | null }
export interface MarkingContext { assessment: Assessment; categories: AssessmentCategory[]; enrollments: ClassEnrollment[]; students: Student[]; rubrics: MarkingRubric[]; attempts: MarkingAttempt[]; sessions: MarkingSession[]; commits: MarkingCommit[]; currentResults: CategoryResult[]; studentAssessments: StudentAssessment[]; scaleOptions: Record<string,string[]> }
export const MARKING_LIMITS = { fileBytes: 2*1024*1024, batchBytes: 10*1024*1024, batchFiles: 10, textCharacters: 200000, documents: 10, annotations: 2000, criteria: 40, levels: 30, expandedDocxBytes: 20*1024*1024 } as const;
