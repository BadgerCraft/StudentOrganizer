import type { OntarioTeacherDB } from '../db/database';
import type { Assessment, AssessmentCategory, StudentAssessment, GradingPolicy, UUID } from '../types/schema';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';

interface Actor { userId: UUID; deviceId: UUID }
interface CategoryInput { categoryCode: AssessmentCategory['categoryCode']; maxScore: number; evidenceWeight: number }
interface CreateInput extends Actor {
  classSectionId: UUID; unitId: UUID; title: string;
  assessmentType: 'summative' | 'formative'; dueAt: string; categories: CategoryInput[];
}
type PolicyChanges = Pick<GradingPolicy, 'weightK' | 'weightT' | 'weightC' | 'weightA' | 'excludeFormative' | 'missingWorkPolicy'>;

/** All related writes, authority checks and attribution share one transaction. */
export class ClassSettingsService {
  constructor(private db: OntarioTeacherDB) {}

  private async record(entityName: string, next: { id: string; version: number }, previous: typeof next | null,
    actor: Actor, organizationId: UUID, transactionId: UUID, sequenceNumber: number, transactionSize: number) {
    const timestamp = new Date().toISOString();
    await this.db.auditEntries.add({ id: crypto.randomUUID(), entityName, entityId: next.id,
      action: previous ? 'UPDATE' : 'INSERT', transactionId, previousStateJson: previous ? JSON.stringify(previous) : null,
      newStateJson: JSON.stringify(next), diffJson: null, userId: actor.userId, timestamp, clientVersion: '1.0.0' });
    await this.db.syncMutations.add({ id: crypto.randomUUID(), deviceId: actor.deviceId, organizationId,
      mutationId: crypto.randomUUID(), transactionId, sequenceNumber, transactionSize, entityName, entityId: next.id,
      operation: previous ? 'UPDATE' : 'INSERT', payloadJson: JSON.stringify(next), baseVersion: previous?.version ?? 0,
      status: 'pending', createdAt: timestamp, attemptCount: 0, lastAttemptAt: null, lastError: null, acknowledgedAt: null });
  }

  async createAssessment(input: CreateInput): Promise<Assessment> {
    if (!input.title.trim() || input.title.trim().length > 200 || !Number.isFinite(Date.parse(input.dueAt)))
      throw new ValidationError('A title and valid due date are required.');
    if (!['summative', 'formative'].includes(input.assessmentType) || !input.categories.length ||
      new Set(input.categories.map(c => c.categoryCode)).size !== input.categories.length ||
      input.categories.some(c => !['K', 'T', 'C', 'A'].includes(c.categoryCode) ||
        !Number.isFinite(c.maxScore) || c.maxScore <= 0 || !Number.isFinite(c.evidenceWeight) || c.evidenceWeight <= 0))
      throw new ValidationError('Select valid categories with positive maximum scores and weights.');
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.units, this.db.gradingPolicies,
      this.db.reportingPeriods, this.db.classEnrollments, this.db.assessments, this.db.assessmentCategories,
      this.db.studentAssessments, this.db.auditEntries, this.db.syncMutations], async () => {
      const auth = await assertClassSectionWriteAccess(this.db, input.userId, input.classSectionId);
      const unit = await this.db.units.get(input.unitId);
      if (!unit || unit.deletedAt !== null || unit.classSectionId !== input.classSectionId)
        throw new ValidationError('Unit does not belong to this class.');
      const policy = await this.db.gradingPolicies.where('classSectionId').equals(input.classSectionId)
        .filter(p => p.deletedAt === null).first();
      const period = policy?.reportingPeriodId ? await this.db.reportingPeriods.get(policy.reportingPeriodId)
        : await this.db.reportingPeriods.where('termId').equals(auth.classSection.termId)
          .filter(p => p.deletedAt === null).first();
      if (!period || period.deletedAt !== null || period.termId !== auth.classSection.termId)
        throw new ValidationError('No valid reporting period is available for this class.');
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const assessment: Assessment = { id, classSectionId: input.classSectionId, unitId: unit.id,
        reportingPeriodId: period.id, code: `A-${id}`, title: input.title.trim(), assessmentType: input.assessmentType,
        assignedAt: now, dueAt: input.dueAt, isLocked: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
      const categories: AssessmentCategory[] = input.categories.map(c => ({ ...c, id: crypto.randomUUID(), assessmentId: id,
        markScaleVersionId: policy?.defaultMarkScaleVersionId ?? null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }));
      const enrollments = await this.db.classEnrollments.where('classSectionId').equals(input.classSectionId)
        .filter(e => e.deletedAt === null && e.enrollmentStatus === 'active').toArray();
      const assignments: StudentAssessment[] = enrollments.map(e => ({ id: crypto.randomUUID(), assessmentId: id,
        classEnrollmentId: e.id, classSectionId: input.classSectionId, workflowStatus: 'assigned', completionStatus: 'incomplete',
        isLate: false, assignedAt: now, dueAt: input.dueAt, submittedAt: null, assessedAt: null, returnedAt: null,
        overallFeedback: null, privateNotes: null, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }));
      await this.db.assessments.add(assessment);
      await this.db.assessmentCategories.bulkAdd(categories);
      await this.db.studentAssessments.bulkAdd(assignments);
      const rows = [{ table: 'assessments', row: assessment }, ...categories.map(row => ({ table: 'assessmentCategories', row })),
        ...assignments.map(row => ({ table: 'studentAssessments', row }))];
      const txId = crypto.randomUUID();
      for (const [i, item] of rows.entries()) await this.record(item.table, item.row, null, input, auth.organizationId, txId, i + 1, rows.length);
      return assessment;
    });
  }

  async archiveAssessment(id: UUID, expectedVersion: number, actor: Actor): Promise<void> {
    await this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.assessments, this.db.auditEntries, this.db.syncMutations], async () => {
      const previous = await this.db.assessments.get(id);
      if (!previous || previous.deletedAt !== null) throw new ValidationError('Assessment is unavailable.');
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, previous.classSectionId);
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Assessment changed. Please refresh.');
      const now = new Date().toISOString();
      const next = { ...previous, deletedAt: now, updatedAt: now, version: previous.version + 1 };
      await this.db.assessments.put(next);
      await this.record('assessments', next, previous, actor, auth.organizationId, crypto.randomUUID(), 1, 1);
    });
  }

  async duplicateAssessment(id: UUID, expectedVersion: number, actor: Actor): Promise<Assessment> {
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.assessments, this.db.assessmentCategories,
      this.db.auditEntries, this.db.syncMutations], async () => {
      const previous = await this.db.assessments.get(id);
      if (!previous || previous.deletedAt !== null) throw new ValidationError('Assessment is unavailable.');
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, previous.classSectionId);
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Assessment changed. Please refresh.');
      const now = new Date().toISOString();
      const newId = crypto.randomUUID();
      const next = { ...previous, id: newId, code: `A-${newId}`, title: `${previous.title} (Copy)`, createdAt: now, updatedAt: now, version: 1 };
      const oldCategories = await this.db.assessmentCategories.where('assessmentId').equals(id).filter(c => c.deletedAt === null).toArray();
      const categories = oldCategories.map(c => ({ ...c, id: crypto.randomUUID(), assessmentId: newId, createdAt: now, updatedAt: now, version: 1 }));
      await this.db.assessments.add(next);
      await this.db.assessmentCategories.bulkAdd(categories);
      const txId = crypto.randomUUID();
      await this.record('assessments', next, null, actor, auth.organizationId, txId, 1, categories.length + 1);
      for (const [i, category] of categories.entries()) await this.record('assessmentCategories', category, null, actor, auth.organizationId, txId, i + 2, categories.length + 1);
      return next;
    });
  }

  async updateGradingPolicy(id: UUID, expectedVersion: number, changes: PolicyChanges, actor: Actor): Promise<GradingPolicy> {
    const weights = [changes.weightK, changes.weightT, changes.weightC, changes.weightA];
    if (weights.some(w => !Number.isFinite(w) || w < 0 || w > 100) || Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > .001 ||
      typeof changes.excludeFormative !== 'boolean' || !['exclude', 'zero_with_warning', 'floor_r'].includes(changes.missingWorkPolicy))
      throw new ValidationError('Category weights must total 100% and the missing-work policy must be valid.');
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.gradingPolicies, this.db.auditEntries, this.db.syncMutations], async () => {
      const previous = await this.db.gradingPolicies.get(id);
      if (!previous || previous.deletedAt !== null) throw new ValidationError('Grading policy is unavailable.');
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, previous.classSectionId);
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Grading policy changed. Please refresh.');
      const next: GradingPolicy = { ...previous, weightK: changes.weightK, weightT: changes.weightT, weightC: changes.weightC,
        weightA: changes.weightA, excludeFormative: changes.excludeFormative, missingWorkPolicy: changes.missingWorkPolicy,
        updatedAt: new Date().toISOString(), version: previous.version + 1 };
      await this.db.gradingPolicies.put(next);
      await this.record('gradingPolicies', next, previous, actor, auth.organizationId, crypto.randomUUID(), 1, 1);
      return next;
    });
  }
}
