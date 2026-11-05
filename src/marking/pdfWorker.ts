/// <reference lib="webworker" />
import { getDocument, AnnotationMode } from 'pdfjs-dist/build/pdf.mjs';
// The PDF.js parser runs in this *outer* disposable worker, so the deadline can
// terminate parsing and canvas work, including synchronous hostile-file work.

import assets from 'virtual:local-pdf-assets';
import { MARKING_LIMITS } from './types';

class PdfFailure extends Error {}
const scope = globalThis as unknown as DedicatedWorkerGlobalScope & { pdfjsWorker: { WorkerMessageHandler: unknown } };
// Prevent PDF.js from attaching its standalone protocol to our outer worker port.
// Its parser instead uses PDF.js's in-process loopback port inside this worker.
(globalThis as unknown as { window?: object }).window = {};
// @ts-expect-error distribution worker has no declaration file
const engineReady = import('pdfjs-dist/build/pdf.worker.mjs').then(engine => {
  delete (globalThis as unknown as { window?: object }).window;
  scope.pdfjsWorker = { WorkerMessageHandler: engine.WorkerMessageHandler };
});
// Defense in depth beyond production connect-src 'none'. Only bundled bytes are read.
Object.defineProperty(globalThis, 'fetch', { value: () => Promise.reject(new Error('PDF network access is disabled.')), configurable: false });
class LocalBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const encoded = assets[`${kind}/${filename}`];
    if (!encoded) throw new PdfFailure('This PDF needs an unsupported resource. Export a flattened PDF.');
    return Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  }
}
class LocalCanvas {
  getNoAlphaContext(canvas: OffscreenCanvas) { return canvas.getContext('2d', { alpha: false }); }
  create(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 8_000_000) throw new PdfFailure('PDF page exceeds the rendering limit. Reduce PDF zoom or use smaller page images.');
    const canvas = new OffscreenCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext('2d')! };
  }
  reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
    const bounded = this.create(width, height); target.canvas.width = bounded.canvas.width; target.canvas.height = bounded.canvas.height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }) { if (target.canvas) target.canvas.width = target.canvas.height = 0; target.canvas = null; target.context = null; }
}
// SVG/DOM filters cannot be faithfully approximated in this worker. Fail visibly.
class LocalFilters {
  addFilter() { throw new PdfFailure('Unsupported PDF colour filter. Export a flattened PDF.'); }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { throw new PdfFailure('Unsupported PDF alpha filter. Export a flattened PDF.'); }
  addLuminosityFilter() { throw new PdfFailure('Unsupported PDF luminosity filter. Export a flattened PDF.'); }
  addKnockoutFilter() { throw new PdfFailure('Unsupported PDF transparency filter. Export a flattened PDF.'); }
  destroy() {}
}

scope.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array; page?: number; scale?: number }>) => {
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    await engineReady;
    if (!(data.bytes instanceof Uint8Array) || data.bytes.length > MARKING_LIMITS.pdfBytes) throw new PdfFailure('PDF exceeds 8 MB.');
    task = getDocument({ data: data.bytes, verbosity: 0, stopAtErrors: true, disableFontFace: true, useSystemFonts: false,
      useWorkerFetch: false, useWasm: false, enableXfa: false, disableRange: true, disableStream: true, disableAutoFetch: true,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false, disableWorkerRendering: true, maxImageSize: 8_000_000,
      CanvasFactory: LocalCanvas, FilterFactory: LocalFilters, BinaryDataFactory: LocalBinaryData });
    task.onPassword = () => { void task?.destroy(); scope.postMessage({ type: 'result', error: 'Password-protected PDFs are unsupported. Export an unlocked flattened PDF.' }); };
    const pdf = await task.promise;
    const metadata = await pdf.getMetadata();
    if (pdf.numPages < 1 || pdf.numPages > MARKING_LIMITS.pdfPages) throw new PdfFailure('PDFs support 1–20 pages each. Split this PDF first.');
    if (pdf.isPureXfa || (metadata.info as { IsXFAPresent?: boolean }).IsXFAPresent || (metadata.info as { IsAcroFormPresent?: boolean }).IsAcroFormPresent || await pdf.getFieldObjects() || await pdf.getJSActions()) throw new PdfFailure('Interactive forms or PDF scripts are unsupported. Export a flattened PDF with the marks visible.');
    // Inspect every page even during import; no silent out-of-range page omission.
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width < 1 || viewport.height < 1 || viewport.width * viewport.height > 8_000_000) throw new PdfFailure('PDF page dimensions exceed the rendering limit.');
      if (await page.getJSActions()) throw new PdfFailure('PDF page scripts are unsupported. Export a flattened PDF.');
    }
    if (!data.page) { scope.postMessage({ type: 'result', pageCount: pdf.numPages }); return; }
    if (!Number.isInteger(data.page) || data.page < 1 || data.page > pdf.numPages || !Number.isFinite(data.scale) || data.scale! < 0.25 || data.scale! > 3) throw new PdfFailure('Choose a valid PDF page and zoom.');
    const page = await pdf.getPage(data.page), viewport = page.getViewport({ scale: data.scale! });
    const target = new LocalCanvas().create(viewport.width, viewport.height);
    await page.render({ canvas: target.canvas as unknown as HTMLCanvasElement, canvasContext: target.context as unknown as CanvasRenderingContext2D, viewport, annotationMode: AnnotationMode.ENABLE, background: '#ffffff' }).promise;
    const blob = await target.canvas.convertToBlob({ type: 'image/png' });
    const bytes = await blob.arrayBuffer();
    scope.postMessage({ type: 'result', pageCount: pdf.numPages, image: bytes }, [bytes]);
  } catch (failure) {
    // Parser exception text can include private file content; keep it out of diagnostics/UI.
    const message = failure instanceof PdfFailure ? failure.message : 'This PDF could not be displayed safely. Export a flattened PDF or use page images.';
    scope.postMessage({ type: 'result', error: message });
  } finally { await task?.destroy().catch(() => {}); }
};
