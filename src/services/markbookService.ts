import type { OntarioTeacherDB } from '../db/database';
import { normalizeEnteredScore } from './calculationEngine';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import type {
  CategoryResult,
  ScoreInputFormat,
  UUID,
  AuditEntry,
  SyncMutation,
  StudentAssessment
} from '../types/schema';

export interface RecordCategoryResultParams {
  studentAssessmentId: UUID;
  assessmentCategoryId: UUID;
  rawScore: string;
  inputFormat: ScoreInputFormat;
  feedback?: string | null; // undefined = unchanged, null = clear, string = new value
  expectedVersion?: number; // Mandatory if updating existing CategoryResult
  expectedStudentAssessmentVersion?: number; // Mandatory if existing result updated
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
   * Executes atomic, in-transaction authorization, validation, normalization, scoring, audit, and sync mutations.
   */
  async recordCategoryResult(params: RecordCategoryResultParams): Promise<CategoryResult> {
    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.studentAssessments,
        this.db.assessments,
        this.db.assessmentCategories,
        this.db.classEnrollments,
        this.db.reportingPeriods,
        this.db.categoryResults,
        this.db.gradingPolicies,
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

        // Validate reporting period exists and is open
        const repPeriod = await this.db.reportingPeriods.get(assessment.reportingPeriodId);
        if (!repPeriod || repPeriod.deletedAt !== null) {
          throw new ValidationError(`Assessment references non-existent or deleted reporting period.`);
        }
        if (repPeriod.isClosed) {
          throw new ValidationError(`Reporting period "${repPeriod.name}" is closed.`);
        }

        // 2. In-Transaction Authorization Check
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, assessment.classSectionId);
        const derivedOrgId = auth.organizationId;

        // 3. Single-Path Deterministic Scale Fallback
        let scaleVersionId = catDef.markScaleVersionId;
        if (!scaleVersionId) {
          // Prefer reporting-period policy
          const rpPolicy = await this.db.gradingPolicies
            .where({ classSectionId: assessment.classSectionId, reportingPeriodId: assessment.reportingPeriodId })
            .first();
          if (rpPolicy && rpPolicy.deletedAt === null) {
            scaleVersionId = rpPolicy.defaultMarkScaleVersionId;
          } else {
            // Fallback to class section default policy
            const defaultPolicy = await this.db.gradingPolicies
              .where({ classSectionId: assessment.classSectionId, scopeKey: 'DEFAULT' })
              .first();
            if (defaultPolicy && defaultPolicy.deletedAt === null) {
              scaleVersionId = defaultPolicy.defaultMarkScaleVersionId;
            }
          }
        }

        if (!scaleVersionId) {
          throw new ValidationError('No mark scale version or default grading policy configured for this category.');
        }

        const scaleEntries = await this.db.markScaleEntries
          .where('markScaleVersionId')
          .equals(scaleVersionId)
          .toArray();

        if (scaleEntries.length === 0 && params.inputFormat === 'scale_code') {
          throw new ValidationError(`Configured mark scale version "${scaleVersionId}" has no valid scale entries.`);
        }

        // 4. Deterministic Domain Normalization
        const norm = normalizeEnteredScore(params.rawScore, params.inputFormat, catDef.maxScore, scaleEntries);
        if (norm.error) {
          throw new ValidationError(norm.error);
        }

        // 5. Check Existing Result & Mandatory Optimistic Concurrency
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

          if (params.expectedVersion === undefined) {
            throw new ValidationError(`expectedVersion is mandatory when updating an existing category result.`);
          }

          if (existing.version !== params.expectedVersion) {
            throw new ConcurrencyConflictError(
              `Version conflict on categoryResult ${existing.id}. Expected ${params.expectedVersion}, got ${existing.version}.`
            );
          }

          if (params.expectedStudentAssessmentVersion !== undefined && sa.version !== params.expectedStudentAssessmentVersion) {
            throw new ConcurrencyConflictError(
              `Version conflict on parent studentAssessment ${sa.id}. Expected ${params.expectedStudentAssessmentVersion}, got ${sa.version}.`
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

        // 6. Update parent student assessment workflow & timestamp
        const updatedSA: StudentAssessment = {
          ...sa,
          classSectionId: assessment.classSectionId,
          workflowStatus: 'assessed',
          assessedAt: now,
          updatedAt: now,
          version: sa.version + 1
        };
        await this.db.studentAssessments.put(updatedSA);

        // 7. Append-Only Structured Audit Entry
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

        // 8. Enqueue Complete Transaction Sync Mutations (Size: 2)
        const mutationCategoryResult: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 2,
          entityName: 'categoryResults',
          entityId: result.id,
          operation: action,
          payloadJson: JSON.stringify(result),
          baseVersion: action === 'UPDATE' ? (existing?.version ?? 0) : 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        const mutationStudentAssessment: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 2,
          transactionSize: 2,
          entityName: 'studentAssessments',
          entityId: updatedSA.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updatedSA),
          baseVersion: sa.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await this.db.syncMutations.bulkAdd([mutationCategoryResult, mutationStudentAssessment]);

        return result;
      }
    );
  }
}

