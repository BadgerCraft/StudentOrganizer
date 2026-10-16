import Dexie, { type Table } from 'dexie';
import { zipSync, strToU8 } from 'fflate';

export const catalog = [
  { id: 'fictional-science', name: 'Fictional Science', assignments: ['Fictional leaf study', 'Fictional water cycle'] },
  { id: 'fictional-english', name: 'Fictional English', assignments: ['Fictional short response'] },
];
export interface Page { id: string; label: string; originalName: string; mime: string; bytes: Uint8Array; }
export interface Batch { id: string; captureId: string; classId: string; assignment: string; pages: Page[]; revision: number; }
export class CaptureDB extends Dexie {
  batches!: Table<Batch, string>;
  constructor(name = 'studentorganizer-phone-capture-v1') {
    super(name); this.version(1).stores({ batches: 'id' });
  }
}
export function emptyBatch(): Batch { return { id: 'local-batch', captureId: crypto.randomUUID(), classId: '', assignment: '', pages: [], revision: 0 }; }
export function validContext(batch: Batch): boolean {
  return !!catalog.find(c => c.id === batch.classId)?.assignments.includes(batch.assignment);
}
export async function save(db: CaptureDB, batch: Batch): Promise<Batch> {
  return db.transaction('rw', db.batches, async () => {
    const previous = await db.batches.get(batch.id);
    if ((previous?.revision ?? 0) !== batch.revision) throw new Error('This batch changed in another tab. Reload before editing.');
    const next = { ...batch, revision: batch.revision + 1 };
    await db.batches.put(next); return next;
  });
}
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_PAGES = 10;
export async function readPhoto(file: File): Promise<Page> {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Each photo must be between 1 byte and 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
  if (!jpeg && !png) throw new Error('Use JPEG or PNG photos. Convert other formats locally first.');
  return { id: crypto.randomUUID(), label: '', originalName: file.name, mime: jpeg ? 'image/jpeg' : 'image/png', bytes };
}
export function appendPages(batch: Batch, pages: Page[]): Batch {
  if (!validContext(batch)) throw new Error('Choose a class and assignment first.');
  const all = [...batch.pages, ...pages];
  if (all.length > MAX_PAGES || all.reduce((sum, p) => sum + p.bytes.length, 0) > MAX_BYTES) throw new Error('Batch limit: 10 pages and 32 MB. Export this batch before starting another.');
  return { ...batch, pages: all };
}
export function movePage(batch: Batch, index: number, delta: number): Batch {
  const pages = [...batch.pages], target = index + delta;
  if (index < 0 || index >= pages.length || target < 0 || target >= pages.length) return batch;
  [pages[index], pages[target]] = [pages[target], pages[index]];
  return { ...batch, pages };
}
export async function exportBatch(batch: Batch): Promise<Uint8Array> {
  if (!validContext(batch) || !batch.pages.length) throw new Error('Choose a class/assignment and add at least one page.');
  if (batch.pages.some(p => !p.label.trim())) throw new Error('Label every page before exporting. Labels are hints, not student matches.');
  const files: Record<string, Uint8Array> = {};
  const pages = [];
  for (const [index, page] of batch.pages.entries()) {
    const path = `pages/${String(index + 1).padStart(3, '0')}.${page.mime === 'image/jpeg' ? 'jpg' : 'png'}`;
    files[path] = page.bytes;
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(page.bytes).buffer);
    pages.push({ pageId: page.id, order: index + 1, path, labelHint: page.label.trim(), originalName: page.originalName, mime: page.mime,
      byteLength: page.bytes.length, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), studentId: null, matchStatus: 'unmatched' });
  }
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'studentorganizer-capture', version: 1, fictional: true,
    batchId: batch.captureId, revision: batch.revision, classHint: catalog.find(c => c.id === batch.classId)!.name,
    assignmentHint: batch.assignment, requiresExplicitDesktopMatching: true, pages }, null, 2));
  files['README.txt'] = strToU8('Fictional capture pilot. Extract locally. Import ordered photos into desktop Markinator and explicitly choose each student. The desktop does not yet read this manifest. Labels and class/assignment hints never establish identity. Original photos can contain metadata. Export does not delete the local batch.\n');
  return zipSync(files, { level: 0 });
}

/** Export a committed point-in-time snapshot, rejecting an obsolete tab even
 * when no label edit triggered a write. Hashing/ZIP work stays outside IDB. */
export async function exportSavedBatch(db: CaptureDB, expected: Batch): Promise<Uint8Array> {
  const snapshot = await db.transaction('r', db.batches, async () => {
    const current = await db.batches.get(expected.id);
    if (!current || current.revision !== expected.revision || current.captureId !== expected.captureId)
      throw new Error('This batch changed in another tab. Copy unsaved labels, then reload before exporting.');
    return current;
  });
  return exportBatch(snapshot);
}
