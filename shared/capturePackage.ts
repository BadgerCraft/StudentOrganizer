import { Inflate, zipSync } from 'fflate';
import { inspectMarkingImage, validateMarkingImageBytes } from '../src/marking/importImages';

/** v2 is a completed assignment package, never a live revision stream. Labels are hints, not identity. */
export interface CaptureEdits { rotation: 0 | 90 | 180 | 270; crop: { x: number; y: number; width: number; height: number } }
export interface CapturePageMetadata { id: string; order: number; path: string; mime: 'image/png' | 'image/jpeg'; byteLength: number; sha256: string; edits: CaptureEdits }
export interface CaptureSubmissionMetadata { id: string; label: string; pages: CapturePageMetadata[] }
export interface CaptureManifest { format: 'studentorganizer-capture'; version: 2; packageId: string; assignmentId: string; assignmentName: string; revision: number; completed: true; submissions: CaptureSubmissionMetadata[] }
export interface ParsedCapturePage { metadata: CapturePageMetadata; bytes: Uint8Array }
export interface ParsedCaptureSubmission { id: string; label: string; pages: ParsedCapturePage[] }
export interface ParsedCapturePackage { manifest: CaptureManifest; submissions: ParsedCaptureSubmission[] }
export const CAPTURE_LIMITS = Object.freeze({ submissions: 40, pagesPerSubmission: 10, pages: 400, imageBytes: 8 * 1024 * 1024, archiveBytes: 256 * 1024 * 1024, expandedBytes: 256 * 1024 * 1024, manifestBytes: 1024 * 1024, imagePixels: 20_000_000, totalPixels: 800_000_000 });
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
function fail(message: string): never { throw new Error(`Capture package: ${message}`); }
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) fail('unexpected or missing metadata fields.');
}
function label(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value); }
export function capturePagePath(submissionId: string, pageId: string, mime: CapturePageMetadata['mime']): string {
  if (!id(submissionId) || !id(pageId) || !['image/png', 'image/jpeg'].includes(mime)) fail('invalid page identity or MIME.');
  return `pages/${submissionId}/${pageId}.${mime === 'image/png' ? 'png' : 'jpg'}`;
}
export async function captureSha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export function validateCaptureManifest(value: unknown): CaptureManifest {
  fields(value, ['format', 'version', 'packageId', 'assignmentId', 'assignmentName', 'revision', 'completed', 'submissions']);
  if (value.format !== 'studentorganizer-capture' || value.version !== 2 || value.completed !== true) fail('only completed version 2 packages are supported.');
  if (!id(value.packageId) || !id(value.assignmentId) || !label(value.assignmentName) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) fail('invalid assignment identity, label or revision.');
  if (!Array.isArray(value.submissions) || !value.submissions.length || value.submissions.length > CAPTURE_LIMITS.submissions) fail('requires 1–40 student page sets.');
  const submissions = new Set<string>(), pages = new Set<string>(), paths = new Set<string>();
  let bytes = 0;
  for (const submission of value.submissions) {
    fields(submission, ['id', 'label', 'pages']);
    if (!id(submission.id) || submissions.has(submission.id) || !label(submission.label)) fail('invalid or repeated page-set identity, or missing student label.');
    submissions.add(submission.id);
    if (!Array.isArray(submission.pages) || !submission.pages.length || submission.pages.length > CAPTURE_LIMITS.pagesPerSubmission) fail('each student page set requires 1–10 pages.');
    for (const [index, page] of submission.pages.entries()) {
      fields(page, ['id', 'order', 'path', 'mime', 'byteLength', 'sha256', 'edits']);
      if (!id(page.id) || pages.has(page.id) || page.order !== index || !['image/png', 'image/jpeg'].includes(page.mime as string)) fail('invalid/repeated page identity, order or MIME.');
      pages.add(page.id);
      if (page.path !== capturePagePath(submission.id, page.id, page.mime as CapturePageMetadata['mime'])) fail('page path must be generated from its identities.');
      const normalizedPath = (page.path as string).toLowerCase();
      if (paths.has(normalizedPath)) fail('duplicate normalized page path.');
      paths.add(normalizedPath);
      if (!Number.isSafeInteger(page.byteLength) || (page.byteLength as number) < 1 || (page.byteLength as number) > CAPTURE_LIMITS.imageBytes || typeof page.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(page.sha256)) fail('invalid image size or hash.');
      bytes += page.byteLength as number;
      fields(page.edits, ['rotation', 'crop']);
      if (![0, 90, 180, 270].includes(page.edits.rotation as number)) fail('invalid rotation.');
      fields(page.edits.crop, ['x', 'y', 'width', 'height']);
      const { x, y, width, height } = page.edits.crop;
      if (![x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) || (x as number) < 0 || (y as number) < 0 || (width as number) <= 0 || (height as number) <= 0 || (x as number) + (width as number) > 1 || (y as number) + (height as number) > 1) fail('crop must fit the original image coordinates.');
    }
  }
  if (bytes > CAPTURE_LIMITS.expandedBytes || pages.size > CAPTURE_LIMITS.pages) fail('whole-class size limit exceeded.');
  return value as unknown as CaptureManifest;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
interface ZipEntry { name: string; size: number; packed: number; method: number; crc: number; start: number }
/** Inspect the entire central directory AND every local header before any decompression. ZIP64,
 * descriptors, comments and extra fields are intentionally unsupported by this small interchange format. */
function inspectZip(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.length < 22 || bytes.length > CAPTURE_LIMITS.archiveBytes) fail('ZIP size exceeds the bounded package limit or is truncated.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
  const u16 = (at: number) => v.getUint16(at, true), u32 = (at: number) => v.getUint32(at, true);
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20) || u16(end + 8) !== u16(end + 10)) fail('unsupported ZIP framing, comments or split archive.');
  const count = u16(end + 10), directorySize = u32(end + 12), directoryAt = u32(end + 16);
  if (!count || count > CAPTURE_LIMITS.pages + 1 || directoryAt + directorySize !== end) fail('invalid ZIP directory or entry count.');
  const entries = new Map<string, ZipEntry>(), ranges: { start: number; end: number }[] = [];
  let at = directoryAt, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail('invalid central directory.');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), packed = u32(at + 20), size = u32(at + 24), length = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42);
    const nameEnd = at + 46 + length;
    if (nameEnd > end || !length || extra || comment || u16(at + 34) || (flags & ~0x0800) || ![0, 8].includes(method) || u16(at + 6) > 20) fail('encrypted, unsupported or malformed ZIP entry.');
    const attributes = u32(at + 38), mode = attributes >>> 16;
    if ((mode & 0xf000) && (mode & 0xf000) !== 0x8000 || attributes & 0x10) fail('directories, symlinks and special files are forbidden.');
    const name = utf8.decode(bytes.subarray(at + 46, nameEnd));
    if (name !== 'manifest.json' && !/^pages\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(?:png|jpg)$/.test(name)) fail('unsafe or unsupported ZIP path.');
    // Restrict all paths to ASCII; reject case-fold aliases too, independent of host filesystem.
    if ([...entries.keys()].some(existing => existing.toLowerCase() === name.toLowerCase())) fail('duplicate normalized ZIP path.');
    const max = name === 'manifest.json' ? CAPTURE_LIMITS.manifestBytes : CAPTURE_LIMITS.imageBytes;
    if (!size || size > max || !packed || (method === 0 && packed !== size) || size > packed * 200) fail('entry size or compression ratio exceeds limits.');
    expanded += size;
    if (expanded > CAPTURE_LIMITS.expandedBytes) fail('expanded package exceeds the whole-class limit.');
    if (local + 30 > directoryAt || u32(local) !== 0x04034b50 || u16(local + 4) !== u16(at + 6) || u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc || u32(local + 18) !== packed || u32(local + 22) !== size || u16(local + 26) !== length || u16(local + 28)) fail('local and central ZIP headers disagree.');
    const start = local + 30 + length;
    if (start + packed > directoryAt || utf8.decode(bytes.subarray(local + 30, start)) !== name) fail('invalid local entry path or extent.');
    ranges.push({ start: local, end: start + packed });
    entries.set(name, { name, size, packed, method, crc, start });
    at = nameEnd;
  }
  if (at !== end) fail('unexpected ZIP directory bytes.');
  ranges.sort((a, b) => a.start - b.start);
  let next = 0;
  for (const range of ranges) { if (range.start !== next) fail('overlapping entries or unreferenced ZIP data.'); next = range.end; }
  if (next !== directoryAt) fail('unexpected data before ZIP directory.');
  return entries;
}
function expand(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const data = bytes.subarray(entry.start, entry.start + entry.packed);
  let result: Uint8Array;
  if (entry.method === 0) result = data.slice();
  else {
    result = new Uint8Array(entry.size);
    let written = 0;
    const inflate = new Inflate(chunk => { if (written + chunk.length > entry.size) fail('deflate stream exceeds its declared size.'); result.set(chunk, written); written += chunk.length; });
    // Small input chunks bound each temporary decompressor allocation, even for dishonest headers.
    try { for (let offset = 0; offset < data.length; offset += 256) inflate.push(data.subarray(offset, offset + 256), offset + 256 >= data.length); }
    catch (error) { fail(error instanceof Error ? error.message : 'invalid deflate stream.'); }
    if (written !== entry.size) fail('expanded size does not match the ZIP header.');
  }
  if (crc32(result) !== entry.crc) fail('ZIP entry checksum mismatch.');
  return result;
}
function base64(bytes: Uint8Array): string { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); }
async function verifyPage(metadata: CapturePageMetadata, bytes: Uint8Array): Promise<number> {
  if (bytes.length !== metadata.byteLength || await captureSha256(bytes) !== metadata.sha256) fail('image bytes do not match the declared hash or size.');
  const info = inspectMarkingImage(bytes);
  if (info.mime !== metadata.mime) fail('image MIME does not match its bytes.');
  if (info.width * info.height > CAPTURE_LIMITS.imagePixels) fail('image exceeds 20 megapixels.');
  await validateMarkingImageBytes({ id: metadata.id, name: metadata.path.split('/').pop()!, mime: metadata.mime, size: bytes.length, hash: metadata.sha256, base64: base64(bytes), width: info.width, height: info.height });
  return info.width * info.height;
}
/** Sequential expansion/codec checks avoid decoding 400 pictures concurrently. The returned original
 * bytes are bounded by the package cap and remain unedited; UI geometry applies edits separately. */
export async function decodeCapturePackage(bytes: Uint8Array): Promise<ParsedCapturePackage> {
  const entries = inspectZip(bytes), manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) fail('manifest.json is required.');
  let raw: unknown;
  try { raw = JSON.parse(utf8.decode(expand(bytes, manifestEntry))); } catch { fail('invalid manifest JSON or checksum.'); }
  const manifest = validateCaptureManifest(raw), submissions: ParsedCaptureSubmission[] = [];
  let pixels = 0, expectedEntries = 1;
  for (const submission of manifest.submissions) {
    const parsed: ParsedCaptureSubmission = { id: submission.id, label: submission.label, pages: [] };
    for (const metadata of submission.pages) {
      const entry = entries.get(metadata.path);
      if (!entry || entry.size !== metadata.byteLength) fail('missing page or incorrect declared image size.');
      const pageBytes = expand(bytes, entry);
      pixels += await verifyPage(metadata, pageBytes);
      if (pixels > CAPTURE_LIMITS.totalPixels) fail('whole-class pixel budget exceeded.');
      parsed.pages.push({ metadata, bytes: pageBytes }); expectedEntries++;
    }
    submissions.push(parsed);
  }
  if (entries.size !== expectedEntries) fail('unlisted files are forbidden.');
  return { manifest, submissions };
}
export async function encodeCapturePackage(manifest: CaptureManifest, files: Record<string, Uint8Array>): Promise<Uint8Array> {
  // Snapshot metadata before await so a UI mutation cannot alter the completed package mid-export.
  const checked = validateCaptureManifest(JSON.parse(JSON.stringify(manifest)));
  const manifestBytes = encoder.encode(JSON.stringify(checked));
  if (manifestBytes.length > CAPTURE_LIMITS.manifestBytes) fail('manifest exceeds its limit.');
  const entries: Record<string, Uint8Array> = { 'manifest.json': manifestBytes };
  let total = manifestBytes.length, pixels = 0, count = 0;
  for (const submission of checked.submissions) for (const page of submission.pages) {
    if (!Object.prototype.hasOwnProperty.call(files, page.path) || !(files[page.path] instanceof Uint8Array)) fail('a page is missing.');
    const bytes = files[page.path].slice();
    pixels += await verifyPage(page, bytes); total += bytes.length; count++;
    if (pixels > CAPTURE_LIMITS.totalPixels || total > CAPTURE_LIMITS.expandedBytes) fail('whole-class package budget exceeded.');
    entries[page.path] = bytes;
  }
  if (Object.keys(files).length !== count) fail('unlisted files are forbidden.');
  const zip = zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0) });
  if (zip.length > CAPTURE_LIMITS.archiveBytes) fail('ZIP exceeds the whole-class archive limit.');
  return zip;
}
