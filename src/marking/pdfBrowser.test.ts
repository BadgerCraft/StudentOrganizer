import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  finish() { this.onmessage?.({ data: { type: 'result', pageCount: 1 } }); }
}
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded PDF worker lifecycle', () => {
  it('terminates processing at the deadline and frees the slot for retry', async () => {
    const { processPdf } = await import('./pdfBrowser');
    const pending = processPdf(new Uint8Array([1]));
    const failure = expect(pending).rejects.toThrow('15 seconds');
    await vi.advanceTimersByTimeAsync(15000); await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = processPdf(new Uint8Array([1])); FakeWorker.instances[1].finish();
    await expect(retry).resolves.toEqual({ type: 'result', pageCount: 1 });
  });
  it('cancels queued work immediately without starting another worker or disrupting the active preview', async () => {
    const { processPdf } = await import('./pdfBrowser');
    const first = processPdf(new Uint8Array([1]));
    const controller = new AbortController();
    const queued = processPdf(new Uint8Array([2]), { signal: controller.signal });
    controller.abort(); await expect(queued).rejects.toThrow('cancelled');
    expect(FakeWorker.instances).toHaveLength(1); expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    FakeWorker.instances[0].finish(); await first;
  });
  it('terminates active work on departure and ignores late or unrelated protocol messages', async () => {
    const { processPdf } = await import('./pdfBrowser');
    const controller = new AbortController();
    const pending = processPdf(new Uint8Array([1]), { signal: controller.signal });
    FakeWorker.instances[0].onmessage?.({ data: { action: 'ready' } });
    controller.abort(); await expect(pending).rejects.toThrow('cancelled');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    FakeWorker.instances[0].finish(); expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('bounds queued previews and leaves successful jobs retryable', async () => {
    const { processPdf } = await import('./pdfBrowser');
    const jobs = Array.from({ length: 6 }, () => processPdf(new Uint8Array([1])));
    await expect(processPdf(new Uint8Array([1]))).rejects.toThrow('Too many');
    for (let index = 0; index < jobs.length; index++) { FakeWorker.instances[index].finish(); await jobs[index]; await Promise.resolve(); await Promise.resolve(); }
    expect(FakeWorker.instances).toHaveLength(6);
  });
});
