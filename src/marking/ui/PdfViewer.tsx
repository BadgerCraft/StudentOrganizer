import { useEffect, useState } from 'react';
import type { MarkingPdfDocument } from '../types';
import { validateRetainedPdf } from '../importPdfs';
import { processPdf } from '../pdfBrowser';

/** Displays rasterized pages only: no document-provided HTML, actions or links. */
export function PdfViewer({ documents, initiallyOpen = false }: { documents: MarkingPdfDocument[]; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen), [selected, setSelected] = useState(documents[0]?.id ?? '');
  const current = documents.find(document => document.id === selected) ?? documents[0];
  if (!current) return null;
  return <section aria-label="Local PDF viewer" className="space-y-3">
    {!open ? <button type="button" className="border rounded p-2" onClick={() => setOpen(true)}>View retained PDF ({documents.length})</button> : <>
      <label className="block">PDF document<select className="border rounded p-2 w-full bg-white text-slate-900" value={current.id} onChange={event => setSelected(event.target.value)}>{documents.map(document => <option key={document.id} value={document.id}>{document.name} · {document.pageCount} pages</option>)}</select></label>
      <PdfPage key={`${current.id}:${current.hash}`} document={current} />
    </>}
  </section>;
}
function PdfPage({ document }: { document: MarkingPdfDocument }) {
  const [page, setPage] = useState(1), [scale, setScale] = useState(1.25), [retry, setRetry] = useState(0);
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let source = '';
    setUrl(''); setError(''); setBusy(true);
    void (async () => {
      try {
        await validateRetainedPdf(document);
        const result = await processPdf(Uint8Array.from(atob(document.base64), c => c.charCodeAt(0)), { page, scale, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.pageCount !== document.pageCount || !result.image) throw new Error('PDF page metadata does not match the retained original. Restore a complete backup or reimport this file.');
        source = URL.createObjectURL(new Blob([result.image], { type: 'image/png' })); setUrl(source);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to view PDF. Retry or import page images.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); if (source) URL.revokeObjectURL(source); };
  }, [document.id, document.hash, document.base64, document.size, document.pageCount, page, scale, retry]);
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2 items-center"><button type="button" className="border rounded p-2" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous PDF page</button><span>Page {page} of {document.pageCount}</span><button type="button" className="border rounded p-2" disabled={page >= document.pageCount} onClick={() => setPage(value => value + 1)}>Next PDF page</button><label>PDF zoom<select className="border rounded p-2 bg-white text-slate-900" value={scale} onChange={event => setScale(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value * 100}%</option>)}</select></label></div>
    <p className="text-sm">Read-only original. Enter grades in the sidebar; nothing is extracted automatically. Forms/scripts are unsupported—export a flattened PDF with all marks visible.</p>
    {busy && <p role="status">Rendering PDF page locally…</p>}
    {error && <p role="alert">{error} <button type="button" className="border rounded p-2" onClick={() => setRetry(value => value + 1)}>Retry PDF page</button></p>}
    {url && <div className="overflow-auto max-h-[65vh] bg-white"><img alt={`${document.name} · page ${page}`} src={url} className="max-w-none" /></div>}
  </div>;
}
