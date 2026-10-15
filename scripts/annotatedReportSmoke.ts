import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 4207, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:4207');
  const result = await page.evaluate(async () => {
    const { renderAnnotatedMarkingReport, drawAnnotatedPage } = await import('/src/marking/annotatedReport.ts' as string);
    const base = { assessmentId: 'assessment', classSectionId: 'class', createdBy: 'teacher', createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:00:00Z', deletedAt: null, version: 1 };
    const source = document.createElement('canvas'); source.width = 600; source.height = 800;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 600, 800); ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#000000'; ctx.font = '24px sans-serif'; ctx.fillText('FICTIONAL STUDENT WORK', 100, 200);
    const data = source.toDataURL('image/png').split(',')[1];
    const imagePages = [1, 2].map(i => ({ id: `page-${i}`, name: `Fictional page ${i}.png`, mime: 'image/png', width: 600, height: 800, base64: data, size: atob(data).length, hash: 'a'.repeat(64) }));
    const feedback = imagePages.map((p, i) => ({ pageId: p.id, rotation: i ? 90 : 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [
      { id: `pen-${i}`, kind: 'pen', color: 'red', width: .01, points: [{ x: .2, y: .5 }, { x: .8, y: .5 }], text: '', criterionId: null, level: '' },
      { id: `comment-${i}`, kind: 'comment', color: 'blue', width: .01, points: [{ x: .5, y: .7 }], text: `Page ${i + 1} evidence feedback <script>`, criterionId: 'criterion', level: '3+' },
    ] }));
    const check = document.createElement('canvas'); drawAnnotatedPage(check, source, imagePages[1], feedback[1]);
    const blue = Array.from(check.getContext('2d')!.getImageData(750, 50, 1, 1).data);
    if (blue[2] < 230 || blue[0] > 20) throw new Error('Rotated original corner was misplaced.');
    const red = Array.from(check.getContext('2d')!.getImageData(400, 300, 1, 1).data);
    if (red[0] < 190 || red[1] > 80) throw new Error('Rotated annotation anchor was misplaced.');
    const input = {
      assessment: { id: 'assessment', title: 'Fictional annotated export', classSectionId: 'class' }, student: { firstName: 'Fictional', lastName: 'Learner' }, categories: [{ id: 'category', assessmentId: 'assessment', categoryCode: 'T' }],
      rubric: { ...base, id: 'rubric', confirmed: true, title: 'Evidence', levels: ['3+'], criteria: [{ id: 'criterion', name: 'Reasoning', categoryCode: 'T', descriptors: { '3+': 'Explains the supporting evidence.' } }] },
      attempt: { ...base, id: 'attempt', rubricId: 'rubric', documents: [], imagePages },
      commit: { ...base, id: 'commit', rubricId: 'rubric', attemptId: 'attempt', draft: { annotations: [], pending: null, overallFeedback: 'Fictional overall feedback', judgments: [{ assessmentCategoryId: 'category', assessed: true, rawScore: '3+', inputFormat: 'scale_code', feedback: 'Clear evidence' }], imageFeedback: feedback } },
    };
    const before = JSON.stringify(input); const html = await renderAnnotatedMarkingReport(input);
    if (JSON.stringify(input) !== before) throw new Error('Report export mutated saved records.');
    return { html, blue, red };
  });
  const requests: string[] = []; const report = await browser.newPage();
  await report.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await report.setContent(result.html, { waitUntil: 'load' });
  assert.equal(await report.locator('.marked-page img').count(), 2);
  assert.equal(await report.locator('.marked-page img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)), true);
  assert.match(await report.locator('body').innerText(), /Page 2 evidence feedback <script>/);
  assert.equal(await report.locator('script').count(), 0);
  assert.deepEqual(requests, []);
  const pdf = await report.pdf({ printBackground: true, preferCSSPageSize: true }); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await writeFile('/tmp/annotated-report-smoke.pdf', pdf); await report.screenshot({ path: '/tmp/annotated-report-smoke.png', fullPage: true });
  await writeFile('/tmp/annotated-report-smoke-results.json', JSON.stringify({ status: 'pass', rotatedImagePixel: result.blue, rotatedStrokePixel: result.red, pageImages: 2, externalRequests: requests, pdfBytes: pdf.length, nativeRuntimeVerified: false }, null, 2));
  console.log('PASS: local multi-page PDF renderer, image/stroke rotation anchors, escaped feedback, rubric, no external requests, original-record immutability. Native save dialog remains unverified.');
} finally { await browser.close(); await server.close(); }
