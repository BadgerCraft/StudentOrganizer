import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from '../services/portabilityService';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { MarkingService } from './markingService';
import { parseMarkingFiles, sha256 } from './importDocuments';
import type { MarkingActor, MarkingImagePage, MarkingSession } from './types';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

describe('atomic recovery of all marking modes and original photographs', () => {
  let db: OntarioTeacherDB, service: MarkingService, portability: PortabilityService, actor: MarkingActor;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`modes-photo-backup-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const template = (await db.assessments.get('assess-eng-essay'))!;
    await db.assessments.add({ ...template, id: 'modes-recovery', code: 'MODES' });
    const categories = await db.assessmentCategories.where('assessmentId').equals(template.id).toArray();
    await db.assessmentCategories.bulkAdd(categories.map(category => ({ ...category, id: `modes-${category.categoryCode}`, assessmentId: 'modes-recovery' })));
    const identity = await selectActingTeacher(db, 'user-tyler');
    actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    service = new MarkingService(db);
    portability = new PortabilityService(db);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });

  async function fixture() {
    const rubric = await service.saveRubric('modes-recovery', { title: 'Fictional evidence rubric', levels: ['3'], criteria: [
      { id: 'reason', name: 'Reasoning', categoryCode: 'T', descriptors: { '3': 'Supports the claim.' } },
      { id: 'communication', name: 'Communication', categoryCode: 'C', descriptors: { '3': 'Explains the claim clearly.' } },
    ] }, actor);
    const enrollment = (await db.classEnrollments.where('classSectionId').equals('class-eng4u-01').first())!;
    const bytes = Uint8Array.from(atob(PNG), value => value.charCodeAt(0));
    const page: MarkingImagePage = { id: 'first-page', name: 'Fictional-first.png', mime: 'image/png', base64: PNG, size: bytes.length, hash: await sha256(bytes), width: 1, height: 1 };
    const photos = await service.importImageAttempt('modes-recovery', rubric.id, [page, { ...page, id: 'second-page', name: 'Fictional-second.png' }], enrollment.id, actor);
    const oral = await service.createModeAttempt('modes-recovery', rubric.id, 'oral', enrollment.id, actor);
    const rubricOnly = await service.createModeAttempt('modes-recovery', rubric.id, 'rubric', enrollment.id, actor);
    const parsed = await parseMarkingFiles([new File(['Fictional written evidence.'], 'Fictional.txt')]);
    const written = await service.importAttempt('modes-recovery', rubric.id, parsed.documents, enrollment.id, null, actor);
    const photoSession = await service.openSession(photos.id, actor);
    photoSession.draft.imageFeedback = [
      { pageId: 'second-page', rotation: 270, crop: { x: .1, y: .2, width: .8, height: .7 }, annotations: [
        { id: 'pen', kind: 'pen', points: [{ x: .2, y: .3 }, { x: .5, y: .6 }], color: 'red', width: .01, text: '', criterionId: null, level: '' },
        { id: 'highlight', kind: 'highlight', points: [{ x: .3, y: .4 }, { x: .6, y: .5 }], color: 'yellow', width: .03, text: '', criterionId: 'reason', level: '3' },
        { id: 'comment', kind: 'comment', points: [{ x: .4, y: .4 }], color: 'blue', width: .01, text: 'Explain this fictional step.', criterionId: 'communication', level: '3' },
      ] },
      { pageId: 'first-page', rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: [] },
    ];
    const savedPhoto = await service.saveDraft(photoSession.id, photoSession.draft, photoSession.version, actor);
    const photoCommit = await service.finalize(savedPhoto.id, savedPhoto.version, actor);
    const photoRevision = await service.openSession(photos.id, actor);
    const oralSession = await service.openSession(oral.id, actor);
    oralSession.draft.oral = { items: [{ id: 'evidence', label: 'Explains evidence', checked: true, note: 'Fictional checklist observation' }], notes: 'Fictional private notes' };
    oralSession.draft.rubricFeedback = [{ criterionId: 'reason', level: '3', feedback: 'Fictional oral reasoning' }, { criterionId: 'communication', level: '', feedback: 'Fictional oral communication' }];
    oralSession.draft.overallFeedback = 'Fictional student-facing feedback';
    const savedOral = await service.saveDraft(oralSession.id, oralSession.draft, oralSession.version, actor);
    const oralCommit = await service.finalize(savedOral.id, savedOral.version, actor);
    const oralRevision = await service.openSession(oral.id, actor);
    const rubricSession = await service.openSession(rubricOnly.id, actor);
    rubricSession.draft.rubricFeedback = [{ criterionId: 'reason', level: '3', feedback: 'Fictional rubric-only reasoning' }, { criterionId: 'communication', level: '3', feedback: 'Fictional rubric-only communication' }];
    const savedRubric = await service.saveDraft(rubricSession.id, rubricSession.draft, rubricSession.version, actor);
    const rubricCommit = await service.finalize(savedRubric.id, savedRubric.version, actor);
    const writtenSession = await service.openSession(written.id, actor);
    writtenSession.draft.annotations = [{ id: 'quote', documentId: written.documents[0].id, start: 0, end: 9, quote: 'Fictional', criterionId: 'reason', level: '3', text: 'Fictional passage feedback' }];
    const savedWritten = await service.saveDraft(writtenSession.id, writtenSession.draft, writtenSession.version, actor);
    return { photos, oral, rubricOnly, written, savedPhoto: photoRevision, photoCommit, oralCommit, oralRevision, rubricCommit, savedWritten };
  }

  async function snapshot(database = db) {
    return Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, (await table.toArray()).sort((a, b) => a.id.localeCompare(b.id))])));
  }

  it('roundtrips written legacy attempts, all modes, private evidence and original bytes without losing order or transforms', async () => {
    const records = await fixture();
    const json = await portability.createFullBackupJSON();
    expect(JSON.parse(json).schemaVersion).toBe(4);
    const restored = new OntarioTeacherDB(`modes-photo-restored-${crypto.randomUUID()}`);
    try {
      await new PortabilityService(restored).restoreFromJSON(json);
      for (const attempt of [records.photos, records.oral, records.rubricOnly, records.written]) expect(await restored.markingAttempts.get(attempt.id)).toEqual(attempt);
      for (const session of [records.savedPhoto, records.oralRevision, records.savedWritten]) expect(await restored.markingSessions.get(session.id)).toEqual(session);
      for (const commit of [records.photoCommit, records.oralCommit, records.rubricCommit]) expect(await restored.markingCommits.get(commit.id)).toEqual(commit);
      expect((await restored.markingSessions.get(records.savedPhoto.id))!.draft.imageFeedback!.map(page => page.pageId)).toEqual(['second-page', 'first-page']);
      expect((await restored.markingAttempts.get(records.photos.id))!.imagePages!.map(page => page.base64)).toEqual([PNG, PNG]);
      // A fresh database object reopens persisted recovery, rather than retaining form state.
      restored.close();
      await restored.open();
      expect((await restored.markingSessions.get(records.oralRevision.id))!.draft.oral).toEqual(records.oralRevision.draft.oral);
    } finally { await restored.delete(); }
  });

  it('rejects corrupt image bytes, hashes, URLs, dimensions, modes and draft links before changing any table', async () => {
    const records = await fixture();
    const json = await portability.createFullBackupJSON();
    const before = await snapshot();
    const mutations: ((backup: any) => void)[] = [
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].hash = '0'.repeat(64); },
      backup => { delete backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].hash; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].base64 = 'https://example.invalid/Fictional.png'; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].base64 = `data:image/png;base64,${PNG}`; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].url = 'https://example.invalid/Fictional.png'; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].width = 2; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).imagePages[0].mime = 'image/jpeg'; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).mode = 'oral'; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).mode = 'unknown'; },
      backup => { backup.tables.markingAttempts.find((row: any) => row.id === records.photos.id).createdBy = 'user-colleague'; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.savedPhoto.id).draft.imageFeedback[0].pageId = 'missing-page'; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.savedPhoto.id).draft.imageFeedback[0].annotations[0].points[0].x = 1.1; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.savedPhoto.id).draft.imageFeedback[0].crop.width = 1; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.savedPhoto.id).draft.imageFeedback[0].annotations[1].criterionId = 'missing-criterion'; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.oralRevision.id).draft.rubricFeedback[0].level = 'missing-level'; },
      backup => { backup.tables.markingSessions.find((row: any) => row.id === records.oralRevision.id).draft.imageFeedback = records.savedPhoto.draft.imageFeedback; },
      backup => { backup.tables.markingRubrics = []; },
      backup => { backup.tables.markingAttempts = []; },
    ];
    for (const mutate of mutations) {
      const backup = JSON.parse(json);
      backup.tables.students[0].firstName = 'Must not replace existing student';
      mutate(backup);
      await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
  });

  it('rejects altered private finalized evidence even when all references and image bytes are valid', async () => {
    const records = await fixture();
    const backup = JSON.parse(await portability.createFullBackupJSON());
    const finalized = backup.tables.markingSessions.find((row: MarkingSession) => row.id === records.oralCommit.sessionId);
    finalized.draft.oral.notes = 'A different private observation';
    const before = await snapshot();
    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow('differs from its committed feedback');
    expect(await snapshot()).toEqual(before);
  });

  it('retains older version-4 written records that omit every additive mode and image field', async () => {
    const records = await fixture();
    const backup = JSON.parse(await portability.createFullBackupJSON());
    const legacyAttempt = backup.tables.markingAttempts.find((row: any) => row.id === records.written.id);
    delete legacyAttempt.mode;
    delete legacyAttempt.imagePages;
    const legacySession = backup.tables.markingSessions.find((row: any) => row.id === records.savedWritten.id);
    delete legacySession.draft.imageFeedback;
    delete legacySession.draft.rubricFeedback;
    delete legacySession.draft.oral;
    await portability.restoreFromJSON(JSON.stringify(backup));
    expect(await db.markingAttempts.get(records.written.id)).toEqual(legacyAttempt);
    expect(await service.openSession(records.written.id, actor)).toEqual(legacySession);
  });
});
