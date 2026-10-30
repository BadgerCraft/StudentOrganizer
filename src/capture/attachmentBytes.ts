import { captureSha256 } from '../../shared/capturePackage';
import type { CaptureAttachmentPage } from './types';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}
export function base64ToBytes(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || base64.length > 28_000_000 || (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))) throw new Error('Invalid capture page bytes.');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (bytesToBase64(bytes) !== base64) throw new Error('Invalid capture page encoding.');
  return bytes;
}
/** Canonical metadata fingerprint includes edits, ordering and original-byte hashes. */
export async function captureContentHash(pages: CaptureAttachmentPage[]): Promise<string> {
  return captureSha256(new TextEncoder().encode(JSON.stringify(pages.map(({ metadata: m }) => ({
    id: m.id, order: m.order, mime: m.mime, byteLength: m.byteLength, sha256: m.sha256,
    rotation: m.edits.rotation, crop: [m.edits.crop.x, m.edits.crop.y, m.edits.crop.width, m.edits.crop.height]
  })))));
}
