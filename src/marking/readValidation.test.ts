import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { MarkingService } from './markingService';
import { validateSavedMarkingSession } from './readValidation';
import type { MarkingAttempt, MarkingRubric, MarkingSession } from './types';

describe('saved marking read boundaries', () => {
  let db: OntarioTeacherDB, attempt: MarkingAttempt, rubric: MarkingRubric, session: MarkingSession;
  beforeEach(async () => {
    db = new OntarioTeacherDB(`fictional-read-boundary-${crypto.randomUUID()}`);
    await seedDatabase(db);
    const identity = await selectActingTeacher(db, 'user-tyler');
    const actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
    const service = new MarkingService(db);
    const context = await service.getContext('assess-eng-essay', actor);
    rubric = await service.saveRubric(context.assessment.id, { title: 'Fictional read recovery', levels: ['Clear'], criteria: [{ id: 'evidence', name: 'Evidence', categoryCode: 'K', descriptors: { Clear: 'Clear reasoning' } }] }, actor);
    attempt = await service.createModeAttempt(context.assessment.id, rubric.id, 'rubric', context.enrollments[0].id, actor);
    session = await service.openSession(attempt.id, actor);
  });
  afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
  it('accepts valid current and legacy category snapshots without altering the record', () => {
    const legacy = structuredClone(session); delete legacy.categorySnapshot;
    const before = JSON.stringify(legacy);
    validateSavedMarkingSession(session, attempt, rubric);
    validateSavedMarkingSession(legacy, attempt, rubric);
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it('rejects a malformed saved image array and preserves the authoritative database record', async () => {
    const bad = structuredClone(session);
    bad.draft.imageFeedback = [{ pageId: 'fictional-page', rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 }, annotations: null as never }];
    const before = JSON.stringify(bad);
    expect(() => validateSavedMarkingSession(bad, attempt, rubric)).toThrow();
    expect(JSON.stringify(bad)).toBe(before);
    expect(await db.markingSessions.get(session.id)).toEqual(session);
  });
  it('rejects an invalid legacy baseline rather than silently showing empty feedback', () => {
    const bad = structuredClone(session); delete bad.categorySnapshot; bad.baseline = '{broken';
    expect(() => validateSavedMarkingSession(bad, attempt, rubric)).toThrow('baseline');
    expect(bad.baseline).toBe('{broken');
  });
  it('validates finalized read shortcuts and rejects cross-student or cross-actor joins', () => {
    const finalized = { ...session, status: 'finalized' as const, commitId: 'fictional-commit' };
    validateSavedMarkingSession(finalized, attempt, rubric);
    expect(() => validateSavedMarkingSession({ ...finalized, attemptId: 'another-attempt' }, attempt, rubric)).toThrow('links');
    expect(() => validateSavedMarkingSession({ ...finalized, createdBy: 'another-teacher' }, attempt, rubric)).toThrow('links');
  });
});
