/** A cancelled browser decoder cannot be forcibly stopped. Keep its slot until the
 * actual read/decode finishes; obsolete queued work checks cancellation on entry. */
let tail: Promise<unknown> = Promise.resolve();
export function queueCapturePage<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work); tail = next.catch(() => undefined); return next;
}
