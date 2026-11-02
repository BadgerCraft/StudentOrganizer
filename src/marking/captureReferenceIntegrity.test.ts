import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { PortabilityService } from '../services/portabilityService';
import { CaptureAttachmentService } from '../capture/attachmentService';
import * as backupCapacity from '../capture/backupCapacity';
import type { CaptureImportReceipt } from '../capture/types';
import { capturePagePath, captureSha256, type ParsedCapturePackage } from '../../shared/capturePackage';
import { MarkingService } from './markingService';
import type { MarkingActor, MarkingAttempt, MarkingRubric } from './types';

// Small real PNG isolates graph failures without repeating the large pixel test.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
describe('capture reference integrity and rollback', () => {
  let db: OntarioTeacherDB, marking: MarkingService, portability: PortabilityService;
  let actor: MarkingActor, rubric: MarkingRubric, receipt: CaptureImportReceipt;
  const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  beforeEach(async () => {
    clearActiveTeacherId(); db = new OntarioTeacherDB(`fictional-ref-integrity-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { ...identity, epoch: getIdentityEpoch() };
    const local = { ...identity, identityEpoch: actor.epoch };
    const bytes = Uint8Array.from(atob(PNG), char => char.charCodeAt(0));
    const metadata = { id: 'page-one', order: 0, path: capturePagePath('student-one', 'page-one', 'image/png'), mime: 'image/png' as const,
      byteLength: bytes.length, sha256: await captureSha256(bytes), edits: { rotation: 0 as const, crop: { x: 0, y: 0, width: 1, height: 1 } } };
    const submission = { id: 'student-one', label: 'Fictional student', pages: [metadata] };
    const pkg: ParsedCapturePackage = { manifest: { format: 'studentorganizer-capture', version: 2, packageId: 'fictional-package', assignmentId: 'fictional-phone-assignment', assignmentName: 'Fictional work', revision: 1, completed: true, submissions: [submission] }, submissions: [{ ...submission, pages: [{ metadata, bytes }] }] };
    const capture = new CaptureAttachmentService(db);
    const enrollment = (await capture.context('assess-eng-essay', local)).roster[0].enrollment.id;
    marking = new MarkingService(db); portability = new PortabilityService(db);
    rubric = await marking.saveRubric('assess-eng-essay', { title: 'Fictional reference rubric', levels: ['Secure'], criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'K', descriptors: { Secure: 'Clear' } }] }, actor);
    receipt = await capture.confirm('assess-eng-essay', pkg, submission.id, enrollment, local);
  });
  afterEach(async () => { vi.restoreAllMocks(); clearActiveTeacherId(); await db.delete(); });

  async function referenceAttempt(): Promise<MarkingAttempt> {
    const inline = await marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, actor);
    // Install the same valid representation used by large bind/promotion. Production
    // threshold selection is independently covered by the real 35MiB regression.
    const attempt: MarkingAttempt = { ...inline, imagePages: inline.imagePages!.map(({ base64: _bytes, ...page }) => ({ ...page,
      captureRef: { version: 1 as const, attachmentId: receipt.attachmentId, pageId: 'page-one' } })) };
    await db.markingAttempts.put(attempt);
    return attempt;
  }

  it('roundtrips references and preserves independent originals through keep-work and no-work archive', async () => {
    const attempt = await referenceAttempt();
    const originals = (await db.captureAttachments.get(receipt.attachmentId))!.pages;
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect((await marking.readImagePage(attempt.id, attempt.imagePages![0].id, actor)).base64).toBe(PNG);
    const beforeArchive = await portability.createFullBackupJSON();
    await marking.archiveAttempt(attempt.id, attempt.version, actor, true);
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect((await marking.readImagePage(attempt.id, attempt.imagePages![0].id, actor)).base64).toBe(PNG);
    await portability.restoreFromJSON(beforeArchive);
    await marking.archiveAttempt(attempt.id, attempt.version, actor, false);
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    await expect(marking.readImagePage(attempt.id, attempt.imagePages![0].id, actor)).rejects.toThrow();
    expect((await db.captureAttachments.get(receipt.attachmentId))!.pages).toEqual(originals);
    expect(await db.captureImportReceipts.get(receipt.id)).toEqual(receipt);
  });

  it.each(['page', 'version', 'owner', 'missing'] as const)('rejects corrupt %s in backup before changing any table', async corruption => {
    const attempt = await referenceAttempt();
    const backup = JSON.parse(await portability.createFullBackupJSON());
    const page = backup.tables.markingAttempts.find((row: MarkingAttempt) => row.id === attempt.id).imagePages[0];
    if (corruption === 'page') page.captureRef.pageId = 'missing-page';
    if (corruption === 'version') page.captureRef.version = 2;
    if (corruption === 'owner') backup.tables.captureAttachments[0].createdBy = 'fictional-other-teacher';
    if (corruption === 'missing') backup.tables.captureAttachments = [];
    await db.students.update(receipt.studentId, { firstName: 'Newer fictional sentinel' });
    const before = await snapshot();
    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it.each(['student', 'root owner', 'receipt package', 'missing'] as const)('denies %s corruption at read, save and finalize without writes', async corruption => {
    const attempt = await referenceAttempt();
    let session = await marking.openSession(attempt.id, actor);
    session = await marking.saveDraft(session.id, { ...session.draft, judgments: session.draft.judgments.map(j => ({ ...j, assessed: true, rawScore: '88', inputFormat: 'percentage' as const })) }, session.version, actor);
    const source = (await db.captureAttachments.get(receipt.attachmentId))!;
    if (corruption === 'student') await db.captureAttachments.update(source.id, { studentId: 'fictional-other-student' });
    if (corruption === 'root owner') await db.captureAttachments.update(source.id, { createdBy: 'fictional-other-teacher' });
    if (corruption === 'receipt package') await db.captureImportReceipts.update(receipt.id, { packageId: 'fictional-other-package' });
    if (corruption === 'missing') await db.captureAttachments.delete(source.id);
    const before = await snapshot();
    await expect(marking.readImagePage(attempt.id, attempt.imagePages![0].id, actor)).rejects.toThrow();
    await expect(marking.saveDraft(session.id, session.draft, session.version, actor)).rejects.toThrow();
    await expect(marking.finalize(session.id, session.version, actor)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    await db.captureAttachments.put(source); await db.captureImportReceipts.put(receipt);
    expect((await marking.readImagePage(attempt.id, attempt.imagePages![0].id, actor)).base64).toBe(PNG);
  });

  it('rolls back bind on the final complete-backup capacity guard and permits a clean retry', async () => {
    const before = await snapshot();
    const capacity = vi.spyOn(backupCapacity, 'assertCaptureBackupCapacity').mockRejectedValueOnce(new Error('Fictional complete-backup capacity exceeded'));
    await expect(marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, actor)).rejects.toThrow('complete-backup capacity');
    expect(capacity).toHaveBeenCalledOnce();
    expect(await snapshot()).toEqual(before);
    capacity.mockRestore();
    const attempt = await marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, actor);
    expect(await db.markingAttempts.count()).toBe(1);
    expect(await db.markingSessions.where('attemptId').equals(attempt.id).count()).toBe(1);
    expect(await db.captureImportReceipts.get(receipt.id)).toEqual(receipt);
  });
});
