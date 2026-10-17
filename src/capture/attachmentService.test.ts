import 'fake-indexeddb/auto';
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
  });
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
