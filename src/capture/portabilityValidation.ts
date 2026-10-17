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
