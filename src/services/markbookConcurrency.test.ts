import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ConcurrencyConflictError, MarkbookDomainService, type SaveMarkbookCellParams } from './markbookService';

describe('Markbook editor opening baseline', () => {
  let db: OntarioTeacherDB;
  let service: MarkbookDomainService;
  let params: SaveMarkbookCellParams;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`fictional-markbook-concurrency-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new MarkbookDomainService(db);
    const sa = (await db.studentAssessments.where('assessmentId').equals('assess-eng-essay').first())!;
    const cr = (await db.categoryResults.where('studentAssessmentId').equals(sa.id).first())!;
    params = { assessmentId: sa.assessmentId, classEnrollmentId: sa.classEnrollmentId, classSectionId: sa.classSectionId,
      assessmentCategoryId: cr.assessmentCategoryId, rawScore: '78', inputFormat: 'percentage', feedback: 'Opening draft',
      userId: 'user-tyler', deviceId: 'fictional-device',
      expectedCellState: { studentAssessment: { id: sa.id, version: sa.version }, categoryResult: { id: cr.id, version: cr.version } } };
  });
  afterEach(async () => { await db.delete(); });
  async function snapshot() {
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  }
  async function rejectWithoutWrites() {
    const before = await snapshot();
    await expect(service.saveMarkbookCell(params)).rejects.toThrow(ConcurrencyConflictError);
    expect(await snapshot()).toEqual(before);
  }
  it('preserves a newer official mark and feedback when an existing editor saves its older baseline', async () => {
    const newer = await service.saveMarkbookCell({ ...params, rawScore: '90', feedback: 'Newer official feedback' });
    await rejectWithoutWrites();
    expect(await db.categoryResults.get(newer.categoryResult!.id)).toMatchObject({ rawScore: '90', feedback: 'Newer official feedback' });
  });
  it('rejects a competing first assignment/result rather than treating absence as an unchecked update', async () => {
    const saId = params.expectedCellState!.studentAssessment!.id;
    await db.categoryResults.where('studentAssessmentId').equals(saId).delete();
    await db.studentAssessments.delete(saId);
    params.expectedCellState = { studentAssessment: null, categoryResult: null };
    await service.saveMarkbookCell({ ...params, rawScore: '90', feedback: 'Competing first save' });
    await rejectWithoutWrites();
  });
  it('checks an absent result even when a legacy writer leaves the parent version unchanged, rolling back all writes', async () => {
    const cr = (await db.categoryResults.get(params.expectedCellState!.categoryResult!.id))!;
    await db.categoryResults.delete(cr.id);
    params.expectedCellState!.categoryResult = null;
    await db.categoryResults.add({ ...cr, id: 'fictional-competing-result', rawScore: '90', normalizedPercentage: 90 });
    await rejectWithoutWrites();
  });
  it('rejects deleted or replaced expected records even if a replacement has the same version', async () => {
    const cr = (await db.categoryResults.get(params.expectedCellState!.categoryResult!.id))!;
    await db.categoryResults.delete(cr.id);
    await rejectWithoutWrites();
    await db.categoryResults.add({ ...cr, id: 'fictional-replacement-result' });
    await rejectWithoutWrites();
  });
  it('allows a reviewed existing or absent baseline and preserves omitted-baseline service compatibility', async () => {
    const updated = await service.saveMarkbookCell(params);
    expect(updated.categoryResult?.normalizedPercentage).toBe(78);
    const unchecked = await service.saveMarkbookCell({ ...params, expectedCellState: undefined, rawScore: '81' });
    expect(unchecked.categoryResult?.normalizedPercentage).toBe(81);
    await db.categoryResults.where('studentAssessmentId').equals(unchecked.studentAssessment.id).delete();
    await db.studentAssessments.delete(unchecked.studentAssessment.id);
    const created = await service.saveMarkbookCell({ ...params, expectedCellState: { studentAssessment: null, categoryResult: null } });
    expect(created.categoryResult?.normalizedPercentage).toBe(78);
    expect(created.studentAssessment.version).toBe(1);
  });
});
