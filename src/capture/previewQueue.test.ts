import { describe, expect, it, vi } from 'vitest';
import { PreviewQueue } from './previewQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
};

describe('desktop preview working-set scheduler', () => {
  it('never overlaps source decodes, including after cancelling an active codec', async () => {
    const queue = new PreviewQueue(), release = deferred();
    let active = 0, peak = 0;
    const first = queue.schedule(async signal => { active++; peak = Math.max(peak, active); await release.promise; expect(signal.aborted).toBe(true); active--; });
    const firstResult = first.done.catch(error => error);
    const secondTask = vi.fn(async () => { active++; peak = Math.max(peak, active); active--; });
    const second = queue.schedule(secondTask);
    await vi.waitFor(() => expect(active).toBe(1));
    first.cancel();
    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();
    release.resolve();
    expect((await firstResult).name).toBe('AbortError');
    await second.done;
    expect(peak).toBe(1);
  });

  it('removes obsolete queued pages before allocation and leaves later pages runnable', async () => {
    const queue = new PreviewQueue(), release = deferred();
    const first = queue.schedule(() => release.promise);
    const obsoleteTask = vi.fn(async () => {}), nextTask = vi.fn(async () => {});
    const obsolete = queue.schedule(obsoleteTask), rejected = obsolete.done.catch(error => error);
    const next = queue.schedule(nextTask);
    obsolete.cancel();
    expect((await rejected).name).toBe('AbortError');
    release.resolve(); await first.done; await next.done;
    expect(obsoleteTask).not.toHaveBeenCalled(); expect(nextTask).toHaveBeenCalledOnce();
  });

  it('does not allocate during a cancelled StrictMode setup pass, and releases the slot after failure', async () => {
    const queue = new PreviewQueue(), obsoleteTask = vi.fn(async () => {});
    const obsolete = queue.schedule(obsoleteTask), obsoleteResult = obsolete.done.catch(error => error);
    obsolete.cancel();
    const broken = queue.schedule(async () => { throw new Error('Fictional codec failed'); });
    const brokenResult = broken.done.catch(error => error);
    const recoveredTask = vi.fn(async () => {}), recovered = queue.schedule(recoveredTask);
    await recovered.done;
    expect((await obsoleteResult).name).toBe('AbortError');
    expect((await brokenResult).message).toBe('Fictional codec failed');
    expect(obsoleteTask).not.toHaveBeenCalled(); expect(recoveredTask).toHaveBeenCalledOnce();
  });
});
