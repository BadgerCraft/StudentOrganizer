import { Inflate, zipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { MARKING_LIMITS, type MarkingDocument } from './types';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ZIP_ENTRIES = 256;
const MAX_XML_ELEMENTS = 100000;

export function normalizeMarkingText(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('The document contains no marking text.');
  if (normalized.length > MARKING_LIMITS.textCharacters) throw new Error('Text exceeds 200,000 characters.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(normalized)) throw new Error('Unsupported control or replacement characters in text.');
  return normalized;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateName(name: string): void {
  if (!name.trim() || name.length > 255 || /[\u0000-\u001f\u007f/\\]/u.test(name)) throw new Error('Use a file name of 1–255 characters without paths or control characters.');
}

function base64(bytes: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate before Mammoth sees the archive. Actual inflation, not only ZIP claims, is bounded. */
export async function validateDocxArchive(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length > MARKING_LIMITS.fileBytes || bytes.length < 22) throw new Error('Invalid DOCX archive or file larger than 2 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Unsupported DOCX archive.');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (!count || count > MAX_ZIP_ENTRIES || view.getUint16(end + 8, true) !== count || directoryStart + directorySize !== end) throw new Error('DOCX archive is too complex or malformed.');
  const entries: Record<string, Uint8Array> = Object.create(null);
  const spans: [number, number][] = [];
  let cursor = directoryStart;
  let expandedTotal = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Malformed DOCX directory.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const expandedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & ~0x080e || flags & 1 || ![0, 8].includes(method) || view.getUint16(cursor + 34, true) || expandedSize > MARKING_LIMITS.expandedDocxBytes) throw new Error('Unsupported or oversized DOCX entry.');
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || name.length > 255 || /[\\\u0000-\u0020]/u.test(name) || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || Object.prototype.hasOwnProperty.call(entries, name)) throw new Error('Unsafe or duplicate DOCX entry.');
    // Do not retain executable Office parts or embedded packages in the parser input.
    if (/\.(?:bin|exe|dll|js|html?|zip)$/i.test(name) || /(?:^|\/)(?:embeddings|activeX)(?:\/|$)/i.test(name)) throw new Error('Embedded executable or packaged content is not supported. Export as plain text.');
    if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new Error('Malformed DOCX local entry.');
    const localNameLength = view.getUint16(local + 26, true);
    const dataStart = local + 30 + localNameLength + view.getUint16(local + 28, true);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directoryStart || utf8.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name || spans.some(([start, stop]) => local < stop && dataEnd > start)) throw new Error('Overlapping or malformed DOCX entries.');
    spans.push([local, dataEnd]);
    const chunks: Uint8Array[] = [];
    let actual = 0;
    const accept = (chunk: Uint8Array) => {
      actual += chunk.length;
      expandedTotal += chunk.length;
      if (actual > expandedSize || expandedTotal > MARKING_LIMITS.expandedDocxBytes) throw new Error('DOCX expanded content exceeds its safe limit.');
      chunks.push(chunk.slice());
    };
    if (method === 0) accept(bytes.subarray(dataStart, dataEnd));
    else {
      const inflate = new Inflate(accept);
      // A small compressed chunk bounds allocations even if the ZIP header lies about expansion.
      for (let at = dataStart; at < dataEnd; at += 512) inflate.push(bytes.subarray(at, Math.min(at + 512, dataEnd)), at + 512 >= dataEnd);
      if (!compressedSize) throw new Error('Empty compressed DOCX entry.');
    }
    if (actual !== expandedSize) throw new Error('DOCX expanded size does not match its directory.');
    const expanded = new Uint8Array(actual);
    let offset = 0;
    for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.length; }
    if (crc32(expanded) !== crc) throw new Error('DOCX entry checksum does not match.');
    entries[name] = expanded;
    cursor = next;
  }
  if (cursor !== end || !entries['[Content_Types].xml'] || !entries['word/document.xml']) throw new Error('Not a supported Word DOCX document.');
  let xmlElements = 0;
  for (const [name, content] of Object.entries(entries)) {
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const xml = utf8.decode(content);
    let depth = 0;
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', () => { throw new Error('DOCX document type declarations are not supported.'); });
    parser.on('opentag', tag => {
      if (++depth > 64 || ++xmlElements > MAX_XML_ELEMENTS) throw new Error('DOCX XML is too complex.');
      if (['altChunk', 'object', 'OLEObject'].includes(tag.local)) throw new Error('Embedded content is not supported. Export as plain text.');
      if (name.endsWith('.rels') && tag.local === 'Relationship') {
        const attributes = Object.values(tag.attributes);
        const mode = attributes.find(attribute => attribute.local === 'TargetMode')?.value;
        const rawTarget = attributes.find(attribute => attribute.local === 'Target')?.value;
        if (mode && mode.toLowerCase() !== 'internal') throw new Error('DOCX external relationships are not supported. Export as plain text.');
        if (!rawTarget) throw new Error('Malformed DOCX relationship.');
        let target: string;
        try { target = decodeURIComponent(rawTarget); } catch { throw new Error('Malformed DOCX relationship target.'); }
        if (/^[a-z][a-z0-9+.-]*:|^\/\/|[\\\u0000-\u001f]/i.test(target)) throw new Error('DOCX remote or external resources are not supported.');
        const relativeBase = name === '_rels/.rels' ? '' : name.slice(0, name.lastIndexOf('/_rels/'));
        const parts = target.startsWith('/') ? [] : relativeBase.split('/').filter(Boolean);
        for (const part of target.split('#')[0].split('/')) {
          if (!part || part === '.') continue;
          if (part === '..') {
            if (!parts.length) throw new Error('DOCX relationship escapes its local archive.');
            parts.pop();
          } else parts.push(part);
        }
        if (!Object.prototype.hasOwnProperty.call(entries, parts.join('/'))) throw new Error('DOCX relationship references a missing local part.');
      }
    });
    parser.on('closetag', () => { depth--; });
    parser.write(xml).close();
  }
  // Mammoth receives only a freshly constructed, verified archive; no forged sizes reach JSZip.
  return zipSync(entries, { level: 0 });
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const checked = await validateDocxArchive(bytes);
  // The explicit browser build has no filesystem/network input adapters or CDN loader.
  // @ts-expect-error Mammoth publishes types for its main entry but not the identical browser API.
  const loaded = await import('mammoth/mammoth.browser.js');
  const mammoth = (loaded.default ?? loaded) as typeof import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: new Uint8Array(checked).buffer });
  if (result.messages.length) throw new Error('DOCX contains unsupported content. Export it as UTF-8 text and review the import preview.');
  return result.value;
}

/** Apply the same retained-file contract before an import and before a restore. */
export async function validateRetainedOriginal(document: MarkingDocument): Promise<void> {
  if (!document.original) return;
  const original = document.original;
  validateName(original.name);
  if (original.name !== document.name) throw new Error('Original filename does not match the document.');
  const bytes = Uint8Array.from(atob(original.base64), character => character.charCodeAt(0));
  if (bytes.length !== original.size || bytes.length > MARKING_LIMITS.fileBytes) throw new Error('Original file size does not match its bytes or exceeds 2 MB.');
  if (await sha256(bytes) !== original.hash.toLowerCase()) throw new Error('Original file content does not match its retained hash.');
  let text: string;
  if (original.mime === 'text/plain' && /\.txt$/i.test(original.name)) {
    try { text = utf8.decode(bytes); } catch { throw new Error('Original text file must use valid UTF-8 encoding.'); }
  } else if (original.mime === DOCX_MIME && /\.docx$/i.test(original.name)) text = await docxText(bytes);
  else throw new Error('Original file type is unsupported.');
  if (normalizeMarkingText(text) !== document.text) throw new Error('Original file and normalized marking text do not match.');
}

export async function createPastedDocument(name: string, text: string): Promise<MarkingDocument> {
  validateName(name);
  const normalized = normalizeMarkingText(text);
  return { id: crypto.randomUUID(), name, text: normalized, hash: await sha256(encoder.encode(normalized)), original: null };
}

export async function parseMarkingFiles(files: File[]): Promise<{ documents: MarkingDocument[]; errors: { name: string; message: string }[] }> {
  const documents: MarkingDocument[] = [];
  const errors: { name: string; message: string }[] = [];
  if (files.length > MARKING_LIMITS.batchFiles || files.reduce((sum, file) => sum + file.size, 0) > MARKING_LIMITS.batchBytes) {
    return { documents, errors: files.map(file => ({ name: file.name, message: 'Import at most 10 files and 10 MB in one batch.' })) };
  }
  for (const file of files) {
    try {
      validateName(file.name);
      if (file.size > MARKING_LIMITS.fileBytes) throw new Error('File exceeds 2 MB.');
      const extension = file.name.toLowerCase().split('.').pop();
      if (extension !== 'txt' && extension !== 'docx') throw new Error('Choose UTF-8 .txt or .docx files. PDF, HTML and remote links are not supported.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size || bytes.length > MARKING_LIMITS.fileBytes) throw new Error('File size changed or exceeds 2 MB.');
      let raw: string;
      if (extension === 'txt') {
        try { raw = utf8.decode(bytes); } catch { throw new Error('Text files must use valid UTF-8 encoding.'); }
      } else raw = await docxText(bytes);
      const document = await createPastedDocument(file.name, raw);
      document.original = { name: file.name, mime: extension === 'txt' ? 'text/plain' : DOCX_MIME, base64: base64(bytes), size: bytes.length, hash: await sha256(bytes) };
      documents.push(document);
    } catch (error) {
      errors.push({ name: file.name, message: error instanceof Error ? error.message : 'Unable to read this file.' });
    }
  }
  return { documents, errors };
}
