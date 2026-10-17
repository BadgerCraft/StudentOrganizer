import { MARKING_LIMITS } from '../marking/types';
import { validateCaptureManifest, captureSha256 } from '../../shared/capturePackage';
import { base64ToBytes, captureContentHash } from './attachmentService';
import { inspectMarkingImage, validateMarkingImageBytes } from '../marking/importImages';
import type { CaptureAttachment, CaptureImportReceipt } from './types';
const names = ['captureAttachments', 'captureImportReceipts'] as const;
type Tables = Record<string, any[]>;
function fail(): never { throw new Error('Invalid backup file: Capture attachment or import receipt is inconsistent. Existing data has not been changed.'); }
export function normalizeLegacyCaptureTables(tables: Tables, version: number): void {
  if (version < 5) for (const name of names) {
    if (!(name in tables)) tables[name] = [];
    else if (!Array.isArray(tables[name]) || tables[name].length) fail();
  }
}
export function validateCaptureBackup(tables: Tables): void {
  const maps = Object.fromEntries(Object.entries(tables).map(([name, records]) => [name, new Map(records.map(r => [r.id, r]))]));
  const ref = (table: string, id: string) => { const value = maps[table]?.get(id); if (!value) fail(); return value; };
  const keys = new Set<string>();
  const receiptsByAttachment = new Set<string>();
  for (const a of tables.captureAttachments as CaptureAttachment[]) {
    for (const field of ['id', 'createdBy', 'assessmentId', 'classSectionId', 'classEnrollmentId', 'studentId', 'packageId', 'submissionId', 'createdAt', 'label'] as const) if (typeof a[field] !== 'string' || !a[field].trim()) fail();
    if (!/^[a-f0-9]{64}$/.test(a.contentHash) || !Number.isFinite(Date.parse(a.createdAt))) fail();
    validateCaptureManifest(a.manifest);
    const submission = a.manifest.submissions.find(s => s.id === a.submissionId);
    if (a.packageId !== a.manifest.packageId || !submission || submission.label !== a.label || !Array.isArray(a.pages) || a.pages.length !== submission.pages.length) fail();
    for (let i = 0; i < a.pages.length; i++) {
      if (JSON.stringify(a.pages[i].metadata) !== JSON.stringify(submission.pages[i])) fail();
      const bytes = base64ToBytes(a.pages[i].base64);
      if (bytes.length !== a.pages[i].metadata.byteLength || inspectMarkingImage(bytes).mime !== a.pages[i].metadata.mime) fail();
    }
    const assessment = ref('assessments', a.assessmentId), enrollment = ref('classEnrollments', a.classEnrollmentId);
    ref('users', a.createdBy); const student = ref('students', a.studentId);
    const section = ref('classSections', a.classSectionId), course = ref('courses', section.courseId);
    if (assessment.classSectionId !== a.classSectionId || enrollment.classSectionId !== a.classSectionId || enrollment.studentId !== a.studentId || student.organizationId !== course.organizationId) fail();
    const orgs = new Set<string>(); let orgId: string | null = course.organizationId;
    while (orgId) { if (orgs.has(orgId)) fail(); orgs.add(orgId); orgId = ref('organizations', orgId).parentOrganizationId; }
    const memberships = tables.organizationMemberships.filter(m => m.userId === a.createdBy && orgs.has(m.organizationId));
    if (!memberships.some(m => ['admin', 'department_head'].includes(m.role)) && !tables.classSectionStaff.some(s => s.classSectionId === a.classSectionId && memberships.some(m => m.id === s.organizationMembershipId))) fail();
  }
  for (const r of tables.captureImportReceipts as CaptureImportReceipt[]) {
    const attachment = ref('captureAttachments', r.attachmentId);
    for (const field of ['createdBy', 'assessmentId', 'classSectionId', 'classEnrollmentId', 'studentId', 'packageId', 'submissionId', 'contentHash', 'createdAt'] as const) if (r[field] !== attachment[field]) fail();
    const key = JSON.stringify([r.createdBy, r.assessmentId, r.packageId, r.submissionId]);
    if (keys.has(key) || receiptsByAttachment.has(r.attachmentId)) fail();
    keys.add(key); receiptsByAttachment.add(r.attachmentId);
  }
  const grouped = new Map<string, CaptureAttachment[]>();
  for (const a of tables.captureAttachments as CaptureAttachment[]) {
    if (a.rootAttachmentId === undefined) {
      if (a.markingAttemptId !== undefined || a.rootSequence !== undefined) fail();
    } else {
      const root = ref('captureAttachments', a.rootAttachmentId) as CaptureAttachment;
      if (root.rootAttachmentId !== root.id || root.rootSequence !== 0 || !Number.isSafeInteger(a.rootSequence) || a.rootSequence! < 0) fail();
      for (const field of ['assessmentId', 'classSectionId', 'classEnrollmentId', 'studentId', 'createdBy', 'markingAttemptId'] as const) if (a[field] !== root[field]) fail();
      grouped.set(root.id, [...(grouped.get(root.id) ?? []), a]);
    }
    if (a.markingAttemptId) {
      const attempt = ref('markingAttempts', a.markingAttemptId);
      for (const field of ['assessmentId', 'classSectionId', 'classEnrollmentId', 'createdBy'] as const) if (a[field] !== attempt[field]) fail();
      if (!attempt.captureSources?.some((source: any) => source.attachmentId === a.id)) fail();
    }
  }
  for (const sources of grouped.values()) {
    const pages = sources.flatMap(s => s.pages);
    if (new Set(pages.map(p => p.metadata.id)).size !== pages.length) fail();
    if (pages.length > MARKING_LIMITS.imagePages || pages.reduce((n, p) => n + p.metadata.byteLength, 0) > MARKING_LIMITS.imageBatchBytes) fail();
    const orders = sources.map(s => s.rootSequence!).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index)) fail();
  }
  for (const attempt of tables.markingAttempts) if (attempt.captureSources !== undefined) {
    if (!Array.isArray(attempt.captureSources) || !attempt.captureSources.length) fail();
    const seenSources = new Set<string>(), seenPages = new Set<string>();
    let rootId: string | undefined;
    let previousIndex = -1;
    for (const binding of attempt.captureSources) {
      const source = ref('captureAttachments', binding.attachmentId) as CaptureAttachment;
      if (seenSources.has(source.id) || source.markingAttemptId !== attempt.id || !source.rootAttachmentId || (rootId && rootId !== source.rootAttachmentId) || !Array.isArray(binding.pageIds) || binding.pageIds.length !== source.pages.length) fail();
      rootId = source.rootAttachmentId; seenSources.add(source.id);
      if (source.rootSequence !== seenSources.size - 1) fail();
      for (let index = 0; index < binding.pageIds.length; index++) {
        const id = binding.pageIds[index];
        if (typeof id !== 'string' || !id || seenPages.has(id)) fail(); seenPages.add(id);
        // Explicit archive removes marking originals; provenance remains historical
        // while independently retained capture originals keep their own receipts.
        if (attempt.archivedAt && !attempt.keepStudentWork) continue;
        const pageIndex = attempt.imagePages?.findIndex((page: any) => page.id === id) ?? -1;
        const page = attempt.imagePages?.[pageIndex], original = source.pages[index];
        if (pageIndex !== previousIndex + 1 || !page || page.base64 !== original.base64 || page.hash !== original.metadata.sha256 || page.size !== original.metadata.byteLength || page.mime !== original.metadata.mime) fail();
        previousIndex = pageIndex;
      }
    }
    if (!(attempt.archivedAt && !attempt.keepStudentWork) && seenPages.size !== attempt.imagePages?.length) fail();
  }
  if (receiptsByAttachment.size !== tables.captureAttachments.length) fail();
}
export async function validateCaptureBackupFiles(tables: Tables): Promise<void> {
  for (const attachment of tables.captureAttachments as CaptureAttachment[]) {
    for (const page of attachment.pages) {
      const bytes = base64ToBytes(page.base64);
      if (await captureSha256(bytes) !== page.metadata.sha256) fail();
      await validateMarkingImageBytes({ ...inspectMarkingImage(bytes), id: page.metadata.id, name: page.metadata.path.split('/').pop()!, base64: page.base64, size: page.metadata.byteLength, hash: page.metadata.sha256 });
    }
    if (await captureContentHash(attachment.pages) !== attachment.contentHash) fail();
  }
}
