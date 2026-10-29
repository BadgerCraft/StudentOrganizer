import { assertReadableExportAllowed } from '../security/readableExports';
import { markingImageDecodeBytes } from './importImages';
import { imageDisplaySize, originalToDisplay } from './imageGeometry';
import type { MarkingImagePage, MarkingPageFeedback } from './types';
import { renderMarkingReport, type MarkingReportInput } from './report';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const colors = { red: '#dc2626', blue: '#2563eb', yellow: '#facc15' };
declare global { interface Window { desktopReports?: { exportPdf(filename: string, html: string): Promise<boolean> } } }
export function supportsDesktopPdfExport(): boolean { return typeof window !== 'undefined' && typeof window.desktopReports?.exportPdf === 'function'; }

/** Flatten only a copy: image pixels, crop, rotation and original-coordinate anchors match the editor. */
export function drawAnnotatedPage(canvas: HTMLCanvasElement, source: CanvasImageSource, page: MarkingImagePage, feedback: MarkingPageFeedback): void {
  const size = imageDisplaySize(page, feedback);
  const ratio = Math.min(1, 2400 / Math.max(size.width, size.height));
  canvas.width = Math.max(1, Math.round(size.width * ratio)); canvas.height = Math.max(1, Math.round(size.height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Annotated page export needs a working local image renderer.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(canvas.width / size.width, canvas.height / size.height);
  if (feedback.rotation === 90) ctx.translate(size.width, 0);
  if (feedback.rotation === 180) ctx.translate(size.width, size.height);
  if (feedback.rotation === 270) ctx.translate(0, size.height);
  ctx.rotate(feedback.rotation * Math.PI / 180);
  ctx.drawImage(source, feedback.crop.x * page.width, feedback.crop.y * page.height, feedback.crop.width * page.width, feedback.crop.height * page.height, 0, 0, feedback.crop.width * page.width, feedback.crop.height * page.height);
  ctx.restore();
  feedback.annotations.forEach((annotation, index) => {
    const points = annotation.points.map(p => originalToDisplay(p, feedback)).map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
    ctx.save(); ctx.strokeStyle = colors[annotation.color]; ctx.fillStyle = colors[annotation.color];
    ctx.lineWidth = Math.max(1, annotation.width * Math.min(page.width, page.height) * ratio);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (annotation.kind === 'comment') {
      const radius = Math.max(10, Math.min(page.width, page.height) * .014 * ratio);
      ctx.beginPath(); ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${radius * 1.3}px sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(String(index + 1), points[0].x, points[0].y);
    } else {
      ctx.globalAlpha = annotation.kind === 'highlight' ? .4 : 1;
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      // Single-point pen strokes must survive export too.
      if (points.length === 1) { ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
    ctx.restore();
  });
}

async function pagePixels(page: MarkingImagePage, feedback: MarkingPageFeedback): Promise<string> {
  const bytes = Uint8Array.from(atob(page.base64), c => c.charCodeAt(0));
  const blob = new Blob([new Uint8Array(markingImageDecodeBytes(bytes, page.mime))], { type: page.mime });
  const canvas = document.createElement('canvas');
  let bitmap: ImageBitmap | undefined; let url = '';
  try {
    let source: CanvasImageSource;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
      if (bitmap.width !== page.width || bitmap.height !== page.height) throw new Error('Retained image dimensions do not match.');
      source = bitmap;
    } else {
      url = URL.createObjectURL(blob); const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Retained page could not be decoded.')); image.src = url; });
      if (image.naturalWidth !== page.width || image.naturalHeight !== page.height) throw new Error('Retained image orientation cannot be preserved.');
      source = image;
    }
    drawAnnotatedPage(canvas, source, page, feedback);
    return canvas.toDataURL('image/jpeg', .94);
  } finally { bitmap?.close(); if (url) URL.revokeObjectURL(url); canvas.width = canvas.height = 0; }
}

export async function renderAnnotatedMarkingReport(input: MarkingReportInput): Promise<string> {
  // Validate every saved record before decoding any original.
  const report = renderMarkingReport(input);
  const pages: string[] = [];
  for (const feedback of input.commit.draft.imageFeedback ?? []) {
    const page = input.attempt.imagePages!.find(p => p.id === feedback.pageId)!;
    const pixels = await pagePixels(page, feedback);
    const comments = feedback.annotations.map((annotation, index) => annotation.text.trim() ? `<p><strong>${index + 1}.</strong> ${escape(annotation.text)}</p>` : '').join('');
    pages.push(`<section class="marked-page"><h2>Marked page ${pages.length + 1}: ${escape(page.name)}</h2><img alt="Marked student page ${pages.length + 1}" src="${pixels}">${comments ? `<div class="page-comments">${comments}</div>` : ''}</section>`);
  }
  // Written submissions are useful even without photographs; preserve their full text locally.
  const documents = input.attempt.documents.map(doc => `<section class="submission"><h2>${escape(doc.name)}</h2><p>${escape(doc.text)}</p></section>`).join('');
  return report.replace("img-src 'none'", 'img-src data:').replace('</style>', '@page{size:A4;margin:14mm}.marked-page{break-before:page}.marked-page img{display:block;max-width:100%;max-height:220mm;object-fit:contain;margin:auto}.page-comments{font-size:10pt}.submission{break-before:page}.submission p{white-space:pre-wrap}thead{display:table-header-group}</style>').replace('</body>', `${pages.join('')}${documents}</body>`);
}

/** Desktop writes genuine PDF bytes. Browser fallback is deliberately named printable HTML. */
export async function exportAnnotatedMarkingReport(input: MarkingReportInput, assertAuthorized?: () => void): Promise<boolean> {
  assertReadableExportAllowed();
  const html = await renderAnnotatedMarkingReport(input);
  const filename = `marked-assessment-${input.commit.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  assertAuthorized?.();
  assertReadableExportAllowed();
  if (supportsDesktopPdfExport()) return window.desktopReports!.exportPdf(`${filename}.pdf`, html);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}-print-to-pdf.html`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
