import type { CaptureManifest, CapturePageMetadata } from '../../shared/capturePackage';
export interface CaptureAttachmentPage { metadata: CapturePageMetadata; base64: string }
/** Immutable original bytes and nondestructive edits; no grading records are created. */
export interface CaptureAttachment {
  id: string; createdBy: string; assessmentId: string; classSectionId: string;
  classEnrollmentId: string; studentId: string; packageId: string; submissionId: string;
  contentHash: string; label: string; createdAt: string; manifest: CaptureManifest;
  pages: CaptureAttachmentPage[];
}
export interface CaptureImportReceipt {
  id: string; createdBy: string; assessmentId: string; classSectionId: string;
  classEnrollmentId: string; studentId: string; packageId: string; submissionId: string;
  contentHash: string; attachmentId: string; createdAt: string;
}
