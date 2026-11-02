import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { pixelCaptureFixture } from '../../scripts/helpers/pixelCaptureFixture';
import { decodeCapturePackage, captureSha256 } from '../../shared/capturePackage';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher, setActiveTeacherId } from '../services/identityService';
import { CaptureAttachmentService } from '../capture/attachmentService';
import { PortabilityService } from '../services/portabilityService';
import { MarkingService } from './markingService';
import { assertMarkingImagePages } from './validation';

it('retains a real pixel-heavy 35MiB capture in one markable attempt, recovers retries, validates references and restores exact originals', async () => {
  const started = performance.now(); let previous = started;
  const phase = (name: string) => {
    const now = performance.now();
    console.log(`[capture35] ${name}; elapsed=${Math.round(now - started)}ms; previousPhase=${Math.round(now - previous)}ms`);
    previous = now;
  };
  phase('begin database setup');
  const db = new OntarioTeacherDB(`fictional-reference-${crypto.randomUUID()}`);
  try {
    await seedDatabase(db); const identity = await selectActingTeacher(db, 'user-tyler');
    const actor = { ...identity, epoch: getIdentityEpoch() }, captureActor = { ...identity, identityEpoch: actor.epoch };
    phase('begin pixel fixture encode/decode');
    const fixture = await pixelCaptureFixture(), pkg = await decodeCapturePackage(fixture.zip);
    expect(fixture.bytes.length * 5).toBeGreaterThan(32 * 1024 * 1024); expect(fixture.bytes.length).toBeLessThan(8 * 1024 * 1024);
    const captures = new CaptureAttachmentService(db), marking = new MarkingService(db), portability = new PortabilityService(db);
    const enrollment = (await captures.context('assess-eng-essay', captureActor)).roster[0].enrollment.id;
    phase('begin confirm and bind');
    const receipt = await captures.confirm('assess-eng-essay', pkg, 'pixel-student', enrollment, captureActor);
    const rubric = await marking.saveRubric('assess-eng-essay', { title: 'Fictional pixel rubric', levels: ['Clear'], criteria: [{ id: 'reason', name: 'Reason', categoryCode: 'K', descriptors: { Clear: 'Clear' } }] }, actor);
    const original = (await db.captureAttachments.get(receipt.attachmentId))!.pages;
    const attempt = await marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, actor);
    expect(attempt.imagePages).toHaveLength(5); expect(attempt.imagePages!.every(page => page.captureRef && !page.base64)).toBe(true);
    expect(() => assertMarkingImagePages(attempt.imagePages)).toThrow(); // No forged reference through ordinary image imports.
    phase('begin idempotency checks');
    await expect(marking.bindCaptureRoot(receipt.attachmentId, { rubricId: rubric.id }, actor)).rejects.toThrow('already associated');
    expect(await captures.confirm('assess-eng-essay', pkg, 'pixel-student', enrollment, captureActor)).toEqual(receipt);
    expect(await db.markingAttempts.count()).toBe(1);
    phase('begin all-page original hash checks');
    for (const page of attempt.imagePages!) {
      const loaded = await marking.readImagePage(attempt.id, page.id, actor);
      expect(await captureSha256(new Uint8Array(Buffer.from(loaded.base64, 'base64')))).toBe(fixture.hash);
      expect(loaded).toMatchObject({ width: fixture.width, height: fixture.height, size: fixture.bytes.length });
    }
    phase('begin draft/finalize/reopen');
    let session = await marking.openSession(attempt.id, actor);
    session.draft.overallFeedback = 'Fictional retained feedback';
    session.draft.imageFeedback![0].annotations = [{ id: 'comment', kind: 'comment', points: [{ x: .3, y: .4 }], color: 'red', width: .004, text: 'Fictional annotation', criterionId: 'reason', level: 'Clear' }];
    session.draft.judgments.forEach((judgment: any) => Object.assign(judgment, { assessed: true, rawScore: '4+', inputFormat: 'scale_code' }));
    session = await marking.saveDraft(session.id, session.draft, session.version, actor);
    const commit = await marking.finalize(session.id, session.version, actor);
    expect(await marking.finalize(session.id, session.version, actor)).toEqual(commit);
    db.close(); await db.open();
    expect((await db.markingSessions.get(session.id))!.draft).toEqual(commit.draft);
    phase('begin complete backup');
    const backup = await portability.createFullBackupJSON(); expect(Buffer.byteLength(backup)).toBeLessThan(256 * 1024 * 1024);
    phase('begin full restore');
    await portability.restoreFromJSON(backup);
    phase('begin restored-original comparisons');
    expect((await db.captureAttachments.get(receipt.attachmentId))!.pages).toEqual(original);
    expect(await captureSha256(new Uint8Array(Buffer.from((await marking.readImagePage(attempt.id, attempt.imagePages![4].id, actor)).base64, 'base64')))).toBe(fixture.hash);
    const before = await db.markingAttempts.get(attempt.id), beforeResults = await db.categoryResults.toArray();
    // The fast integrity suite covers the full corruption matrix. Keep one real
    // large-file negative restore here to verify the original-size boundary too.
    phase('begin corrupt restore and unchanged-data checks');
    const corrupt = JSON.parse(backup); corrupt.tables.markingAttempts.find((a: any) => a.id === attempt.id).imagePages[0].captureRef.pageId = 'wrong-page';
    await expect(portability.restoreFromJSON(JSON.stringify(corrupt))).rejects.toThrow();
    expect(await db.markingAttempts.get(attempt.id)).toEqual(before); expect(await db.categoryResults.toArray()).toEqual(beforeResults);
    phase('begin authorization/archive checks');
    const first = attempt.imagePages![0];
    await expect(marking.readImagePage(attempt.id, 'not-current-page', actor)).rejects.toThrow();
    setActiveTeacherId('fictional-other'); await expect(marking.readImagePage(attempt.id, first.id, actor)).rejects.toThrow();
    await selectActingTeacher(db, 'user-tyler'); actor.epoch = getIdentityEpoch();
    await marking.archiveAttempt(attempt.id, attempt.version, actor, false);
    expect((await db.markingAttempts.get(attempt.id))!.imagePages).toEqual([]);
    expect((await db.captureAttachments.get(receipt.attachmentId))!.pages).toEqual(original);
    await expect(marking.readImagePage(attempt.id, first.id, actor)).rejects.toThrow();
    console.log(`PASS actual pixel bytes=${fixture.bytes.length * 5}, backup bytes=${Buffer.byteLength(backup)}; bind/retry/finalize/reopen/restore/corruption/archive`);
  } finally {
    phase('begin cleanup'); clearActiveTeacherId(); await db.delete(); phase('cleanup complete');
  }
// This cumulative integration matrix copies/hashes/restores real >32 MiB originals;
// it is not a latency SLA. Isolated Intel CI exceeded 240 s while Windows/ARM passed.
// Keep every assertion and byte threshold; phase logs distinguish slow work from hangs.
}, 600_000);
