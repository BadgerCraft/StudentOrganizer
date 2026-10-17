import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  CaptureDB, MAX_BYTES, MAX_PAGES, appendPages, catalog, emptyBatch, exportBatch, exportSavedBatch,
  movePage, readPhoto, save, validContext, type Batch, type Page,
} from '../src/store';

const databases: CaptureDB[] = [];
function database(): CaptureDB {
  const db = new CaptureDB(`fictional-capture-test-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}
function page(id: string, bytes = new Uint8Array([255, 216, 255, 0, 1])): Page {
  return { id, label: `Fictional ${id}`, originalName: `${id}.jpg`, mime: 'image/jpeg', bytes };
}
function batch(pages: Page[] = []): Batch {
  return { ...emptyBatch(), classId: catalog[0].id, assignment: catalog[0].assignments[0], pages };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map(db => db.delete()));
});

describe('local batch persistence', () => {
  it('exports identical bytes for the same saved revision across wall-clock changes', async () => {
    const sample = batch([page('fictional-stable')]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
      const first = await exportBatch(sample);
      vi.setSystemTime(new Date('2026-10-17T18:00:00Z'));
      expect(await exportBatch(sample)).toEqual(first);
    } finally { vi.useRealTimers(); }
  });

  it('exports the committed snapshot and rejects a stale clean tab or missing/reset batch', async () => {
    const db = database();
    const old = await save(db, batch([page('fictional-a')]));
    const latest = await save(db, { ...old, pages: [{ ...old.pages[0], label: 'Fictional corrected' }] });
    await expect(exportSavedBatch(db, old)).rejects.toThrow('another tab');
    const files = unzipSync(await exportSavedBatch(db, latest));
    expect(JSON.parse(strFromU8(files['manifest.json'])).pages[0].labelHint).toBe('Fictional corrected');
    expect(await db.batches.get(latest.id)).toEqual(latest);
    await expect(exportSavedBatch(db, { ...latest, captureId: 'wrong-capture' })).rejects.toThrow('another tab');
    await save(db, { ...emptyBatch(), revision: latest.revision });
    await expect(exportSavedBatch(db, latest)).rejects.toThrow('another tab');
    await db.batches.delete(latest.id);
    await expect(exportSavedBatch(db, latest)).rejects.toThrow('another tab');
  });

  it('restores original photo bytes, labels, context and revision after closing the database', async () => {
    const db = database();
    const original = batch([page('fictional-a')]);
    const saved = await save(db, original);
    expect(saved.revision).toBe(1);
    expect(original.revision).toBe(0);
    db.close();
    await db.open();
    expect(await db.batches.get(original.id)).toEqual(saved);
    expect((await db.batches.get(original.id))?.pages[0].bytes).toBeInstanceOf(Uint8Array);
  });

  it('rejects a stale tab without changing the newer saved order or labels', async () => {
    const db = database();
    const first = await save(db, batch([page('fictional-a'), page('fictional-b')]));
    const newer = await save(db, {
      ...movePage(first, 0, 1),
      pages: [page('fictional-b'), { ...page('fictional-a'), label: 'Fictional corrected hint' }],
    });
    await expect(save(db, { ...first, pages: [] })).rejects.toThrow('another tab');
    expect(await db.batches.get(first.id)).toEqual(newer);
  });

  it('allows exactly one of two competing saves from the same revision', async () => {
    const db = database();
    const first = await save(db, batch([page('fictional-original')]));
    const otherTab = new CaptureDB(db.name);
    try {
      await otherTab.open();
      const outcomes = await Promise.allSettled([
        save(db, { ...first, pages: [page('fictional-tab-a')] }),
        save(otherTab, { ...first, pages: [page('fictional-tab-b')] }),
      ]);
      const winners = outcomes.filter(result => result.status === 'fulfilled');
      expect(winners).toHaveLength(1);
      expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(await db.batches.get(first.id)).toEqual((winners[0] as PromiseFulfilledResult<Batch>).value);
    } finally { otherTab.close(); }
  });

  it('rolls back an aborted write and leaves the caller revision unchanged', async () => {
    const db = database();
    const first = await save(db, batch([page('fictional-retained')]));
    const put = db.batches.put.bind(db.batches);
    vi.spyOn(db.batches, 'put').mockImplementationOnce((...args) => put(...args).then(() => {
      Dexie.currentTransaction!.abort();
      throw new Error('Fictional simulated storage failure');
    }));
    const proposed = { ...first, pages: [page('fictional-replacement')] };
    await expect(save(db, proposed)).rejects.toThrow();
    expect(await db.batches.get(first.id)).toEqual(first);
    expect(proposed.revision).toBe(first.revision);
    const retried = await save(db, proposed);
    expect(retried.revision).toBe(first.revision + 1);
  });

  it('keeps the old batch intact if a reset comes from a stale tab', async () => {
    const db = database();
    const first = await save(db, batch([page('fictional-retained')]));
    const latest = await save(db, { ...first, pages: [page('fictional-added')] });
    await expect(save(db, { ...emptyBatch(), revision: first.revision })).rejects.toThrow('another tab');
    expect(await db.batches.get(first.id)).toEqual(latest);
    const reset = await save(db, { ...emptyBatch(), revision: latest.revision });
    expect(reset.pages).toEqual([]);
    expect(reset.revision).toBe(latest.revision + 1);
    expect(reset.id).toBe(latest.id);
    expect(reset.captureId).not.toBe(latest.captureId);
  });
});

describe('photo intake and ordering', () => {
  it('requires an assignment belonging to the selected class before adding photos', () => {
    expect(validContext(batch())).toBe(true);
    for (const invalid of [emptyBatch(), { ...batch(), classId: 'fictional-missing' },
      { ...batch(), assignment: catalog[1].assignments[0] }]) {
      expect(validContext(invalid)).toBe(false);
      expect(() => appendPages(invalid, [page('fictional-a')])).toThrow('Choose a class');
      expect(invalid.pages).toEqual([]);
    }
  });

  it('accepts exactly ten pages and rejects overflow without changing the saved input', () => {
    const original = batch(Array.from({ length: MAX_PAGES - 1 }, (_, i) => page(`fictional-${i}`)));
    const full = appendPages(original, [page('fictional-last')]);
    expect(full.pages).toHaveLength(MAX_PAGES);
    expect(original.pages).toHaveLength(MAX_PAGES - 1);
    expect(() => appendPages(full, [page('fictional-overflow')])).toThrow('10 pages and 32 MB');
    expect(full.pages).toHaveLength(MAX_PAGES);
  });

  it('accepts exactly thirty-two MB and rejects an additional byte without mutating the batch', () => {
    const largePages = Array.from({ length: 4 }, (_, i) => page(`fictional-large-${i}`, new Uint8Array(MAX_BYTES / 4)));
    const original = batch(largePages.slice(0, 3));
    const full = appendPages(original, largePages.slice(3));
    expect(full.pages).toHaveLength(4);
    expect(() => appendPages(full, [page('fictional-overflow', new Uint8Array(1))])).toThrow('32 MB');
    expect(original.pages).toHaveLength(3);
    expect(full.pages).toHaveLength(4);
  });

  it('moves pages with their bytes and hints while preserving the original order', () => {
    const original = batch([page('fictional-a'), page('fictional-b'), page('fictional-c')]);
    const moved = movePage(original, 2, -1);
    expect(moved.pages.map(p => p.id)).toEqual(['fictional-a', 'fictional-c', 'fictional-b']);
    expect(moved.pages[1]).toBe(original.pages[2]);
    expect(original.pages.map(p => p.id)).toEqual(['fictional-a', 'fictional-b', 'fictional-c']);
    expect(movePage(original, 0, -1)).toBe(original);
    expect(movePage(original, 2, 1)).toBe(original);
    expect(movePage(original, -1, 1)).toBe(original);
  });

  it('identifies supported photos by bytes rather than a misleading filename or MIME type', async () => {
    const jpeg = await readPhoto(new File([new Uint8Array([255, 216, 255, 5])], 'fictional.png', { type: 'image/png' }));
    expect(jpeg.mime).toBe('image/jpeg');
    expect(jpeg.originalName).toBe('fictional.png');
    expect(jpeg.label).toBe('');
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const png = await readPhoto(new File([pngBytes], 'fictional.jpg', { type: 'image/jpeg' }));
    expect(png.mime).toBe('image/png');
    expect(png.bytes).toEqual(pngBytes);
    expect(png.id).not.toBe(jpeg.id);
  });

  it('rejects empty, oversized, unsupported and truncated photo signatures', async () => {
    await expect(readPhoto(new File([], 'fictional-empty.jpg'))).rejects.toThrow('1 byte and 8 MB');
    await expect(readPhoto(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'fictional-large.jpg'))).rejects.toThrow('1 byte and 8 MB');
    for (const bytes of [new Uint8Array([71, 73, 70]), new Uint8Array([255, 216]), new Uint8Array([137, 80, 78, 71])]) {
      await expect(readPhoto(new File([bytes], 'fictional.jpg', { type: 'image/jpeg' }))).rejects.toThrow('Use JPEG or PNG');
    }
  });

  it('accepts a photo at the desktop eight MB boundary without changing its bytes', async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024);
    bytes.set([255, 216, 255]);
    const photo = await readPhoto(new File([bytes], 'fictional-boundary.jpg'));
    expect(photo.bytes.byteLength).toBe(bytes.byteLength);
    expect(photo.bytes.every((value, index) => value === bytes[index])).toBe(true);
  });
});

describe('deliberate local ZIP export', () => {
  it('exports exact ordered photo bytes and hashes, leaving every hint explicitly unmatched', async () => {
    const jpeg = { ...page('fictional-a'), label: '  Fictional duplicate hint  ', originalName: '../fictional-source.jpg' };
    const png = { ...page('fictional-b', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99])),
      label: 'Fictional duplicate hint', mime: 'image/png', originalName: 'fictional-source.png' };
    const original = { ...batch([jpeg, png]), revision: 7 };
    const snapshot = structuredClone(original);
    const reordered = movePage(original, 1, -1);
    const files = unzipSync(await exportBatch(reordered));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'manifest.json', 'pages/001.png', 'pages/002.jpg']);
    expect(files['pages/001.png']).toEqual(png.bytes);
    expect(files['pages/002.jpg']).toEqual(jpeg.bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest).toMatchObject({ format: 'studentorganizer-capture', version: 1, fictional: true,
      batchId: original.captureId, revision: 7, classHint: catalog[0].name, assignmentHint: original.assignment,
      requiresExplicitDesktopMatching: true });
    // Independently computed SHA-256 fixture values, in the exported PNG/JPEG order.
    const hashes = ['17a22cdcbfa40840cef95190e8cb660f76f0a6e2bf86c2286d8fcb10b16b991f',
      '6c13f379ff513a750741206db9e93afd6a6b8bf688c5766d74384b5ab07e87fb'];
    expect(manifest.pages).toEqual(reordered.pages.map((photo, i) => ({
      pageId: photo.id, order: i + 1, path: `pages/00${i + 1}.${i === 0 ? 'png' : 'jpg'}`,
      labelHint: photo.label.trim(), originalName: photo.originalName, mime: photo.mime,
      byteLength: photo.bytes.byteLength, sha256: hashes[i],
      studentId: null, matchStatus: 'unmatched',
    })));
    expect(strFromU8(files['README.txt'])).toContain('desktop does not yet read this manifest');
    expect(original).toEqual(snapshot);
  });

  it('refuses an empty batch, invalid context or any missing label', async () => {
    await expect(exportBatch(batch())).rejects.toThrow('add at least one page');
    await expect(exportBatch({ ...batch([page('fictional-a')]), assignment: catalog[1].assignments[0] })).rejects.toThrow('Choose a class');
    await expect(exportBatch(batch([page('fictional-a'), { ...page('fictional-b'), label: ' \t ' }]))).rejects.toThrow('Label every page');
  });
});
