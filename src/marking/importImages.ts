import { Unzlib } from 'fflate';
import { sha256 } from './importDocuments';
import { MARKING_LIMITS, type MarkingImagePage } from './types';

type ImageInfo = Pick<MarkingImagePage, 'mime' | 'width' | 'height'>;
const fail = (message = 'The image is corrupt or has unsupported framing.'): never => { throw new Error(message); };
const ascii = (bytes: Uint8Array, at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count));
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MARKING_LIMITS.imagePixels) fail('Images must have positive dimensions and at most 20 megapixels.');
}
function nameValid(name: string): void {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\u0000-\u001f\u007f/\\]/u.test(name)) fail('Use a local file name of 1–255 characters without paths or control characters.');
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}
function decode(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(MARKING_LIMITS.imageBytes / 3) * 4 || (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))) fail('Image bytes must be bounded local base64, without URLs or data prefixes.');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (encode(bytes) !== value) fail('Image bytes are not canonical base64.');
  return bytes;
}

function png(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8, width = 0, height = 0, bitDepth = 0, color = 0, interlace = 0;
  let ended = false, seenData = false, dataEnded = false, palette = false;
  const parts: Uint8Array[] = [];
  while (at < bytes.length) {
    if (at + 12 > bytes.length) fail();
    const length = view.getUint32(at), kind = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind) || crc32(bytes.subarray(at + 4, end - 4)) !== view.getUint32(end - 4)) fail();
    const payload = at + 8;
    if (at === 8 && kind !== 'IHDR') fail();
    if (kind === 'IHDR') {
      if (at !== 8 || length !== 13) fail();
      width = view.getUint32(payload); height = view.getUint32(payload + 4);
      dimensions(width, height);
      bitDepth = bytes[payload + 8]; color = bytes[payload + 9]; interlace = bytes[payload + 12];
      const allowed: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowed[color]?.includes(bitDepth) || bytes[payload + 10] !== 0 || bytes[payload + 11] !== 0 || interlace > 1) fail();
    } else if (kind === 'PLTE') {
      if (palette || seenData || !length || length % 3 || length > 768 || color === 0 || color === 4 || (color === 3 && length / 3 > 2 ** bitDepth)) fail();
      palette = true;
    } else if (kind === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) fail();
      seenData = true; parts.push(bytes.subarray(payload, payload + length));
    } else if (kind === 'IEND') {
      if (length || !seenData || end !== bytes.length) fail();
      ended = true;
    } else {
      if (seenData) dataEnded = true;
      // Animation is deliberately rejected: every retained page is one stable image.
      if (['acTL', 'fcTL', 'fdAT'].includes(kind) || kind[0] === kind[0].toUpperCase()) fail('Animated or unsupported PNG images are not supported.');
    }
    at = end;
  }
  if (!ended) fail();
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rowSizes: { rows: number; stride: number }[] = [];
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns && rows) rowSizes.push({ rows, stride: 1 + Math.ceil(columns * channels[color] * bitDepth / 8) });
  }
  const expected = rowSizes.reduce((sum, row) => sum + row.rows * row.stride, 0);
  let actual = 0, pass = 0, row = 0, column = 0, a = 1, b = 0;
  const unzip = new Unzlib(chunk => {
    if (actual + chunk.length > expected) fail('PNG expanded pixels exceed their declared dimensions.');
    for (const byte of chunk) {
      a = (a + byte) % 65521; b = (b + a) % 65521;
      if (column === 0 && byte > 4) fail('PNG has an invalid pixel filter.');
      if (++column === rowSizes[pass].stride) {
        column = 0;
        if (++row === rowSizes[pass].rows) { pass++; row = 0; }
      }
    }
    actual += chunk.length;
  });
  const compressed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { compressed.set(part, offset); offset += part.length; }
  if (compressed.length < 6) fail();
  // fflate validates zlib framing; verify Adler-32 ourselves as well.
  try {
    for (let pos = 0; pos < compressed.length; pos += 512) {
      const chunk = compressed.subarray(pos, pos + 512), last = pos + 512 >= compressed.length;
      unzip.push(chunk, last);
    }
  } catch { fail('PNG compressed pixels are invalid.'); }
  const checksum = new DataView(compressed.buffer).getUint32(compressed.length - 4);
  if (actual !== expected || ((b * 65536 + a) >>> 0) !== checksum) fail('PNG compressed pixels do not match their dimensions or checksum.');
  return { mime: 'image/png', width, height };
}

function jpeg(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2, width = 0, height = 0, scan = false, quantization = false, huffman = false, ended = false;
  const componentIds = new Set<number>();
  while (at < bytes.length) {
    if (bytes[at++] !== 0xff) fail();
    while (at < bytes.length && bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9) { ended = at === bytes.length; break; }
    if (marker === 0xd8 || marker === 0 || marker === undefined || (marker >= 0xd0 && marker <= 0xd7)) fail();
    if (marker === 1) continue;
    if (at + 2 > bytes.length) fail();
    const length = view.getUint16(at), end = at + length;
    if (length < 2 || end > bytes.length) fail();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || length < 11 || bytes[at + 2] !== 8) fail('Unsupported JPEG pixel encoding.');
      height = view.getUint16(at + 3); width = view.getUint16(at + 5); dimensions(width, height);
      const components = bytes[at + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + components * 3) fail();
      for (let n = 0; n < components; n++) {
        const p = at + 8 + n * 3, id = bytes[p], sampling = bytes[p + 1];
        if (componentIds.has(id) || !(sampling >>> 4) || (sampling >>> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[p + 2] > 3) fail();
        componentIds.add(id);
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) fail('Unsupported JPEG pixel encoding.');
    if (marker === 0xdb) {
      let p = at + 2;
      while (p < end) {
        const table = bytes[p++], precision = table >>> 4;
        if (precision > 1 || (table & 15) > 3) fail();
        p += precision ? 128 : 64;
        if (p > end) fail();
      }
      if (p === at + 2) fail();
      quantization = true;
    }
    if (marker === 0xc4) {
      let p = at + 2;
      while (p < end) {
        if (p + 17 > end || (bytes[p] >>> 4) > 1 || (bytes[p] & 15) > 3) fail();
        p++;
        let symbols = 0, slots = 1;
        for (let n = 0; n < 16; n++) { symbols += bytes[p + n]; slots = slots * 2 - bytes[p + n]; if (slots < 0) fail(); }
        p += 16 + symbols;
        if (!symbols || symbols > 256 || p > end) fail();
      }
      if (p === at + 2) fail();
      huffman = true;
    }
    if (marker === 0xda) {
      if (!width || !quantization || !huffman || length < 8 || length !== 6 + bytes[at + 2] * 2 || bytes[at + 2] > componentIds.size) fail();
      const scanned = new Set<number>();
      for (let n = 0; n < bytes[at + 2]; n++) {
        const p = at + 3 + n * 2, id = bytes[p], tables = bytes[p + 1];
        if (!componentIds.has(id) || scanned.has(id) || (tables >>> 4) > 3 || (tables & 15) > 3) fail();
        scanned.add(id);
      }
      scan = true; at = end;
      const start = at;
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) { at++; continue; }
        let next = at + 1;
        while (next < bytes.length && bytes[next] === 0xff) next++;
        if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { at = next + 1; continue; }
        break;
      }
      if (at === start) fail();
      continue;
    }
    at = end;
  }
  if (!ended || !width || !scan) fail();
  return { mime: 'image/jpeg', width, height };
}

function webp(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(4, true) + 8 !== bytes.length || ascii(bytes, 8, 4) !== 'WEBP') fail();
  let at = 12, width = 0, height = 0, declaredWidth = 0, declaredHeight = 0;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) fail();
    const kind = ascii(bytes, at, 4), length = view.getUint32(at + 4, true), data = at + 8, end = data + length;
    if (end + (length % 2) > bytes.length || (length % 2 && bytes[end] !== 0)) fail();
    if (kind === 'VP8X') {
      if (at !== 12 || length !== 10 || bytes[data] & 0xc3 || bytes[data + 1] || bytes[data + 2] || bytes[data + 3]) fail('Animated or malformed WebP images are not supported.');
      declaredWidth = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      declaredHeight = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
      dimensions(declaredWidth, declaredHeight);
    } else if (kind === 'VP8 ') {
      if (width || length < 11 || bytes[data] & 1 || ascii(bytes, data + 3, 3) !== '\x9d\x01\x2a') fail();
      const partition = view.getUint32(data, true) >>> 5 & 0x7ffff;
      if (partition < 7 || partition + 3 > length) fail();
      width = view.getUint16(data + 6, true) & 0x3fff; height = view.getUint16(data + 8, true) & 0x3fff;
    } else if (kind === 'VP8L') {
      if (width || length < 6 || bytes[data] !== 0x2f || bytes[data + 4] & 0xe0) fail();
      const packed = view.getUint32(data + 1, true);
      width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (['ANIM', 'ANMF'].includes(kind)) fail('Animated images are not supported.');
    else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind) || !declaredWidth || !length) fail('Unsupported WebP framing.');
    at = end + (length % 2);
  }
  dimensions(width, height);
  if (declaredWidth && (width !== declaredWidth || height !== declaredHeight)) fail();
  return { mime: 'image/webp', width, height };
}

/** Structural and bounded PNG pixel validation is available in Node; browsers also decode all formats. */
export function inspectMarkingImage(bytes: Uint8Array): ImageInfo {
  if (!bytes.length || bytes.length > MARKING_LIMITS.imageBytes) fail('Each image must be at most 8 MB.');
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF') return webp(bytes);
  return fail('Choose a local PNG, JPEG or WebP image. SVG, remote URLs and other formats are not supported.');
}

/** Decode a temporary metadata-neutral copy so all geometry uses the original encoded pixel axes.
 * Browsers may apply EXIF even with imageOrientation: 'none'. Retained bytes/hash are never changed.
 * Call after structural validation. EXIF/XMP are removed only from this preview/codec copy.
 */
export function markingImageDecodeBytes(bytes: Uint8Array, mime: MarkingImagePage['mime']): Uint8Array {
  if (!bytes.length || bytes.length > MARKING_LIMITS.imageBytes) fail('Each image must be at most 8 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  if (mime === 'image/jpeg') {
    parts.push(bytes.subarray(0, 2));
    let at = 2;
    while (at < bytes.length) {
      const start = at;
      if (bytes[at++] !== 0xff) fail();
      while (at < bytes.length && bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xd9 || marker === 1) { parts.push(bytes.subarray(start, at)); continue; }
      if (at + 2 > bytes.length) fail();
      const length = view.getUint16(at), end = at + length;
      if (length < 2 || end > bytes.length) fail();
      // APP1 contains EXIF/XMP; neither may affect the original coordinate model.
      if (marker !== 0xe1) parts.push(bytes.subarray(start, end));
      at = end;
      if (marker === 0xda) {
        const entropy = at;
        while (at < bytes.length) {
          if (bytes[at] !== 0xff) { at++; continue; }
          let next = at + 1;
          while (next < bytes.length && bytes[next] === 0xff) next++;
          if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) { at = next + 1; continue; }
          break;
        }
        parts.push(bytes.subarray(entropy, at));
      }
    }
  } else if (mime === 'image/png') {
    parts.push(bytes.subarray(0, 8));
    let at = 8;
    while (at < bytes.length) {
      if (at + 12 > bytes.length) fail();
      const end = at + 12 + view.getUint32(at);
      if (end > bytes.length) fail();
      if (ascii(bytes, at + 4, 4) !== 'eXIf') parts.push(bytes.subarray(at, end));
      at = end;
    }
  } else if (mime === 'image/webp') {
    parts.push(bytes.slice(0, 12));
    let at = 12;
    while (at < bytes.length) {
      if (at + 8 > bytes.length) fail();
      const length = view.getUint32(at + 4, true), end = at + 8 + length + length % 2;
      if (end > bytes.length) fail();
      const kind = ascii(bytes, at, 4);
      if (kind === 'VP8X') {
        const chunk = bytes.slice(at, end);
        if (chunk.length < 18) fail();
        chunk[8] &= ~0x0c; // EXIF/XMP are absent from the temporary RIFF.
        parts.push(chunk);
      } else if (kind !== 'EXIF' && kind !== 'XMP ') parts.push(bytes.subarray(at, end));
      at = end;
    }
  } else return fail('Unsupported local image format.');
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  if (mime === 'image/webp') new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

async function browserDecode(bytes: Uint8Array, info: ImageInfo): Promise<void> {
  const blob = new Blob([new Uint8Array(markingImageDecodeBytes(bytes, info.mime))], { type: info.mime });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' }).catch(() => fail('The image cannot be decoded. Export a fresh PNG, JPEG or WebP file.'));
    try { if (bitmap.width !== info.width || bitmap.height !== info.height) fail('Decoded image dimensions do not match the original pixels.'); } finally { bitmap.close(); }
  } else if (typeof Image !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The image cannot be decoded.')); image.src = url; });
      if (image.naturalWidth !== info.width || image.naturalHeight !== info.height) fail('This browser cannot preserve this image orientation. Export a fresh PNG before importing.');
    } finally { URL.revokeObjectURL(url); }
  }
}

/** Use before retaining/importing bytes and before restoring a retained image page.
 * Node validates structure (and PNG compressed pixels); full JPEG/WebP decoding requires a browser codec.
 */
export async function validateMarkingImageBytes(page: MarkingImagePage): Promise<void> {
  nameValid(page.name);
  const bytes = decode(page.base64);
  if (!Number.isSafeInteger(page.size) || page.size !== bytes.length || bytes.length > MARKING_LIMITS.imageBytes || !/^[a-f0-9]{64}$/i.test(page.hash)) fail('Image size or retained hash is invalid.');
  if (await sha256(bytes) !== page.hash.toLowerCase()) fail('Image bytes do not match the retained hash.');
  const info = inspectMarkingImage(bytes);
  const extensionMime = /\.png$/i.test(page.name) ? 'image/png' : /\.webp$/i.test(page.name) ? 'image/webp' : /\.jpe?g$/i.test(page.name) ? 'image/jpeg' : null;
  if (page.mime !== info.mime || extensionMime !== info.mime || page.width !== info.width || page.height !== info.height) fail('Image format or dimensions do not match the retained original.');
  await browserDecode(bytes, info);
}

export async function parseMarkingImages(files: File[]): Promise<{ pages: MarkingImagePage[]; errors: { name: string; message: string; file: File }[] }> {
  const pages: MarkingImagePage[] = [], errors: { name: string; message: string; file: File }[] = [];
  if (files.length > MARKING_LIMITS.imagePages || files.reduce((sum, file) => sum + file.size, 0) > MARKING_LIMITS.imageBatchBytes) {
    return { pages, errors: files.map(file => ({ file, name: file.name, message: 'Import at most 10 images and 32 MB in one batch.' })) };
  }
  for (const file of files) {
    try {
      nameValid(file.name);
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MARKING_LIMITS.imageBytes) fail('Each image must be at most 8 MB.');
      if (!/\.(?:png|jpe?g|webp)$/i.test(file.name) || (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) fail('Choose a local PNG, JPEG or WebP file.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) fail('Image size changed while reading.');
      const info = inspectMarkingImage(bytes);
      const expected = /\.png$/i.test(file.name) ? 'image/png' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/jpeg';
      if (info.mime !== expected || (file.type && file.type !== info.mime)) fail('Image bytes do not match the file extension or format.');
      await browserDecode(bytes, info);
      pages.push({ id: crypto.randomUUID(), name: file.name, ...info, base64: encode(bytes), size: bytes.length, hash: await sha256(bytes) });
    } catch (error) { errors.push({ file, name: file.name, message: error instanceof Error ? error.message : 'Unable to read this image.' }); }
  }
  return { pages, errors };
}
