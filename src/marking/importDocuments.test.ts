import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createPastedDocument, parseMarkingFiles, sha256, validateDocxArchive, validateRetainedOriginal } from './importDocuments';
import { MARKING_LIMITS } from './types';

const wrap = (text: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
function docx(document = wrap('Fictional essay &amp; evidence.'), additions: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(document), ...additions,
  });
}
function file(bytes: Uint8Array, name = 'Fictional.docx') { return new File([new Uint8Array(bytes)], name); }

describe('local marking document import', () => {
  it('rejects a retained DOCX paired with independently rehashed different marking text', async () => {
    const result = await parseMarkingFiles([file(docx())]);
    expect(result.errors).toEqual([]);
    const document = result.documents[0];
    await expect(validateRetainedOriginal(document)).resolves.toBeUndefined();
    document.text = 'A different fictional essay.';
    document.hash = await sha256(new TextEncoder().encode(document.text));
    await expect(validateRetainedOriginal(document)).rejects.toThrow('normalized marking text do not match');
  });
  it('retains exact originals and normalizes version-bound text without executing HTML', async () => {
    const raw = '<img src="https://example.invalid/a">\r\nRepeat.\rRepeat.';
    const result = await parseMarkingFiles([new File([raw], 'Fictional.txt', { type: 'text/html' })]);
    expect(result.errors).toEqual([]);
    const document = result.documents[0];
    expect(document.text).toBe(raw.replace(/\r\n?/g, '\n'));
    expect(document.original?.mime).toBe('text/plain');
    expect(atob(document.original!.base64)).toBe(raw);
    expect(document.hash).toBe(await sha256(new TextEncoder().encode(document.text)));
    expect(document.original!.hash).toBe(await sha256(new TextEncoder().encode(raw)));
    expect(document.original!.hash).not.toBe(document.hash);
  });
  it('parses a bundled local DOCX without network or HTML rendering', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    try {
      const result = await parseMarkingFiles([file(docx())]);
      expect(result.errors).toEqual([]);
      expect(result.documents[0].text).toBe('Fictional essay & evidence.\n\n');
      expect(result.documents[0].original?.mime).toContain('wordprocessingml');
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it('keeps successful files when a sibling is invalid and rejects non-UTF8/binary/unsupported files', async () => {
    const result = await parseMarkingFiles([
      new File(['Fictional text'], 'good.txt'), file(new Uint8Array([0xc3, 0x28]), 'invalid.txt'),
      new File(['<script>bad()</script>'], 'bad.html'), new File(['null\u0000text'], 'binary.txt'), file(new Uint8Array([1, 2]), 'broken.docx'),
    ]);
    expect(result.documents.map(value => value.name)).toEqual(['good.txt']);
    expect(result.errors.map(value => value.name)).toEqual(['invalid.txt', 'bad.html', 'binary.txt', 'broken.docx']);
  });
  it('enforces bounded batches and files before reading contents', async () => {
    const files = Array.from({ length: 11 }, (_, i) => new File(['x'], `${i}.txt`));
    const read = vi.spyOn(files[0], 'arrayBuffer');
    expect((await parseMarkingFiles(files)).errors).toHaveLength(11);
    expect(read).not.toHaveBeenCalled();
    const over = new File([new Uint8Array(MARKING_LIMITS.fileBytes + 1)], 'too-large.txt');
    expect((await parseMarkingFiles([over])).errors[0].message).toContain('2 MB');
    const batch = Array.from({ length: 6 }, (_, i) => new File([new Uint8Array(MARKING_LIMITS.fileBytes)], `${i}.txt`));
    expect((await parseMarkingFiles(batch)).documents).toEqual([]);
    expect((await parseMarkingFiles(batch)).errors).toHaveLength(6);
    await expect(createPastedDocument('Paste', 'x'.repeat(MARKING_LIMITS.textCharacters + 1))).rejects.toThrow('200,000');
  });
  it('creates independent immutable document IDs for repeated and pasted text', async () => {
    const [first, second] = await Promise.all([createPastedDocument('Essay', 'Same'), createPastedDocument('Essay', 'Same')]);
    expect(first.id).not.toBe(second.id);
    expect(first.hash).toBe(second.hash);
    expect(first.original).toBeNull();
  });
  it('rejects external relationships, DTD/entities, embedded content and extreme XML depth', async () => {
    for (const archive of [
      docx(wrap('safe'), { 'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" TargetMode="External" Target="https://example.invalid/private"/></Relationships>') }),
      docx(wrap('safe'), { 'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="r1" Target="https%3A%2F%2Fexample.invalid/private"/></Relationships>') }),
      docx('<!DOCTYPE d [<!ENTITY e "private">]>' + wrap('&e;')),
      docx(wrap('safe'), { 'word/embeddings/payload.bin': new Uint8Array([1]) }),
      docx('<x>'.repeat(65) + 'safe' + '</x>'.repeat(65)),
      docx(wrap('safe'), { '../document.xml': strToU8('bad') }),
    ]) {
      const result = await parseMarkingFiles([file(archive)]);
      expect(result.documents).toEqual([]);
      expect(result.errors).toHaveLength(1);
    }
  });
  it('checks actual inflated output even when the archive lies about expanded size', async () => {
    const archive = docx(wrap('x'.repeat(100000)));
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let at = 0; at < archive.length - 46; at++) {
      if (view.getUint32(at, true) === 0x02014b50) {
        const name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)));
        if (name === 'word/document.xml') { view.setUint32(at + 24, 64, true); break; }
      }
    }
    await expect(validateDocxArchive(archive)).rejects.toThrow('expanded content');
  });
  it('rejects CRC corruption, duplicate entry claims and malformed ZIP data', async () => {
    const archive = docx();
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let at = 0; at < archive.length - 46; at++) {
      if (view.getUint32(at, true) === 0x02014b50) { view.setUint32(at + 16, 0, true); break; }
    }
    await expect(validateDocxArchive(archive)).rejects.toThrow('checksum');
    await expect(validateDocxArchive(new Uint8Array(100))).rejects.toThrow('archive');
  });
});
