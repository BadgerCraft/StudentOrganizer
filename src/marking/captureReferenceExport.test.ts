import { afterEach, expect, it, vi } from 'vitest';
import { exportAnnotatedMarkingReport } from './annotatedReport';
import { setRendererStorageMode } from '../security/rendererStorageMode';
import type { MarkingReportInput } from './report';
import type { InlineMarkingImagePage, MarkingImagePage, MarkingPageFeedback } from './types';

// Saved-record validity is covered by report/service tests. Isolate the merged
// reference-resolution + protected transport boundary without activating encryption.
vi.mock('./report', () => ({ renderMarkingReport: () => '<!doctype html><body></body>' }));
const original = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
function fixture() {
  const pages: MarkingImagePage[] = ['first', 'second'].map(id => ({ id, name: `${id}.png`, mime: 'image/png', size: atob(original).length, hash: id.repeat(64).slice(0, 64), width: 1, height: 1, captureRef: { version: 1, attachmentId: 'fictional-capture', pageId: id } }));
  const feedback: MarkingPageFeedback[] = [...pages].reverse().map(page => ({ pageId: page.id, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] }));
  const input = { commit: { id: 'fictional-commit', draft: { imageFeedback: feedback } }, attempt: { imagePages: pages, documents: [] } } as unknown as MarkingReportInput;
  const resolve = vi.fn(async (id: string): Promise<InlineMarkingImagePage> => { const { captureRef: _, ...page } = pages.find(page => page.id === id)!; return { ...page, base64: original }; });
  const nativeSave = vi.fn(async (_filename: string, _html: string, _revision?: number) => true);
  const close = vi.fn();
  vi.stubGlobal('window', { desktopReports: { exportPdf: nativeSave } });
  const ctx = Object.fromEntries(['save', 'restore', 'scale', 'translate', 'rotate', 'drawImage', 'fillRect'].map(name => [name, vi.fn()]));
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,ZmljdGlvbmFs', width: 0, height: 0 })) });
  const decode = vi.fn(async () => ({ width: 1, height: 1, close }));
  vi.stubGlobal('createImageBitmap', decode);
  setRendererStorageMode('encrypted');
  return { input, resolve, nativeSave, decode, close };
}
afterEach(() => { setRendererStorageMode('legacy'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('passes the pinned revision separately from the page resolver and preserves all pages in feedback order', async () => {
  const f = fixture(), before = structuredClone(f.input), guard = vi.fn();
  expect(await exportAnnotatedMarkingReport(f.input, guard, 7, f.resolve)).toBe(true);
  expect(f.resolve.mock.calls.map(([id]) => id)).toEqual(['second', 'first']);
  expect(f.nativeSave).toHaveBeenCalledWith('marked-assessment-fictional-commit.pdf', expect.any(String), 7);
  const html = f.nativeSave.mock.calls[0][1];
  expect(html.match(/class="marked-page"/g)).toHaveLength(2);
  expect(html.indexOf('second.png')).toBeLessThan(html.indexOf('first.png'));
  expect(f.close).toHaveBeenCalledTimes(2); expect(f.input).toEqual(before);
  expect(guard).toHaveBeenCalledTimes(2);
});

it('keeps native readable-copy cancellation as false instead of claiming export succeeded', async () => {
  const f = fixture(); f.nativeSave.mockResolvedValue(false);
  expect(await exportAnnotatedMarkingReport(f.input, () => {}, 7, f.resolve)).toBe(false);
  expect(f.nativeSave).toHaveBeenCalledOnce();
});

it.each(['lock', 'teacher'] as const)('blocks output after %s change while the final reference is resolving', async change => {
  const f = fixture(); let current = true;
  const guard = () => { if (!current) throw Error('Teacher changed'); };
  let release!: (page: InlineMarkingImagePage) => void;
  let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
  const savedResolve = f.resolve.getMockImplementation()!;
  f.resolve.mockImplementation(async id => {
    const page = await savedResolve(id);
    if (id === 'first') { entered(); return new Promise(resolve => { release = resolve; }); }
    return page;
  });
  const pending = exportAnnotatedMarkingReport(f.input, guard, 7, f.resolve);
  await waiting;
  if (change === 'lock') setRendererStorageMode('locked'); else current = false;
  release(await savedResolve('first'));
  await expect(pending).rejects.toThrow(change === 'lock' ? 'No readable file was saved' : 'Teacher changed');
  expect(f.nativeSave).not.toHaveBeenCalled();
});

it('rejects protected export without its pinned revision before reading any original', async () => {
  const f = fixture();
  await expect(exportAnnotatedMarkingReport(f.input, () => {}, undefined, f.resolve)).rejects.toThrow('No readable file was saved');
  expect(f.resolve).not.toHaveBeenCalled(); expect(f.decode).not.toHaveBeenCalled(); expect(f.nativeSave).not.toHaveBeenCalled();
});

it.each(['missing', 'inconsistent'] as const)('does not publish partial output when a later captured original is %s', async fault => {
  const f = fixture(); const savedResolve = f.resolve.getMockImplementation()!;
  f.resolve.mockImplementation(async id => {
    if (id === 'first' && fault === 'missing') throw Error('Saved original missing');
    const page = await savedResolve(id); return id === 'first' ? { ...page, hash: 'changed' } : page;
  });
  await expect(exportAnnotatedMarkingReport(f.input, () => {}, 7, f.resolve)).rejects.toThrow(fault === 'missing' ? 'Saved original missing' : 'page changed');
  expect(f.decode).toHaveBeenCalledOnce(); expect(f.nativeSave).not.toHaveBeenCalled();
});
