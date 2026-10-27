import type { OntarioTeacherDB } from '../db/database';
import type { AchievementCategoryCode, Assessment, AssessmentCategory, GradeOverride, StudentAssessment, Unit } from '../types/schema';
import { assertClassSectionWriteAccess } from './authHelper';
import { captureLocalWriteActor, guardLocalWriteIdentity, type LocalWriteActor } from './localWriteIdentity';
import { ConcurrencyConflictError, MarkbookDomainService, ValidationError } from './markbookService';

/** A default policy does not identify a reporting period. Never substitute a demo ID. */
export async function profileReportingPeriods(db: OntarioTeacherDB, classSectionId: string, policyId: string) {
  const section = await db.classSections.get(classSectionId);
  const policy = await db.gradingPolicies.get(policyId);
  if (!section || section.deletedAt !== null || !policy || policy.deletedAt !== null || policy.classSectionId !== section.id) throw new ValidationError('The class or grading policy is no longer available. Reopen the profile.');
  const term = await db.terms.get(section.termId);
  if (!term || term.deletedAt !== null) throw new ValidationError('The class term is no longer available.');
  const periods = await db.reportingPeriods.where('termId').equals(section.termId).filter(p => p.deletedAt === null && !p.isClosed).sortBy('sequenceNumber');
  const suggestedId = policy.reportingPeriodId && periods.some(p => p.id === policy.reportingPeriodId)
    ? policy.reportingPeriodId : periods.length === 1 ? periods[0].id : '';
  return { periods, suggestedId };
}
interface ProfileScope extends LocalWriteActor { enrollmentId: string; classSectionId: string; policyId: string; reportingPeriodId?: string }
export interface CreateIndividualAssessment extends ProfileScope {
  /** Stable for this form's operation, including retries after an uncertain response. */
  operationId: string; title: string; assessmentType: 'formative' | 'summative'; categoryCode: AchievementCategoryCode;
  rawPercentage: string; feedback: string;
}
export class ProfileAssessmentService {
  constructor(private db: OntarioTeacherDB) {}
  private async context(input: ProfileScope) {
    const enrollment = await this.db.classEnrollments.get(input.enrollmentId);
    if (!enrollment || enrollment.deletedAt !== null || enrollment.enrollmentStatus !== 'active' || enrollment.classSectionId !== input.classSectionId) throw new ValidationError('The student is no longer actively enrolled in this class.');
    const auth = await assertClassSectionWriteAccess(this.db, input.userId, input.classSectionId);
    const student = await this.db.students.get(enrollment.studentId);
    if (!student || student.deletedAt !== null || student.organizationId !== auth.organizationId) throw new ValidationError('Student and class organization do not match.');
    const options = await profileReportingPeriods(this.db, input.classSectionId, input.policyId);
    const period = options.periods.find(p => p.id === (input.reportingPeriodId || options.suggestedId));
    if (!period) throw new ValidationError('Choose an open reporting period for this class term.');
    return { auth, period };
  }
  async createIndividual(input: CreateIndividualAssessment): Promise<Assessment> {
    const actor = captureLocalWriteActor(input);
    const request = { ...input, title: input.title.trim(), rawPercentage: input.rawPercentage.trim(), feedback: input.feedback.trim() };
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.operationId) || !request.title || request.title.length > 200 || !['formative', 'summative'].includes(request.assessmentType) || !['K', 'T', 'C', 'A'].includes(request.categoryCode)) throw new ValidationError('Enter a title, assessment type and achievement category.');
    return this.db.transaction('rw', this.db.tables, async () => {
      const check = await guardLocalWriteIdentity(this.db, actor);
      const { auth, period } = await this.context(request);
      const id = `individual-${request.operationId}`, categoryId = `${id}-category`, assignmentId = `${id}-student`;
      // The atomic insert audit is also the receipt. Compare the submitted request so reusing
      // an operation ID for different input cannot silently succeed or overwrite later work.
      const signature = JSON.stringify({ enrollmentId: request.enrollmentId, classSectionId: request.classSectionId, periodId: period.id,
        title: request.title, assessmentType: request.assessmentType, categoryCode: request.categoryCode, rawPercentage: request.rawPercentage, feedback: request.feedback });
      const existing = await this.db.assessments.get(id);
      if (existing) {
        const receipt = await this.db.auditEntries.get(`${id}-receipt`);
        if (!receipt || receipt.userId !== actor.userId || receipt.diffJson !== signature || existing.deletedAt !== null) throw new ConcurrencyConflictError('This save identifier already belongs to different work. Reopen the form.');
        check(); return existing;
      }
      const now = new Date().toISOString(), meta = { createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
      const created: { entityName: string; record: Unit | Assessment | AssessmentCategory | StudentAssessment }[] = [];
      const units = await this.db.units.where('classSectionId').equals(request.classSectionId).sortBy('sortOrder');
      let unit = units.find(row => row.deletedAt === null);
      if (!unit) {
        // Retained soft-deleted units still own their unique class/code key.
        const usedCodes = new Set(units.map(row => row.code.trim().toUpperCase()));
        let number = 1; while (usedCodes.has(`U${number}`)) number++;
        unit = { ...meta, id: `${id}-unit`, classSectionId: request.classSectionId, code: `U${number}`, title: `Unit ${number}: Individual Assignments`, sortOrder: Math.max(0, ...units.map(row => row.sortOrder)) + 1, startsOn: null, endsOn: null };
        await this.db.units.add(unit); created.push({ entityName: 'units', record: unit });
      }
      const assessment: Assessment = { ...meta, id, classSectionId: request.classSectionId, unitId: unit.id, reportingPeriodId: period.id, code: `IND-${request.operationId}`, title: request.title, assessmentType: request.assessmentType, assignedAt: now, dueAt: now, isLocked: false };
      // Percentage-only input is explicit. Let the grading service resolve its real period policy.
      const category: AssessmentCategory = { ...meta, id: categoryId, assessmentId: id, categoryCode: request.categoryCode, maxScore: 100, evidenceWeight: 1, markScaleVersionId: null };
      const assignment: StudentAssessment = { ...meta, id: assignmentId, assessmentId: id, classEnrollmentId: request.enrollmentId, classSectionId: request.classSectionId,
        workflowStatus: 'assigned', completionStatus: request.rawPercentage ? 'complete' : 'not_assessed', isLate: false, assignedAt: now, dueAt: now, submittedAt: request.rawPercentage ? now : null,
        assessedAt: null, returnedAt: null, overallFeedback: request.feedback || null, privateNotes: null };
      await this.db.assessments.add(assessment); await this.db.assessmentCategories.add(category); await this.db.studentAssessments.add(assignment);
      created.push({ entityName: 'assessments', record: assessment }, { entityName: 'assessmentCategories', record: category }, { entityName: 'studentAssessments', record: assignment });
      for (const [index, row] of created.entries()) {
        await this.db.auditEntries.add({ id: row.entityName === 'assessments' ? `${id}-receipt` : crypto.randomUUID(), entityName: row.entityName, entityId: row.record.id, action: 'INSERT', transactionId: id,
          previousStateJson: null, newStateJson: JSON.stringify(row.record), diffJson: row.entityName === 'assessments' ? signature : null, userId: actor.userId, timestamp: now, clientVersion: '1.0.0' });
        await this.db.syncMutations.add({ id: crypto.randomUUID(), deviceId: actor.deviceId, organizationId: auth.organizationId, mutationId: crypto.randomUUID(), transactionId: id, sequenceNumber: index + 1, transactionSize: created.length,
          entityName: row.entityName, entityId: row.record.id, operation: 'INSERT', payloadJson: JSON.stringify(row.record), baseVersion: 0, status: 'pending', createdAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null, acknowledgedAt: null });
      }
      if (request.rawPercentage) await new MarkbookDomainService(this.db).recordCategoryResult({ studentAssessmentId: assignmentId, assessmentCategoryId: categoryId, rawScore: request.rawPercentage, inputFormat: 'percentage', feedback: request.feedback || null, expectedStudentAssessmentVersion: 1, userId: actor.userId, deviceId: actor.deviceId });
      check(); return assessment;
    });
  }
  async saveOverride(input: ProfileScope & { categoryCode: GradeOverride['categoryCode']; overridePercentage: number; rationale: string; expected: Pick<GradeOverride, 'id' | 'version'> | null }): Promise<GradeOverride> {
    const actor = captureLocalWriteActor(input);
    const request = structuredClone(input);
    return this.db.transaction('rw', this.db.tables, async () => {
      const check = await guardLocalWriteIdentity(this.db, actor);
      const { period } = await this.context(request);
      const current = await this.db.gradeOverrides.where({ classEnrollmentId: request.enrollmentId, reportingPeriodId: period.id, categoryCode: request.categoryCode }).first();
      if (request.expected ? !current || current.id !== request.expected.id || current.version !== request.expected.version : !!current) throw new ConcurrencyConflictError('This override changed since the form opened. Reopen it to review the current value.');
      const saved = await new MarkbookDomainService(this.db).saveGradeOverride({ classEnrollmentId: request.enrollmentId, reportingPeriodId: period.id, categoryCode: request.categoryCode, overridePercentage: request.overridePercentage, rationale: request.rationale.trim(), expectedVersion: request.expected?.version, userId: actor.userId, deviceId: actor.deviceId });
      check(); return saved;
    });
  }
}
