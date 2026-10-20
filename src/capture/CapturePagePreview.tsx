import { useEffect, useRef, useState } from 'react';
import type { ParsedCapturePage } from '../../shared/capturePackage';
import { drawCapturePreview } from '../../shared/capturePreview';
import { desktopPreviewQueue } from './previewQueue';

/** Allocate source pixels only for nearby visible pages. The shared renderer
 * owns/closes its bitmap; this component owns/clears both preview canvases. */
export function CapturePagePreview({ page }: { page: ParsedCapturePage }) {
  const figure = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !figure.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '200px' });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const output = canvas.current;
    let cancelled = false;
    if (output) output.width = output.height = 0;
    setPhase('waiting'); setError('');
    if (!visible) return;
    setPhase('loading');
    const work = desktopPreviewQueue.schedule(async signal => {
      const target = document.createElement('canvas');
      try {
        await drawCapturePreview(target, page.bytes, page.metadata.mime, page.metadata.edits);
        if (cancelled || signal.aborted || !output) return;
        const context = output.getContext('2d');
        if (!context) throw new Error('Photo preview is unavailable.');
        output.width = target.width; output.height = target.height;
        context.drawImage(target, 0, 0);
        setPhase('ready');
      } finally { target.width = target.height = 0; }
    });
    void work.done.catch(cause => {
      if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
      setError(cause instanceof Error ? cause.message : 'Photo preview could not load.'); setPhase('error');
    });
    return () => {
      cancelled = true; work.cancel();
      if (output) output.width = output.height = 0;
    };
  }, [page, visible, attempt]);

  return <figure ref={figure} className="rounded-lg border bg-white p-2" data-testid="capture-page-preview">
    <div className="h-96 flex items-center justify-center">
      <canvas ref={canvas} className="max-w-full max-h-96 mx-auto" style={{ display: phase === 'ready' ? 'block' : 'none' }} aria-label={`Page ${page.metadata.order + 1} preview`} />
      {phase !== 'ready' && phase !== 'error' && <p role="status" className="text-sm text-slate-600">{phase === 'loading' ? 'Loading page preview…' : 'Page preview loads when visible.'}</p>}
    </div>
    <figcaption>Page {page.metadata.order + 1}</figcaption>
    {error && <div><p role="alert">{error}</p><button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setAttempt(value => value + 1)}>Retry page preview</button></div>}
  </figure>;
}
