import type { MarkingPdfDocument } from './types';
import { assertMarkingPdfs } from './validation';
import { sha256 } from './importDocuments';

/** Integrity validation is shared by native protected storage and backup restore.
 * Rendering eligibility is checked separately in a disposable browser worker;
 * restored bytes are never trusted as executable content. */
export async function validateRetainedPdf(document: MarkingPdfDocument): Promise<void> {
  assertMarkingPdfs([document]);
  const bytes = Uint8Array.from(atob(document.base64), c => c.charCodeAt(0));
  if (bytes.length !== document.size || await sha256(bytes) !== document.hash.toLowerCase()) throw new Error('PDF original bytes do not match their retained hash.');
  assertPdfEnvelope(bytes);
}

export function assertPdfEnvelope(bytes: Uint8Array): void {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n\s]/.test(head) || !/%%EOF\s*$/.test(tail)) throw new Error('Choose a complete PDF file exported with its visible marks.');
}
