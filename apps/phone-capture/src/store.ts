import Dexie, { type Table } from 'dexie';
import { capturePagePath, captureSha256, encodeCapturePackage, type CaptureEdits, type CaptureManifest } from '../../../shared/capturePackage';
export interface Page { id: string; label: string; originalName: string; mime: 'image/jpeg'|'image/png'; bytes: Uint8Array; edits: CaptureEdits; }
export interface Group { id: string; label: string; pages: Page[]; }
export interface Batch { id: string; captureId: string; assignmentId: string; classId: string; assignment: string; pages: Page[]; groups: Group[]; removed: Page[]; draftGroupId: string; editingGroupId?: string; draftLabel: string; stage: 'capture'|'preview'; completed: boolean; revision: number; }
export class CaptureDB extends Dexie {
  batches!: Table<Batch, string>;
  constructor(name = 'studentorganizer-phone-capture-v1') { super(name); this.version(1).stores({ batches: 'id' }); }
}
export type BatchSummary = Pick<Batch, 'id' | 'assignment' | 'completed'>;
/** Cursor through retained assignments: never hold every archive's photos in a list. */
export async function listBatchSummaries(db: CaptureDB): Promise<BatchSummary[]> {
  const summaries: BatchSummary[] = [];
  await db.batches.each(batch => { summaries.push({ id: batch.id, assignment: batch.assignment, completed: batch.completed === true }); });
  return summaries;
}
/** Check the saved revision before native deletion or the IndexedDB mutation. */
export async function deleteSavedBatch(db: CaptureDB, expected: Batch, beforeDelete?: () => void): Promise<void> {
  await db.transaction('rw', db.batches, async () => {
    const current = await db.batches.get(expected.id);
    if (!current || current.captureId !== expected.captureId || current.revision !== expected.revision)
      throw new Error('This batch changed in another tab. Reload before deleting.');
    beforeDelete?.();
    await db.batches.delete(expected.id);
  });
}
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024, MAX_BYTES = 256 * 1024 * 1024, MAX_PAGES = 10, MAX_GROUPS = 40;
export const defaultEdits = (): CaptureEdits => ({ rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
export function emptyBatch(): Batch { return { id: crypto.randomUUID(), captureId: crypto.randomUUID(), assignmentId: crypto.randomUUID(), classId: '', assignment: '', pages: [], groups: [], removed: [], draftGroupId: crypto.randomUUID(), draftLabel: '', stage: 'capture', completed: false, revision: 0 }; }
/** Legacy flat batches stay recoverable, with every original and label retained. */
export function recoverBatch(raw: Batch): Batch { return { ...emptyBatch(), ...raw, assignmentId: raw.assignmentId ?? raw.captureId, draftGroupId: raw.draftGroupId ?? raw.captureId, groups: raw.groups ?? [], removed: raw.removed ?? [], pages: raw.pages.map(p => ({ ...p, edits: p.edits ?? defaultEdits() })) }; }
export function validContext(batch: Batch): boolean { return !!batch.assignment.trim() && batch.assignment.trim().length <= 120; }
function editable(batch: Batch) { if (batch.completed) throw new Error('Completed assignments are frozen. Start a new assignment.'); }
export async function save(db: CaptureDB, batch: Batch): Promise<Batch> {
  return db.transaction('rw', db.batches, async () => {
    const previous = await db.batches.get(batch.id);
    if ((previous?.revision ?? 0) !== batch.revision) throw new Error('This batch changed in another tab. Reload before editing.');
    if (previous?.completed) throw new Error('Completed assignments are frozen.');
    const next = { ...batch, revision: batch.revision + 1 }; await db.batches.put(next); return next;
  });
}
export async function readPhoto(file: File): Promise<Page> {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Each photo must be between 1 byte and 8 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b);
  if (!jpeg && !png) throw new Error('Use JPEG or PNG photos.');
  return { id: crypto.randomUUID(), label: '', originalName: file.name, mime: jpeg ? 'image/jpeg' : 'image/png', bytes, edits: defaultEdits() };
}
export function appendPages(batch: Batch, pages: Page[]): Batch {
  editable(batch); if (!validContext(batch)) throw new Error('Name the assignment first.');
  if (batch.groups.length >= MAX_GROUPS) throw new Error('Assignment limit: 40 students.');
  const all = [...batch.pages, ...pages];
  if (all.length > MAX_PAGES) throw new Error('Student page set limit: 10 pages.');
  if ([...batch.groups.flatMap(g => g.pages), ...batch.removed, ...all].reduce((sum,p) => sum + p.bytes.length,0) > MAX_BYTES) throw new Error('Assignment limit: 256 MB including retained originals.');
  return { ...batch, pages: all };
}
export function movePage(batch: Batch, index: number, delta: number): Batch {
  editable(batch); const pages = [...batch.pages], target = index + delta;
  if (index < 0 || index >= pages.length || target < 0 || target >= pages.length) return batch;
  [pages[index], pages[target]] = [pages[target], pages[index]]; return { ...batch, pages };
}
export function removePage(batch: Batch, index: number): Batch { editable(batch); if (!batch.pages[index]) return batch; return { ...batch, removed: [...batch.removed,batch.pages[index]], pages: batch.pages.filter((_,i) => i !== index) }; }
export function saveGroup(batch: Batch): Batch {
  editable(batch); if (batch.stage !== 'preview' || !batch.pages.length || !batch.draftLabel.trim() || batch.draftLabel.trim().length > 120) throw new Error('Preview photos and enter a student name label before saving the group.');
  return { ...batch, groups: [...batch.groups,{ id: batch.editingGroupId ?? batch.draftGroupId, label: batch.draftLabel.trim(), pages: batch.pages }], pages: [], draftLabel: '', editingGroupId: undefined, draftGroupId: crypto.randomUUID(), stage: 'capture' };
}
export function completeBatch(batch: Batch): Batch {
  editable(batch); if (!validContext(batch) || !batch.groups.length || batch.pages.length || batch.draftLabel.trim()) throw new Error('Save the current student group before All done.');
  return { ...batch, completed: true };
}
export async function exportBatch(batch: Batch): Promise<Uint8Array> {
  if (!batch.completed) throw new Error('Choose All done before exporting or transferring.');
  const files: Record<string,Uint8Array> = {};
  const submissions = [];
  for (const group of batch.groups) {
    const pages = [];
    for (const [order,page] of group.pages.entries()) {
      const path = capturePagePath(group.id,page.id,page.mime); files[path] = page.bytes;
      pages.push({ id: page.id, order, path, mime: page.mime, byteLength: page.bytes.length, sha256: await captureSha256(page.bytes), edits: page.edits });
    }
    submissions.push({ id: group.id, label: group.label, pages });
  }
  const manifest: CaptureManifest = { format: 'studentorganizer-capture', version: 2, packageId: batch.captureId, assignmentId: batch.assignmentId, assignmentName: batch.assignment.trim(), revision: batch.revision, completed: true, submissions };
  return encodeCapturePackage(manifest,files);
}
export async function exportSavedBatch(db: CaptureDB, expected: Batch): Promise<Uint8Array> {
  const current = await db.batches.get(expected.id);
  if (!current || current.revision !== expected.revision || current.captureId !== expected.captureId) throw new Error('This batch changed in another tab. Reload before exporting.');
  return exportBatch(recoverBatch(current));
}
