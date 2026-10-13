import 'fake-indexeddb/auto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { loadScalePreview, MarkScalePreviewContent } from './MarkScalePreview';

describe('actual class conversion preset preview', () => {
  let db: OntarioTeacherDB;
  beforeEach(async () => { db = new OntarioTeacherDB(`scale-preview-${crypto.randomUUID()}`); await seedDatabase(db); });
  afterEach(async () => { await db.delete(); });
  it('loads only the configured version and renders its current values and revision rather than a hardcoded title', async () => {
    const old = (await db.markScaleVersions.toArray())[0];
    await db.markScaleVersions.add({ ...old, id: 'fictional-new-version', revision: 7, effectiveFrom: '2026-10-13' });
    const oldEntry = (await db.markScaleEntries.toArray())[0];
    await db.markScaleEntries.add({ ...oldEntry, id: 'fictional-new-entry', markScaleVersionId: 'fictional-new-version', code: 'Custom 4', benchmarkPercentage: 92 });
    const data = await loadScalePreview(db, 'fictional-new-version');
    expect(data.entries).toHaveLength(1);
    const html = renderToStaticMarkup(<MarkScalePreviewContent data={data} />);
    expect(html).toContain('Class version 7'); expect(html).toContain('2026-10-13'); expect(html).toContain('92%');
    expect(html).toContain('Custom 4'); expect(html).not.toContain('Active Version 1');
  });
  it('distinguishes loading, unavailable version and genuine empty version without fallback conversion values', async () => {
    expect(renderToStaticMarkup(<MarkScalePreviewContent data={undefined} />)).toContain('Loading');
    const missing = await loadScalePreview(db, 'missing-version');
    expect(missing.entries).toEqual([]);
    expect(renderToStaticMarkup(<MarkScalePreviewContent data={missing} />)).toContain('version is unavailable');
    const version = (await db.markScaleVersions.toArray())[0];
    await db.markScaleEntries.clear();
    expect(renderToStaticMarkup(<MarkScalePreviewContent data={await loadScalePreview(db, version.id)} />)).toContain('no conversion entries');
  });
});
