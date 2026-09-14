import type { OntarioTeacherDB } from '../db/database';
import { normalizeEnteredScore } from './calculationEngine';
import type {
  CategoryResult,
  ScoreInputFormat,
  UUID,
  AuditEntry,
  SyncMutation
} from '../types/schema';

export interface RecordCategoryResultParams {
  studentAssessmentId: UUID;
  assessmentCategoryId: UUID;
  rawScore: string;
  inputFormat: ScoreInputFormat;
  feedback?: string | null; // undefined = unchanged, null = clear, string = new value
  expectedVersion?: number;
  userId: UUID;
  deviceId: UUID;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export class MarkbookDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Executes atomic, in-transaction validation, normalization, scoring, audit, and sync mutation.
   */
  async recordCategoryResult(params: RecordCategoryResultParams): Promise<CategoryResult> {
    return await this.db.transaction(
      'rw',
      [
        this.db.studentAssessments,
        this.db.assessments,
        this.db.assessmentCategories,
        this.db.classEnrollments,
        this.db.classSections,
        this.db.reportingPeriods,
        this.db.categoryResults,
        this.db.markScaleEntries,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // 1. In-Transaction Entity Lookups
        const sa = await this.db.studentAssessments.get(params.studentAssessmentId);
        if (!sa || sa.deletedAt !== null) {
          throw new ValidationError(`Student assessment ${params.studentAssessmentId} not found or deleted.`);
        }

        const catDef = await this.db.assessmentCategories.get(params.assessmentCategoryId);
        if (!catDef || catDef.deletedAt !== null) {
          throw new ValidationError(`Assessment category ${params.assessmentCategoryId} not found or deleted.`);
        }

        if (sa.assessmentId !== catDef.assessmentId) {
          throw new ValidationError('Student assessment does not match assessment category parent assessment.');
        }

        const assessment = await this.db.assessments.get(sa.assessmentId);
        if (!assessment || assessment.deletedAt !== null) {
          throw new ValidationError(`Parent assessment ${sa.assessmentId} not found or deleted.`);
        }

        if (assessment.isLocked) {
          throw new ValidationError(`Assessment "${assessment.title}" is locked against modifications.`);
        }

        const enrollment = await this.db.classEnrollments.get(sa.classEnrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Class enrollment ${sa.classEnrollmentId} not found or deleted.`);
        }

        if (enrollment.classSectionId !== assessment.classSectionId) {
          throw new ValidationError('Enrollment class section does not match assessment class section.');
        }

        const repPeriod = await this.db.reportingPeriods.get(assessment.reportingPeriodId);
        if (repPeriod && repPeriod.isClosed) {
          throw new ValidationError(`Reporting period "${repPeriod.name}" is closed.`);
        }

        // 2. Fetch Active Scale Entries for Normalization
        let scaleEntries = [];
        if (catDef.markScaleVersionId) {
          scaleEntries = await this.db.markScaleEntries
            .where('markScaleVersionId')
            .equals(catDef.markScaleVersionId)
            .toArray();
        } else {
          // Default to latest version in DB
          scaleEntries = await this.db.markScaleEntries.toArray();
        }

        // 3. Deterministic Domain Normalization
        const norm = normalizeEnteredScore(params.rawScore, params.inputFormat, catDef.maxScore, scaleEntries);
        if (norm.error) {
          throw new ValidationError(norm.error);
        }

        // 4. Check Existing Result & Optimistic Concurrency
        const existing = await this.db.categoryResults
          .where({
            studentAssessmentId: params.studentAssessmentId,
            assessmentCategoryId: params.assessmentCategoryId
          })
          .first();

        let result: CategoryResult;
        let action: 'INSERT' | 'UPDATE' = 'INSERT';
        let previousStateJson: string | null = null;
        let diff: Record<string, { old: any; new: any }> | null = null;

        if (existing) {
          if (existing.deletedAt !== null) {
            throw new ValidationError('Cannot update a deleted category result. Restore it first.');
          }

          if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
            throw new ConcurrencyConflictError(
              `Version conflict on categoryResult ${existing.id}. Expected ${params.expectedVersion}, got ${existing.version}.`
            );
          }

          action = 'UPDATE';
          previousStateJson = JSON.stringify(existing);

          const finalFeedback = params.feedback === undefined ? existing.feedback : params.feedback;

          diff = {
            rawScore: { old: existing.rawScore, new: params.rawScore },
            normalizedPercentage: { old: existing.normalizedPercentage, new: norm.normalizedPercentage },
            pointsEarned: { old: existing.pointsEarned, new: norm.pointsEarned },
            feedback: { old: existing.feedback, new: finalFeedback }
          };

          result = {
            ...existing,
            rawScore: params.rawScore,
            inputFormat: params.inputFormat,
            normalizedPercentage: norm.normalizedPercentage,
            pointsEarned: norm.pointsEarned,
            pointsPossibleSnapshot: norm.pointsPossibleSnapshot,
            feedback: finalFeedback,
            assessedAt: now,
            updatedAt: now,
            version: existing.version + 1
          };

          await this.db.categoryResults.put(result);
        } else {
          action = 'INSERT';
          result = {
            id: crypto.randomUUID(),
            studentAssessmentId: params.studentAssessmentId,
            assessmentCategoryId: params.assessmentCategoryId,
            rawScore: params.rawScore,
            inputFormat: params.inputFormat,
            normalizedPercentage: norm.normalizedPercentage,
            pointsEarned: norm.pointsEarned,
            pointsPossibleSnapshot: norm.pointsPossibleSnapshot,
            feedback: params.feedback ?? null,
            assessedAt: now,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };

          await this.db.categoryResults.add(result);
        }

        // 5. Update parent student assessment workflow & timestamp
        const updatedSA = {
          ...sa,
          workflowStatus: 'assessed' as const,
          assessedAt: now,
          updatedAt: now,
          version: sa.version + 1
        };
        await this.db.studentAssessments.put(updatedSA);

        // 6. Append-Only Structured Audit Entry
        const auditEntry: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'categoryResults',
          entityId: result.id,
          action,
          transactionId: txId,
          previousStateJson,
          newStateJson: JSON.stringify(result),
          diffJson: diff ? JSON.stringify(diff) : null,
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };
        await this.db.auditEntries.add(auditEntry);

        // 7. Enqueue Idempotent Sync Mutation
        const syncMutation: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 2, // categoryResult + studentAssessment
          entityName: 'categoryResults',
          entityId: result.id,
          operation: action,
          payloadJson: JSON.stringify(result),
          baseVersion: action === 'UPDATE' ? (existing?.version ?? 0) : 0,
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };
        await this.db.syncMutations.add(syncMutation);

        return result;
      }
    );
  }
}
