import { deflateSync } from 'node:zlib';
import { capturePagePath, captureSha256, encodeCapturePackage, type CaptureManifest } from '../../shared/capturePackage';

/** Fictional pixels, not ancillary padding: five valid PNG pages total ~35 MiB. */
export async function pixelCaptureFixture(count = 5) {
  const width = 1400, height = 1310;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4); prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, body, suffix]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (1 + width * 4)); let random = 42;
  for (let row = 0; row < height; row++) for (let x = 0; x < width * 4; x++) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; pixels[row * (1 + width * 4) + 1 + x] = x % 4 === 3 ? 255 : random >>> 24; }
  const bytes = new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]));
  const hash = await captureSha256(bytes);
  const pages = Array.from({ length: count }, (_, order) => ({ id: `pixel-page-${order}`, order, path: capturePagePath('pixel-student', `pixel-page-${order}`, 'image/png'), mime: 'image/png' as const, byteLength: bytes.length, sha256: hash, edits: { rotation: 90 as const, crop: { x: .1, y: .1, width: .8, height: .8 } } }));
  const manifest: CaptureManifest = { format: 'studentorganizer-capture', version: 2, packageId: 'fictional-pixel-package', assignmentId: 'fictional-pixel-assignment', assignmentName: 'Fictional pixel-heavy pages', revision: 1, completed: true, submissions: [{ id: 'pixel-student', label: 'Fictional Student', pages }] };
  const zip = await encodeCapturePackage(manifest, Object.fromEntries(pages.map(page => [page.path, bytes])));
  return { bytes, hash, width, height, manifest, zip };
}
