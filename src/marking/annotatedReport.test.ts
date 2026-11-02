import { setRendererStorageMode } from '../security/rendererStorageMode';
import { describe, expect, it, vi } from 'vitest';
import { drawAnnotatedPage, exportAnnotatedMarkingReport } from './annotatedReport';
import type { MarkingReportInput } from './report';
vi.mock('./report', () => ({ renderMarkingReport: () => '<!doctype html><body></body>' }));
import type { MarkingImagePage, MarkingPageFeedback } from './types';
const page = { id: 'page', width: 1000, height: 2000 } as MarkingImagePage;
function drawing(feedback: MarkingPageFeedback) {
  const ctx: Record<string, any> = {};
  for (const name of ['save', 'restore', 'scale', 'translate', 'rotate', 'drawImage', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']) ctx[name] = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawAnnotatedPage(canvas, {} as CanvasImageSource, page, feedback);
  return { canvas, ctx };
}
describe('annotated page export geometry', () => {
  it('preserves original-coordinate strokes through a non-square crop and rotation without mutation', () => {
    const feedback: MarkingPageFeedback = { pageId: 'page', crop: { x: .1, y: .2, width: .6, height: .5 }, rotation: 90, annotations: [{ id: 'stroke', kind: 'pen', color: 'red', width: .01, points: [{ x: .1, y: .2 }, { x: .7, y: .7 }], text: '', criterionId: null, level: '' }] };
    const before = structuredClone(feedback); const { canvas, ctx } = drawing(feedback);
    expect([canvas.width, canvas.height]).toEqual([1000, 600]);
    expect(ctx.drawImage).toHaveBeenCalledWith({}, 100, 400, 600, 1000, 0, 0, 600, 1000);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.moveTo).toHaveBeenCalledWith(1000, 0);
    expect(ctx.lineTo.mock.calls[0][0]).toBeCloseTo(0); expect(ctx.lineTo.mock.calls[0][1]).toBeCloseTo(600);
    expect(ctx.lineWidth).toBe(10); expect(feedback).toEqual(before);
  });
  it('exports single-point strokes, highlights and numbered comment anchors', () => {
    const base = { color: 'blue' as const, width: .01, points: [{ x: .5, y: .5 }], text: 'Feedback', criterionId: null, level: '' };
    const { ctx } = drawing({ pageId: 'page', crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, annotations: [{ ...base, id: 'dot', kind: 'pen' }, { ...base, id: 'highlight', kind: 'highlight' }, { ...base, id: 'comment', kind: 'comment' }] });
    expect(ctx.arc).toHaveBeenCalledTimes(3); expect(ctx.fillText).toHaveBeenCalledWith('3', 500, 1000);
  });
  it('bounds exported pixels without distorting the page aspect ratio', () => {
    const huge = { ...page, width: 4000, height: 5000 }; const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => drawAnnotatedPage(canvas, {} as CanvasImageSource, huge, { pageId: 'page', crop: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0, annotations: [] })).toThrow('renderer');
    expect([canvas.width, canvas.height]).toEqual([1920, 2400]);
  });
});

describe('export authorization after asynchronous rendering', () => {
  it('blocks a legacy render whose workspace locks before output', async () => {
    const nativeSave = vi.fn(); vi.stubGlobal('window', { desktopReports: { exportPdf: nativeSave } });
    try {
      const input = { commit: { id: 'commit', draft: {} }, attempt: { documents: [] } } as unknown as MarkingReportInput;
      const pending = exportAnnotatedMarkingReport(input);
      setRendererStorageMode('locked');
      await expect(pending).rejects.toThrow('No readable file was saved');
      expect(nativeSave).not.toHaveBeenCalled();
    } finally { setRendererStorageMode('legacy'); vi.unstubAllGlobals(); }
  });
  it('blocks native export if the teacher changed during rendering', async () => {
    const nativeSave = vi.fn(); vi.stubGlobal('window', { desktopReports: { exportPdf: nativeSave } });
    try {
      const input = { commit: { id: 'commit', draft: {} }, attempt: { documents: [] } } as unknown as MarkingReportInput;
      const guard = vi.fn(() => { throw new Error('Teacher changed'); });
      await expect(exportAnnotatedMarkingReport(input, guard)).rejects.toThrow('Teacher changed');
      expect(guard).toHaveBeenCalledOnce(); expect(nativeSave).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
