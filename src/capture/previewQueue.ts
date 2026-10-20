/** Desktop preview work is deliberately serialized: a small compressed image can
 * still allocate an 80 MB source bitmap. Keep the slot until its codec settles,
 * even if its owner has left; AbortSignal does not abort createImageBitmap. */
export class PreviewQueue {
  private active = 0;
  private waiting: Array<() => void> = [];

  schedule(task: (signal: AbortSignal) => Promise<void>): { done: Promise<void>; cancel: () => void } {
    const controller = new AbortController();
    let started = false;
    let settled = false;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const cancelled = () => new DOMException('Preview is no longer needed.', 'AbortError');
    const start = () => {
      if (controller.signal.aborted) return;
      started = true; this.active++;
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) throw cancelled();
        return task(controller.signal);
      }).then(() => { if (controller.signal.aborted) reject(cancelled()); else resolve(); }, reject).finally(() => {
        settled = true; this.active--; this.drain();
      });
    };
    this.waiting.push(start);
    // Let mount cleanup remove obsolete work before allocating a bitmap.
    queueMicrotask(() => this.drain());
    return { done, cancel: () => {
      if (settled || controller.signal.aborted) return;
      controller.abort();
      if (!started) {
        this.waiting = this.waiting.filter(item => item !== start);
        settled = true; reject(cancelled());
      }
    } };
  }

  private drain() {
    if (this.active) return;
    this.waiting.shift()?.();
  }
}

export const desktopPreviewQueue = new PreviewQueue();
