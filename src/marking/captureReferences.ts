import type { CaptureAttachment } from '../capture/types';
import { inspectMarkingImage } from './importImages';
import type { InlineMarkingImagePage, MarkingAttempt, MarkingImagePage } from './types';

/** Cross-record checks are required in addition to the shape validator. The source
 * stores bounded originals (10×8 MiB); only the selected page is returned/decoded. */
export function resolveCaptureReference(attempt: MarkingAttempt, page: MarkingImagePage, source: CaptureAttachment, checkDimensions = true): InlineMarkingImagePage {
  const fail = (): never => { throw new Error('The saved capture original is unavailable or inconsistent. Restore a complete backup; no marking was changed.'); };
  const reference = page.captureRef;
  if (!reference || reference.version !== 1 || page.base64 !== undefined || !source || reference.attachmentId !== source.id || attempt.archivedAt && !attempt.keepStudentWork) fail();
  for (const key of ['createdBy', 'assessmentId', 'classSectionId', 'classEnrollmentId'] as const) if (source[key] !== attempt[key]) fail();
  if (source.markingAttemptId !== attempt.id || !source.rootAttachmentId) fail();
  const binding = attempt.captureSources?.find(value => value.attachmentId === source.id);
  const index = binding?.pageIds.indexOf(page.id) ?? -1;
  const original = source.pages[index];
  if (index < 0 || !original || reference!.pageId !== original.metadata.id || page.hash !== original.metadata.sha256 || page.size !== original.metadata.byteLength || page.mime !== original.metadata.mime || page.name !== original.metadata.path.split('/').pop()) fail();
  if (checkDimensions) {
  const info = inspectMarkingImage(Uint8Array.from(atob(original.base64), c => c.charCodeAt(0)));
  if (page.width !== info.width || page.height !== info.height || page.mime !== info.mime) fail();
  }
  const { captureRef: _, ...metadata } = page;
  return { ...metadata, base64: original.base64 };
}
