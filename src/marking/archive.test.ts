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
    for (const row of [...context.sessions.filter(row => row.status === 'finalized'), ...context.commits]) {
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
  it.each([[false, false], [false, true], [true, false], [true, true]])('discards unpublished edits at archive, including backup history (keep source %s, photo %s)', async (keep, photo) => {
    const f = await fixture(photo);
    const session = await service.openSession(f.attempt.id, actor);
    if (photo) session.draft.imageFeedback![0].annotations[0].text = 'UNPUBLISHED_PHOTO_EDIT';
    else session.draft.pending = { ...session.draft.annotations[0], text: 'Fictional pending edited feedback.' };
    session.draft.overallFeedback = 'UNPUBLISHED_OVERALL';
    session.draft.judgments[0].feedback = 'UNPUBLISHED_CATEGORY';
    session.draft.rubricFeedback![0].feedback = 'UNPUBLISHED_CRITERION';
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(saved.draft);
    await service.archiveAttempt(f.attempt.id, f.attempt.version, actor, keep);
    const archivedSession = (await db.markingSessions.get(saved.id))!;
    expect(archivedSession.draft.overallFeedback).toBe('');
    expect(archivedSession.draft.pending).toBeNull();
    expect(archivedSession.draft.annotations).toEqual([]);
    expect(archivedSession.retainedCategoryJudgments).toEqual([]);
    const json = await new PortabilityService(db).createFullBackupJSON();
    expect(json).not.toContain('UNPUBLISHED_');
    expect(json).not.toContain('Fictional pending edited feedback.');
    expect((await service.exportContext(f.commit.id, actor)).commit.draft.overallFeedback).toBe(f.commit.draft.overallFeedback);
    await new PortabilityService(db).restoreFromJSON(json);
    expect((await db.markingSessions.get(saved.id))?.draft).toEqual(archivedSession.draft);
  });
  it.each(['text', 'photo', 'oral'] as const)('discards draft-only %s work and restores a valid empty archive in both retention modes', async mode => {
    const f = await fixture(mode === 'photo');
    for (const keep of [false, true]) {
      const attempt = mode === 'oral'
        ? await service.createModeAttempt(ASSESSMENT, f.rubric.id, 'oral', f.enrollment.id, actor)
        : mode === 'photo'
          ? await service.importImageAttempt(ASSESSMENT, f.rubric.id, f.attempt.imagePages!, null, actor)
          : await service.importAttempt(ASSESSMENT, f.rubric.id, (await parseMarkingFiles([new File([`Fictional source ${keep}`], 'draft.txt')])).documents, null, null, actor);
      const matched = attempt.classEnrollmentId ? attempt : await service.matchAttempt(attempt.id, f.enrollment.id, attempt.version, actor);
      const session = await service.openSession(matched.id, actor);
      session.draft.overallFeedback = 'UNPUBLISHED_DRAFT_ONLY';
      if (session.draft.oral) session.draft.oral = { notes: 'UNPUBLISHED_OBSERVATION', items: [{ id: 'item', label: 'UNPUBLISHED_ITEM', checked: true, note: 'UNPUBLISHED_NOTE' }] };
      if (session.draft.imageFeedback) session.draft.imageFeedback[0].annotations = [{ id: 'draft-photo', kind: 'comment', points: [{ x: .5, y: .5 }], color: 'red', width: .01, text: 'UNPUBLISHED_PHOTO', criterionId: null, level: '' }];
      const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
      expect((await db.markingSessions.get(saved.id))?.draft).toEqual(saved.draft);
      const officialBefore = await db.categoryResults.toArray();
      const archived = await service.archiveAttempt(matched.id, matched.version, actor, keep);
      const afterFirst = await snapshot();
      expect(await service.archiveAttempt(matched.id, matched.version, actor, keep)).toEqual(archived);
      expect(await snapshot()).toEqual(afterFirst);
      expect(await db.categoryResults.toArray()).toEqual(officialBefore);
      const backup = await new PortabilityService(db).createFullBackupJSON();
      expect(backup).not.toContain('UNPUBLISHED_');
      await new PortabilityService(db).restoreFromJSON(backup);
      expect((await db.markingSessions.get(saved.id))?.draft.overallFeedback).toBe('');
    }
  });
  it.each([false, true])('retains published oral observations, discarding subsequent unpublished oral edits (keep %s)', async keep => {
    const f = await fixture();
    const attempt = await service.createModeAttempt(ASSESSMENT, f.rubric.id, 'oral', f.enrollment.id, actor);
    const session = await service.openSession(attempt.id, actor);
    session.draft.judgments = structuredClone(f.commit.draft.judgments);
    session.draft.oral = { notes: 'Published oral observation', items: [{ id: 'item', label: 'Published skill', checked: true, note: 'Published note' }] };
    const saved = await service.saveDraft(session.id, session.draft, session.version, actor);
    const commit = await service.finalize(saved.id, saved.version, actor);
    const revision = await service.openSession(attempt.id, actor);
    revision.draft.oral!.notes = 'UNPUBLISHED_ORAL_REVISION';
    revision.draft.oral!.items[0].note = 'UNPUBLISHED_ORAL_ITEM';
    await service.saveDraft(revision.id, revision.draft, revision.version, actor);
    await service.archiveAttempt(attempt.id, attempt.version, actor, keep);
    const backup = await new PortabilityService(db).createFullBackupJSON();
    expect(backup).not.toContain('UNPUBLISHED_');
    await new PortabilityService(db).restoreFromJSON(backup);
    expect((await service.exportContext(commit.id, actor)).commit.draft.oral).toEqual(commit.draft.oral);
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
  it('leaves another active attempt and its unfinished audit history unchanged', async () => {
    const f = await fixture();
    const other = await service.createModeAttempt(ASSESSMENT, f.rubric.id, 'oral', f.enrollment.id, actor);
    const draft = await service.openSession(other.id, actor);
    draft.draft.overallFeedback = 'Fictional active draft to preserve';
    const saved = await service.saveDraft(draft.id, draft.draft, draft.version, actor);
    const history = await db.auditEntries.where('entityId').equals(saved.id).toArray();
    await service.archiveAttempt(f.attempt.id, f.attempt.version, actor);
    expect(await db.markingSessions.get(saved.id)).toEqual(saved);
    expect(await db.auditEntries.where('entityId').equals(saved.id).toArray()).toEqual(history);
    expect(await db.markingAttempts.get(other.id)).toEqual(other);
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
