import type { CaptureAttachment } from '../capture/types';
import { assertCaptureBackupCapacity } from '../capture/backupCapacity';
import Dexie from 'dexie';
import { archiveDraft, archiveSnapshot, discardUnfinishedDraft } from './archive';
import type { OntarioTeacherDB } from '../db/database';
import type { Assessment, AssessmentCategory, CategoryResult } from '../types/schema';
import { assertClassSectionWriteAccess, AuthorizationError } from '../services/authHelper';
import { getActiveTeacherId, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { ConcurrencyConflictError, MarkbookDomainService, ValidationError } from '../services/markbookService';
import type { MarkingActor, MarkingAttempt, MarkingBase, MarkingCommit, MarkingContext, MarkingDocument, MarkingDraft, MarkingImagePage, MarkingRubric, MarkingSession, RubricContent } from './types';
import { assertAttemptDraft, assertMarkingDocuments, assertMarkingDraft, assertMarkingImagePages, assertRubricContent, sessionCategories } from './validation';
import { validateMarkingImageBytes, inspectMarkingImage } from './importImages';
import { categoryChangeReview, categorySignature, compatibleCategoryTarget } from './categoryRecovery';

const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter(row => row.deletedAt === null);
const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const clone = <T>(value: T): T => structuredClone(value);

/** Marking text and drafts stay local. Existing grading services own official scores. */
export class MarkingService {
  constructor(private db: OntarioTeacherDB) {}

  private checkActor(actor: MarkingActor) {
    if (!actor || getActiveTeacherId() !== actor.userId || getIdentityEpoch() !== actor.epoch) {
      throw new AuthorizationError('The acting teacher changed. Reopen the marking workspace before continuing.');
    }
  }
  private async transaction<T>(actor: MarkingActor, write: boolean, body: () => Promise<T>): Promise<T> {
    this.checkActor(actor);
    return this.db.transaction(write ? 'rw' : 'r', this.db.tables, async () => {
      this.checkActor(actor);
      // Abort immediately, including requests queued after the final awaited write.
      const transaction = Dexie.currentTransaction;
      const unsubscribe = subscribeIdentityChange(() => { transaction?.abort(); });
      transaction?.on('complete', unsubscribe);
      transaction?.on('abort', unsubscribe);
      transaction?.on('error', unsubscribe);
      try {
        const device = await this.db.devices.get(actor.deviceId);
        if (!device || device.userId !== actor.userId) throw new AuthorizationError('The active teacher has no matching local device identity.');
        const result = await body();
        this.checkActor(actor);
        return result;
      } finally { if (!transaction) unsubscribe(); }
    });
  }
  private async context(assessmentId: string, actor: MarkingActor, write: boolean) {
    this.checkActor(actor);
    const assessment = await this.db.assessments.get(assessmentId);
    if (!assessment || assessment.deletedAt !== null) throw new ValidationError('The assessment is unavailable.');
    const auth = await assertClassSectionWriteAccess(this.db, actor.userId, assessment.classSectionId);
    const organization = await this.db.organizations.get(auth.organizationId);
    const period = await this.db.reportingPeriods.get(assessment.reportingPeriodId);
    const term = await this.db.terms.get(auth.classSection.termId);
    const unit = await this.db.units.get(assessment.unitId);
    if (!organization || organization.deletedAt !== null || !term || term.deletedAt !== null || !unit || unit.deletedAt !== null || unit.classSectionId !== assessment.classSectionId) throw new ValidationError('The assessment parent context is unavailable.');
    if (!period || period.deletedAt !== null || period.termId !== auth.classSection.termId) throw new ValidationError('The assessment reporting period is unavailable.');
    if (write && (assessment.isLocked || period.isClosed)) throw new ValidationError('The assessment is locked or its reporting period is closed.');
    const categories = live(await this.db.assessmentCategories.where('assessmentId').equals(assessmentId).toArray());
    if (new Set(categories.map(c => c.categoryCode)).size !== categories.length) throw new ValidationError('The assessment requires distinct valid KTCA categories.');
    return { assessment, categories, auth };
  }
  private async enrollment(assessment: Assessment, enrollmentId: string, requireActive = true) {
    const enrollment = await this.db.classEnrollments.get(enrollmentId);
    if (!enrollment || enrollment.deletedAt !== null || enrollment.classSectionId !== assessment.classSectionId || (requireActive && enrollment.enrollmentStatus !== 'active')) throw new ValidationError('Choose an active student enrollment in this class.');
    const student = await this.db.students.get(enrollment.studentId);
    const section = await this.db.classSections.get(assessment.classSectionId);
    const course = section && await this.db.courses.get(section.courseId);
    if (!student || student.deletedAt !== null || !course || student.organizationId !== course.organizationId) throw new ValidationError('The student is unavailable in this school.');
    return enrollment;
  }
  private owned<T extends MarkingBase>(row: T | undefined, actor: MarkingActor, label: string): T {
    if (!row || row.deletedAt !== null || row.createdBy !== actor.userId) throw new AuthorizationError(`${label} is unavailable to the acting teacher.`);
    return row;
  }
  private async attemptContext(attemptId: string, actor: MarkingActor, write: boolean) {
    const attempt = this.owned(await this.db.markingAttempts.get(attemptId), actor, 'Submission');
    const context = await this.context(attempt.assessmentId, actor, write);
    if (write && attempt.archivedAt) throw new ValidationError('Archived work is read-only. Import a new attempt to mark again.');
    const rubric = this.owned(await this.db.markingRubrics.get(attempt.rubricId), actor, 'Rubric');
    if (attempt.classSectionId !== context.assessment.classSectionId || rubric.assessmentId !== attempt.assessmentId || rubric.classSectionId !== attempt.classSectionId || !rubric.confirmed) throw new ValidationError('Submission and rubric links are inconsistent.');
    if (attempt.classEnrollmentId) await this.enrollment(context.assessment, attempt.classEnrollmentId, write);
    return { ...context, attempt, rubric };
  }
  private async sessionContext(sessionId: string, actor: MarkingActor, write: boolean) {
    const session = this.owned(await this.db.markingSessions.get(sessionId), actor, 'Marking session');
    const context = await this.attemptContext(session.attemptId, actor, write);
    if (session.rubricId !== context.rubric.id || session.assessmentId !== context.assessment.id || session.classSectionId !== context.assessment.classSectionId) throw new ValidationError('Marking session links are inconsistent.');
    return { ...context, session };
  }
  private version(row: MarkingBase, expectedVersion: number) {
    if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion) throw new ConcurrencyConflictError('This marking record changed elsewhere. Reload it before saving.');
  }
  private base(assessment: Assessment, actor: MarkingActor): MarkingBase {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), assessmentId: assessment.id, classSectionId: assessment.classSectionId, createdBy: actor.userId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
  }
  private async audit(entityName: string, next: { id: string }, previous: unknown, actor: MarkingActor, transactionId = crypto.randomUUID()) {
    await this.db.auditEntries.add({ id: crypto.randomUUID(), entityName, entityId: next.id, action: previous ? 'UPDATE' : 'INSERT', transactionId, previousStateJson: previous ? JSON.stringify(previous) : null, newStateJson: JSON.stringify(next), diffJson: null, userId: actor.userId, timestamp: new Date().toISOString(), clientVersion: '1.0.0' });
  }
  private async baseline(assessment: Assessment, categories: AssessmentCategory[], enrollmentId: string) {
    const sa = await this.db.studentAssessments.where({ assessmentId: assessment.id, classEnrollmentId: enrollmentId }).first();
    const results = sa ? await this.db.categoryResults.where('studentAssessmentId').equals(sa.id).toArray() : [];
    const policies = await this.db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).toArray();
    const scaleIds = new Set([...categories.map(c => c.markScaleVersionId), ...policies.map(p => p.defaultMarkScaleVersionId)].filter((id): id is string => !!id));
    const entries = scaleIds.size ? await this.db.markScaleEntries.where('markScaleVersionId').anyOf([...scaleIds]).toArray() : [];
    // Include actual values: legacy/manual writes may not have incremented a version.
    return JSON.stringify({ assessment, categories: sorted(categories), policies: sorted(policies), scaleEntries: sorted(entries), studentAssessment: sa ?? null, results: sorted(results) });
  }
  private async scaleOptions(assessment: Assessment, categories: AssessmentCategory[]) {
    const options: Record<string, string[]> = {};
    const policies = live(await this.db.gradingPolicies.where('classSectionId').equals(assessment.classSectionId).toArray());
    const policy = policies.find(p => p.reportingPeriodId === assessment.reportingPeriodId) ?? policies.find(p => p.scopeKey === 'DEFAULT');
    for (const category of categories) {
      const scale = category.markScaleVersionId ?? policy?.defaultMarkScaleVersionId;
      options[category.id] = scale ? (await this.db.markScaleEntries.where('markScaleVersionId').equals(scale).sortBy('sortOrder')).map(entry => entry.code) : [];
    }
    return options;
  }

  async getContext(assessmentId: string, actor: MarkingActor): Promise<MarkingContext> {
    return this.transaction(actor, false, async () => {
      const { assessment, categories, auth } = await this.context(assessmentId, actor, false);
      const roster = live(await this.db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).toArray());
      const students = live(await this.db.students.where('id').anyOf(roster.map(e => e.studentId)).toArray()).filter(s => s.organizationId === auth.organizationId);
      const enrollments = roster.filter(e => e.enrollmentStatus === 'active' && students.some(s => s.id === e.studentId));
      const rubrics = live(await this.db.markingRubrics.where('assessmentId').equals(assessmentId).toArray()).filter(r => r.createdBy === actor.userId);
      const allAttempts = live(await this.db.markingAttempts.where('assessmentId').equals(assessmentId).toArray()).filter(a => a.createdBy === actor.userId && rubrics.some(r => r.id === a.rubricId));
      const archivedAttempts = allAttempts.filter(a => !!a.archivedAt);
      const attempts = allAttempts.filter(a => !a.archivedAt && (!a.classEnrollmentId || enrollments.some(e => e.id === a.classEnrollmentId)));
      // Historical discovery is separate from the writable active-roster queue.
      // Require a live, same-school student link, just as enrollment reads do.
      const historicalAttempts = allAttempts.filter(a => !a.archivedAt && a.classEnrollmentId && roster.some(e => e.id === a.classEnrollmentId && e.enrollmentStatus !== 'active' && students.some(s => s.id === e.studentId)));
      const visibleAttempts = [...attempts, ...archivedAttempts, ...historicalAttempts];
      const sessions = live(await this.db.markingSessions.where('assessmentId').equals(assessmentId).toArray()).filter(s => s.createdBy === actor.userId && visibleAttempts.some(a => a.id === s.attemptId));
      const commits = live(await this.db.markingCommits.where('assessmentId').equals(assessmentId).toArray()).filter(c => c.createdBy === actor.userId && visibleAttempts.some(a => a.id === c.attemptId));
      const studentAssessments = live(await this.db.studentAssessments.where('assessmentId').equals(assessmentId).toArray()).filter(sa => enrollments.some(e => e.id === sa.classEnrollmentId));
      const currentResults = studentAssessments.length ? live(await this.db.categoryResults.where('studentAssessmentId').anyOf(studentAssessments.map(sa => sa.id)).toArray()) : [];
      return { assessment, categories, enrollments, historicalEnrollments: roster, students, rubrics, attempts, archivedAttempts, historicalAttempts, sessions, commits, scaleOptions: await this.scaleOptions(assessment, categories), studentAssessments, currentResults };
    });
  }
  async saveRubric(assessmentId: string, content: RubricContent, actor: MarkingActor): Promise<MarkingRubric> {
    assertRubricContent(content); const snapshot = clone(content);
    return this.transaction(actor, true, async () => {
      const { assessment, categories } = await this.context(assessmentId, actor, true);
      if (snapshot.criteria.some(c => !categories.some(category => category.categoryCode === c.categoryCode))) throw new ValidationError('Rubric criteria must map to categories included in this assessment.');
      const rubric: MarkingRubric = { title: snapshot.title, levels: snapshot.levels, criteria: snapshot.criteria, ...this.base(assessment, actor), confirmed: true };
      await this.db.markingRubrics.add(rubric); await this.audit('markingRubrics', rubric, null, actor); return rubric;
    });
  }
  async importAttempt(assessmentId: string, rubricId: string, documents: MarkingDocument[], enrollmentId: string | null, previousAttemptId: string | null, actor: MarkingActor): Promise<MarkingAttempt> {
    this.checkActor(actor); assertMarkingDocuments(documents); const snapshot = clone(documents);
    // WebCrypto is deliberately outside Dexie's live transaction; stale identity is checked again below.
    const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))).map(b => b.toString(16).padStart(2, '0')).join('');
    for (const doc of snapshot) {
      if (await digest(new TextEncoder().encode(doc.text)) !== doc.hash.toLowerCase()) throw new ValidationError('Document content does not match its immutable hash.');
      if (doc.original) {
        const bytes = Uint8Array.from(atob(doc.original.base64), c => c.charCodeAt(0));
        if (await digest(bytes) !== doc.original.hash.toLowerCase()) throw new ValidationError('Original file content does not match its hash.');
        const { validateRetainedOriginal } = await import('./importDocuments');
        await validateRetainedOriginal(doc);
      }
    }
    return this.transaction(actor, true, async () => {
      const { assessment } = await this.context(assessmentId, actor, true);
      const rubric = this.owned(await this.db.markingRubrics.get(rubricId), actor, 'Rubric');
      if (rubric.assessmentId !== assessmentId || rubric.classSectionId !== assessment.classSectionId || !rubric.confirmed) throw new ValidationError('Confirm a rubric for this assessment before importing.');
      if (enrollmentId) await this.enrollment(assessment, enrollmentId);
      if (previousAttemptId) {
        const previous = this.owned(await this.db.markingAttempts.get(previousAttemptId), actor, 'Previous submission');
        if (previous.assessmentId !== assessmentId || previous.classEnrollmentId !== enrollmentId || !enrollmentId) throw new ValidationError('A resubmission must retain the same assessment and confirmed student.');
      }
      const existing = live(await this.db.markingAttempts.where('assessmentId').equals(assessmentId).toArray()).filter(a => a.createdBy === actor.userId);
      if (existing.some(a => a.classEnrollmentId === enrollmentId && a.documents.length === snapshot.length && a.documents.every((doc, index) => doc.hash === snapshot[index].hash && doc.original?.hash === snapshot[index].original?.hash))) throw new ValidationError('This exact submission is already imported for this student. Select its existing attempt.');
      const attempt: MarkingAttempt = { ...this.base(assessment, actor), rubricId, mode: 'written', documents: snapshot, classEnrollmentId: enrollmentId, previousAttemptId };
      await this.db.markingAttempts.add(attempt); await this.audit('markingAttempts', attempt, null, actor); return attempt;
    });
  }
  async createModeAttempt(assessmentId: string, rubricId: string, mode: 'oral' | 'rubric', enrollmentId: string, actor: MarkingActor): Promise<MarkingAttempt> {
    this.checkActor(actor);
    if (mode !== 'oral' && mode !== 'rubric') throw new ValidationError('Choose oral presentation or rubric-only marking.');
    if (!enrollmentId) throw new ValidationError('Confirm a student before creating a marking attempt.');
    return this.transaction(actor, true, async () => {
      const { assessment } = await this.context(assessmentId, actor, true);
      const rubric = this.owned(await this.db.markingRubrics.get(rubricId), actor, 'Rubric');
      if (rubric.assessmentId !== assessmentId || rubric.classSectionId !== assessment.classSectionId || !rubric.confirmed) throw new ValidationError('Confirm a rubric for this assessment before marking.');
      await this.enrollment(assessment, enrollmentId);
      const attempt: MarkingAttempt = { ...this.base(assessment, actor), rubricId, mode, documents: [], classEnrollmentId: enrollmentId, previousAttemptId: null };
      await this.db.markingAttempts.add(attempt); await this.audit('markingAttempts', attempt, null, actor); return attempt;
    });
  }
  async importImageAttempt(assessmentId: string, rubricId: string, pages: MarkingImagePage[], enrollmentId: string | null, actor: MarkingActor): Promise<MarkingAttempt> {
    this.checkActor(actor); assertMarkingImagePages(pages);
    if (!pages.length) throw new ValidationError('Import at least one image page.');
    const snapshot = clone(pages);
    // Digesting and decoding original bytes must finish before the live transaction.
    try { for (const page of snapshot) await validateMarkingImageBytes(page); }
    catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Unable to validate the retained image pages.'); }
    return this.transaction(actor, true, async () => {
      const { assessment } = await this.context(assessmentId, actor, true);
      const rubric = this.owned(await this.db.markingRubrics.get(rubricId), actor, 'Rubric');
      if (rubric.assessmentId !== assessmentId || rubric.classSectionId !== assessment.classSectionId || !rubric.confirmed) throw new ValidationError('Confirm a rubric for this assessment before importing.');
      if (enrollmentId) await this.enrollment(assessment, enrollmentId);
      const existing = live(await this.db.markingAttempts.where('assessmentId').equals(assessmentId).toArray()).filter(a => a.createdBy === actor.userId);
      if (existing.some(a => a.classEnrollmentId === enrollmentId && a.imagePages?.length === snapshot.length && a.imagePages.every((page, index) => page.hash.toLowerCase() === snapshot[index].hash.toLowerCase()))) throw new ValidationError('This exact submission is already imported for this student. Select its existing attempt.');
      const attempt: MarkingAttempt = { ...this.base(assessment, actor), rubricId, mode: 'written', documents: [], imagePages: snapshot, classEnrollmentId: enrollmentId, previousAttemptId: null };
      await this.db.markingAttempts.add(attempt); await this.audit('markingAttempts', attempt, null, actor); return attempt;
    });
  }
  /** Explicitly bind retained capture originals to a chosen never-finalized photo submission. */
  async bindCaptureRoot(rootId: string, choice: { rubricId?: string; attemptId?: string; expectedVersion?: number; sessionVersions?: Record<string, number> }, actor: MarkingActor): Promise<MarkingAttempt> {
    return this.transaction(actor, true, async () => {
      const root = await this.db.captureAttachments.get(rootId);
      if (!root || root.createdBy !== actor.userId || (root.rootAttachmentId && root.rootAttachmentId !== root.id)) throw new ValidationError('Choose an owned saved capture submission.');
      await this.context(root.assessmentId, actor, true);
      const sources = await this.db.captureAttachments.where('assessmentId').equals(root.assessmentId).filter(a => a.id === root.id || a.rootAttachmentId === root.id).sortBy('rootSequence');
      sources.sort((a, b) => (a.rootSequence ?? 0) - (b.rootSequence ?? 0));
      if (root.markingAttemptId) throw new ValidationError('This capture submission is already associated with marking.');
      let attempt: MarkingAttempt;
      if (choice.attemptId) {
        attempt = (await this.attemptContext(choice.attemptId, actor, true)).attempt;
        this.version(attempt, choice.expectedVersion!);
        await this.captureDraftOnly(attempt, root, choice.sessionVersions ?? {});
        const allPages = sources.flatMap(a => a.pages);
        if (attempt.captureSources?.length || attempt.documents.length || attempt.imagePages?.length !== allPages.length || !attempt.imagePages.every((page, index) => page.base64 === allPages[index].base64 && page.hash === allPages[index].metadata.sha256)) throw new ValidationError('The selected marking submission must contain exactly these original pages in order. Names are not used to associate work.');
      } else {
        const { assessment } = await this.context(root.assessmentId, actor, true);
        await this.enrollment(assessment, root.classEnrollmentId);
        const rubric = this.owned(await this.db.markingRubrics.get(choice.rubricId ?? ''), actor, 'Rubric');
        if (!rubric.confirmed || rubric.assessmentId !== assessment.id || rubric.classSectionId !== assessment.classSectionId) throw new ValidationError('Choose a confirmed rubric for this assignment.');
        attempt = { ...this.base(assessment, actor), rubricId: rubric.id, mode: 'written', documents: [], imagePages: sources.flatMap(source => this.captureImages(source)), classEnrollmentId: root.classEnrollmentId, previousAttemptId: null };
      }
      assertMarkingImagePages(attempt.imagePages);
      let offset = 0;
      const provenance = sources.map(source => { const pageIds = attempt.imagePages!.slice(offset, offset + source.pages.length).map(p => p.id); offset += source.pages.length; return { attachmentId: source.id, pageIds }; });
      const next = { ...attempt, captureSources: provenance, version: choice.attemptId ? attempt.version + 1 : attempt.version, updatedAt: new Date().toISOString() };
      await this.db.markingAttempts.put(next);
      await this.audit('markingAttempts', next, choice.attemptId ? attempt : null, actor);
      for (const source of sources) await this.db.captureAttachments.update(source.id, { rootAttachmentId: root.id, rootSequence: source.rootSequence ?? 0, markingAttemptId: next.id });
      const session = await this.openSession(next.id, actor);
      // A new association applies capture edits only to newly created sessions. Existing
      // marking feedback and edits remain untouched when binding an exact manual import.
      if (!choice.attemptId) {
        const edits = sources.flatMap(s => s.pages.map(p => p.metadata.edits));
        const adjusted = { ...session, draft: { ...session.draft, imageFeedback: next.imagePages!.map((p, i) => ({ pageId: p.id, ...edits[i], annotations: [] })) }, version: session.version + 1, updatedAt: new Date().toISOString() };
        await this.db.markingSessions.put(adjusted); await this.audit('markingSessions', adjusted, session, actor);
      } else { const adjusted = { ...session, version: session.version + 1, updatedAt: new Date().toISOString() }; await this.db.markingSessions.put(adjusted); await this.audit('markingSessions', adjusted, session, actor); }
      await assertCaptureBackupCapacity(this.db);
      return next;
    });
  }
  private captureImages(source: CaptureAttachment): MarkingImagePage[] {
    return source.pages.map(page => ({ id: crypto.randomUUID(), name: page.metadata.path.split('/').pop()!, base64: page.base64, size: page.metadata.byteLength, hash: page.metadata.sha256, ...inspectMarkingImage(Uint8Array.from(atob(page.base64), c => c.charCodeAt(0))) }));
  }
  private async captureDraftOnly(attempt: MarkingAttempt, source: CaptureAttachment, versions: Record<string, number>) {
    if (attempt.assessmentId !== source.assessmentId || attempt.classSectionId !== source.classSectionId || attempt.classEnrollmentId !== source.classEnrollmentId || attempt.createdBy !== source.createdBy || attempt.deletedAt !== null || attempt.archivedAt) throw new ValidationError('The target must be an active submission for this exact assignment and enrollment.');
    const sessions = await this.db.markingSessions.where('attemptId').equals(attempt.id).toArray();
    if ((await this.db.markingCommits.where('attemptId').equals(attempt.id).count()) || sessions.some(s => s.status !== 'draft' || s.commitId || s.deletedAt !== null)) throw new ValidationError('Finalized or archived submissions cannot receive late pages.');
    if (sessions.length !== Object.keys(versions).length || sessions.some(s => versions[s.id] !== s.version)) throw new ConcurrencyConflictError('The marking draft changed. Reload before associating or appending pages.');
    return sessions;
  }
  /** Called inside the atomic capture match transaction, after original bytes validate. */
  async appendCaptureSource(rootId: string, sourceId: string, expectedVersion: number, sessionVersions: Record<string, number>, actor: MarkingActor): Promise<void> {
    if (!Dexie.currentTransaction) throw new ValidationError('Late pages require the atomic capture match transaction.');
    await this.transaction(actor, true, async () => {
      const root = await this.db.captureAttachments.get(rootId), source = await this.db.captureAttachments.get(sourceId);
      const receipt = await this.db.captureImportReceipts.where('attachmentId').equals(sourceId).first();
      if (!root || !source || !receipt || source.rootAttachmentId !== root.id || source.markingAttemptId !== root.markingAttemptId || source.createdBy !== actor.userId || receipt.contentHash !== source.contentHash || receipt.createdBy !== actor.userId || receipt.assessmentId !== source.assessmentId || receipt.classEnrollmentId !== source.classEnrollmentId || receipt.packageId !== source.packageId || receipt.submissionId !== source.submissionId) throw new ValidationError('Late pages require their persisted authenticated source and receipt.');
      const { attempt, rubric } = await this.attemptContext(root.markingAttemptId!, actor, true);
      this.version(attempt, expectedVersion);
      const sessions = await this.captureDraftOnly(attempt, source, sessionVersions);
      if (!attempt.captureSources?.some(p => p.attachmentId === root.id)) throw new ValidationError('The original capture is not explicitly bound to this marking submission.');
      if (attempt.captureSources?.some(p => p.attachmentId === source.id)) throw new ValidationError('These late pages are already associated.');
      const pages = this.captureImages(source);
      for (const page of pages) await Dexie.waitFor(validateMarkingImageBytes(page));
      const next = { ...attempt, imagePages: [...(attempt.imagePages ?? []), ...pages], captureSources: [...attempt.captureSources, { attachmentId: source.id, pageIds: pages.map(p => p.id) }], version: attempt.version + 1, updatedAt: new Date().toISOString() };
      assertMarkingImagePages(next.imagePages);
      await this.db.markingAttempts.put(next); await this.audit('markingAttempts', next, attempt, actor);
      for (const session of sessions) {
        const draft = { ...session.draft, imageFeedback: [...(session.draft.imageFeedback ?? []), ...pages.map((p, index) => ({ pageId: p.id, ...source.pages[index].metadata.edits, annotations: [] }))] };
        assertAttemptDraft(draft, next, rubric);
        const updated = { ...session, draft, version: session.version + 1, updatedAt: next.updatedAt };
        await this.db.markingSessions.put(updated); await this.audit('markingSessions', updated, session, actor);
      }
      await assertCaptureBackupCapacity(this.db);
    });
  }
  async matchAttempt(id: string, enrollmentId: string, expectedVersion: number, actor: MarkingActor): Promise<MarkingAttempt> {
    return this.transaction(actor, true, async () => {
      const { attempt, assessment } = await this.attemptContext(id, actor, true); this.version(attempt, expectedVersion);
      if (attempt.captureSources?.length && attempt.classEnrollmentId !== enrollmentId) throw new ValidationError('A capture-associated submission cannot be reassigned to another enrollment.');
      await this.enrollment(assessment, enrollmentId);
      if (await this.db.markingSessions.where('attemptId').equals(id).count()) throw new ValidationError('A submission with marking history cannot be reassigned to another student. Import a new attempt.');
      if (attempt.previousAttemptId) {
        const previous = this.owned(await this.db.markingAttempts.get(attempt.previousAttemptId), actor, 'Previous submission');
        if (previous.classEnrollmentId !== enrollmentId) throw new ValidationError('A resubmission must retain its previous student.');
      }
      const next = { ...attempt, classEnrollmentId: enrollmentId, updatedAt: new Date().toISOString(), version: attempt.version + 1 };
      await this.db.markingAttempts.put(next); await this.audit('markingAttempts', next, attempt, actor); return next;
    });
  }
  async openSession(attemptId: string, actor: MarkingActor): Promise<MarkingSession> {
    return this.transaction(actor, true, async () => {
      const { attempt, assessment, categories, rubric } = await this.attemptContext(attemptId, actor, true);
      if (!attempt.classEnrollmentId) throw new ValidationError('Confirm a student before marking this submission.');
      const history = live(await this.db.markingSessions.where('attemptId').equals(attemptId).toArray()).filter(s => s.createdBy === actor.userId).sort((a, b) => b.revision - a.revision);
      const pending = history.find(s => s.status === 'draft');
      if (pending) {
        assertAttemptDraft(pending.draft, attempt, rubric);
        assertMarkingDraft(pending.draft, rubric, attempt.documents, sessionCategories(pending).map(c => c.id));
        return pending;
      }
      const previous = history[0];
      const old = previous?.draft;
      const categorySnapshot = clone(previous ? sessionCategories(previous) : categories);
      const draft: MarkingDraft = old ? clone(old) : {
        annotations: [], pending: null, overallFeedback: '',
        judgments: categorySnapshot.map(category => ({ assessmentCategoryId: category.id, assessed: false, rawScore: '', inputFormat: 'classroom_level', feedback: '' })),
        rubricFeedback: rubric.criteria.map(criterion => ({ criterionId: criterion.id, level: '', feedback: '' })),
        ...(attempt.mode === 'oral' ? { oral: { items: [], notes: '' } } : {}),
        ...(attempt.imagePages?.length ? { imageFeedback: attempt.imagePages.map(page => ({ pageId: page.id, rotation: 0 as const, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] })) } : {}),
      };
      assertAttemptDraft(draft, attempt, rubric);
      assertMarkingDraft(draft, rubric, attempt.documents, categorySnapshot.map(c => c.id));
      const session: MarkingSession = { ...this.base(assessment, actor), attemptId, rubricId: rubric.id, revision: (previous?.revision ?? 0) + 1, status: 'draft', draft, categorySnapshot, retainedCategoryJudgments: clone(previous?.retainedCategoryJudgments ?? []), baseline: await this.baseline(assessment, categories, attempt.classEnrollmentId), commitId: null };
      await this.db.markingSessions.add(session); await this.audit('markingSessions', session, null, actor); return session;
    });
  }
  async saveDraft(sessionId: string, draft: MarkingDraft, expectedVersion: number, actor: MarkingActor): Promise<MarkingSession> {
    assertMarkingDraft(draft); const snapshot = clone(draft);
    return this.transaction(actor, true, async () => {
      const { session, rubric, attempt } = await this.sessionContext(sessionId, actor, true); this.version(session, expectedVersion);
      if (session.status !== 'draft') throw new ValidationError('Reopen the finalized session to create a draft revision.');
      // Saving pending work is separate from accepting changed assessment settings.
      // Preserve the IDs the teacher actually edited until explicit reconciliation.
      const categorySnapshot = sessionCategories(session);
      assertAttemptDraft(snapshot, attempt, rubric);
      assertMarkingDraft(snapshot, rubric, attempt.documents, categorySnapshot.map(c => c.id));
      const next: MarkingSession = { ...session, draft: snapshot, categorySnapshot: clone(categorySnapshot), version: session.version + 1, updatedAt: new Date().toISOString() };
      await this.db.markingSessions.put(next); await this.audit('markingSessions', next, session, actor); return next;
    });
  }
  async reviewCategoryChanges(sessionId: string, actor: MarkingActor) {
    return this.transaction(actor, false, async () => {
      const { session, categories, rubric } = await this.sessionContext(sessionId, actor, false);
      if (session.status !== 'draft') throw new ValidationError('Reopen the finalized session before reviewing changed categories.');
      return categoryChangeReview(session, categories, rubric);
    });
  }
  async reconcileCategoryChanges(sessionId: string, expectedVersion: number, reviewToken: string, mapping: Record<string, string | null>, actor: MarkingActor): Promise<MarkingSession> {
    const decisions = clone(mapping);
    return this.transaction(actor, true, async () => {
      const { session, categories, rubric, attempt } = await this.sessionContext(sessionId, actor, true);
      this.version(session, expectedVersion);
      if (session.status !== 'draft') throw new ValidationError('Only a draft can reconcile changed categories.');
      const review = categoryChangeReview(session, categories, rubric);
      if (review.token !== reviewToken) throw new ConcurrencyConflictError('Categories or the saved draft changed again. Review category changes again before reconciling.');
      if (!review.compatible) throw new ValidationError(review.reasons.join(' '));
      const previous = review.previousCategories;
      if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions) || Object.keys(decisions).length !== previous.length || previous.some(c => !Object.prototype.hasOwnProperty.call(decisions, c.id))) throw new ValidationError('Explicitly review a destination or retain the original feedback for every saved category.');
      assertAttemptDraft(session.draft, attempt, rubric);
      assertMarkingDraft(session.draft, rubric, attempt.documents, previous.map(c => c.id));
      const judgments: MarkingDraft['judgments'] = categories.map(c => ({ assessmentCategoryId: c.id, assessed: false, rawScore: '', inputFormat: 'classroom_level', feedback: '' }));
      const retained = clone(session.retainedCategoryJudgments ?? []);
      const used = new Set<string>();
      for (const category of previous) {
        const judgment = session.draft.judgments.find(j => j.assessmentCategoryId === category.id)!;
        const destinationId = decisions[category.id];
        const destination = categories.find(c => c.id === destinationId);
        if (destinationId !== null) {
          if (!destination || !compatibleCategoryTarget(category, destination) || used.has(destination.id)) throw new ValidationError('Incompatible category mapping. Keep the original feedback in recovery history; score maximum, scale and KTCA category must match to retain a judgment.');
          used.add(destination.id);
          judgments[judgments.findIndex(j => j.assessmentCategoryId === destination.id)] = { ...clone(judgment), assessmentCategoryId: destination.id };
        }
        if (!destination || categorySignature([category]) !== categorySignature([destination])) retained.push({ category: clone(category), judgment: clone(judgment) });
      }
      if (retained.length > 200) throw new ValidationError('Recovery history is full. This draft is still preserved; export a backup before starting a new submission.');
      const next: MarkingSession = { ...session, categorySnapshot: clone(categories), retainedCategoryJudgments: retained, draft: { ...session.draft, judgments }, version: session.version + 1, updatedAt: new Date().toISOString() };
      assertAttemptDraft(next.draft, attempt, rubric);
      assertMarkingDraft(next.draft, rubric, attempt.documents, categories.map(c => c.id));
      // Do not accept newer official marks as a side effect of category recovery.
      await this.db.markingSessions.put(next); await this.audit('markingSessions', next, session, actor); return next;
    });
  }
  async refreshBaseline(sessionId: string, expectedVersion: number, actor: MarkingActor, reviewedOfficialSignature?: string): Promise<MarkingSession> {
    return this.transaction(actor, true, async () => {
      const { session, attempt, assessment, categories } = await this.sessionContext(sessionId, actor, true); this.version(session, expectedVersion);
      if (session.status !== 'draft' || !attempt.classEnrollmentId) throw new ValidationError('Only a matched draft can accept a newer official baseline.');
      if (categorySignature(sessionCategories(session)) !== categorySignature(categories)) throw new ConcurrencyConflictError('Assessment categories changed. Review category changes and reconcile the saved feedback first.');
      if (reviewedOfficialSignature !== undefined) {
        const value = await this.getContext(assessment.id, actor);
        const studentAssessment = value.studentAssessments.find(a => a.classEnrollmentId === attempt.classEnrollmentId);
        const signature = JSON.stringify({assessment:value.assessment,categories:value.categories,studentAssessment,results:value.currentResults.filter(r => r.studentAssessmentId === studentAssessment?.id)});
        if (signature !== reviewedOfficialSignature) throw new ConcurrencyConflictError('Official results changed again. Review them before accepting this baseline.');
      }
      const next: MarkingSession = { ...session, baseline: await this.baseline(assessment, categories, attempt.classEnrollmentId), version: session.version + 1, updatedAt: new Date().toISOString() };
      await this.db.markingSessions.put(next); await this.audit('markingSessions', next, session, actor); return next;
    });
  }
  async finalize(sessionId: string, expectedVersion: number, actor: MarkingActor): Promise<MarkingCommit> {
    return this.transaction(actor, true, async () => {
      const { session, attempt, rubric, assessment, categories } = await this.sessionContext(sessionId, actor, false);
      // Repeated clicks or restart retries return the original immutable receipt.
      if (attempt.archivedAt) throw new ValidationError('Archived work is read-only.');
      if (session.status === 'finalized') {
        const existing = session.commitId && await this.db.markingCommits.get(session.commitId);
        if (!existing) throw new ValidationError('Finalized session is missing its commit receipt.');
        return this.owned(existing, actor, 'Commit');
      }
      await this.context(assessment.id, actor, true);
      if (attempt.classEnrollmentId) await this.enrollment(assessment, attempt.classEnrollmentId);
      this.version(session, expectedVersion);
      if (!attempt.classEnrollmentId) throw new ValidationError('Confirm a student before finalization.');
      if (categorySignature(sessionCategories(session)) !== categorySignature(categories)) throw new ConcurrencyConflictError('Assessment categories changed. Review category changes and reconcile the saved feedback first.');
      assertAttemptDraft(session.draft, attempt, rubric);
      assertMarkingDraft(session.draft, rubric, attempt.documents, categories.map(c => c.id));
      const categoryReview = categoryChangeReview(session, categories, rubric);
      if (!categoryReview.compatible) throw new ValidationError(categoryReview.reasons.join(' '));
      if (session.draft.pending) throw new ValidationError('Save or explicitly discard the pending comment before finalization.');
      if (session.draft.imageFeedback?.some(page => page.annotations.some(annotation => annotation.kind === 'comment' && !annotation.text.trim()))) throw new ValidationError('Enter text for every image comment before finalization, or remove the empty comment.');
      if (session.baseline !== await this.baseline(assessment, categories, attempt.classEnrollmentId)) throw new ConcurrencyConflictError('The official mark or assessment settings changed. Review the current result, then explicitly accept the newer baseline before finalizing.');
      let sa = await this.db.studentAssessments.where({ assessmentId: assessment.id, classEnrollmentId: attempt.classEnrollmentId }).first();
      // Missing/excused completion policies override category scores in course
      // calculations. Require the teacher to resolve that policy explicitly
      // rather than finalize a report whose scores cannot become official evidence.
      if (session.draft.judgments.some(j => j.assessed) && sa && (sa.completionStatus === 'missing' || sa.completionStatus === 'excused')) {
        throw new ValidationError('This assessment is marked missing or excused in Organizer. Review and update its completion status there, then accept the newer official baseline before finalizing assessed judgments. Your marking draft is preserved.');
      }
      const oldResults: CategoryResult[] = sa ? await this.db.categoryResults.where('studentAssessmentId').equals(sa.id).toArray() : [];
      for (const judgment of session.draft.judgments) {
        if (judgment.assessed && !judgment.rawScore.trim()) throw new ValidationError('Enter an official judgment for every category marked assessed.');
        if (!judgment.assessed && oldResults.some(r => r.assessmentCategoryId === judgment.assessmentCategoryId && r.deletedAt === null && (r.normalizedPercentage !== null || r.rawScore.trim() !== ''))) throw new ValidationError('An unassessed category already has an official result. Use and confirm its current score, or edit the official result in Organizer before finalizing.');
      }
      const markbook = new MarkbookDomainService(this.db);
      const resultIds: string[] = [];
      // A deliberately cleared feedback-only judgment must also update the current
      // Markbook. Prior committed feedback remains in its immutable revision.
      for (const judgment of session.draft.judgments.filter(j => j.assessed || j.feedback.trim() || oldResults.some(result =>
        result.assessmentCategoryId === j.assessmentCategoryId && result.deletedAt === null &&
        result.normalizedPercentage === null && !result.rawScore.trim() && result.feedback?.trim()))) {
        const current = sa && await this.db.categoryResults.where({ studentAssessmentId: sa.id, assessmentCategoryId: judgment.assessmentCategoryId }).first();
        const saved = await markbook.saveMarkbookCell({ assessmentId: assessment.id, classSectionId: assessment.classSectionId, classEnrollmentId: attempt.classEnrollmentId, assessmentCategoryId: judgment.assessmentCategoryId, rawScore: judgment.assessed ? judgment.rawScore : '', inputFormat: judgment.assessed ? judgment.inputFormat : 'descriptive', feedback: judgment.feedback, expectedStudentAssessmentVersion: sa?.version, expectedCategoryResultVersion: current?.version, userId: actor.userId, deviceId: actor.deviceId });
        sa = saved.studentAssessment;
        // Empty-clearing writes are not assessed results or feedback evidence in this receipt.
        if (saved.categoryResult && (judgment.assessed || judgment.feedback.trim())) resultIds.push(saved.categoryResult.id);
      }
      if (!sa) {
        sa = (await markbook.saveMarkbookCell({ assessmentId: assessment.id, classSectionId: assessment.classSectionId, classEnrollmentId: attempt.classEnrollmentId, completionStatus: 'not_assessed', userId: actor.userId, deviceId: actor.deviceId })).studentAssessment;
      }
      const updatedSA = { ...sa, overallFeedback: session.draft.overallFeedback, updatedAt: new Date().toISOString(), version: sa.version + 1 };
      await this.db.studentAssessments.put(updatedSA); await this.audit('studentAssessments', updatedSA, sa, actor);
      const previousCommits = live(await this.db.markingCommits.where('studentAssessmentId').equals(sa.id).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const commit: MarkingCommit = { ...this.base(assessment, actor), sessionId, attemptId: attempt.id, rubricId: rubric.id, studentAssessmentId: sa.id, draft: clone(session.draft), resultIds, previousCommitId: previousCommits[0]?.id ?? null };
      await this.db.markingCommits.add(commit); await this.audit('markingCommits', commit, null, actor);
      const finalized: MarkingSession = { ...session, status: 'finalized', commitId: commit.id, version: session.version + 1, updatedAt: new Date().toISOString() };
      await this.db.markingSessions.put(finalized); await this.audit('markingSessions', finalized, session, actor);
      return commit;
    });
  }
  async setKeepStudentWork(id: string, expectedVersion: number, keepStudentWork: boolean, actor: MarkingActor): Promise<MarkingAttempt> {
    if (typeof keepStudentWork !== 'boolean') throw new ValidationError('Choose whether to keep student work.');
    return this.transaction(actor, true, async () => {
      const { attempt } = await this.attemptContext(id, actor, true); this.version(attempt, expectedVersion);
      if ((attempt.keepStudentWork ?? false) === keepStudentWork) return attempt;
      const next = { ...attempt, keepStudentWork, updatedAt: new Date().toISOString(), version: attempt.version + 1 };
      await this.db.markingAttempts.put(next); await this.audit('markingAttempts', next, attempt, actor); return next;
    });
  }
  async archiveAttempt(id: string, expectedVersion: number, actor: MarkingActor, keepStudentWork?: boolean): Promise<MarkingAttempt> {
    if (keepStudentWork !== undefined && typeof keepStudentWork !== 'boolean') throw new ValidationError('Choose whether to keep student work.');
    return this.transaction(actor, true, async () => {
      // Archiving is records management, not a grade write: closed reporting periods
      // and inactive enrollments retain their history and may still be archived.
      const { attempt } = await this.attemptContext(id, actor, false);
      const keep = keepStudentWork ?? attempt.keepStudentWork ?? false;
      if (attempt.archivedAt && keep === (attempt.keepStudentWork ?? false) && (expectedVersion === attempt.version || expectedVersion === attempt.version - 1)) return attempt;
      this.version(attempt, expectedVersion);
      if (attempt.archivedAt) throw new ValidationError('This attempt is already archived.');
      const now = new Date().toISOString();
      const sessions = await this.db.markingSessions.where('attemptId').equals(id).toArray();
      const commits = await this.db.markingCommits.where('attemptId').equals(id).toArray();
      if ([...sessions, ...commits].some(row => row.createdBy !== actor.userId || row.assessmentId !== attempt.assessmentId || row.classSectionId !== attempt.classSectionId)) throw new ValidationError('The marking history has inconsistent ownership. Archive was cancelled.');
      const next: MarkingAttempt = { ...attempt, archivedAt: now, keepStudentWork: keep, ...(keep ? {} : { documents: [], imagePages: [] }), updatedAt: now, version: attempt.version + 1 };
      const transactionId = crypto.randomUUID();
      const finalDrafts = new Map(commits.map(commit => [commit.id, keep ? clone(commit.draft) : archiveDraft(commit.draft)]));
      const retainedSessions = new Map<string, MarkingSession>();
      for (const session of sessions) {
        const committed = session.status === 'finalized' && session.commitId ? commits.find(commit => commit.id === session.commitId && commit.sessionId === session.id && commit.rubricId === session.rubricId) : undefined;
        if (session.status === 'finalized' && !committed) throw new ValidationError('The finalized marking history is inconsistent. Archive was cancelled.');
        const retained = { ...session, draft: committed ? clone(finalDrafts.get(committed.id)!) : discardUnfinishedDraft(session.draft, keep), retainedCategoryJudgments: committed ? session.retainedCategoryJudgments : [], updatedAt: now, version: session.version + 1 };
        retainedSessions.set(session.id, retained);
        await this.db.markingSessions.put(retained);
      }
      for (const commit of commits) {
        await this.db.markingCommits.put({ ...commit, draft: finalDrafts.get(commit.id)!, updatedAt: now, version: commit.version + 1 });
      }
      const targets = new Map<string, Set<string>>([
        ['markingAttempts', new Set([id])], ['markingSessions', new Set(sessions.map(row => row.id))], ['markingCommits', new Set(commits.map(row => row.id))]
      ]);
      // Only this deliberately archived attempt is affected. Audit metadata remains,
      // but old payloads must not recover unpublished feedback through backup/sync.
      const retainedSnapshot = (json: string | null, entity: string, entityId: string): string | null => {
        if (json === null) return null;
        if (entity === 'markingAttempts') return keep ? json : archiveSnapshot(json, entity, now);
        const value = JSON.parse(json);
        if (!value || typeof value !== 'object' || Array.isArray(value) || !value.draft) throw new ValidationError('A retained marking snapshot is invalid. Archive was cancelled without changes.');
        if (entity === 'markingCommits') return JSON.stringify({ ...value, draft: finalDrafts.get(entityId) });
        const retained = retainedSessions.get(entityId)!;
        // An old draft event is never relabelled as a finalized publication.
        const published = value.status === 'finalized' && value.commitId === retained.commitId && retained.status === 'finalized';
        return JSON.stringify({ ...value, draft: published ? retained.draft : discardUnfinishedDraft(retained.draft, keep), retainedCategoryJudgments: published ? retained.retainedCategoryJudgments : [] });
      };
      for (const entry of await this.db.auditEntries.toArray()) {
        if (!targets.get(entry.entityName)?.has(entry.entityId)) continue;
        await this.db.auditEntries.put({ ...entry, previousStateJson: retainedSnapshot(entry.previousStateJson, entry.entityName, entry.entityId), newStateJson: retainedSnapshot(entry.newStateJson, entry.entityName, entry.entityId), diffJson: null });
      }
      for (const mutation of await this.db.syncMutations.toArray()) {
        if (!targets.get(mutation.entityName)?.has(mutation.entityId)) continue;
        await this.db.syncMutations.put({ ...mutation, payloadJson: retainedSnapshot(mutation.payloadJson, mutation.entityName, mutation.entityId)!, lastError: null });
      }
      await this.db.markingAttempts.put(next);
      // The archive event must never reintroduce the pre-redaction originals.
      const previous = keep ? attempt : JSON.parse(archiveSnapshot(JSON.stringify(attempt), 'markingAttempts', now)!);
      await this.audit('markingAttempts', next, previous, actor, transactionId);
      return next;
    });
  }
  async exportContext(commitId: string, actor: MarkingActor) {
    return this.transaction(actor, false, async () => {
      const commit = this.owned(await this.db.markingCommits.get(commitId), actor, 'Finalized report');
      const { session, assessment, attempt, rubric } = await this.sessionContext(commit.sessionId, actor, false);
      if (session.commitId !== commit.id || session.status !== 'finalized' || commit.attemptId !== attempt.id || commit.rubricId !== rubric.id || !attempt.classEnrollmentId) throw new ValidationError('The finalized report links are inconsistent.');
      const enrollment = await this.enrollment(assessment, attempt.classEnrollmentId, false);
      const student = await this.db.students.get(enrollment.studentId);
      // Saved reports describe the finalized revision, even after the assessment's
      // categories change. Legacy sessions retain this snapshot in their baseline.
      return { commit, session, assessment, attempt, rubric, categories: clone(sessionCategories(session)), student: student! };
    });
  }
}
