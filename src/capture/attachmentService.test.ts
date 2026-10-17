import 'fake-indexeddb/auto';
import { MarkingService } from '../marking/markingService';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as backupCapacity from './backupCapacity';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { PortabilityService } from '../services/portabilityService';
import type { LocalWriteActor } from '../services/localWriteIdentity';
import { CaptureAttachmentService } from './attachmentService';
import { captureSha256, capturePagePath, type ParsedCapturePackage } from '../../shared/capturePackage';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
async function fixture(): Promise<ParsedCapturePackage> {
  const bytes = Uint8Array.from(atob(PNG), c => c.charCodeAt(0));
  const hash = await captureSha256(bytes);
  const submissions = ['student-one', 'student-two'].map(id => ({ id, label: 'Alex Fictional', pages: [0, 1].map(order => ({ id: `${id}-page-${order}`, order, path: capturePagePath(id, `${id}-page-${order}`, 'image/png'), mime: 'image/png' as const, byteLength: bytes.length, sha256: hash, edits: { rotation: 0 as const, crop: { x: 0, y: 0, width: 1, height: 1 } } })) }));
  return { manifest: { format: 'studentorganizer-capture', version: 2, packageId: 'package-one', assignmentId: 'phone-assignment', assignmentName: 'Fictional work', revision: 1, completed: true, submissions }, submissions: submissions.map(s => ({ id: s.id, label: s.label, pages: s.pages.map(metadata => ({ metadata, bytes })) })) };
}
describe('durable capture matching boundary', () => {
  let db: OntarioTeacherDB, service: CaptureAttachmentService, actor: LocalWriteActor, pkg: ParsedCapturePackage, enrollments: string[];
  beforeEach(async () => {
    clearActiveTeacherId(); db = new OntarioTeacherDB(`capture-${crypto.randomUUID()}`); await seedDatabase(db);
    const identity = await selectActingTeacher(db, 'user-tyler'); actor = { userId: identity.userId, deviceId: identity.deviceId, identityEpoch: getIdentityEpoch() };
    service = new CaptureAttachmentService(db); pkg = await fixture();
    enrollments = (await service.context('assess-eng-essay', actor)).roster.map(r => r.enrollment.id);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  const confirm = (s: CaptureAttachmentService, p: ParsedCapturePackage, e: string, a: LocalWriteActor, id = 'student-one') => s.confirm('assess-eng-essay', p, id, e, a);
  it('atomically retains multipage originals/edits, duplicate names and identical pages across students without marking', async () => {
    const grades = await db.studentAssessments.toArray();
    await confirm(service, pkg, enrollments[0], actor);
    await confirm(service, pkg, enrollments[1], actor, 'student-two');
    expect(await db.captureAttachments.count()).toBe(2);
    expect((await db.captureAttachments.toArray()).every(a => a.pages.length === 2)).toBe(true);
    expect(await db.markingAttempts.count()).toBe(0); expect(await db.markingSessions.count()).toBe(0);
    expect(await db.studentAssessments.toArray()).toEqual(grades);
  });
  it('persists a whole class of 40 ten-page sets incrementally without a flat ten-photo cap', async () => {
    const context = await service.context('assess-eng-essay', actor);
    const template = context.roster[0];
    const bytes = pkg.submissions[0].pages[0].bytes;
    const metadata = pkg.manifest.submissions[0].pages[0];
    const submissions = Array.from({ length: 40 }, (_, index) => {
      const id = `class-set-${index}`;
      return { id, label: 'Duplicate fictional display name', pages: Array.from({ length: 10 }, (_, order) => ({ ...structuredClone(metadata), id: `${id}-page-${order}`, order, path: capturePagePath(id, `${id}-page-${order}`, 'image/png') })) };
    });
    pkg = { manifest: { ...pkg.manifest, submissions }, submissions: submissions.map(s => ({ id: s.id, label: s.label, pages: s.pages.map(metadata => ({ metadata, bytes })) })) };
    for (let index = 0; index < 40; index++) {
      const studentId = `capacity-student-${index}`, enrollmentId = `capacity-enrollment-${index}`;
      await db.students.add({ ...template.student, id: studentId, localStudentNumber: `capacity-${index}` });
      await db.classEnrollments.add({ ...template.enrollment, id: enrollmentId, studentId });
      await confirm(service, pkg, enrollmentId, actor, submissions[index].id);
    }
    expect(await db.captureAttachments.count()).toBe(40);
    const loaded = await service.context('assess-eng-essay', actor);
    expect(loaded.attachments.every(a => a.pageCount === 10)).toBe(true);
    expect(await service.reconcile('assess-eng-essay', pkg, actor)).toHaveLength(40);
  }, 30_000); // Forty durable transactions plus backup-capacity scans on slower CI hosts.
  it('double confirm and restart/reimport recover the receipt without duplicate attachments', async () => {
    const [first, second] = await Promise.all([confirm(service, pkg, enrollments[0], actor), confirm(service, pkg, enrollments[0], actor)]);
    expect(first.id).toBe(second.id); db.close(); await db.open();
    expect(await confirm(new CaptureAttachmentService(db), pkg, enrollments[0], actor)).toEqual(first);
    expect(await service.reconcile('assess-eng-essay', pkg, actor)).toEqual([first]);
    expect(await db.captureAttachments.count()).toBe(1);
    await expect(confirm(service, pkg, enrollments[1], actor)).rejects.toThrow('different student');
  });
  it('rejects changed bytes and changed edits under an already imported stable ID', async () => {
    await confirm(service, pkg, enrollments[0], actor);
    const changed = structuredClone(pkg); changed.submissions[0].pages[0].bytes[0] ^= 1;
    await expect(confirm(service, changed, enrollments[0], actor)).rejects.toThrow('changed');
    pkg.manifest.submissions[0].pages[0].edits.rotation = 90;
    await expect(service.reconcile('assess-eng-essay', pkg, actor)).rejects.toThrow('different content');
    expect(await db.captureAttachments.count()).toBe(1);
  });
  it('rolls back whole attachment on quota failure, preserves selection retry and other completed work', async () => {
    await confirm(service, pkg, enrollments[1], actor, 'student-two');
    const fail = () => { throw new DOMException('disk full', 'QuotaExceededError'); };
    db.captureImportReceipts.hook('creating', fail);
    await expect(confirm(service, pkg, enrollments[0], actor)).rejects.toThrow('disk full');
    db.captureImportReceipts.hook('creating').unsubscribe(fail);
    expect(await db.captureAttachments.count()).toBe(1);
    await confirm(service, pkg, enrollments[0], actor); expect(await db.captureAttachments.count()).toBe(2);
  });
  it('measures full-backup UTF-8 bytes exactly and rolls back capacity failures for retry', async () => {
    await confirm(service, pkg, enrollments[1], actor, 'student-two');
    // Exercise pretty-print indentation and multibyte Unicode, not only base64.
    await db.students.update((await db.classEnrollments.get(enrollments[0]))!.studentId, { firstName: 'Fictional Élodie 雪' });
    const portability = new PortabilityService(db);
    const before = await portability.createFullBackupJSON();
    const beforeBytes = new TextEncoder().encode(before).length;
    const measured = await db.transaction('r', db.tables, () => backupCapacity.assertCaptureBackupCapacity(db));
    expect(measured).toBe(beforeBytes);
    const actualCheck = backupCapacity.assertCaptureBackupCapacity;
    const constrained = new CaptureAttachmentService(db, beforeBytes + 1);
    await expect(confirm(constrained, pkg, enrollments[0], actor)).rejects.toThrow('complete-backup limit');
    expect(() => new CaptureAttachmentService(db, backupCapacity.CAPTURE_BACKUP_MAX_BYTES + 1)).toThrow('Invalid complete-backup capacity');
    expect(await db.captureAttachments.count()).toBe(1);
    expect(await db.captureImportReceipts.count()).toBe(1);
    await confirm(service, pkg, enrollments[0], actor);
    expect(await db.captureAttachments.count()).toBe(2);
    const after = await portability.createFullBackupJSON();
    expect(await db.transaction('r', db.tables, () => actualCheck(db))).toBe(new TextEncoder().encode(after).length);
  });
  it('rejects stale epoch, revoked class access and dropped enrollment', async () => {
    setActiveTeacherId('user-tyler'); await expect(confirm(service, pkg, enrollments[0], actor)).rejects.toThrow('changed');
    actor.identityEpoch = getIdentityEpoch();
    await db.classEnrollments.update(enrollments[0], { enrollmentStatus: 'dropped' });
    await expect(confirm(service, pkg, enrollments[0], actor)).rejects.toThrow('no longer enrolled');
    await db.classSectionStaff.clear(); await expect(confirm(service, pkg, enrollments[1], actor)).rejects.toThrow('not assigned');
    expect(await db.captureAttachments.count()).toBe(0);
  });
  it('aborts identity switches during the final queued write', async () => {
    const switchIdentity = () => { setActiveTeacherId('fictional-other'); };
    db.captureImportReceipts.hook('creating', switchIdentity);
    await expect(confirm(service, pkg, enrollments[0], actor)).rejects.toThrow();
    db.captureImportReceipts.hook('creating').unsubscribe(switchIdentity);
    expect(await db.captureAttachments.count()).toBe(0); expect(await db.captureImportReceipts.count()).toBe(0);
  });
  async function markingFixture() {
    const marking = new MarkingService(db), markingActor = { userId: actor.userId, deviceId: actor.deviceId, epoch: actor.identityEpoch! };
    const rubric = await marking.saveRubric('assess-eng-essay', { title: 'Fictional capture rubric', levels: ['Developing', 'Secure'], criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'K', descriptors: { Developing: 'Some', Secure: 'Clear' } }] }, markingActor);
    const receipt = await confirm(service, pkg, enrollments[0], actor);
    return { marking, markingActor, rubric, receipt };
  }
  it('starts marking large saved photos for two of five students and preserves receipts across restart', async () => {
    for (const id of enrollments.slice(5)) await db.classEnrollments.update(id, { enrollmentStatus: 'dropped' });
    enrollments = (await service.context('assess-eng-essay', actor)).roster.map(row => row.enrollment.id);
    expect(enrollments).toHaveLength(5);
    // A valid one-pixel PNG with a 4 MiB ancillary chunk reproduces camera-sized
    // base64 without private photos or changing the decoded image dimensions.
    const png = Uint8Array.from(atob(PNG), c => c.charCodeAt(0));
    const chunk = new Uint8Array(4 * 1024 * 1024), view = new DataView(chunk.buffer);
    view.setUint32(0, chunk.length - 12); chunk.set(new TextEncoder().encode('tEXt'), 4);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
    const bytes = new Uint8Array(png.length + chunk.length);
    bytes.set(png.subarray(0, -12)); bytes.set(chunk, png.length - 12); bytes.set(png.subarray(-12), bytes.length - 12);
    const hash = await captureSha256(bytes);
    for (const submission of pkg.submissions) for (const page of submission.pages) {
      page.bytes = bytes; page.metadata.byteLength = bytes.length; page.metadata.sha256 = hash;
    }
    const official = await db.studentAssessments.toArray();
    const { marking, markingActor, rubric, receipt } = await markingFixture();
    const second = await confirm(service, pkg, enrollments[1], actor, 'student-two');
    const attachments = await db.captureAttachments.toArray(), receipts = await db.captureImportReceipts.toArray();
    for (const [index, saved] of [receipt, second].entries()) {
      const attempt = await marking.bindCaptureRoot(saved.attachmentId, { rubricId: rubric.id }, markingActor);
      expect(attempt.classEnrollmentId).toBe(enrollments[index]);
      expect(attempt.imagePages).toHaveLength(2);
      expect(attempt.imagePages!.every(page => page.hash === hash && page.size === bytes.length)).toBe(true);
      const session = await marking.openSession(attempt.id, markingActor);
      await marking.saveDraft(session.id, { ...session.draft, overallFeedback: 'Fictional retained draft' }, session.version, markingActor);
    }
    db.close(); await db.open();
    expect(await service.reconcile('assess-eng-essay', pkg, actor)).toEqual(expect.arrayContaining(receipts));
    const retained = await db.captureAttachments.toArray();
    expect(retained.map(row => ({ id: row.id, pages: row.pages, manifest: row.manifest }))).toEqual(attachments.map(row => ({ id: row.id, pages: row.pages, manifest: row.manifest })));
    expect(retained.every(row => !!row.markingAttemptId)).toBe(true);
    expect(await db.captureImportReceipts.toArray()).toEqual(receipts);
    expect(await db.markingAttempts.count()).toBe(2);
    expect((await db.markingSessions.toArray()).every(session => session.draft.overallFeedback === 'Fictional retained draft')).toBe(true);
    expect(await db.studentAssessments.toArray()).toEqual(official);
    expect(await db.markingCommits.count()).toBe(0);
  }, 60_000);
  it('explicitly starts capture marking then atomically appends originals while preserving draft feedback and rejecting stale editors', async () => {
    const { marking, markingActor, rubric, receipt } = await markingFixture();
    const originalReceipt = await db.captureImportReceipts.get(receipt.id);
    const originalAttachment = (await db.captureAttachments.get(receipt.attachmentId))!;
    const attempt = await marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, markingActor);
    let session = await marking.openSession(attempt.id, markingActor);
    session = await marking.saveDraft(session.id, { ...session.draft, overallFeedback: 'Keep my unfinished feedback', imageFeedback: session.draft.imageFeedback!.map((p, i) => i ? p : { ...p, annotations: [{ id: 'retained-comment', kind: 'comment', points: [{ x: .3, y: .4 }], color: 'red', width: .004, text: 'Keep this comment', criterionId: 'reason', level: 'Secure' }] }) }, session.version, markingActor);
    await expect(marking.appendCaptureSource(receipt.attachmentId, 'missing-source', attempt.version, {}, markingActor)).rejects.toThrow('atomic capture');
    const target = { rootAttachmentId: receipt.attachmentId, expectedAttemptVersion: attempt.version, sessionVersions: { [session.id]: session.version } };
    const corrupted = structuredClone(pkg); corrupted.submissions[1].pages[0].bytes[0] ^= 1;
    await expect(service.confirm('assess-eng-essay', corrupted, 'student-two', enrollments[0], actor, target)).rejects.toThrow('changed');
    await expect(service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, { ...target, sessionVersions: { [session.id]: session.version - 1 } })).rejects.toThrow('draft changed');
    const beforeOfficial = await db.studentAssessments.toArray();
    const fail = () => { throw new Error('Fictional late-page quota'); }; db.captureImportReceipts.hook('creating', fail);
    await expect(service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, target)).rejects.toThrow('quota');
    db.captureImportReceipts.hook('creating').unsubscribe(fail);
    expect(await db.markingAttempts.get(attempt.id)).toEqual(attempt);
    expect(await db.markingSessions.get(session.id)).toEqual(session);
    const added = await service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, target);
    expect(await service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, target)).toEqual(added);
    const updated = (await db.markingAttempts.get(attempt.id))!, draft = (await db.markingSessions.get(session.id))!;
    expect(updated.imagePages).toHaveLength(4); expect(updated.imagePages!.slice(0, 2)).toEqual(attempt.imagePages);
    expect(draft.draft.imageFeedback!.slice(0, 2)).toEqual(session.draft.imageFeedback);
    expect(draft.draft.overallFeedback).toBe('Keep my unfinished feedback'); expect(draft.draft.judgments).toEqual(session.draft.judgments);
    await expect(marking.saveDraft(session.id, session.draft, session.version, markingActor)).rejects.toThrow('changed');
    expect(await db.captureImportReceipts.get(receipt.id)).toEqual(originalReceipt);
    const retained = (await db.captureAttachments.get(receipt.attachmentId))!;
    expect(retained.pages).toEqual(originalAttachment.pages); expect(retained.manifest).toEqual(originalAttachment.manifest);
    expect(await db.studentAssessments.toArray()).toEqual(beforeOfficial); expect(await db.markingCommits.count()).toBe(0);
    expect((await service.groupedAttachment('assess-eng-essay', receipt.attachmentId, actor)).pages).toHaveLength(4);
    const portability = new PortabilityService(db), backup = await portability.createFullBackupJSON();
    await portability.restoreFromJSON(backup); expect((await db.markingAttempts.get(attempt.id))!.imagePages).toEqual(updated.imagePages);
    const corrupt = JSON.parse(backup); corrupt.tables.markingAttempts[0].captureSources[1].pageIds[0] = updated.imagePages![0].id;
    await expect(portability.restoreFromJSON(JSON.stringify(corrupt))).rejects.toThrow();
    await marking.archiveAttempt(attempt.id, updated.version, markingActor, false);
    await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect((await db.markingAttempts.get(attempt.id))!.imagePages).toEqual([]);
    expect((await db.captureAttachments.get(receipt.attachmentId))!.pages).toEqual(originalAttachment.pages);
    const afterArchive = structuredClone(pkg); afterArchive.manifest.packageId = 'after-archive';
    for (const page of afterArchive.manifest.submissions[1].pages) { page.id = `archive-${page.id}`; page.path = capturePagePath('student-two', page.id, page.mime); }
    await expect(service.confirm('assess-eng-essay', afterArchive, 'student-two', enrollments[0], actor, { ...target, expectedAttemptVersion: updated.version + 1 })).rejects.toThrow('Archived');
  });
  it('binds only an explicitly selected exact existing photo submission and refuses finalized, wrong enrollment, stale or archived targets', async () => {
    const { marking, markingActor, rubric, receipt } = await markingFixture();
    const source = (await db.captureAttachments.get(receipt.attachmentId))!;
    const { inspectMarkingImage } = await import('../marking/importImages');
    const pages = source.pages.map(p => ({ id: crypto.randomUUID(), name: p.metadata.path.split('/').pop()!, base64: p.base64, size: p.metadata.byteLength, hash: p.metadata.sha256, ...inspectMarkingImage(Uint8Array.from(atob(p.base64), c => c.charCodeAt(0))) }));
    const wrongStudent = await marking.importImageAttempt('assess-eng-essay', rubric.id, pages, enrollments[1], markingActor);
    await expect(marking.bindCaptureRoot(source.id, { attemptId: wrongStudent.id, expectedVersion: wrongStudent.version, sessionVersions: {} }, markingActor)).rejects.toThrow('exact assignment and enrollment');
    const manual = await marking.importImageAttempt('assess-eng-essay', rubric.id, pages, enrollments[0], markingActor);
    const session = await marking.openSession(manual.id, markingActor);
    await expect(marking.bindCaptureRoot(source.id, { attemptId: manual.id, expectedVersion: manual.version, sessionVersions: {} }, markingActor)).rejects.toThrow('draft changed');
    const linked = await marking.bindCaptureRoot(source.id, { attemptId: manual.id, expectedVersion: manual.version, sessionVersions: { [session.id]: session.version } }, markingActor);
    expect(linked.id).toBe(manual.id); expect(linked.imagePages).toEqual(manual.imagePages);
    await expect(marking.matchAttempt(linked.id, enrollments[1], linked.version, markingActor)).rejects.toThrow('cannot be reassigned');
    const current = (await db.markingSessions.get(session.id))!;
    const ready = await marking.saveDraft(current.id, { ...current.draft, judgments: current.draft.judgments.map(j => ({ ...j, assessed: true, rawScore: '3+', inputFormat: 'classroom_level' })) }, current.version, markingActor);
    await marking.finalize(ready.id, ready.version, markingActor);
    await expect(service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, { rootAttachmentId: source.id, expectedAttemptVersion: linked.version, sessionVersions: { [current.id]: current.version + 1 } })).rejects.toThrow('Finalized');
    expect(await db.captureAttachments.count()).toBe(1);
  });
  it('groups late sources without starting marking and rejects closed assignment append', async () => {
    const receipt = await confirm(service, pkg, enrollments[0], actor);
    await db.assessments.update('assess-eng-essay', { isLocked: true });
    await expect(service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, { rootAttachmentId: receipt.attachmentId })).rejects.toThrow('Locked');
    await db.assessments.update('assess-eng-essay', { isLocked: false });
    await service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[0], actor, { rootAttachmentId: receipt.attachmentId });
    expect(await db.markingAttempts.count()).toBe(0); expect((await service.lifecycle('assess-eng-essay', actor)).roots).toHaveLength(1);
    const portability = new PortabilityService(db); await portability.restoreFromJSON(await portability.createFullBackupJSON());
    expect((await service.groupedAttachment('assess-eng-essay', receipt.attachmentId, actor)).pages).toHaveLength(4);
  });
  it('rejects wrong teacher association and grouped page-count or original-byte overflow atomically', async () => {
    const { marking, markingActor, rubric, receipt } = await markingFixture();
    await expect(marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, { ...markingActor, userId: 'another-teacher' })).rejects.toThrow('teacher changed');
    for (let index = 0; index < 4; index++) {
      const next = structuredClone(pkg); next.manifest.packageId = `count-package-${index}`;
      for (const page of next.manifest.submissions[1].pages) { page.id = `count-${index}-${page.id}`; page.path = capturePagePath('student-two', page.id, page.mime); }
      await service.confirm('assess-eng-essay', next, 'student-two', enrollments[0], actor, { rootAttachmentId: receipt.attachmentId });
    }
    const collision = structuredClone(pkg); collision.manifest.packageId = 'collision-package';
    await expect(service.confirm('assess-eng-essay', collision, 'student-one', enrollments[0], actor, { rootAttachmentId: receipt.attachmentId })).rejects.toThrow('reuse an original page ID');
    const overflow = structuredClone(pkg); overflow.manifest.packageId = 'count-overflow';
    await expect(service.confirm('assess-eng-essay', overflow, 'student-two', enrollments[0], actor, { rootAttachmentId: receipt.attachmentId })).rejects.toThrow('at most 10 pages');
    expect((await service.groupedAttachment('assess-eng-essay', receipt.attachmentId, actor)).pages).toHaveLength(10);
    expect(await db.captureImportReceipts.count()).toBe(5);
    // Five valid PNG originals of 7 MiB each exercise the byte cap independently
    // of the ten-page cap. Ancillary text does not change the one-pixel image.
    const png = Uint8Array.from(atob(PNG), c => c.charCodeAt(0));
    const chunk = new Uint8Array(7 * 1024 * 1024), view = new DataView(chunk.buffer);
    view.setUint32(0, chunk.length - 12); chunk.set(new TextEncoder().encode('tEXt'), 4);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
    const bytes = new Uint8Array(png.length + chunk.length); bytes.set(png.subarray(0, -12)); bytes.set(chunk, png.length - 12); bytes.set(png.subarray(-12), bytes.length - 12);
    const hash = await captureSha256(bytes);
    const metadata = Array.from({ length: 5 }, (_, order) => ({ ...structuredClone(pkg.manifest.submissions[1].pages[0]), id: `large-${order}`, order, path: capturePagePath('student-two', `large-${order}`, 'image/png'), byteLength: bytes.length, sha256: hash }));
    const large: ParsedCapturePackage = { manifest: { ...pkg.manifest, packageId: 'bytes-overflow', submissions: [{ id: 'student-two', label: 'Fictional byte limit', pages: metadata }] }, submissions: [{ id: 'student-two', label: 'Fictional byte limit', pages: metadata.map(metadata => ({ metadata, bytes })) }] };
    const separate = await service.confirm('assess-eng-essay', pkg, 'student-two', enrollments[1], actor);
    await expect(service.confirm('assess-eng-essay', large, 'student-two', enrollments[1], actor, { rootAttachmentId: separate.attachmentId })).rejects.toThrow('32 MiB');
    expect(await db.captureImportReceipts.count()).toBe(6);
    expect((await service.groupedAttachment('assess-eng-essay', separate.attachmentId, actor)).pages).toHaveLength(2);
  // This checks real 35 MiB originals, hashes and transactional rollback, not a
  // latency target. Allow slower shared Intel CI runners without reducing data.
  }, 60_000);
  it('roundtrips attachments and receipts; rejects corrupt content and receipt scope before changing data', async () => {
    const receipt = await confirm(service, pkg, enrollments[0], actor); const portability = new PortabilityService(db);
    const json = await portability.createFullBackupJSON(); expect(JSON.parse(json).schemaVersion).toBe(5);
    for (const field of ['contentHash', 'classEnrollmentId']) {
      const corrupt = JSON.parse(json); corrupt.tables.captureImportReceipts[0][field] = 'wrong';
      await expect(portability.restoreFromJSON(JSON.stringify(corrupt))).rejects.toThrow();
      expect(await db.captureImportReceipts.get(receipt.id)).toEqual(receipt);
    }
    const corrupt = JSON.parse(json); corrupt.tables.captureAttachments[0].pages[0].metadata.sha256 = '0'.repeat(64);
    await expect(portability.restoreFromJSON(JSON.stringify(corrupt))).rejects.toThrow();
    await db.captureImportReceipts.clear(); await db.captureAttachments.clear(); await portability.restoreFromJSON(json);
    expect(await confirm(service, pkg, enrollments[0], actor)).toEqual(receipt);
    const legacy = JSON.parse(json); legacy.schemaVersion = 4; delete legacy.tables.captureAttachments; delete legacy.tables.captureImportReceipts;
    await portability.restoreFromJSON(JSON.stringify(legacy)); expect(await db.captureAttachments.count()).toBe(0); expect(await db.captureImportReceipts.count()).toBe(0);
  });
});
