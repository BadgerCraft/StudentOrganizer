import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { MarkingService } from './markingService';
import { parseMarkingFiles, sha256 } from './importDocuments';
import { archiveDraft } from './archive';
import type { MarkingActor, MarkingAttempt } from './types';

const ASSESSMENT = 'fictional-archive';
const SOURCE = 'UNIQUE_FICTIONAL_STUDENT_SOURCE_TO_REMOVE';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

describe('minimal marking archive and deliberate student-work retention', () => {
  let db: OntarioTeacherDB, service: MarkingService, actor: MarkingActor;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`fictional-archive-${crypto.randomUUID()}`); await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...template, id: ASSESSMENT, code: 'ARCHIVE' });
    await db.assessmentCategories.bulkAdd((await db.assessmentCategories.where('assessmentId').equals(template.id).toArray()).map(c => ({ ...c, id: `archive-${c.categoryCode}`, assessmentId: ASSESSMENT })));
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() }; service = new MarkingService(db);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  async function snapshot() {
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, (await table.toArray()).sort((a, b) => a.id.localeCompare(b.id))])));
  }
  async function fixture(photo = false, annotationId?: string) {
    const rubric = await service.saveRubric(ASSESSMENT, { title: 'Fictional archived rubric', levels: ['3'], criteria: [{ id: 'reason', name: 'Reasoning', categoryCode: 'T', descriptors: { '3': 'Support ideas.' } }] }, actor);
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    let attempt: MarkingAttempt;
    if (photo) {
      const bytes = Uint8Array.from(atob(PNG), c => c.charCodeAt(0));
      attempt = await service.importImageAttempt(ASSESSMENT, rubric.id, [{ id: 'fictional-page', name: 'fictional.png', mime: 'image/png', base64: PNG, size: bytes.length, hash: await sha256(bytes), width: 1, height: 1 }], enrollment.id, actor);
    } else {
      const documents = (await parseMarkingFiles([new File([SOURCE], 'fictional.txt')])).documents;
      attempt = await service.importAttempt(ASSESSMENT, rubric.id, documents, enrollment.id, null, actor);
    }
    const session = await service.openSession(attempt.id, actor);
    session.draft.overallFeedback = 'Fictional overall teacher feedback.';
    const category = session.draft.judgments.find(j => j.assessmentCategoryId === 'archive-T')!;
    Object.assign(category, { assessed: true, rawScore: '3', feedback: 'Fictional category feedback.' });
    session.draft.rubricFeedback = [{ criterionId: 'reason', level: '3', feedback: 'Fictional criterion feedback.' }];
    if (photo) session.draft.imageFeedback![0].annotations = [{ id: annotationId ?? 'fictional-image-comment', kind: 'comment', points: [{ x: .3, y: .7 }], color: 'red', width: .01, text: 'Fictional passage comment.', criterionId: 'reason', level: '3' }];
    else session.draft.annotations = [{ id: annotationId ?? 'fictional-comment', documentId: attempt.documents[0].id, start: 0, end: SOURCE.length, quote: SOURCE, criterionId: 'reason', level: '3', text: 'Fictional passage comment.' }];
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    const commit = await service.finalize(saved.id, saved.version, actor);
    return { attempt, rubric, enrollment, commit };
  }
  it.each([false, true])('keeps maximum-length valid %s annotation IDs recoverable after archival', async photo => {
    const f = await fixture(photo, 'x'.repeat(200));
    const portability = new PortabilityService(db);
    const beforeArchive = await portability.createFullBackupJSON();
    expect(() => portability.validateBackupJSON(beforeArchive)).not.toThrow();
    await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    const backup = await portability.createFullBackupJSON();
    expect(() => portability.validateBackupJSON(backup)).not.toThrow();
    await portability.restoreFromJSON(backup);
    expect((await db.markingCommits.get(f.commit.id))?.draft.archivedFeedback?.[0].text).toBe('Fictional passage comment.');
  });
  it('preserves existing archived feedback IDs without collisions and produces deterministic snapshots', async () => {
    const f = await fixture();
    const draft = { ...f.commit.draft, archivedFeedback: [{ id: 'text:0', criterionId: 'reason', level: '3', text: 'Fictional previously retained feedback.' }] };
    const archivedDraft = archiveDraft(draft);
    const feedback = archivedDraft.archivedFeedback!;
    expect(new Set(feedback.map(comment => comment.id)).size).toBe(feedback.length);
    expect(feedback[0]).toEqual(draft.archivedFeedback[0]);
    expect(feedback.map(comment => comment.text)).toContain('Fictional passage comment.');
    expect(archiveDraft(draft)).toEqual(archivedDraft);
  });
  it.each([false, true])('purges %s source and anchors from live rows and audit snapshots while preserving feedback, rubric and official grades', async photo => {
    const f = await fixture(photo);
    const revision = await service.openSession(f.attempt.id, actor);
    const studentsBefore = await db.students.toArray();
    const resultsBefore = await db.categoryResults.toArray();
    const gradesBefore = await db.studentAssessments.toArray();
    const archived = await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    expect(archived).toMatchObject({ documents: [], imagePages: [], keepStudentWork: false, deletedAt: null });
    expect(archived.archivedAt).toBeTruthy();
    const context = await service.getContext(ASSESSMENT, actor);
    expect(context.attempts).toEqual([]); expect(context.archivedAttempts).toEqual([archived]);
    expect(context.sessions).toHaveLength(2); expect(context.commits).toHaveLength(1);
    for (const row of [...context.sessions, ...context.commits]) {
      expect(row.draft.annotations).toEqual([]); expect(row.draft.pending).toBeNull(); expect(row.draft.imageFeedback).toBeUndefined();
      expect(row.draft.archivedFeedback).toEqual([expect.objectContaining({ text: 'Fictional passage comment.', criterionId: 'reason', level: '3' })]);
      expect(row.draft.overallFeedback).toBe(f.commit.draft.overallFeedback);
      expect(row.draft.judgments).toEqual(f.commit.draft.judgments);
    }
    const json = await new PortabilityService(db).createFullBackupJSON();
    expect(json).not.toContain(SOURCE); expect(json).not.toContain(Buffer.from(SOURCE).toString('base64')); expect(json).not.toContain(PNG);
    expect(await db.students.toArray()).toEqual(studentsBefore); expect(await db.categoryResults.toArray()).toEqual(resultsBefore); expect(await db.studentAssessments.toArray()).toEqual(gradesBefore);
    expect(await db.markingRubrics.get(f.rubric.id)).toEqual(f.rubric);
    expect((await service.exportContext(f.commit.id, actor)).attempt.id).toBe(archived.id);
    for (const action of [() => service.openSession(archived.id, actor), () => service.saveDraft(revision.id, revision.draft, revision.version, actor), () => service.finalize(revision.id, revision.version, actor), () => service.setKeepStudentWork(archived.id, archived.version, true, actor)]) await expect(action()).rejects.toThrow();
    const after = await snapshot(); expect(await service.archiveAttempt(f.attempt.id, f.attempt.version, actor)).toEqual(archived); expect(await snapshot()).toEqual(after);
    const other = new OntarioTeacherDB(`fictional-archive-restore-${crypto.randomUUID()}`);
    try { await new PortabilityService(other).restoreFromJSON(json); expect(await other.markingAttempts.get(archived.id)).toEqual(archived); expect(await other.markingCommits.get(f.commit.id)).toEqual(context.commits[0]); }
    finally { await other.delete(); }
  });
  it('redacts retained outbox payloads and audit diffs without removing transaction metadata', async () => {
    const f = await fixture();
    const timestamp = new Date().toISOString();
    const mutation = { id: 'fictional-marking-outbox', deviceId: actor.deviceId, organizationId: (await db.organizations.toArray())[0].id, mutationId: crypto.randomUUID(), transactionId: crypto.randomUUID(), sequenceNumber: 1, transactionSize: 1, entityName: 'markingAttempts', entityId: f.attempt.id, operation: 'UPDATE' as const, payloadJson: JSON.stringify(f.attempt), baseVersion: 1, status: 'pending' as const, createdAt: timestamp, attemptCount: 0, lastAttemptAt: null, lastError: SOURCE, acknowledgedAt: null };
    await db.syncMutations.add(mutation);
    const audit = (await db.auditEntries.where('entityId').equals(f.attempt.id).first())!;
    await db.auditEntries.update(audit.id, { diffJson: JSON.stringify({ text: SOURCE }) });
    await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    const stored = (await db.syncMutations.get(mutation.id))!;
    expect(stored).toMatchObject({ transactionId: mutation.transactionId, sequenceNumber: 1, status: 'pending', lastError: null });
    expect(JSON.parse(stored.payloadJson)).toMatchObject({ documents: [], imagePages: [], keepStudentWork: false });
    expect((await db.auditEntries.get(audit.id))?.diffJson).toBeNull();
    expect(await new PortabilityService(db).createFullBackupJSON()).not.toContain(SOURCE);
  });
  it('preserves an in-progress edit of an existing comment once and restores its archive', async () => {
    const f = await fixture();
    const session = await service.openSession(f.attempt.id, actor);
    session.draft.pending = { ...session.draft.annotations[0], text: 'Fictional pending edited feedback.' };
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    const archivedSession = (await db.markingSessions.get(saved.id))!;
    expect(archivedSession.draft.archivedFeedback).toHaveLength(1);
    expect(archivedSession.draft.archivedFeedback![0].text).toBe('Fictional pending edited feedback.');
    const json = await new PortabilityService(db).createFullBackupJSON();
    await new PortabilityService(db).restoreFromJSON(json);
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(archivedSession.draft);
  });
  it('stores the export retention choice without deleting work, and keeps originals and markup only when opted in', async () => {
    const f = await fixture(true);
    const changed = await service.setKeepStudentWork(f.attempt.id, f.attempt.version, true, actor);
    expect(changed.imagePages).toEqual(f.attempt.imagePages);
    const archived = await service.archiveAttempt(changed.id, changed.version, actor);
    expect(archived.keepStudentWork).toBe(true); expect(archived.imagePages).toEqual(f.attempt.imagePages);
    expect((await db.markingCommits.get(f.commit.id))?.draft).toEqual(f.commit.draft);
    const backup = await new PortabilityService(db).createFullBackupJSON(); expect(backup).toContain(PNG);
    await new PortabilityService(db).restoreFromJSON(backup);
    expect((await service.getContext(ASSESSMENT, actor)).archivedAttempts).toEqual([archived]);
  });
  it.each(['audit failure', 'identity change'])('rolls back source redaction and all related history on %s', async boundary => {
    const f = await fixture(); const before = await snapshot();
    const fail = () => { if (boundary === 'identity change') setActiveTeacherId('fictional-other'); else throw new Error('Fictional archive audit failure'); };
    db.auditEntries.hook('creating', fail);
    try { await expect(service.archiveAttempt(f.attempt.id, f.attempt.version, actor)).rejects.toThrow(); }
    finally { db.auditEntries.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
  });
  it('rejects stale versions and lost teacher access before removing anything', async () => {
    const f = await fixture();
    await service.setKeepStudentWork(f.attempt.id, f.attempt.version, true, actor);
    const before = await snapshot();
    await expect(service.archiveAttempt(f.attempt.id, f.attempt.version, actor)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
    await db.organizationMemberships.where('userId').equals(actor.userId).modify({ status: 'suspended' });
    const revoked = await snapshot();
    await expect(service.archiveAttempt(f.attempt.id, f.attempt.version + 1, actor)).rejects.toThrow(); expect(await snapshot()).toEqual(revoked);
  });
  it('discovers former-student drafts and finished attempts without writes or reenrollment', async () => {
    const f = await fixture();
    const revision = await service.openSession(f.attempt.id, actor);
    await db.classEnrollments.update(f.enrollment.id, { enrollmentStatus: 'dropped' });
    const before = await snapshot();
    for (let repeat = 0; repeat < 2; repeat++) {
      const context = await service.getContext(ASSESSMENT, actor);
      expect(context.historicalAttempts).toEqual([f.attempt]);
      expect(context.attempts).toEqual([]);
      expect(context.sessions.map(row => row.id)).toContain(revision.id);
      expect(context.commits.map(row => row.id)).toContain(f.commit.id);
      expect((await service.exportContext(f.commit.id, actor)).student.id).toBe(f.enrollment.studentId);
    }
    await expect(service.openSession(f.attempt.id, actor)).rejects.toThrow('active student enrollment');
    await expect(service.saveDraft(revision.id, revision.draft, revision.version, actor)).rejects.toThrow('active student enrollment');
    await expect(service.finalize(revision.id, revision.version, actor)).rejects.toThrow('active student enrollment');
    await expect(service.matchAttempt(f.attempt.id, f.enrollment.id, f.attempt.version, actor)).rejects.toThrow('active student enrollment');
    expect(await snapshot()).toEqual(before);
    const backup = await new PortabilityService(db).createFullBackupJSON();
    await new PortabilityService(db).restoreFromJSON(backup);
    expect((await service.getContext(ASSESSMENT, actor)).historicalAttempts).toEqual([f.attempt]);
    await db.organizationMemberships.where('userId').equals(actor.userId).modify({ status: 'suspended' });
    await expect(service.getContext(ASSESSMENT, actor)).rejects.toThrow();
  });
  it('does not expose former-student work through an invalid school or deleted enrollment link', async () => {
    const f = await fixture();
    await db.classEnrollments.update(f.enrollment.id, { enrollmentStatus: 'dropped' });
    const student = (await db.students.get(f.enrollment.studentId))!;
    await db.students.update(f.enrollment.studentId, { organizationId: 'another-school' });
    expect((await service.getContext(ASSESSMENT, actor)).historicalAttempts).toEqual([]);
    await db.students.update(f.enrollment.studentId, { organizationId: student.organizationId });
    expect((await service.getContext(ASSESSMENT, actor)).historicalAttempts).toEqual([f.attempt]);
    await db.classEnrollments.update(f.enrollment.id, { deletedAt: new Date().toISOString() });
    expect((await service.getContext(ASSESSMENT, actor)).historicalAttempts).toEqual([]);
  });
  it('archives historical work after enrollment becomes inactive and the assessment is locked', async () => {
    const f = await fixture();
    await db.classEnrollments.update(f.enrollment.id, { enrollmentStatus: 'dropped' });
    await db.assessments.update(ASSESSMENT, { isLocked: true });
    const archived = await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    const context = await service.getContext(ASSESSMENT, actor);
    expect(context.archivedAttempts).toEqual([archived]);
    expect(context.historicalEnrollments?.find(row => row.id === f.enrollment.id)?.enrollmentStatus).toBe('dropped');
    expect(context.enrollments.some(row => row.id === f.enrollment.id)).toBe(false);
    expect((await service.exportContext(f.commit.id, actor)).student.id).toBe(f.enrollment.studentId);
  });
});
