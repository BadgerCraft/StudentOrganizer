import type { OntarioTeacherDB } from '../db/database';
import { normalizeEnteredScore } from './calculationEngine';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import type {
  CategoryResult,
  ScoreInputFormat,
  UUID,
  AuditEntry,
  SyncMutation,
  StudentAssessment,
  GradeOverride,
  OverrideCategoryCode,
  CompletionStatus
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

export interface SaveGradeOverrideParams {
  classEnrollmentId: UUID;
  reportingPeriodId: UUID;
  categoryCode: OverrideCategoryCode;
  overridePercentage: number;
  rationale: string;
  expectedVersion?: number;
  userId: UUID;
  deviceId: UUID;
}

export interface SaveMarkbookCellParams {
  assessmentId: UUID;
  classEnrollmentId: UUID;
  classSectionId: UUID;
  completionStatus?: CompletionStatus;
  isLate?: boolean;
  assessmentCategoryId?: UUID;
  rawScore?: string;
  inputFormat?: ScoreInputFormat;
  feedback?: string | null;
  expectedStudentAssessmentVersion?: number;
  expectedCategoryResultVersion?: number;
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

  /**
   * Saves or updates a grade override under the unique compound key [classEnrollmentId+reportingPeriodId+categoryCode].
   * If an override already exists for this enrollment, reporting period, and category:
   * - Preserves existing record ID and createdAt
   * - Increments version number
   * - Updates overridePercentage, rationale, teacherUserId, and updatedAt
   * - Records atomic AuditEntry ('UPDATE') and SyncMutation ('UPDATE')
   * If none exists:
   * - Inserts new record with version 1
   * - Records atomic AuditEntry ('INSERT') and SyncMutation ('INSERT')
   * Enforces in-transaction write authorization via assertClassSectionWriteAccess.
   */
  async saveGradeOverride(params: SaveGradeOverrideParams): Promise<GradeOverride> {
    if (!params.classEnrollmentId || !params.reportingPeriodId || !params.categoryCode) {
      throw new ValidationError('classEnrollmentId, reportingPeriodId, and categoryCode are required.');
    }

    if (
      typeof params.overridePercentage !== 'number' ||
      isNaN(params.overridePercentage) ||
      params.overridePercentage < 0 ||
      params.overridePercentage > 100
    ) {
      throw new ValidationError('Override percentage must be a valid number between 0 and 100.');
    }

    const validCategories: OverrideCategoryCode[] = ['OVERALL', 'K', 'T', 'C', 'A'];
    if (!validCategories.includes(params.categoryCode)) {
      throw new ValidationError(
        `Invalid category code: "${params.categoryCode}". Expected one of: ${validCategories.join(', ')}.`
      );
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.gradeOverrides,
        this.db.classEnrollments,
        this.db.reportingPeriods,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // 1. Look up class enrollment
        const enrollment = await this.db.classEnrollments.get(params.classEnrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Class enrollment ${params.classEnrollmentId} not found or deleted.`);
        }

        // 2. Look up reporting period
        const repPeriod = await this.db.reportingPeriods.get(params.reportingPeriodId);
        if (!repPeriod || repPeriod.deletedAt !== null) {
          throw new ValidationError(`Reporting period ${params.reportingPeriodId} not found or deleted.`);
        }
        if (repPeriod.isClosed) {
          throw new ValidationError(`Reporting period "${repPeriod.name}" is closed.`);
        }

        // 3. In-Transaction Authorization Check
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, enrollment.classSectionId);
        const derivedOrgId = auth.organizationId;

        // 4. Query existing override using compound key
        const existing = await this.db.gradeOverrides
          .where({
            classEnrollmentId: params.classEnrollmentId,
            reportingPeriodId: params.reportingPeriodId,
            categoryCode: params.categoryCode
          })
          .first();

        let record: GradeOverride;
        let action: 'INSERT' | 'UPDATE' = 'INSERT';
        let previousStateJson: string | null = null;
        let diff: Record<string, { old: any; new: any }> | null = null;

        if (existing) {
          if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
            throw new ConcurrencyConflictError(
              `Version conflict on gradeOverride ${existing.id}. Expected ${params.expectedVersion}, got ${existing.version}.`
            );
          }

          action = 'UPDATE';
          previousStateJson = JSON.stringify(existing);
          diff = {
            overridePercentage: { old: existing.overridePercentage, new: params.overridePercentage },
            rationale: { old: existing.rationale, new: params.rationale.trim() },
            teacherUserId: { old: existing.teacherUserId, new: params.userId }
          };

          record = {
            ...existing,
            overridePercentage: params.overridePercentage,
            rationale: params.rationale.trim(),
            teacherUserId: params.userId,
            updatedAt: now,
            deletedAt: null,
            version: existing.version + 1
          };

          await this.db.gradeOverrides.put(record);
        } else {
          action = 'INSERT';
          record = {
            id: crypto.randomUUID(),
            classEnrollmentId: params.classEnrollmentId,
            reportingPeriodId: params.reportingPeriodId,
            categoryCode: params.categoryCode,
            overridePercentage: params.overridePercentage,
            rationale: params.rationale.trim(),
            teacherUserId: params.userId,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };

          await this.db.gradeOverrides.add(record);
        }

        // 5. Append-Only Structured Audit Entry
        const auditEntry: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'gradeOverrides',
          entityId: record.id,
          action,
          transactionId: txId,
          previousStateJson,
          newStateJson: JSON.stringify(record),
          diffJson: diff ? JSON.stringify(diff) : null,
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };
        await this.db.auditEntries.add(auditEntry);

        // 6. Enqueue Sync Mutation
        const syncMutation: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'gradeOverrides',
          entityId: record.id,
          operation: action,
          payloadJson: JSON.stringify(record),
          baseVersion: action === 'UPDATE' ? existing!.version : 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };
        await this.db.syncMutations.add(syncMutation);

        return record;
      }
    );
  }

  /**
   * Atomically saves a markbook cell edit, encompassing:
   * - Ensuring / updating StudentAssessment (workflowStatus, completionStatus, isLate, classSectionId)
   * - Normalizing and saving CategoryResult if a score was entered
   * - In-transaction authorization check
   * - Atomic AuditEntries and SyncMutations for all modified entities
   */
  async saveMarkbookCell(params: SaveMarkbookCellParams): Promise<{
    studentAssessment: StudentAssessment;
    categoryResult?: CategoryResult;
  }> {
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

        // 1. Look up parent assessment
        const assessment = await this.db.assessments.get(params.assessmentId);
        if (!assessment || assessment.deletedAt !== null) {
          throw new ValidationError(`Assessment ${params.assessmentId} not found or deleted.`);
        }
        if (assessment.isLocked) {
          throw new ValidationError(`Assessment "${assessment.title}" is locked against modifications.`);
        }

        // 2. Look up class enrollment
        const enrollment = await this.db.classEnrollments.get(params.classEnrollmentId);
        if (!enrollment || enrollment.deletedAt !== null) {
          throw new ValidationError(`Class enrollment ${params.classEnrollmentId} not found or deleted.`);
        }
        if (enrollment.classSectionId !== assessment.classSectionId) {
          throw new ValidationError('Enrollment class section does not match assessment class section.');
        }

        // 3. Look up reporting period
        const repPeriod = await this.db.reportingPeriods.get(assessment.reportingPeriodId);
        if (!repPeriod || repPeriod.deletedAt !== null) {
          throw new ValidationError(`Assessment references non-existent or deleted reporting period.`);
        }
        if (repPeriod.isClosed) {
          throw new ValidationError(`Reporting period "${repPeriod.name}" is closed.`);
        }

        // 4. In-Transaction Authorization Check
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, assessment.classSectionId);
        const derivedOrgId = auth.organizationId;

        // 5. Look up or create studentAssessment
        const sa = await this.db.studentAssessments
          .where({
            assessmentId: params.assessmentId,
            classEnrollmentId: params.classEnrollmentId
          })
          .first();

        const hasScore =
          params.rawScore !== undefined && params.rawScore.trim() !== '' && !!params.assessmentCategoryId;
        const completionStatus = params.completionStatus || (sa ? sa.completionStatus : 'complete');
        const isLate = params.isLate !== undefined ? params.isLate : (sa ? sa.isLate : false);

        let saAction: 'INSERT' | 'UPDATE' = 'INSERT';
        let saPrevJson: string | null = null;
        let saDiff: Record<string, { old: any; new: any }> | null = null;
        let updatedSA: StudentAssessment;

        if (sa) {
          if (sa.deletedAt !== null) {
            throw new ValidationError('Cannot update a deleted student assessment.');
          }
          if (
            params.expectedStudentAssessmentVersion !== undefined &&
            sa.version !== params.expectedStudentAssessmentVersion
          ) {
            throw new ConcurrencyConflictError(
              `Version conflict on studentAssessment ${sa.id}. Expected ${params.expectedStudentAssessmentVersion}, got ${sa.version}.`
            );
          }

          saAction = 'UPDATE';
          saPrevJson = JSON.stringify(sa);
          const nextWorkflow = hasScore ? 'assessed' : sa.workflowStatus;
          saDiff = {
            completionStatus: { old: sa.completionStatus, new: completionStatus },
            isLate: { old: sa.isLate, new: isLate },
            workflowStatus: { old: sa.workflowStatus, new: nextWorkflow }
          };

          updatedSA = {
            ...sa,
            classSectionId: assessment.classSectionId,
            workflowStatus: nextWorkflow,
            completionStatus,
            isLate,
            assessedAt: hasScore ? now : sa.assessedAt,
            updatedAt: now,
            version: sa.version + 1
          };
          await this.db.studentAssessments.put(updatedSA);
        } else {
          saAction = 'INSERT';
          updatedSA = {
            id: crypto.randomUUID(),
            assessmentId: params.assessmentId,
            classEnrollmentId: params.classEnrollmentId,
            classSectionId: assessment.classSectionId,
            workflowStatus: hasScore ? 'assessed' : 'assigned',
            completionStatus,
            isLate,
            assignedAt: assessment.assignedAt || now,
            dueAt: assessment.dueAt || now,
            submittedAt: now,
            assessedAt: hasScore ? now : null,
            returnedAt: null,
            overallFeedback: null,
            privateNotes: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await this.db.studentAssessments.add(updatedSA);
        }

        // 6. If category score entered, normalize and write CategoryResult
        let savedCr: CategoryResult | undefined;
        let crAction: 'INSERT' | 'UPDATE' = 'INSERT';
        let crPrevJson: string | null = null;
        let crDiff: Record<string, { old: any; new: any }> | null = null;

        if (hasScore && params.assessmentCategoryId) {
          const catDef = await this.db.assessmentCategories.get(params.assessmentCategoryId);
          if (!catDef || catDef.deletedAt !== null) {
            throw new ValidationError(`Assessment category ${params.assessmentCategoryId} not found or deleted.`);
          }
          if (catDef.assessmentId !== assessment.id) {
            throw new ValidationError('Assessment category does not belong to this assessment.');
          }

          // Deterministic mark scale resolution
          let scaleVersionId = catDef.markScaleVersionId;
          if (!scaleVersionId) {
            const rpPolicy = await this.db.gradingPolicies
              .where({ classSectionId: assessment.classSectionId, reportingPeriodId: assessment.reportingPeriodId })
              .first();
            if (rpPolicy && rpPolicy.deletedAt === null) {
              scaleVersionId = rpPolicy.defaultMarkScaleVersionId;
            } else {
              const defaultPolicy = await this.db.gradingPolicies
                .where({ classSectionId: assessment.classSectionId, scopeKey: 'DEFAULT' })
                .first();
              if (defaultPolicy && defaultPolicy.deletedAt === null) {
                scaleVersionId = defaultPolicy.defaultMarkScaleVersionId;
              }
            }
          }

          const scaleEntries = scaleVersionId
            ? await this.db.markScaleEntries.where('markScaleVersionId').equals(scaleVersionId).toArray()
            : [];

          const norm = normalizeEnteredScore(
            params.rawScore!,
            params.inputFormat || 'percentage',
            catDef.maxScore,
            scaleEntries
          );
          if (norm.error) {
            throw new ValidationError(norm.error);
          }

          const existingCr = await this.db.categoryResults
            .where({
              studentAssessmentId: updatedSA.id,
              assessmentCategoryId: params.assessmentCategoryId
            })
            .first();

          if (existingCr) {
            if (existingCr.deletedAt !== null) {
              throw new ValidationError('Cannot update a deleted category result.');
            }
            if (
              params.expectedCategoryResultVersion !== undefined &&
              existingCr.version !== params.expectedCategoryResultVersion
            ) {
              throw new ConcurrencyConflictError(
                `Version conflict on categoryResult ${existingCr.id}. Expected ${params.expectedCategoryResultVersion}, got ${existingCr.version}.`
              );
            }

            crAction = 'UPDATE';
            crPrevJson = JSON.stringify(existingCr);
            const finalFeedback = params.feedback === undefined ? existingCr.feedback : params.feedback;
            crDiff = {
              rawScore: { old: existingCr.rawScore, new: params.rawScore },
              normalizedPercentage: { old: existingCr.normalizedPercentage, new: norm.normalizedPercentage },
              pointsEarned: { old: existingCr.pointsEarned, new: norm.pointsEarned },
              feedback: { old: existingCr.feedback, new: finalFeedback }
            };

            savedCr = {
              ...existingCr,
              rawScore: params.rawScore!,
              inputFormat: params.inputFormat || 'percentage',
              normalizedPercentage: norm.normalizedPercentage,
              pointsEarned: norm.pointsEarned,
              pointsPossibleSnapshot: norm.pointsPossibleSnapshot,
              feedback: finalFeedback,
              assessedAt: now,
              updatedAt: now,
              version: existingCr.version + 1
            };
            await this.db.categoryResults.put(savedCr);
          } else {
            crAction = 'INSERT';
            savedCr = {
              id: crypto.randomUUID(),
              studentAssessmentId: updatedSA.id,
              assessmentCategoryId: params.assessmentCategoryId,
              rawScore: params.rawScore!,
              inputFormat: params.inputFormat || 'percentage',
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
            await this.db.categoryResults.add(savedCr);
          }
        }

        // 7. Audit and Sync mutations in same transaction
        const totalMutations = savedCr ? 2 : 1;
        let seq = 1;

        // StudentAssessment audit & sync
        await this.db.auditEntries.add({
          id: crypto.randomUUID(),
          entityName: 'studentAssessments',
          entityId: updatedSA.id,
          action: saAction,
          transactionId: txId,
          previousStateJson: saPrevJson,
          newStateJson: JSON.stringify(updatedSA),
          diffJson: saDiff ? JSON.stringify(saDiff) : null,
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        });

        await this.db.syncMutations.add({
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: derivedOrgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: seq++,
          transactionSize: totalMutations,
          entityName: 'studentAssessments',
          entityId: updatedSA.id,
          operation: saAction,
          payloadJson: JSON.stringify(updatedSA),
          baseVersion: saAction === 'UPDATE' ? sa!.version : 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        });

        // CategoryResult audit & sync (if scored)
        if (savedCr) {
          await this.db.auditEntries.add({
            id: crypto.randomUUID(),
            entityName: 'categoryResults',
            entityId: savedCr.id,
            action: crAction,
            transactionId: txId,
            previousStateJson: crPrevJson,
            newStateJson: JSON.stringify(savedCr),
            diffJson: crDiff ? JSON.stringify(crDiff) : null,
            userId: params.userId,
            timestamp: now,
            clientVersion: '1.0.0'
          });

          await this.db.syncMutations.add({
            id: crypto.randomUUID(),
            deviceId: params.deviceId,
            organizationId: derivedOrgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: seq++,
            transactionSize: totalMutations,
            entityName: 'categoryResults',
            entityId: savedCr.id,
            operation: crAction,
            payloadJson: JSON.stringify(savedCr),
            baseVersion: crAction === 'UPDATE' ? savedCr.version - 1 : 0,
            status: 'pending',
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });
        }

        return { studentAssessment: updatedSA, categoryResult: savedCr };
      }
    );
  }
}
