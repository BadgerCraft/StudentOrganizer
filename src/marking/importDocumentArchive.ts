import { Inflate } from 'fflate';
import { parseMarkingFiles } from './importDocuments';
import { MARKING_LIMITS, type MarkingDocument } from './types';

/** A class set uses the existing 40-submission capture boundary, without raising document,
 * parser-batch or retained-original limits. The 10 MB budget covers the entire class ZIP. */
export const DOCUMENT_ARCHIVE_LIMITS = Object.freeze({
  documents: 40, entries: 128, archiveBytes: MARKING_LIMITS.batchBytes,
  expandedBytes: MARKING_LIMITS.batchBytes, compressionRatio: 200,
});
export interface DocumentArchiveResult {
  documents: MarkingDocument[];
  errors: { name: string; message: string; file: File; path: string }[];
  sources: { documentId: string; path: string }[];
}
interface Entry { path: string; size: number; packed: number; method: number; crc: number; start: number; directory: boolean }
const utf8 = new TextDecoder('utf-8', { fatal: true });
function fail(message: string): never { throw new Error(`DOCX class ZIP: ${message}`); }
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(path: string, directory: boolean): string {
  const bare = directory ? path.slice(0, -1) : path;
  const parts = bare.split('/');
  if (!bare || path.length > 1024 || parts.length > 8 || /[\\:\u0000-\u001f\u007f-\u009f]/u.test(path)
    || parts.some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.') || part.length > 255)) fail('unsafe ZIP path.');
  return bare.normalize('NFC').toLowerCase();
}

/** Same inspect-before-inflate, header agreement, contiguous-range and CRC rules as capturePackage.
 * This intentionally small format rejects ZIP64, descriptors, extra fields and comments. */
function inspect(bytes: Uint8Array): Entry[] {
  if (bytes.length < 22 || bytes.length > DOCUMENT_ARCHIVE_LIMITS.archiveBytes) fail('choose a ZIP of at most 10 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true);
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20) || u16(end + 8) !== u16(end + 10)) fail('unsupported, split or malformed ZIP framing.');
  const count = u16(end + 10), directoryAt = u32(end + 16);
  if (!count || count > DOCUMENT_ARCHIVE_LIMITS.entries || directoryAt + u32(end + 12) !== end) fail('invalid ZIP directory or too many entries.');
  const entries: Entry[] = [], paths = new Map<string, boolean>(), ranges: { start: number; end: number }[] = [];
  let at = directoryAt, expanded = 0, documents = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail('malformed ZIP directory.');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), packed = u32(at + 20), size = u32(at + 24);
    const length = u16(at + 28), local = u32(at + 42), nameEnd = at + 46 + length;
    if (nameEnd > end || !length || u16(at + 30) || u16(at + 32) || u16(at + 34) || flags & ~0x0806 || ![0, 8].includes(method) || u16(at + 6) > 20) fail('encrypted, unsupported or malformed ZIP entry. Recreate a plain ZIP without encryption or extra metadata.');
    const path = utf8.decode(bytes.subarray(at + 46, nameEnd)), directory = path.endsWith('/');
    const attributes = u32(at + 38), mode = (attributes >>> 16) & 0xf000;
    if (mode && mode !== (directory ? 0x4000 : 0x8000) || !directory && attributes & 0x10) fail('symlinks and special ZIP entries are forbidden.');
    const normalized = safePath(path, directory);
    if (paths.has(normalized)) fail('duplicate normalized ZIP path.');
    paths.set(normalized, directory);
    if (directory) {
      if (size || packed || crc || method !== 0) fail('directory entries must be empty.');
    } else {
      if (!/\.docx$/i.test(path)) fail('only .docx essays and their folders are supported; nested archives and other files are forbidden.');
      if (++documents > DOCUMENT_ARCHIVE_LIMITS.documents) fail('import at most 40 DOCX essays in a class ZIP.');
      if (!size || size > MARKING_LIMITS.fileBytes || !packed || method === 0 && packed !== size || size > packed * DOCUMENT_ARCHIVE_LIMITS.compressionRatio) fail('entry exceeds the 2 MB or compression-ratio limit.');
      expanded += size;
      if (expanded > DOCUMENT_ARCHIVE_LIMITS.expandedBytes) fail('expanded class ZIP exceeds 10 MB.');
    }
    if (local + 30 > directoryAt || u32(local) !== 0x04034b50 || u16(local + 4) !== u16(at + 6) || u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc || u32(local + 18) !== packed || u32(local + 22) !== size || u16(local + 26) !== length || u16(local + 28)) fail('local and central ZIP headers disagree.');
    const start = local + 30 + length;
    if (start + packed > directoryAt || utf8.decode(bytes.subarray(local + 30, start)) !== path) fail('invalid local ZIP path or extent.');
    ranges.push({ start: local, end: start + packed });
    entries.push({ path, directory, size, packed, method, crc, start });
    at = nameEnd;
  }
  if (at !== end || !documents) fail('the ZIP must contain 1–40 DOCX essays.');
  // A file cannot also be the parent folder of another entry, on any host platform.
  for (const path of paths.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join('/')) === false) fail('file and folder paths conflict.');
  }
  ranges.sort((a, b) => a.start - b.start);
  let next = 0;
  for (const range of ranges) { if (range.start !== next) fail('overlapping entries or unreferenced ZIP bytes.'); next = range.end; }
  if (next !== directoryAt) fail('unexpected bytes before the ZIP directory.');
  return entries;
}
function expand(bytes: Uint8Array, entry: Entry): Uint8Array {
  const packed = bytes.subarray(entry.start, entry.start + entry.packed);
  const result = new Uint8Array(entry.size);
  let written = 0;
  const accept = (chunk: Uint8Array) => {
    if (written + chunk.length > result.length) fail('deflate stream exceeds its declared size.');
    result.set(chunk, written); written += chunk.length;
  };
  if (entry.method === 0) accept(packed);
  else {
    const inflate = new Inflate(accept);
    for (let offset = 0; offset < packed.length; offset += 256) inflate.push(packed.subarray(offset, offset + 256), offset + 256 >= packed.length);
  }
  if (written !== entry.size || crc32(result) !== entry.crc) fail('expanded size or ZIP checksum does not match.');
  return result;
}

/** Structural ZIP failures reject the whole selection. Bad DOCX contents remain individual retryable
 * failures; extracted names are labels only and never imply a student match. No files are written. */
export async function parseMarkingDocumentArchive(file: File): Promise<DocumentArchiveResult> {
  if (!/\.zip$/i.test(file.name)) fail('choose a .zip file containing .docx essays.');
  if (file.size > DOCUMENT_ARCHIVE_LIMITS.archiveBytes) fail('choose a ZIP of at most 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) fail('file size changed while reading.');
  let extracted: { path: string; file: File }[];
  try {
    const entries = inspect(bytes).filter(entry => !entry.directory);
    // Expand and verify every outer entry before passing any content to the DOCX parser.
    extracted = entries.map(entry => ({ path: entry.path, file: new File([new Uint8Array(expand(bytes, entry))], entry.path.split('/').pop()!, { lastModified: file.lastModified }) }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DOCX class ZIP:')) throw error;
    fail('malformed ZIP names or compressed data. Recreate the ZIP from the original DOCX essays.');
  }
  const result: DocumentArchiveResult = { documents: [], errors: [], sources: [] };
  // Single-file sequential batches honor existing parser caps and retain an exact source path,
  // including when separate folders contain identical base names and identical essay content.
  for (const source of extracted) {
    const parsed = await parseMarkingFiles([source.file]);
    result.documents.push(...parsed.documents);
    result.errors.push(...parsed.errors.map(error => ({ ...error, path: source.path })));
    result.sources.push(...parsed.documents.map(document => ({ documentId: document.id, path: source.path })));
  }
  return result;
}
