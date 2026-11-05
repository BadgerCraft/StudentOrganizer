import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { MarkingService } from './markingService';
import { validateMainBundleIntegrity } from '../security/mainBundleValidation';
import { sha256 } from './importDocuments';
import { assertMarkingPdfs, assertMarkingRecord } from './validation';
import type { MarkingActor, MarkingPdfDocument } from './types';

// Real, bounded single-page PDF with a synthetic grade. No student/private input.
function fictionalPdfBytes() {
  const stream = 'BT /F1 18 Tf 20 60 Td (Fictional rubric: 3) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function pdfDocument(name = 'Fictional-A.pdf'): Promise<MarkingPdfDocument> {
  const bytes = fictionalPdfBytes();
  return { version: 1, id: crypto.randomUUID(), name, mime: 'application/pdf', base64: btoa(String.fromCharCode(...bytes)), size: bytes.length, hash: await sha256(bytes), pageCount: 1 };
}

const ASSESSMENT = 'fictional-pdf-storage';
describe('retained PDF originals and grade/storage integrity', () => {
  let db: OntarioTeacherDB, service: MarkingService, actor: MarkingActor, rubricId: string, enrollments: string[];
  beforeEach(async () => {
    db = new OntarioTeacherDB(`pdf-storage-${crypto.randomUUID()}`); await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...template, id: ASSESSMENT, code: 'PDF' });
    await db.assessmentCategories.bulkAdd((await db.assessmentCategories.where('assessmentId').equals(template.id).toArray()).map(c => ({ ...c, id: `pdf-${c.categoryCode}`, assessmentId: ASSESSMENT })));
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() }; service = new MarkingService(db);
    rubricId = (await service.saveRubric(ASSESSMENT, { title: 'Fictional PDF category entry', levels: ['3'], criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'T', descriptors: { '3': 'Refer to the original PDF.' } }] }, actor)).id;
    enrollments = (await db.classEnrollments.where('classSectionId').equals(template.classSectionId).toArray()).map(e => e.id);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  async function imported() { return service.importPdfAttempt(ASSESSMENT, rubricId, [await pdfDocument()], enrollments[0], actor); }

  it('retains exact originals and keeps identical PDFs for separate students while rejecting successful retries', async () => {
    const pdf = await pdfDocument();
    const first = await service.importPdfAttempt(ASSESSMENT, rubricId, [pdf], enrollments[0], actor);
    const second = await service.importPdfAttempt(ASSESSMENT, rubricId, [{ ...pdf, id: 'second', name: 'Fictional-B.pdf' }], enrollments[1], actor);
    expect(first.pdfDocuments).toEqual([pdf]);
    expect(second.classEnrollmentId).not.toBe(first.classEnrollmentId);
    await expect(service.importPdfAttempt(ASSESSMENT, rubricId, [{ ...pdf, id: 'retry', name: 'Renamed.pdf' }], enrollments[0], actor)).rejects.toThrow('already imported');
    expect(await db.markingAttempts.where('assessmentId').equals(ASSESSMENT).count()).toBe(2);
    expect(await db.studentAssessments.where('assessmentId').equals(ASSESSMENT).count()).toBe(0);
  });

  it('rejects changed originals, invalid enrollment and departed actors without writing attempts', async () => {
    const pdf = await pdfDocument();
    await expect(service.importPdfAttempt(ASSESSMENT, rubricId, [{ ...pdf, hash: '0'.repeat(64) }], enrollments[0], actor)).rejects.toThrow();
    await expect(service.importPdfAttempt(ASSESSMENT, rubricId, [pdf], 'missing-enrollment', actor)).rejects.toThrow();
    clearActiveTeacherId();
    await expect(service.importPdfAttempt(ASSESSMENT, rubricId, [pdf], enrollments[0], actor)).rejects.toThrow('teacher changed');
    expect(await db.markingAttempts.where('assessmentId').equals(ASSESSMENT).count()).toBe(0);
  });

  it('rolls back the imported original when audit persistence fails', async () => {
    const fail = () => { throw new Error('Fictional disk failure'); };
    db.auditEntries.hook('creating', fail);
    try { await expect(imported()).rejects.toThrow('Fictional disk failure'); }
    finally { db.auditEntries.hook('creating').unsubscribe(fail); }
    expect(await db.markingAttempts.where('assessmentId').equals(ASSESSMENT).count()).toBe(0);
    expect((await imported()).pdfDocuments).toHaveLength(1);
  });

  it('roundtrips PDF originals and finalized grades; corrupt restore leaves live data intact', async () => {
    const attempt = await imported();
    const session = await service.openSession(attempt.id, actor);
    const judgment = session.draft.judgments.find(j => j.assessmentCategoryId === 'pdf-T')!;
    Object.assign(judgment, { assessed: true, rawScore: '3', feedback: 'Entered from fictional PDF' });
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    const commit = await service.finalize(saved.id, saved.version, actor);
    const portability = new PortabilityService(db);
    const json = await portability.createFullBackupJSON();
    const bundle = { format: 'student-organizer-working', version: 1, primary: JSON.parse(json), recovery: { backups: [], options: [], state: [] }, applicationStorage: {} };
    await expect(validateMainBundleIntegrity(bundle)).resolves.toBeDefined();
    const other = new OntarioTeacherDB(`pdf-restore-${crypto.randomUUID()}`);
    try {
      await new PortabilityService(other).restoreFromJSON(json);
      expect(await other.markingAttempts.get(attempt.id)).toEqual(attempt);
      expect(await other.markingCommits.get(commit.id)).toEqual(commit);
      expect(await other.categoryResults.toArray()).toEqual(await db.categoryResults.toArray());
    } finally { await other.delete(); }
    const before = await db.categoryResults.toArray();
    const corrupt = JSON.parse(json);
    corrupt.tables.markingAttempts.find((row: any) => row.id === attempt.id).pdfDocuments[0].hash = '0'.repeat(64);
    await expect(validateMainBundleIntegrity({ ...bundle, primary: corrupt })).rejects.toThrow();
    await expect(portability.restoreFromJSON(JSON.stringify(corrupt))).rejects.toThrow();
    expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
    expect(await db.categoryResults.toArray()).toEqual(before);
  });

  it.each([false, true])('archive keep=%s follows retention policy for originals, history and backup', async keep => {
    const attempt = await imported();
    const session = await service.openSession(attempt.id, actor);
    session.draft.overallFeedback = 'Fictional teacher feedback survives';
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    const commit = await service.finalize(saved.id, saved.version, actor);
    const results = await db.categoryResults.toArray();
    const archived = await service.archiveAttempt(attempt.id, attempt.version, actor, keep);
    expect(archived.pdfDocuments).toEqual(keep ? attempt.pdfDocuments : []);
    expect(await db.categoryResults.toArray()).toEqual(results);
    expect((await db.markingCommits.get(commit.id))?.draft.overallFeedback).toBe('Fictional teacher feedback survives');
    const json = await new PortabilityService(db).createFullBackupJSON();
    expect(json.includes(attempt.pdfDocuments![0].base64)).toBe(keep);
    await new PortabilityService(db).restoreFromJSON(json);
    expect(await db.markingAttempts.get(attempt.id)).toEqual(archived);
  });

  it('validates bounds and disallows PDFs in incompatible or purged attempts', async () => {
    const pdf = await pdfDocument();
    expect(() => assertMarkingPdfs([{ ...pdf, pageCount: 21 }])).toThrow();
    expect(() => assertMarkingPdfs([{ ...pdf, name: '../Fictional.pdf' }])).toThrow();
    expect(() => assertMarkingPdfs([{ ...pdf, size: pdf.size + 1 }])).toThrow();
    expect(() => assertMarkingPdfs([pdf, pdf])).toThrow('IDs');
    expect(() => assertMarkingPdfs(Array.from({ length: 41 }, (_, i) => ({ ...pdf, id: String(i) })))).toThrow();
    const attempt = await imported();
    expect(() => assertMarkingRecord('markingAttempts', { ...attempt, mode: 'oral' })).toThrow();
    expect(() => assertMarkingRecord('markingAttempts', { ...attempt, archivedAt: new Date().toISOString(), keepStudentWork: false })).toThrow();
  });
});
