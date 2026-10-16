import { CaptureDB, catalog, emptyBatch, save, readPhoto, appendPages, movePage, exportBatch, type Batch } from './store';
import './style.css';
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<h1>Phone capture</h1><p>Fictional-data pilot · local batch</p><p class="notice">Use fictional photos only. Pages stay in this browser until you deliberately export. Browser storage can be cleared or evicted; keep your originals. Labels never assign a student.</p>
<p id="status" role="status" aria-live="polite">Opening local batch…</p><fieldset id="controls" disabled>
<label>Class<select id="class"><option value="">Choose class</option></select></label>
<label>Assignment<select id="assignment"><option value="">Choose assignment</option></select></label>
<small>Class and assignment are fixed once pages are added. Export and start a new batch to change them.</small>
<label>Take a photo<input id="camera" type="file" accept="image/jpeg,image/png" capture="environment"></label>
<label>Import photos<input id="files" type="file" accept="image/jpeg,image/png" multiple></label>
<small>JPEG/PNG · up to 8 MB each · 10 pages / 32 MB per batch. Camera availability depends on your browser/device.</small>
<section id="pages" aria-label="Saved pages"></section><button id="save-labels">Save labels</button><button id="export">Export local ZIP</button><button id="reset">Start new batch</button></fieldset>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const classSelect = el<HTMLSelectElement>('class'), assignment = el<HTMLSelectElement>('assignment');
catalog.forEach(c => classSelect.add(new Option(c.name, c.id)));
const db = new CaptureDB(); let batch: Batch = emptyBatch(); let urls: string[] = []; let busy = false;
const status = (message: string) => { el('status').textContent = message; };
function render() {
  urls.forEach(URL.revokeObjectURL); urls = [];
  classSelect.value = batch.classId;
  assignment.replaceChildren(new Option('Choose assignment', ''));
  catalog.find(c => c.id === batch.classId)?.assignments.forEach(a => assignment.add(new Option(a, a)));
  assignment.value = batch.assignment;
  classSelect.disabled = assignment.disabled = !!batch.pages.length;
  el<HTMLInputElement>('camera').disabled = el<HTMLInputElement>('files').disabled = !batch.assignment;
  el<HTMLButtonElement>('export').disabled = !batch.pages.length;
  el('pages').replaceChildren();
  batch.pages.forEach((page, index) => {
    const article = document.createElement('article');
    const heading = document.createElement('h2'); heading.textContent = `Page ${index + 1}`;
    const img = document.createElement('img');
    const url = URL.createObjectURL(new Blob([new Uint8Array(page.bytes).buffer], { type: page.mime })); urls.push(url);
    img.src = url; img.alt = `Preview of page ${index + 1}`;
    const label = document.createElement('label'); label.textContent = 'Page label (unmatched hint)';
    const input = document.createElement('input'); input.value = page.label; input.maxLength = 120;
    input.dataset.pageId = page.id;
    input.oninput = () => status('Label edited. Choose Save labels or Export local ZIP to save it.');
    label.append(input); article.append(heading, img, label);
    for (const [title, delta] of [['Move up', -1], ['Move down', 1]] as const) {
      const button = document.createElement('button'); button.textContent = title; button.setAttribute('aria-label', `${title} page ${index + 1}`);
      button.disabled = index + delta < 0 || index + delta >= batch.pages.length;
      button.onclick = () => void run(() => persist(movePage(batch, index, delta))); article.append(button);
    }
    el('pages').append(article);
  });
}
async function persist(next: Batch) { batch = await save(db, next); status(`Saved locally · ${batch.pages.length} page(s). All pages unmatched.`); }
async function run(action: () => Promise<void>) {
  if (busy) return; busy = true; el<HTMLFieldSetElement>('controls').disabled = true;
  try {
    const labels = new Map(Array.from(el('pages').querySelectorAll<HTMLInputElement>('input')).map(input => [input.dataset.pageId, input.value]));
    if (batch.pages.some(p => labels.has(p.id) && labels.get(p.id) !== p.label))
      await persist({ ...batch, pages: batch.pages.map(p => ({ ...p, label: labels.get(p.id) ?? p.label })) });
    await action();
  } catch (error) { status(`Not completed: ${error instanceof Error ? error.message : String(error)} Your previously saved batch is retained.`); }
  finally { busy = false; render(); el<HTMLFieldSetElement>('controls').disabled = false; }
}
classSelect.onchange = () => void run(() => persist({ ...batch, classId: classSelect.value, assignment: '' }));
assignment.onchange = () => void run(() => persist({ ...batch, assignment: assignment.value }));
for (const id of ['camera', 'files']) {
  el<HTMLInputElement>(id).onchange = event => {
    const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []); input.value = '';
    if (!files.length) return;
    void run(async () => {
      const pages = [];
      for (const file of files) {
        const page = await readPhoto(file);
        // Decode before committing: a plausible header alone does not prove a usable photo.
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(page.bytes).buffer], { type: page.mime }));
        const pixels = bitmap.width * bitmap.height; bitmap.close();
        if (pixels > 20 * 1024 * 1024) throw new Error('Photo exceeds the desktop limit of 20 megapixels. Resize a copy locally first.');
        pages.push(page); appendPages(batch, pages);
      }
      await persist(appendPages(batch, pages));
    });
  };
}
el('save-labels').onclick = () => void run(async () => { status('Labels saved locally. All pages unmatched.'); });
window.addEventListener('beforeunload', event => {
  if (busy || Array.from(el('pages').querySelectorAll<HTMLInputElement>('input')).some(input => batch.pages.find(p => p.id === input.dataset.pageId)?.label !== input.value)) { event.preventDefault(); event.returnValue = ''; }
});
el('export').onclick = () => void run(async () => {
  const bytes = await exportBatch(batch);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
  const link = document.createElement('a'); link.href = url; link.download = `fictional-capture-r${batch.revision}.zip`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  status('ZIP download requested. Check your saved file before starting a new batch. No transfer or student matching has occurred.');
});
el('reset').onclick = () => {
  if (confirm('Start a new batch? This removes the current local pages. First check that your exported ZIP is saved and readable.'))
    void run(() => persist({ ...emptyBatch(), revision: batch.revision }));
};
try { batch = await db.batches.get('local-batch') ?? emptyBatch(); render(); el<HTMLFieldSetElement>('controls').disabled = false; status(`Opened local batch · ${batch.pages.length} page(s). All pages unmatched.`); }
catch { status('Local storage could not open. No changes made. Check browser storage permissions and reload.'); }
