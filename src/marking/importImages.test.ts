import { describe, expect, it, vi } from 'vitest';
import { zlibSync } from 'fflate';
import { inspectMarkingImage, markingImageDecodeBytes, parseMarkingImages, validateMarkingImageBytes } from './importImages';
import { sha256 } from './importDocuments';
import { MARKING_LIMITS, type MarkingImagePage } from './types';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z';
const WEBP = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
const bytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const file = (value = PNG, name = 'page.png', type = 'image/png') => new File([bytes(value)], name, { type });
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(kind: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(payload.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length); chunk.set(new TextEncoder().encode(kind), 4); chunk.set(payload, 8);
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4))); return chunk;
}
function makePng(width = 1, height = 1, pixels = new Uint8Array([0, 0, 0, 0, 255])) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const chunks = [bytes(PNG).slice(0, 8), pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(pixels)), pngChunk('IEND', new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
async function page(value = PNG): Promise<MarkingImagePage> {
  const original = bytes(value), info = inspectMarkingImage(original);
  return { id: 'page-1', name: info.mime === 'image/png' ? 'page.png' : info.mime === 'image/jpeg' ? 'page.jpg' : 'page.webp', ...info, base64: value, size: original.length, hash: await sha256(original) };
}

describe('local retained image bytes', () => {
  it('imports all supported formats while preserving exact original bytes and dimensions', async () => {
    const result = await parseMarkingImages([file(), file(JPEG, 'page.jpg', 'image/jpeg'), file(WEBP, 'page.webp', 'image/webp')]);
    expect(result.errors).toEqual([]);
    expect(result.pages.map(item => [item.mime, item.width, item.height])).toEqual([['image/png', 1, 1], ['image/jpeg', 3, 2], ['image/webp', 3, 2]]);
    expect(result.pages.map(item => item.base64)).toEqual([PNG, JPEG, WEBP]);
    for (const item of result.pages) { expect(item.hash).toBe(await sha256(bytes(item.base64))); await validateMarkingImageBytes(item); }
  });
  it('rejects remote URLs, SVG, noncanonical base64, forged dimensions and altered immutable originals', async () => {
    const original = await page();
    for (const changes of [{ base64: 'https://example.com/image.png' }, { base64: `data:image/png;base64,${PNG}` }, { base64: PNG.replace('==', '=') }, { width: 2 }, { height: 2 }, { size: original.size + 1 }, { hash: '0'.repeat(64) }, { mime: 'image/jpeg' }, { name: '../page.png' }]) {
      await expect(validateMarkingImageBytes({ ...original, ...changes } as MarkingImagePage)).rejects.toThrow();
    }
    const result = await parseMarkingImages([new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'page.svg', { type: 'image/svg+xml' }), new File(['https://example.com/image.png'], 'link.png', { type: 'image/png' })]);
    expect(result.pages).toEqual([]); expect(result.errors).toHaveLength(2);
  });
  it('rejects mismatched file format without losing independently valid pages', async () => {
    const result = await parseMarkingImages([file(PNG, 'fake.jpg', 'image/jpeg'), file(), file(PNG, 'wrong.png', 'image/svg+xml')]);
    expect(result.pages).toHaveLength(1); expect(result.errors.map(item => item.name)).toEqual(['fake.jpg', 'wrong.png']);
  });
  it('rejects truncated frames, corrupt PNG checksums, oversized pixels and inconsistent raster lengths', () => {
    for (const value of [PNG, JPEG, WEBP]) expect(() => inspectMarkingImage(bytes(value).slice(0, -1))).toThrow();
    const corrupt = bytes(PNG); corrupt[45] ^= 1; expect(() => inspectMarkingImage(corrupt)).toThrow();
    expect(() => inspectMarkingImage(makePng(MARKING_LIMITS.imagePixels + 1, 1))).toThrow(/megapixels/);
    expect(() => inspectMarkingImage(makePng(2, 1))).toThrow(/compressed pixels/);
    expect(() => inspectMarkingImage(makePng(1, 1, new Uint8Array([5, 0, 0, 0, 255])))).toThrow(/compressed pixels/);
    expect(() => inspectMarkingImage(makePng(1, 1, new Uint8Array(5000)))).toThrow(/compressed pixels/);
  });
  it('rejects a wrong zlib checksum even with a valid PNG chunk checksum', () => {
    const image = makePng(), view = new DataView(image.buffer);
    const length = view.getUint32(33); image[41 + length - 1] ^= 1;
    view.setUint32(41 + length, crc32(image.subarray(37, 41 + length)));
    expect(() => inspectMarkingImage(image)).toThrow(/checksum/);
  });
  it('applies limits before reading bytes or accepting any partial over-limit batch', async () => {
    const tooMany = await parseMarkingImages(Array.from({ length: 11 }, () => file()));
    expect(tooMany.pages).toEqual([]); expect(tooMany.errors).toHaveLength(11);
    const read = vi.fn();
    const oversized = { name: 'big.png', type: 'image/png', size: MARKING_LIMITS.imageBytes + 1, arrayBuffer: read } as unknown as File;
    expect((await parseMarkingImages([oversized])).errors[0].message).toMatch(/8 MB/); expect(read).not.toHaveBeenCalled();
    const batch = { ...oversized, size: MARKING_LIMITS.imageBatchBytes + 1 } as unknown as File;
    expect((await parseMarkingImages([batch])).errors[0].message).toMatch(/32 MB/); expect(read).not.toHaveBeenCalled();
  });
  it('requires actual browser decoding where available and releases decoded resources', async () => {
    const original = await page(), close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
    try {
      await validateMarkingImageBytes(original); expect(close).toHaveBeenCalledOnce();
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2, height: 1, close }));
      await expect(validateMarkingImageBytes(original)).rejects.toThrow(/dimensions/); expect(close).toHaveBeenCalledTimes(2);
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad codec')));
      await expect(validateMarkingImageBytes(original)).rejects.toThrow(/cannot be decoded/);
    } finally { vi.unstubAllGlobals(); }
  });
});


function join(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}
function orientationTiff(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26), view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49]); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  view.setUint16(8, 1, true); view.setUint16(10, 0x112, true); view.setUint16(12, 3, true);
  view.setUint32(14, 1, true); view.setUint16(18, orientation, true);
  return tiff;
}
function orientedJpeg(orientation: number): Uint8Array {
  const exif = join([new TextEncoder().encode('Exif\0\0'), orientationTiff(orientation)]);
  const marker = new Uint8Array(4); marker.set([0xff, 0xe1]); new DataView(marker.buffer).setUint16(2, exif.length + 2);
  const original = bytes(JPEG); return join([original.slice(0, 2), marker, exif, original.slice(2)]);
}
function webpChunk(kind: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.length + payload.length % 2);
  output.set(new TextEncoder().encode(kind)); new DataView(output.buffer).setUint32(4, payload.length, true);
  output.set(payload, 8); return output;
}
function orientedWebp(orientation: number): Uint8Array {
  const original = bytes(WEBP), extended = new Uint8Array(10);
  extended[0] = 0x0c; extended[4] = 2; extended[7] = 1; // EXIF + XMP, encoded pixels are3×2.
  const output = join([original.slice(0, 12), webpChunk('VP8X', extended), original.slice(12), webpChunk('EXIF', orientationTiff(orientation)), webpChunk('XMP ', new TextEncoder().encode('orientation metadata'))]);
  new DataView(output.buffer).setUint32(4, output.length - 8, true); return output;
}

describe('metadata-neutral temporary image decode copies', () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`strips JPEG EXIF orientation${orientation}, preserving retained bytes and raw pixel axes`, async () => {
      const original = orientedJpeg(orientation), snapshot = original.slice(), hash = await sha256(original);
      const decoded = markingImageDecodeBytes(original, 'image/jpeg');
      expect(decoded).toEqual(bytes(JPEG)); expect(decoded).not.toBe(original);
      expect(inspectMarkingImage(original)).toEqual({ mime: 'image/jpeg', width: 3, height: 2 });
      expect(inspectMarkingImage(decoded)).toEqual(inspectMarkingImage(original));
      expect(markingImageDecodeBytes(original, 'image/jpeg')).toEqual(decoded);
      expect(original).toEqual(snapshot); expect(await sha256(original)).toBe(hash);
    });
  }
  it('strips PNG eXIf without altering retained chunks, checksums or dimensions', () => {
    const original = join([bytes(PNG).slice(0, 33), pngChunk('eXIf', orientationTiff(6)), bytes(PNG).slice(33)]);
    const snapshot = original.slice(), decoded = markingImageDecodeBytes(original, 'image/png');
    expect(inspectMarkingImage(original)).toEqual({ mime: 'image/png', width: 1, height: 1 });
    expect(decoded).toEqual(bytes(PNG)); expect(original).toEqual(snapshot);
    expect(inspectMarkingImage(decoded)).toEqual(inspectMarkingImage(original));
  });
  it('strips WebP EXIF/XMP and repairs decode-copy RIFF length and VP8X metadata flags', () => {
    const original = orientedWebp(8), snapshot = original.slice();
    const decoded = markingImageDecodeBytes(original, 'image/webp');
    expect(inspectMarkingImage(original)).toEqual({ mime: 'image/webp', width: 3, height: 2 });
    expect(inspectMarkingImage(decoded)).toEqual(inspectMarkingImage(original));
    expect(new DataView(decoded.buffer).getUint32(4, true)).toBe(decoded.length - 8);
    expect(decoded[20] & 0x0c).toBe(0);
    expect(new TextDecoder().decode(decoded)).not.toMatch(/EXIF|XMP /);
    expect(original).toEqual(snapshot); expect(original[20] & 0x0c).toBe(0x0c);
    expect(markingImageDecodeBytes(decoded, 'image/webp')).toEqual(decoded);
  });
  it('retains orientation metadata/hash at import, passing only the neutral copy to browser codecs', async () => {
    const original = orientedJpeg(6), close = vi.fn(), seen: Uint8Array[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
      seen.push(new Uint8Array(await blob.arrayBuffer()));
      return { width: 3, height: 2, close };
    }));
    try {
      const result = await parseMarkingImages([new File([new Uint8Array(original)], 'portrait.jpg', { type: 'image/jpeg' })]);
      expect(result.errors).toEqual([]); expect(result.pages).toHaveLength(1);
      const imported = result.pages[0];
      expect(bytes(imported.base64)).toEqual(original); expect(imported.hash).toBe(await sha256(original));
      expect([imported.width, imported.height]).toEqual([3, 2]);
      await validateMarkingImageBytes(imported);
      expect(seen).toEqual([bytes(JPEG), bytes(JPEG)]); expect(close).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
