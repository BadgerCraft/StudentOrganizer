import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { AuthorizationError } from '../services/authHelper';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { ConcurrencyConflictError, MarkbookDomainService, ValidationError } from '../services/markbookService';
import type { AssessmentCategory, ClassEnrollment } from '../types/schema';
import { MarkingService } from './markingService';
import type { MarkingActor, MarkingAttempt, MarkingDocument, MarkingDraft, MarkingImagePage, MarkingMode, MarkingRubric, MarkingVisualAnnotation, RubricContent } from './types';

const ASSESSMENT = 'fictional-modes-photo-assessment';
const SECTION = 'class-eng4u-01';
const TEACHER = 'user-tyler';
const OTHER_TEACHER = 'fictional-other-photo-marker';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Real, tiny PNGs keep the service's byte/signature/dimension checks meaningful.
function pngPage(name = 'fictional-page.png', shade = 150): MarkingImagePage {
  const chunk = (name: string, payload: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(name), payload]);
    let crc = 0xffffffff;
    for (const byte of typeAndData) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, typeAndData, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(3 * (1 + 4 * 4));
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      const offset = row * 17 + 1 + column * 4;
      pixels[offset] = shade; pixels[offset + 1] = shade; pixels[offset + 2] = shade; pixels[offset + 3] = 255;
    }
  }
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return { id: crypto.randomUUID(), name, mime: 'image/png', base64: bytes.toString('base64'), size: bytes.length, hash: digest(bytes), width: 4, height: 3 };
}

function writtenDocument(): MarkingDocument {
  const text = 'Fictional written evidence.';
  return { id: crypto.randomUUID(), name: 'fictional-written.txt', text, hash: digest(text), original: { name: 'fictional-written.txt', mime: 'text/plain', base64: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text), hash: digest(text) } };
}

function rubricContent(): RubricContent {
  return {
    title: 'Fictional customizable presentation rubric', levels: ['Practising', 'Clear', 'Convincing'],
    criteria: [
      { id: 'ideas', name: 'Explain ideas', categoryCode: 'K', descriptors: { Practising: 'Develop ideas.', Clear: 'Explain ideas clearly.', Convincing: 'Support ideas precisely.' } },
      { id: 'reasoning', name: 'Justify a conclusion', categoryCode: 'T', weight: 7, descriptors: { Practising: 'Give a reason.', Clear: 'Connect the reasoning.', Convincing: 'Weigh alternative explanations.' } }
    ]
  };
}

function visual(kind: MarkingVisualAnnotation['kind'] = 'pen'): MarkingVisualAnnotation {
  return { id: crypto.randomUUID(), kind, points: kind === 'comment' ? [{ x: 0.4, y: 0.6 }] : [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }], color: kind === 'highlight' ? 'yellow' : 'red', width: 0.01, text: kind === 'comment' ? 'Explain this fictional step.' : '', criterionId: 'reasoning', level: 'Clear' };
}

describe('Local marking modes and photographed-page integrity', () => {
  let db: OntarioTeacherDB;
  let service: MarkingService;
  let actor: MarkingActor;
  let rubric: MarkingRubric;
  let categories: AssessmentCategory[];
  let enrollments: ClassEnrollment[];

  beforeEach(async () => {
    clearActiveTeacherId();
    db = new OntarioTeacherDB(`fictional-modes-photo-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...template, id: ASSESSMENT, code: 'FICTIONAL-MODES-PHOTO', title: 'Fictional multimodal assessment' });
    categories = (await db.assessmentCategories.where('assessmentId').equals(template.id).toArray()).map(category => ({ ...category, id: `fictional-photo-${category.categoryCode}`, assessmentId: ASSESSMENT }));
    await db.assessmentCategories.bulkAdd(categories);
    enrollments = await db.classEnrollments.where('classSectionId').equals(SECTION).limit(2).toArray();
    const identity = await selectActingTeacher(db, TEACHER);
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    service = new MarkingService(db);
    rubric = await service.saveRubric(ASSESSMENT, rubricContent(), actor);
  });

  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });

  async function snapshot() {
    return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
  }

  async function official(enrollmentId = enrollments[0].id) {
    const studentAssessment = await db.studentAssessments.where({ assessmentId: ASSESSMENT, classEnrollmentId: enrollmentId }).first();
    return { studentAssessment, results: studentAssessment ? await db.categoryResults.where('studentAssessmentId').equals(studentAssessment.id).toArray() : [] };
  }

  async function create(mode: MarkingMode | 'photo', enrollmentId = enrollments[0].id): Promise<MarkingAttempt> {
    if (mode === 'photo') return service.importImageAttempt(ASSESSMENT, rubric.id, [pngPage(), pngPage('fictional-page-two.png', 70)], enrollmentId, actor);
    if (mode === 'written') return service.importAttempt(ASSESSMENT, rubric.id, [writtenDocument()], enrollmentId, null, actor);
    return service.createModeAttempt(ASSESSMENT, rubric.id, mode, enrollmentId, actor);
  }

  function evidence(draft: MarkingDraft, mode: MarkingMode | 'photo'): MarkingDraft {
    const content = structuredClone(draft);
    content.overallFeedback = 'Fictional private teacher feedback.';
    content.rubricFeedback = rubric.criteria.map(criterion => ({ criterionId: criterion.id, level: 'Convincing', feedback: `Fictional feedback for ${criterion.name}.` }));
    if (mode === 'oral') content.oral = { items: [{ id: 'fictional-eye-contact', label: 'Addresses the audience', checked: true, note: 'Fictional observation retained.' }, { id: 'fictional-support', label: 'Supports each claim', checked: false, note: '' }], notes: 'Fictional presentation notes.' };
    if (mode === 'photo') {
      content.imageFeedback![0].annotations = [visual('pen'), visual('highlight'), visual('comment')];
      content.imageFeedback![0].crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.7 };
      content.imageFeedback![0].rotation = 90;
      content.imageFeedback![1].rotation = 270;
      content.imageFeedback!.reverse();
    }
    return content;
  }

  async function saved(mode: MarkingMode | 'photo') {
    const attempt = await create(mode);
    const opened = await service.openSession(attempt.id, actor);
    const session = await service.saveDraft(opened.id, evidence(opened.draft, mode), opened.version, actor);
    return { attempt, session };
  }

  it.each(['written', 'oral', 'rubric', 'photo'] as const)('recovers %s evidence and exact retained originals after closing and reopening the database', async mode => {
    const beforeGrades = await official();
    const { attempt, session } = await saved(mode);
    const name = db.name;
    db.close(); db = new OntarioTeacherDB(name); service = new MarkingService(db);
    const context = await service.getContext(ASSESSMENT, actor);
    expect(context.attempts.find(row => row.id === attempt.id)).toEqual(attempt);
    expect(context.sessions.find(row => row.id === session.id)?.draft).toEqual(session.draft);
    expect((await service.openSession(attempt.id, actor)).id).toBe(session.id);
    expect(await official()).toEqual(beforeGrades);
    expect(await db.markingCommits.count()).toBe(0);
  });

  it('initializes private oral evidence, every rubric criterion and uncropped photographed pages without assigning grades', async () => {
    for (const mode of ['oral', 'rubric', 'photo'] as const) {
      const attempt = await create(mode);
      const session = await service.openSession(attempt.id, actor);
      expect(session.draft.rubricFeedback).toEqual(rubric.criteria.map(criterion => ({ criterionId: criterion.id, level: '', feedback: '' })));
      expect(session.draft.judgments.every(judgment => !judgment.assessed && judgment.rawScore === '')).toBe(true);
      expect(session.draft.annotations).toEqual([]);
      if (mode === 'oral') expect(session.draft.oral).toEqual({ items: [], notes: '' });
      if (mode === 'photo') expect(session.draft.imageFeedback).toEqual(attempt.imagePages!.map(page => ({ pageId: page.id, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] })));
    }
    expect(await official()).toEqual({ studentAssessment: undefined, results: [] });
  });

  it('reorders, crops and rotates page feedback while preserving original pixels and original-coordinate annotations', async () => {
    const { attempt, session } = await saved('photo');
    expect(session.draft.imageFeedback!.map(page => page.pageId)).toEqual(attempt.imagePages!.map(page => page.id).reverse());
    const content = structuredClone(session.draft);
    const page = content.imageFeedback!.find(page => page.pageId === attempt.imagePages![0].id)!;
    const originalAnnotations = structuredClone(page.annotations);
    page.rotation = 180; page.crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const next = await service.saveDraft(session.id, content, session.version, actor);
    expect(next.draft.imageFeedback!.find(page => page.pageId === attempt.imagePages![0].id)!.annotations).toEqual(originalAnnotations);
    expect((await db.markingAttempts.get(attempt.id))?.imagePages).toEqual(attempt.imagePages);
    for (const original of attempt.imagePages!) expect(digest(Buffer.from(original.base64, 'base64'))).toBe(original.hash);
    await expect(service.saveDraft(session.id, session.draft, session.version, actor)).rejects.toThrow(ConcurrencyConflictError);
    expect((await db.markingSessions.get(session.id))?.draft).toEqual(next.draft);
  });

  it('opens legacy written attempts and drafts with no mode or optional evidence fields', async () => {
    const attempt = await create('written');
    delete attempt.mode; delete attempt.imagePages;
    await db.markingAttempts.put(attempt);
    const session = await service.openSession(attempt.id, actor);
    const content = structuredClone(session.draft);
    delete content.rubricFeedback; delete content.imageFeedback; delete content.oral;
    const saved = await service.saveDraft(session.id, content, session.version, actor);
    expect((await service.openSession(attempt.id, actor)).draft).toEqual(saved.draft);
    expect((await db.markingAttempts.get(attempt.id))?.documents).toEqual(attempt.documents);
  });

  it.each(['https://example.invalid/student.png', 'data:image/png;base64,AA==', 'blob:fictional-photo', 'file:///fictional/student.png'])('rejects an image URL in retained bytes (%s) before writing anything', async url => {
    const page = { ...pngPage(), base64: url };
    const before = await snapshot();
    await expect(service.importImageAttempt(ASSESSMENT, rubric.id, [page], enrollments[0].id, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['hash', 'dimensions', 'signature', 'duplicate-page-id', 'empty-pages'] as const)('rejects %s in photographed-page imports without partial attempt or audit writes', async invalid => {
    const pages = [pngPage()];
    if (invalid === 'hash') pages[0].hash = '0'.repeat(64);
    if (invalid === 'dimensions') pages[0].width++;
    if (invalid === 'signature') {
      const bytes = Buffer.from('fictional text disguised as an image');
      Object.assign(pages[0], { base64: bytes.toString('base64'), size: bytes.length, hash: digest(bytes) });
    }
    if (invalid === 'duplicate-page-id') pages.push({ ...pngPage('fictional-second.png', 80), id: pages[0].id });
    if (invalid === 'empty-pages') pages.pop();
    const before = await snapshot();
    await expect(service.importImageAttempt(ASSESSMENT, rubric.id, pages, enrollments[0].id, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['unknown-page', 'missing-page', 'duplicate-page', 'crop-outside-original', 'invalid-rotation', 'invalid-point', 'unknown-criterion', 'unknown-level'] as const)('rejects %s draft evidence and preserves the saved image draft', async invalid => {
    const { session } = await saved('photo');
    const content = structuredClone(session.draft);
    const page = content.imageFeedback![1];
    if (invalid === 'unknown-page') page.pageId = 'fictional-unrelated-page';
    if (invalid === 'missing-page') content.imageFeedback!.pop();
    if (invalid === 'duplicate-page') content.imageFeedback![0] = structuredClone(page);
    if (invalid === 'crop-outside-original') page.crop = { x: 0.7, y: 0, width: 0.4, height: 1 };
    if (invalid === 'invalid-rotation') Object.assign(page, { rotation: 45 });
    if (invalid === 'invalid-point') page.annotations[0].points[0].x = Number.NaN;
    if (invalid === 'unknown-criterion') page.annotations[0].criterionId = 'fictional-unrelated-criterion';
    if (invalid === 'unknown-level') page.annotations[0].level = 'Advanced';
    const before = await snapshot();
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['oral', 'rubric'] as const)('rejects cross-mode image and text evidence on a %s attempt', async mode => {
    const { session } = await saved(mode);
    const before = await snapshot();
    const content = structuredClone(session.draft);
    content.imageFeedback = [{ pageId: 'fictional-unrelated-page', rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] }];
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    delete content.imageFeedback;
    content.annotations = [{ id: 'fictional-unrelated-annotation', documentId: 'fictional-no-document', start: 0, end: 1, quote: 'x', criterionId: 'ideas', level: 'Clear', text: '' }];
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['unknown-criterion', 'unknown-level', 'duplicate-criterion', 'missing-criterion'] as const)('rejects %s in criterion feedback without writing the rubric-only draft', async invalid => {
    const { session } = await saved('rubric');
    const content = structuredClone(session.draft);
    if (invalid === 'unknown-criterion') content.rubricFeedback![0].criterionId = 'fictional-unrelated-criterion';
    if (invalid === 'unknown-level') content.rubricFeedback![0].level = '4+';
    if (invalid === 'duplicate-criterion') content.rubricFeedback![1] = structuredClone(content.rubricFeedback![0]);
    if (invalid === 'missing-criterion') content.rubricFeedback!.pop();
    const before = await snapshot();
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it('retains custom checklist changes without deriving official judgments from checked items or rubric levels', async () => {
    const { session } = await saved('oral');
    const content = structuredClone(session.draft);
    content.oral!.items.reverse();
    content.oral!.items[0].label = 'Responds thoughtfully to questions';
    content.oral!.items[0].checked = true;
    content.oral!.items[0].note = 'Fictional revised observation.';
    const next = await service.saveDraft(session.id, content, session.version, actor);
    expect(next.draft.oral).toEqual(content.oral);
    expect(next.draft.judgments).toEqual(session.draft.judgments);
    expect(await official()).toEqual({ studentAssessment: undefined, results: [] });
  });

  it.each(['duplicate-item', 'implicit-status'] as const)('rejects %s in an oral checklist without losing the private saved notes', async invalid => {
    const { session } = await saved('oral');
    const content = structuredClone(session.draft);
    if (invalid === 'duplicate-item') content.oral!.items[1].id = content.oral!.items[0].id;
    if (invalid === 'implicit-status') Object.assign(content.oral!.items[0], { checked: 'yes' });
    const before = await snapshot();
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['rubric', 'written', 'photo'] as const)('rejects presentation evidence attached to a %s attempt', async mode => {
    const { session } = await saved(mode);
    const content = structuredClone(session.draft);
    content.oral = { items: [], notes: 'Fictional presentation notes attached to the wrong mode.' };
    const before = await snapshot();
    await expect(service.saveDraft(session.id, content, session.version, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
  });

  it('keeps unmatched photographs local until a student is deliberately selected', async () => {
    const attempt = await service.importImageAttempt(ASSESSMENT, rubric.id, [pngPage()], null, actor);
    const before = await snapshot();
    await expect(service.openSession(attempt.id, actor)).rejects.toThrow(ValidationError);
    expect(await snapshot()).toEqual(before);
    const matched = await service.matchAttempt(attempt.id, enrollments[0].id, attempt.version, actor);
    expect(matched.imagePages).toEqual(attempt.imagePages);
    expect((await service.openSession(attempt.id, actor)).attemptId).toBe(attempt.id);
  });

  it('prevents another authorized co-teacher and a stale identity from accessing private mode evidence or importing photos', async () => {
    const photo = await saved('photo');
    const oral = await saved('oral');
    const template = (await db.users.get(TEACHER))!;
    await db.users.add({ ...template, id: OTHER_TEACHER, authSubject: OTHER_TEACHER, email: 'fictional-other-photo@example.invalid', name: 'Fictional Other Photo Marker' });
    const membership = (await db.organizationMemberships.where('userId').equals(TEACHER).first())!;
    await db.organizationMemberships.add({ ...membership, id: 'fictional-other-photo-membership', userId: OTHER_TEACHER });
    const staff = (await db.classSectionStaff.where('classSectionId').equals(SECTION).first())!;
    await db.classSectionStaff.add({ ...staff, id: 'fictional-other-photo-staff', organizationMembershipId: 'fictional-other-photo-membership', role: 'co_teacher' });
    const identity = await selectActingTeacher(db, OTHER_TEACHER);
    const other = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    const before = await snapshot();
    expect((await service.getContext(ASSESSMENT, other)).attempts).toEqual([]);
    for (const { attempt, session } of [photo, oral]) {
      await expect(service.openSession(attempt.id, other)).rejects.toThrow(AuthorizationError);
      await expect(service.saveDraft(session.id, session.draft, session.version, other)).rejects.toThrow(AuthorizationError);
      await expect(service.finalize(session.id, session.version, other)).rejects.toThrow(AuthorizationError);
    }
    await expect(service.createModeAttempt(ASSESSMENT, rubric.id, 'rubric', enrollments[0].id, other)).rejects.toThrow(AuthorizationError);
    await expect(service.importImageAttempt(ASSESSMENT, rubric.id, [pngPage()], enrollments[0].id, other)).rejects.toThrow(AuthorizationError);
    await expect(service.createModeAttempt(ASSESSMENT, rubric.id, 'oral', enrollments[0].id, actor)).rejects.toThrow(AuthorizationError);
    await expect(service.importImageAttempt(ASSESSMENT, rubric.id, [pngPage()], enrollments[0].id, actor)).rejects.toThrow(AuthorizationError);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['oral', 'rubric', 'photo'] as const)('finalizes %s judgments idempotently and preserves manual course overrides and grade identities through revisions', async mode => {
    const { attempt, session } = await saved(mode);
    const assessment = (await db.assessments.get(ASSESSMENT))!;
    await new MarkbookDomainService(db).saveGradeOverride({ classEnrollmentId: enrollments[0].id, reportingPeriodId: assessment.reportingPeriodId, categoryCode: 'OVERALL', overridePercentage: 82, rationale: 'Fictional teacher override.', userId: actor.userId, deviceId: actor.deviceId });
    const overrides = await db.gradeOverrides.toArray();
    const otherStudent = await official(enrollments[1].id);
    const content = structuredClone(session.draft);
    const judgment = content.judgments.find(judgment => judgment.assessmentCategoryId === categories.find(category => category.categoryCode === 'K')!.id)!;
    Object.assign(judgment, { assessed: true, rawScore: '4+', inputFormat: 'scale_code', feedback: 'Fictional independent K judgment.' });
    const ready = await service.saveDraft(session.id, content, session.version, actor);
    const commit = await service.finalize(ready.id, ready.version, actor);
    const first = await official();
    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({ rawScore: '4+', normalizedPercentage: 95 });
    expect(commit.draft).toEqual(content);
    const afterFirst = await snapshot();
    expect(await service.finalize(ready.id, ready.version, actor)).toEqual(commit);
    expect(await snapshot()).toEqual(afterFirst);
    const revision = await service.openSession(attempt.id, actor);
    expect(revision.draft).toEqual(content);
    const revised = structuredClone(revision.draft);
    revised.judgments.find(judgment => judgment.assessed)!.rawScore = '3-';
    const savedRevision = await service.saveDraft(revision.id, revised, revision.version, actor);
    const nextCommit = await service.finalize(savedRevision.id, savedRevision.version, actor);
    const next = await official();
    expect(nextCommit.previousCommitId).toBe(commit.id);
    expect(next.studentAssessment?.id).toBe(first.studentAssessment?.id);
    expect(next.results.map(result => result.id)).toEqual(first.results.map(result => result.id));
    expect(next.results[0].rawScore).toBe('3-');
    expect(await db.markingCommits.get(commit.id)).toEqual(commit);
    expect(await db.gradeOverrides.toArray()).toEqual(overrides);
    expect(await official(enrollments[1].id)).toEqual(otherStudent);
    const audit = await db.auditEntries.where('entityId').equals(next.results[0].id).toArray();
    expect(audit.some(entry => entry.action === 'INSERT' && entry.userId === TEACHER)).toBe(true);
    expect(audit.some(entry => entry.action === 'UPDATE' && entry.userId === TEACHER)).toBe(true);
  });

  it('rolls back photographed-page import when its audit record cannot be persisted', async () => {
    const before = await snapshot();
    const fail = () => { throw new Error('Fictional photo audit failure'); };
    db.auditEntries.hook('creating', fail);
    try {
      await expect(service.importImageAttempt(ASSESSMENT, rubric.id, [pngPage()], enrollments[0].id, actor)).rejects.toThrow('photo audit failure');
    } finally { db.auditEntries.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
  });

  it.each(['oral', 'rubric', 'photo'] as const)('preserves the last saved %s draft when its audit write fails', async mode => {
    const { session } = await saved(mode);
    const before = await snapshot();
    const fail = () => { throw new Error('Fictional mode audit failure'); };
    db.auditEntries.hook('creating', fail);
    try {
      await expect(service.saveDraft(session.id, { ...session.draft, overallFeedback: 'Fictional unsaved edit.' }, session.version, actor)).rejects.toThrow('mode audit failure');
    } finally { db.auditEntries.hook('creating').unsubscribe(fail); }
    expect(await snapshot()).toEqual(before);
  });

  it.each(['storage-failure', 'identity-revoked'] as const)('atomically rolls back photo finalization after grade writes on %s', async boundary => {
    const { session } = await saved('photo');
    const content = structuredClone(session.draft);
    Object.assign(content.judgments[0], { assessed: true, rawScore: '3', inputFormat: 'scale_code' });
    const ready = await service.saveDraft(session.id, content, session.version, actor);
    const before = await snapshot();
    let reachedCommit = false;
    const fail = () => {
      reachedCommit = true;
      if (boundary === 'storage-failure') throw new Error('Fictional photo commit failure');
      setActiveTeacherId(OTHER_TEACHER); setActiveTeacherId(TEACHER);
    };
    db.markingCommits.hook('creating', fail);
    try { await expect(service.finalize(ready.id, ready.version, actor)).rejects.toThrow(); }
    finally { db.markingCommits.hook('creating').unsubscribe(fail); }
    expect(reachedCommit).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});
