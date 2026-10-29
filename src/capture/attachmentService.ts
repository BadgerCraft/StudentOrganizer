import { bytesToBase64, base64ToBytes, captureContentHash } from './attachmentBytes';
export { bytesToBase64, base64ToBytes, captureContentHash } from './attachmentBytes';
import { MARKING_LIMITS } from '../marking/types';
import { MarkingService } from '../marking/markingService';
import { assertCaptureBackupCapacity, CAPTURE_BACKUP_MAX_BYTES } from './backupCapacity';
import type { OntarioTeacherDB } from '../db/database';
import { AUTH_TABLES, assertClassSectionWriteAccess } from '../services/authHelper';
import { captureLocalWriteActor, guardLocalWriteIdentity, type LocalWriteActor } from '../services/localWriteIdentity';
import { captureSha256, validateCaptureManifest, type ParsedCapturePackage } from '../../shared/capturePackage';
import { inspectMarkingImage, validateMarkingImageBytes } from '../marking/importImages';
import type { CaptureAttachment, CaptureAttachmentPage, CaptureImportReceipt, CaptureAppendTarget } from './types';

async function prepareSubmission(pkg: ParsedCapturePackage, submissionId: string) {
    const expected = pkg.manifest.submissions.find(s => s.id === submissionId);
    const submission = pkg.submissions.find(s => s.id === submissionId);
    if (!expected || !submission || submission.label !== expected.label || submission.pages.length !== expected.pages.length) throw new Error('Page set is not in the completed package.');
    const pages: CaptureAttachmentPage[] = [];
    for (let i = 0; i < expected.pages.length; i++) {
      const page = submission.pages[i];
      const metadata = expected.pages[i];
      if (JSON.stringify(page.metadata) !== JSON.stringify(metadata) || !(page.bytes instanceof Uint8Array) || page.bytes.length !== metadata.byteLength || await captureSha256(page.bytes) !== metadata.sha256) throw new Error('Capture content changed; reopen the original ZIP.');
      const info = inspectMarkingImage(page.bytes);
      if (info.mime !== metadata.mime) throw new Error('Capture page MIME mismatch.');
      const base64 = bytesToBase64(page.bytes);
      await validateMarkingImageBytes({ ...info, id: metadata.id, name: metadata.path.split('/').pop()!, base64, size: metadata.byteLength, hash: metadata.sha256 });
      pages.push({ metadata, base64 });
    }
    const contentHash = await captureContentHash(pages);
    return { expected, pages, contentHash };
}
export class CaptureAttachmentService {
  constructor(private db: OntarioTeacherDB, private backupCapacityBytes = CAPTURE_BACKUP_MAX_BYTES) {
    // Callers may impose a smaller local budget, never bypass the native ceiling.
    if (!Number.isSafeInteger(backupCapacityBytes) || backupCapacityBytes < 1 || backupCapacityBytes > CAPTURE_BACKUP_MAX_BYTES) throw new Error('Invalid complete-backup capacity.');
  }
  private tables() { return [...AUTH_TABLES(this.db), this.db.devices, this.db.assessments, this.db.students, this.db.classEnrollments, this.db.captureAttachments, this.db.captureImportReceipts]; }
  private async scope(assessmentId: string, actor: LocalWriteActor) {
    const assessment = await this.db.assessments.get(assessmentId);
    if (!assessment || assessment.deletedAt !== null) throw new Error('Assignment is no longer available.');
    const auth = await assertClassSectionWriteAccess(this.db, actor.userId, assessment.classSectionId);
    return { assessment, auth };
  }
  async context(assessmentId: string, actor: LocalWriteActor) {
    const captured = captureLocalWriteActor(actor);
    const result = await this.db.transaction('r', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, captured);
      const { assessment, auth } = await this.scope(assessmentId, captured);
      const enrollments = await this.db.classEnrollments.where('classSectionId').equals(assessment.classSectionId).filter(e => e.deletedAt === null && e.enrollmentStatus === 'active').toArray();
      const roster = [];
      for (const enrollment of enrollments) {
        const student = await this.db.students.get(enrollment.studentId);
        if (student && student.deletedAt === null && student.organizationId === auth.organizationId) roster.push({ enrollment, student });
      }
      const attachments: { id: string; label: string; pageCount: number; classEnrollmentId: string; studentId: string }[] = [];
      // Cursor processing releases each original page set before loading the next.
      await this.db.captureAttachments.where('assessmentId').equals(assessmentId).each(a => {
        if (a.createdBy === captured.userId) attachments.push({ id: a.id, label: a.label, pageCount: a.pages.length, classEnrollmentId: a.classEnrollmentId, studentId: a.studentId });
      });
      const receipts = await this.db.captureImportReceipts.where('assessmentId').equals(assessmentId).filter(r => r.createdBy === captured.userId).toArray();
      check(); return { assessment, roster, attachments, receipts };
    });
    captureLocalWriteActor(captured);
    return result;
  }
  async getAttachment(assessmentId: string, attachmentId: string, actor: LocalWriteActor): Promise<CaptureAttachment> {
    const captured = captureLocalWriteActor(actor);
    return this.db.transaction('r', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, captured);
      await this.scope(assessmentId, captured);
      const attachment = await this.db.captureAttachments.get(attachmentId);
      if (!attachment || attachment.createdBy !== captured.userId || attachment.assessmentId !== assessmentId) throw new Error('Attachment is not available to this teacher and assignment.');
      check(); return attachment;
    });
  }
  async lifecycle(assessmentId: string, actor: LocalWriteActor) {
    const captured = captureLocalWriteActor(actor);
    return this.db.transaction('r', this.db.tables, async () => {
      const check = await guardLocalWriteIdentity(this.db, captured); await this.scope(assessmentId, captured);
      const sources: { id: string; label: string; classEnrollmentId: string; rootAttachmentId?: string; markingAttemptId?: string; pageCount: number }[] = [];
      await this.db.captureAttachments.where('assessmentId').equals(assessmentId).each(a => { if (a.createdBy === captured.userId) sources.push({ id: a.id, label: a.label, classEnrollmentId: a.classEnrollmentId, rootAttachmentId: a.rootAttachmentId, markingAttemptId: a.markingAttemptId, pageCount: a.pages.length }); });
      const attempts: { id: string; classEnrollmentId: string | null; version: number; archivedAt?: string | null; pageCount: number }[] = [];
      await this.db.markingAttempts.where('assessmentId').equals(assessmentId).each(a => { if (a.createdBy === captured.userId && a.deletedAt === null) attempts.push({ id: a.id, classEnrollmentId: a.classEnrollmentId, version: a.version, archivedAt: a.archivedAt, pageCount: a.imagePages?.length ?? 0 }); });
      const sessions = await this.db.markingSessions.where('assessmentId').equals(assessmentId).toArray();
      const commits = await this.db.markingCommits.where('assessmentId').equals(assessmentId).toArray();
      const rubrics = await this.db.markingRubrics.where('assessmentId').equals(assessmentId).filter(r => r.createdBy === captured.userId && r.deletedAt === null && r.confirmed).toArray();
      const targets = attempts.map(a => ({ id: a.id, enrollmentId: a.classEnrollmentId, version: a.version, pageCount: a.pageCount, blocked: !!a.archivedAt || commits.some(c => c.attemptId === a.id) || sessions.some(s => s.attemptId === a.id && (s.status !== 'draft' || s.deletedAt !== null || s.commitId)), sessionVersions: Object.fromEntries(sessions.filter(s => s.attemptId === a.id).map(s => [s.id, s.version])) }));
      const roots = sources.filter(a => !a.rootAttachmentId || a.rootAttachmentId === a.id).map(root => ({ id: root.id, label: root.label, enrollmentId: root.classEnrollmentId, markingAttemptId: root.markingAttemptId, pageCount: sources.filter(s => s.id === root.id || s.rootAttachmentId === root.id).reduce((n, s) => n + s.pageCount, 0) }));
      check(); return { roots, targets, rubrics };
    });
  }
  async groupedAttachment(assessmentId: string, rootId: string, actor: LocalWriteActor) {
    const captured = captureLocalWriteActor(actor);
    return this.db.transaction('r', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, captured); await this.scope(assessmentId, captured);
      const root = await this.db.captureAttachments.get(rootId);
      if (!root || root.createdBy !== captured.userId || root.assessmentId !== assessmentId) throw new Error('Capture submission unavailable.');
      const sources = await this.db.captureAttachments.where('assessmentId').equals(assessmentId).filter(a => a.createdBy === captured.userId && (a.id === root.id || a.rootAttachmentId === root.id)).toArray();
      sources.sort((a, b) => (a.rootSequence ?? 0) - (b.rootSequence ?? 0));
      check(); return { ...root, pages: sources.flatMap(s => s.pages) };
    });
  }
  async reconcile(assessmentId: string, input: ParsedCapturePackage, actor: LocalWriteActor): Promise<CaptureImportReceipt[]> {
    const captured = captureLocalWriteActor(actor);
    const pkg = structuredClone(input);
    validateCaptureManifest(pkg.manifest);
    const { receipts } = await this.context(assessmentId, captured);
    const matches: CaptureImportReceipt[] = [];
    for (const submission of pkg.manifest.submissions) {
      const { contentHash } = await prepareSubmission(pkg, submission.id);
      const previous = receipts.find(r => r.packageId === pkg.manifest.packageId && r.submissionId === submission.id);
      if (previous && previous.contentHash !== contentHash) throw new Error('This package and page-set ID already has different content. It cannot be overwritten.');
      if (previous) matches.push(previous);
    }
    captureLocalWriteActor(captured);
    return matches;
  }
  async confirm(assessmentId: string, input: ParsedCapturePackage, submissionId: string, enrollmentId: string, actor: LocalWriteActor, append?: CaptureAppendTarget): Promise<CaptureImportReceipt> {
    const captured = captureLocalWriteActor(actor);
    // Snapshot mutable caller data before awaiting hashes; no TOCTOU from UI edits.
    const pkg: ParsedCapturePackage = { manifest: structuredClone(input.manifest), submissions: structuredClone(input.submissions.filter(s => s.id === submissionId)) };
    validateCaptureManifest(pkg.manifest);
    const { expected, pages, contentHash } = await prepareSubmission(pkg, submissionId);
    return this.db.transaction('rw', this.db.tables, async () => {
      const check = await guardLocalWriteIdentity(this.db, captured);
      const { assessment, auth } = await this.scope(assessmentId, captured);
      const enrollment = await this.db.classEnrollments.get(enrollmentId);
      const student = enrollment && await this.db.students.get(enrollment.studentId);
      if (!enrollment || enrollment.classSectionId !== assessment.classSectionId || enrollment.deletedAt !== null || enrollment.enrollmentStatus !== 'active' || !student || student.deletedAt !== null || student.organizationId !== auth.organizationId) throw new Error('The selected student is no longer enrolled in this class.');
      const previous = await this.db.captureImportReceipts.where('[createdBy+assessmentId+packageId+submissionId]').equals([captured.userId, assessmentId, pkg.manifest.packageId, submissionId]).first();
      if (previous) {
        if (previous.contentHash !== contentHash) throw new Error('This package and page-set ID already has different content. It cannot be overwritten.');
        if (previous.classEnrollmentId !== enrollmentId || previous.studentId !== student.id) throw new Error('This page set was already matched to a different student.');
        if (!await this.db.captureAttachments.get(previous.attachmentId)) throw new Error('The saved attachment is missing; restore a complete backup.');
        const existing = await this.db.captureAttachments.get(previous.attachmentId);
        if ((existing?.rootAttachmentId ?? existing?.id) !== (append?.rootAttachmentId ?? existing?.id)) throw new Error('This page set was already saved with a different append destination.');
        check(); return previous;
      }
      const createdAt = new Date().toISOString();
      const common = { createdBy: captured.userId, assessmentId, classSectionId: assessment.classSectionId, classEnrollmentId: enrollmentId, studentId: student.id, packageId: pkg.manifest.packageId, submissionId, contentHash, createdAt };
      const attachment: CaptureAttachment = { ...common, id: crypto.randomUUID(), label: expected.label, manifest: pkg.manifest, pages };
      const receipt: CaptureImportReceipt = { ...common, id: crypto.randomUUID(), attachmentId: attachment.id };
      if (append) {
        const period = await this.db.reportingPeriods.get(assessment.reportingPeriodId);
        if (assessment.isLocked || !period || period.isClosed || period.deletedAt !== null) throw new Error('Locked assignments or closed reporting periods cannot receive late pages.');
        const root = await this.db.captureAttachments.get(append.rootAttachmentId);
        if (!root || (root.rootAttachmentId && root.rootAttachmentId !== root.id) || root.createdBy !== captured.userId || root.assessmentId !== assessmentId || root.classEnrollmentId !== enrollmentId) throw new Error('Choose the original saved submission for this exact student and assignment.');
        const grouped = await this.db.captureAttachments.where('assessmentId').equals(assessmentId).filter(a => a.id === root.id || a.rootAttachmentId === root.id).toArray();
        const aggregate = [...grouped.flatMap(s => s.pages), ...attachment.pages];
        if (new Set(aggregate.map(p => p.metadata.id)).size !== aggregate.length) throw new Error('Late pages reuse an original page ID already in this submission. Export a new page set.');
        if (aggregate.length > MARKING_LIMITS.imagePages || aggregate.reduce((n, p) => n + p.metadata.byteLength, 0) > MARKING_LIMITS.imageBatchBytes) throw new Error('A grouped submission supports at most 10 pages and 32 MiB of original images. Nothing from this append was saved.');
        attachment.rootAttachmentId = root.id; attachment.rootSequence = grouped.length;
        if (root.markingAttemptId) {
          attachment.markingAttemptId = root.markingAttemptId;

        }
        await this.db.captureAttachments.update(root.id, { rootAttachmentId: root.id, rootSequence: 0 });
      }
      await this.db.captureAttachments.add(attachment);
      await this.db.captureImportReceipts.add(receipt);
      if (append && attachment.markingAttemptId) await new MarkingService(this.db).appendCaptureSource(append.rootAttachmentId, attachment.id, append.expectedAttemptVersion!, append.sessionVersions ?? {}, { userId: captured.userId, deviceId: captured.deviceId, epoch: captured.identityEpoch! });
      await assertCaptureBackupCapacity(this.db, this.backupCapacityBytes);
      check();
      return receipt;
    });
  }
}
