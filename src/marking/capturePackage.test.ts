import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { CAPTURE_LIMITS, capturePagePath, captureSha256, decodeCapturePackage, encodeCapturePackage, validateCaptureManifest, type CaptureManifest } from '../../shared/capturePackage';
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
async function fixture(students = 2, pages = 2) {
  const files: Record<string, Uint8Array> = {}, hash = await captureSha256(png);
  const manifest: CaptureManifest = { format: 'studentorganizer-capture', version: 2, completed: true, packageId: 'package-1', assignmentId: 'assignment-1', assignmentName: 'Fictional fractions', revision: 1, submissions: Array.from({ length: students }, (_, s) => ({ id: `student-${s}`, label: 'Duplicate display name', pages: Array.from({ length: pages }, (_, p) => {
    const id = `page-${s}-${p}`, path = capturePagePath(`student-${s}`, id, 'image/png'); files[path] = png;
    return { id, order: p, path, mime: 'image/png', byteLength: png.length, sha256: hash, edits: { rotation: p % 2 ? 90 : 0, crop: { x: .1, y: .2, width: .8, height: .7 } } };
  }) })) };
  return { manifest, files };
}
function rawZip(manifest: unknown, files: Record<string, Uint8Array>, level: 0 | 6 = 0) { return zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), ...files }, { level }); }
function central(zip: Uint8Array) { return new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(zip.length - 6, true); }
function mutate(zip: Uint8Array, fn: (view: DataView, centralAt: number) => void) { const copy = zip.slice(); fn(new DataView(copy.buffer), central(copy)); return copy; }
describe('completed capture package v2', () => {
  it('preserves original bytes, nondestructive edits, order and duplicate labels as distinct sets', async () => {
    const { manifest, files } = await fixture();
    const result = await decodeCapturePackage(await encodeCapturePackage(manifest, files));
    expect(result.manifest).toEqual(manifest);
    expect(result.submissions).toHaveLength(2);
    expect(result.submissions[0].id).not.toBe(result.submissions[1].id);
    expect(result.submissions[0].pages[1].metadata.edits.rotation).toBe(90);
    expect(result.submissions[0].pages[1].bytes).toEqual(png);
  });
  it('exports identical bytes across retries at different wall-clock times', async () => {
    const { manifest, files } = await fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
      const first = await encodeCapturePackage(manifest, files);
      vi.setSystemTime(new Date('2027-02-10T23:55:00Z'));
      expect(await encodeCapturePackage(manifest, files)).toEqual(first);
    } finally { vi.useRealTimers(); }
  });
  it('round-trips a bounded whole class of 40 students and 400 pages', async () => {
    const { manifest, files } = await fixture(40, 10);
    const result = await decodeCapturePackage(await encodeCapturePackage(manifest, files));
    expect(result.submissions).toHaveLength(CAPTURE_LIMITS.submissions);
    expect(result.submissions.flatMap(s => s.pages)).toHaveLength(CAPTURE_LIMITS.pages);
  });
  it('accepts bounded ordinary deflate ZIPs as well as store output', async () => {
    const { manifest, files } = await fixture(); expect((await decodeCapturePackage(rawZip(manifest, files, 6))).submissions).toHaveLength(2);
  });
  it.each(['../evil.png', '/pages/x.png', 'pages\\evil.png', 'pages/a/../b.png', 'nested.zip', 'pages/a/b.svg'])('rejects unsafe/unsupported entry %s', async path => {
    const { manifest, files } = await fixture(); files[path] = png;
    await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow(/path/);
  });
  it('rejects normalized duplicate paths before extraction', async () => {
    const { manifest, files } = await fixture(); files['pages/STUDENT-0/PAGE-0-0.png'] = png;
    await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow(/duplicate/);
  });
  it.each([
    (v: DataView, c: number) => v.setUint16(c + 8, 1, true),
    (v: DataView, c: number) => v.setUint16(c + 10, 99, true),
    (v: DataView, c: number) => v.setUint32(c + 38, 0xa1ff0000, true),
    (v: DataView, c: number) => v.setUint32(c + 24, CAPTURE_LIMITS.manifestBytes + 1, true),
    (v: DataView) => v.setUint32(18, 1, true),
    (v: DataView, c: number) => v.setUint32(c + 42, 1, true),
    (v: DataView, c: number) => v.setUint16(c + 30, 1, true),
  ])('rejects hostile header variant %#', async mutation => {
    const { manifest, files } = await fixture(); await expect(decodeCapturePackage(mutate(rawZip(manifest, files), mutation))).rejects.toThrow();
  });
  it.each([
    (m: any) => { m.version = 1; }, (m: any) => { m.completed = false; },
    (m: any) => { m.enrollmentId = 123; }, (m: any) => { m.submissions[0].label = ' '; },
    (m: any) => { m.submissions[1].id = m.submissions[0].id; },
    (m: any) => { m.submissions[0].pages[1].id = m.submissions[0].pages[0].id; },
    (m: any) => { m.submissions[0].pages[1].order = 0; },
    (m: any) => { m.submissions[0].pages[0].edits.crop.width = 1; },
    (m: any) => { m.submissions[0].pages[0].edits.rotation = 45; },
    (m: any) => { m.submissions[0].pages[0].path = '../escape.png'; },
    (m: any) => { m.submissions[0].pages[0].sha256 = '0'.repeat(64); },
    (m: any) => { m.submissions[0].pages[0].byteLength++; },
  ])('rejects invalid manifest variant %#', async change => {
    const { manifest, files } = await fixture(); change(manifest); await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow();
  });
  it('rejects missing/unlisted pictures and wrong files', async () => {
    const { manifest, files } = await fixture();
    await expect(decodeCapturePackage(png)).rejects.toThrow();
    await expect(encodeCapturePackage(manifest, {})).rejects.toThrow(/missing/);
    await expect(decodeCapturePackage(rawZip(manifest, { ...files, 'pages/extra/extra.png': png }))).rejects.toThrow(/unlisted/);
    delete files[manifest.submissions[0].pages[0].path]; await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow(/missing/);
  });
  it('rejects a correctly hashed malformed image and mislabeled MIME', async () => {
    const { manifest, files } = await fixture(); const page = manifest.submissions[0].pages[0];
    const invalid = new Uint8Array(png.length); files[page.path] = invalid; page.sha256 = await captureSha256(invalid);
    await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow();
    files[page.path] = png; page.sha256 = await captureSha256(png); delete files[page.path];
    page.mime = 'image/jpeg'; page.path = capturePagePath(manifest.submissions[0].id, page.id, page.mime); files[page.path] = png;
    await expect(decodeCapturePackage(rawZip(manifest, files))).rejects.toThrow(/MIME/);
  });
  it('rejects excess page sets and per-student pages', async () => {
    const tooMany = await fixture(41, 1); expect(() => validateCaptureManifest(tooMany.manifest)).toThrow(/40/);
    const tooManyPages = await fixture(1, 11); expect(() => validateCaptureManifest(tooManyPages.manifest)).toThrow(/10/);
  });
  it('checks CRC and refuses truncated or appended archives', async () => {
    const { manifest, files } = await fixture(); const zip = rawZip(manifest, files);
    const corrupt = zip.slice(); corrupt[50] ^= 1; await expect(decodeCapturePackage(corrupt)).rejects.toThrow();
    await expect(decodeCapturePackage(zip.subarray(0, zip.length - 1))).rejects.toThrow();
    await expect(decodeCapturePackage(new Uint8Array([...zip, 0]))).rejects.toThrow();
  });
  it('rejects compressed bombs before expansion', async () => {
    const { manifest, files } = await fixture(); files['pages/bomb/bomb.png'] = new Uint8Array(4 * 1024 * 1024);
    await expect(decodeCapturePackage(rawZip(manifest, files, 6))).rejects.toThrow(/compression ratio/);
  });
});
