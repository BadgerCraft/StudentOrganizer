import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { DOCUMENT_ARCHIVE_LIMITS, parseMarkingDocumentArchive } from './importDocumentArchive';
import { parseMarkingFiles } from './importDocuments';
import { MARKING_LIMITS } from './types';

function essay(text = 'Fictional essay with evidence.') {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
}
const file = (bytes: Uint8Array) => new File([new Uint8Array(bytes)], 'Fictional class.zip', { lastModified: 123 });
const archive = (files: Record<string, Uint8Array>) => zipSync(files, { level: 0 });
function headers(bytes: Uint8Array, change: (view: DataView, central: number, local: number) => void) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = view.getUint32(bytes.length - 6, true);
  const count = view.getUint16(bytes.length - 12, true);
  for (let i = 0; i < count; i++) {
    const next = at + 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    change(view, at, view.getUint32(at + 42, true)); at = next;
  }
  return bytes;
}

describe('bounded local DOCX class ZIP import', () => {
  it('imports nested-folder essays with exact originals and explicit source paths, without a student match or network', async () => {
    const original = essay();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline fictional fixture'));
    try {
      const result = await parseMarkingDocumentArchive(file(archive({ 'Class/': new Uint8Array(), 'Class/Essay.docx': original, 'Other/Essay.docx': essay('Another fictional response.') })));
      expect(result.errors).toEqual([]);
      expect(result.documents.map(document => document.text)).toEqual(['Fictional essay with evidence.\n\n', 'Another fictional response.\n\n']);
      expect(result.sources).toEqual(result.documents.map((document, i) => ({ documentId: document.id, path: ['Class/Essay.docx', 'Other/Essay.docx'][i] })));
      expect(Uint8Array.from(atob(result.documents[0].original!.base64), c => c.charCodeAt(0))).toEqual(original);
      expect(result.documents[0]).not.toHaveProperty('studentId');
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it('supports a 40-essay class set beyond the individual-file batch cap, preserving separate document identities', async () => {
    const result = await parseMarkingDocumentArchive(file(archive(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Essay-${i}.docx`, essay()])))));
    expect(result.errors).toEqual([]);
    expect(result.documents).toHaveLength(40);
    expect(new Set(result.documents.map(document => document.id)).size).toBe(40);
    expect(MARKING_LIMITS.batchFiles).toBe(10);
    expect(MARKING_LIMITS.documents).toBe(10);
  });
  it('keeps successful siblings and exact failed files for retry when identical basenames occur in different folders', async () => {
    const result = await parseMarkingDocumentArchive(file(archive({ 'One/Essay.docx': essay(), 'Two/Essay.docx': strToU8('Not a DOCX') })));
    expect(result.documents).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe('Two/Essay.docx');
    expect(result.errors[0].file.name).toBe('Essay.docx');
    const retry = await parseMarkingFiles([result.errors[0].file]);
    expect(retry.errors[0].file).toBe(result.errors[0].file);
    expect(new TextDecoder().decode(await retry.errors[0].file.arrayBuffer())).toBe('Not a DOCX');
  });
  it.each(['../Essay.docx', '/Essay.docx', 'C:/Essay.docx', 'A\\Essay.docx', 'A/./Essay.docx', 'A//Essay.docx', 'A /Essay.docx', 'A./Essay.docx', 'Essay.zip', 'Readme.txt'])('rejects unsafe paths or unsupported/nested content: %s', async path => {
    await expect(parseMarkingDocumentArchive(file(archive({ [path]: essay() })))).rejects.toThrow('DOCX class ZIP');
  });
  it('rejects case-folded and Unicode-normalized duplicates and file/folder conflicts', async () => {
    const cases: Record<string, Uint8Array>[] = [
      { 'Essay.docx': essay(), 'essay.docx': essay() },
      { 'Caf\u00e9.docx': essay(), 'Cafe\u0301.docx': essay() },
      { 'Essay.docx': essay(), 'Essay.docx/Child.docx': essay() },
    ];
    for (const files of cases) await expect(parseMarkingDocumentArchive(file(archive(files)))).rejects.toThrow(/duplicate|conflict/);
  });
  it('rejects symlinks, devices, encryption, unsupported methods, descriptors, and inconsistent local headers', async () => {
    const mutations = [
      (v: DataView, c: number) => v.setUint32(c + 38, 0xa000 << 16, true),
      (v: DataView, c: number) => v.setUint32(c + 38, 0x2000 << 16, true),
      (v: DataView, c: number, l: number) => { v.setUint16(c + 8, 1, true); v.setUint16(l + 6, 1, true); },
      (v: DataView, c: number, l: number) => { v.setUint16(c + 10, 99, true); v.setUint16(l + 8, 99, true); },
      (v: DataView, c: number, l: number) => { v.setUint16(c + 8, 8, true); v.setUint16(l + 6, 8, true); },
      (v: DataView, _c: number, l: number) => v.setUint32(l + 22, 1, true),
      (v: DataView, c: number) => v.setUint16(c + 30, 1, true),
    ];
    for (const mutate of mutations) await expect(parseMarkingDocumentArchive(file(headers(archive({ 'Essay.docx': essay() }), mutate)))).rejects.toThrow('DOCX class ZIP');
  });
  it('rejects malformed, corrupt and overlapping archives before any DOCX parsing', async () => {
    await expect(parseMarkingDocumentArchive(file(new Uint8Array(40)))).rejects.toThrow('framing');
    await expect(parseMarkingDocumentArchive(file(archive({ 'Folder/': new Uint8Array() })))).rejects.toThrow('1–40');
    const corrupt = archive({ 'Essay.docx': essay() });
    corrupt[45] ^= 1;
    await expect(parseMarkingDocumentArchive(file(corrupt))).rejects.toThrow('checksum');
    const overlap = headers(archive({ 'One.docx': essay(), 'Two.docx': essay() }), (v, c) => v.setUint32(c + 42, 0, true));
    await expect(parseMarkingDocumentArchive(file(overlap))).rejects.toThrow('DOCX class ZIP');
  });
  it('enforces compressed size before reading and bounds count, per-file and total expanded bytes', async () => {
    const over = file(new Uint8Array(DOCUMENT_ARCHIVE_LIMITS.archiveBytes + 1));
    const read = vi.spyOn(over, 'arrayBuffer');
    await expect(parseMarkingDocumentArchive(over)).rejects.toThrow('10 MB');
    expect(read).not.toHaveBeenCalled();
    await expect(parseMarkingDocumentArchive(file(archive(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`Essay-${i}.docx`, essay()])))))).rejects.toThrow('40');
    const big = headers(archive({ 'Essay.docx': essay() }), (v, c, l) => { v.setUint32(c + 24, MARKING_LIMITS.fileBytes + 1, true); v.setUint32(l + 22, MARKING_LIMITS.fileBytes + 1, true); });
    await expect(parseMarkingDocumentArchive(file(big))).rejects.toThrow('2 MB');
    // Each entry passes the ratio/file cap; the aggregate must still fail before inflation.
    let seed = 123456789;
    const block = Uint8Array.from({ length: 16000 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; });
    const repeated = Uint8Array.from({ length: MARKING_LIMITS.fileBytes }, (_, n) => block[n % block.length]);
    const aggregate = zipSync(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`Essay-${i}.docx`, repeated])), { level: 1 });
    await expect(parseMarkingDocumentArchive(file(aggregate))).rejects.toThrow('expanded class ZIP exceeds 10 MB');
  });
  it('bounds actual inflation despite dishonest sizes and rejects compression bombs', async () => {
    const bomb = zipSync({ 'Essay.docx': new Uint8Array(100000).fill(65) });
    await expect(parseMarkingDocumentArchive(file(bomb))).rejects.toThrow('compression-ratio');
    const dishonest = headers(zipSync({ 'Essay.docx': essay('x'.repeat(10000)) }), (v, c, l) => { v.setUint32(c + 24, 32, true); v.setUint32(l + 22, 32, true); });
    await expect(parseMarkingDocumentArchive(file(dishonest))).rejects.toThrow('declared size');
  });
  it('accepts supported outer deflate and keeps a renamed nested ZIP as an individual invalid DOCX', async () => {
    const result = await parseMarkingDocumentArchive(file(zipSync({ 'Good.docx': essay(), 'Renamed.docx': archive({ 'Inner.docx': essay() }) })));
    expect(result.documents.map(document => document.name)).toEqual(['Good.docx']);
    expect(result.errors.map(error => error.path)).toEqual(['Renamed.docx']);
  });
  it('bounds total entry count including empty folders and rejects changed file sizes', async () => {
    const crowded = archive({ ...Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`Folder-${i}/`, new Uint8Array()])), 'Essay.docx': essay() });
    await expect(parseMarkingDocumentArchive(file(crowded))).rejects.toThrow('too many entries');
    const changed = file(archive({ 'Essay.docx': essay() }));
    vi.spyOn(changed, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(23));
    await expect(parseMarkingDocumentArchive(changed)).rejects.toThrow('size changed');
  });
});
