import type { MarkingPdfDocument } from './types';
import { MARKING_LIMITS } from './types';
import { assertPdfEnvelope, validateRetainedPdf } from './importPdfs';
import { sha256 } from './importDocuments';

export interface PdfWorkerResult { pageCount: number; image?: ArrayBuffer }
type PdfOptions = { page?: number; scale?: number; signal?: AbortSignal };
let activePdf = false;
const pdfQueue: { start: () => void; cancel: () => void }[] = [];
function pumpPdfQueue() { if (!activePdf) pdfQueue[0]?.start(); }
export function processPdf(bytes: Uint8Array, options: PdfOptions = {}): Promise<PdfWorkerResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('PDF viewing cancelled.')); return; }
    if (pdfQueue.length >= 5) { reject(new Error('Too many PDF previews are open. Close another preview, then retry.')); return; }
    const job = {
      cancel: () => { const index = pdfQueue.indexOf(job); if (index >= 0) pdfQueue.splice(index, 1); options.signal?.removeEventListener('abort', job.cancel); reject(new Error('PDF viewing cancelled.')); },
      start: () => {
        pdfQueue.shift(); activePdf = true; options.signal?.removeEventListener('abort', job.cancel);
        void runPdfWorker(bytes, options).then(resolve, reject).finally(() => { activePdf = false; pumpPdfQueue(); });
      },
    };
    options.signal?.addEventListener('abort', job.cancel, { once: true }); pdfQueue.push(job); pumpPdfQueue();
  });
}
function runPdfWorker(bytes: Uint8Array, options: { page?: number; scale?: number; signal?: AbortSignal }): Promise<PdfWorkerResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('PDF viewing cancelled.')); return; }
    const worker = new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error?: Error, result?: PdfWorkerResult) => {
      if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new Error('PDF viewing cancelled.'));
    const timer = setTimeout(() => finish(new Error('PDF processing exceeded 15 seconds. Split or flatten the PDF, then retry.')), 15_000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error('The local PDF viewer could not start. Reopen SO or use page images.')); };
    worker.onmessage = ({ data }) => { if (data.type === 'result') data.error ? finish(new Error(data.error)) : finish(undefined, data); };
    const copy = new Uint8Array(bytes); worker.postMessage({ bytes: copy, page: options.page, scale: options.scale }, [copy.buffer]);
  });
}
export async function parseMarkingPdfs(files: File[], signal?: AbortSignal) {
  const documents: MarkingPdfDocument[] = [], errors: { name: string; message: string; file: File }[] = [];
  if (files.length > MARKING_LIMITS.pdfFiles || files.reduce((n, f) => n + f.size, 0) > MARKING_LIMITS.pdfBatchBytes) return { documents, errors: files.map(file => ({ file, name: file.name, message: 'Choose up to 40 PDFs and 32 MB total per batch.' })) };
  for (const file of files) {
    if (signal?.aborted) throw new Error('PDF import cancelled.');
    try {
      if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf') || file.size < 1 || file.size > MARKING_LIMITS.pdfBytes) throw new Error('Choose a PDF up to 8 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()); assertPdfEnvelope(bytes);
      const { pageCount } = await processPdf(bytes, { signal });
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const document: MarkingPdfDocument = { version: 1, id: crypto.randomUUID(), name: file.name, mime: 'application/pdf', base64: btoa(binary), size: bytes.length, hash: await sha256(bytes), pageCount };
      await validateRetainedPdf(document); documents.push(document);
    } catch (failure) { errors.push({ file, name: file.name, message: failure instanceof Error ? failure.message : 'PDF import failed. Your earlier files are kept.' }); }
  }
  return { documents, errors };
}
