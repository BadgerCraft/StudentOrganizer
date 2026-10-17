import type { Assessment, AssessmentCategory, ClassEnrollment, Student, StudentAssessment, CategoryResult, ScoreInputFormat } from '../types/schema';
export type KTAC = 'K' | 'T' | 'A' | 'C';
export interface MarkingActor { userId: string; deviceId: string; epoch: number }
export interface MarkingBase { id: string; assessmentId: string; classSectionId: string; createdBy: string; createdAt: string; updatedAt: string; version: number; deletedAt: string | null }
export interface RubricCriterion { id: string; name: string; categoryCode: KTAC; descriptors: Record<string,string>; weight?: number }
export interface RubricContent { title: string; levels: string[]; criteria: RubricCriterion[] }
export interface MarkingRubric extends MarkingBase, RubricContent { confirmed: true }
export interface MarkingDocument { id: string; name: string; text: string; hash: string; original: null | { name: string; mime: string; base64: string; size: number; hash: string } }
export type MarkingMode = 'written' | 'oral' | 'rubric';
export interface MarkingImagePage { id: string; name: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; size: number; hash: string; width: number; height: number }
export interface MarkingPoint { x: number; y: number }
export interface MarkingVisualAnnotation { id: string; kind: 'pen' | 'highlight' | 'comment'; points: MarkingPoint[]; color: 'red' | 'blue' | 'yellow'; width: number; text: string; criterionId: string | null; level: string }
export interface MarkingPageFeedback { pageId: string; rotation: 0 | 90 | 180 | 270; crop: { x: number; y: number; width: number; height: number }; annotations: MarkingVisualAnnotation[] }
export interface MarkingOralEvidence { items: { id: string; label: string; checked: boolean; note: string }[]; notes: string }
export interface MarkingRubricFeedback { criterionId: string; level: string; feedback: string }
export interface ArchivedMarkingFeedback { id: string; criterionId: string | null; level: string; text: string }
export interface MarkingAttempt extends MarkingBase { archivedAt?: string | null; keepStudentWork?: boolean; classEnrollmentId: string | null; rubricId: string; documents: MarkingDocument[]; previousAttemptId: string | null; mode?: MarkingMode; imagePages?: MarkingImagePage[] }
export interface MarkingAnnotation { id: string; documentId: string; start: number; end: number; quote: string; criterionId: string; level: string; text: string }
export interface MarkingJudgment { assessmentCategoryId: string; assessed: boolean; rawScore: string; inputFormat: ScoreInputFormat; feedback: string }
export interface MarkingDraft { archivedFeedback?: ArchivedMarkingFeedback[]; annotations: MarkingAnnotation[]; pending: MarkingAnnotation | null; judgments: MarkingJudgment[]; overallFeedback: string; imageFeedback?: MarkingPageFeedback[]; oral?: MarkingOralEvidence; rubricFeedback?: MarkingRubricFeedback[] }
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
export interface MarkingContext { assessment: Assessment; categories: AssessmentCategory[]; enrollments: ClassEnrollment[]; historicalEnrollments?: ClassEnrollment[]; students: Student[]; rubrics: MarkingRubric[]; attempts: MarkingAttempt[]; archivedAttempts: MarkingAttempt[]; historicalAttempts?: MarkingAttempt[]; sessions: MarkingSession[]; commits: MarkingCommit[]; currentResults: CategoryResult[]; studentAssessments: StudentAssessment[]; scaleOptions: Record<string,string[]> }
export const MARKING_LIMITS = { fileBytes: 2*1024*1024, batchBytes: 10*1024*1024, batchFiles: 10, textCharacters: 200000, documents: 10, annotations: 2000, criteria: 40, levels: 30, expandedDocxBytes: 20*1024*1024, imageBytes: 8*1024*1024, imageBatchBytes: 32*1024*1024, imagePages: 10, imagePixels: 20*1024*1024, visualAnnotations: 500, strokePoints: 512, checklistItems: 100 } as const;
