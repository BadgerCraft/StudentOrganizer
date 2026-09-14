import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { MarkbookDomainService, ValidationError, ConcurrencyConflictError } from './markbookService';
import { ParticipationDomainService } from './participationService';
import { SeatingDomainService } from './seatingService';
import { SyncOutboxWorker } from './syncOutbox';

describe('Transactional Domain Services Suite', () => {
  let db: OntarioTeacherDB;
  let markbookService: MarkbookDomainService;
  let participationService: ParticipationDomainService;
  let seatingService: SeatingDomainService;
  let syncWorker: SyncOutboxWorker;

  beforeEach(async () => {
    // Unique in-memory database for isolation
    db = new OntarioTeacherDB(`test-db-${crypto.randomUUID()}`);
    await seedDatabase(db);
    markbookService = new MarkbookDomainService(db);
    participationService = new ParticipationDomainService(db);
    seatingService = new SeatingDomainService(db);
    syncWorker = new SyncOutboxWorker(db);
    SyncOutboxWorker.resetMockServer();
  });

  it('records category result with atomic audit entry and sync mutation', async () => {
    const sa = await db.studentAssessments.toCollection().first();
    expect(sa).toBeDefined();

    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();
    expect(cat).toBeDefined();

    const result = await markbookService.recordCategoryResult({
      studentAssessmentId: sa!.id,
      assessmentCategoryId: cat!.id,
      rawScore: '4+',
      inputFormat: 'scale_code',
      feedback: 'Excellent textual synthesis',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(result.normalizedPercentage).toBe(95);
    expect(result.rawScore).toBe('4+');

    // Verify audit entry
    const audit = await db.auditEntries.where('entityId').equals(result.id).first();
    expect(audit).toBeDefined();
    expect(audit!.action).toBe('UPDATE'); // seeded existed
    expect(audit!.diffJson).toContain('95');

    // Verify sync mutation
    const sync = await db.syncMutations.where('entityId').equals(result.id).first();
    expect(sync).toBeDefined();
    expect(sync!.acknowledgedAt).toBeNull();

    // Process sync outbox
    const pushResult = await syncWorker.processOutbox('dev-1', 'org-school-port-credit');
    expect(pushResult.processedMutations).toBeGreaterThan(0);

    const syncUpdated = await db.syncMutations.get(sync!.id);
    expect(syncUpdated!.acknowledgedAt).not.toBeNull();
  });

  it('rejects version conflict when expectedVersion mismatches', async () => {
    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();
    const existing = await db.categoryResults
      .where({ studentAssessmentId: sa!.id, assessmentCategoryId: cat!.id })
      .first();

    expect(existing).toBeDefined();

    // Pass stale expectedVersion
    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '3',
        inputFormat: 'scale_code',
        expectedVersion: existing!.version + 99,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(ConcurrencyConflictError);
  });

  it('rejects score exceeding denominator with clear validation message', async () => {
    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '105%',
        inputFormat: 'percentage',
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(ValidationError);
  });

  it('records multi-student participation event with atomic daily summaries and undo', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollments = await db.classEnrollments
      .where('classSectionId')
      .equals(section!.id)
      .limit(3)
      .toArray();

    const enrIds = enrollments.map(e => e.id);

    const events = await participationService.recordParticipation({
      classEnrollmentIds: enrIds,
      classSectionId: section!.id,
      name: 'Demonstrated preparation',
      classification: 'positive',
      points: 1.0,
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(events.length).toBe(3);
    const batchId = events[0].batchId;

    // Check daily summary projection for student 1
    const summary = await db.participationDailySummaries
      .where({ classEnrollmentId: enrIds[0], localSchoolDate: '2026-09-14' })
      .first();
    expect(summary).toBeDefined();
    expect(summary!.positiveCount).toBeGreaterThanOrEqual(1);

    // Atomic Undo batch
    const undoRes = await participationService.undoBatch(batchId, 'user-tyler', 'dev-1');
    expect(undoRes.undoneCount).toBe(3);

    // Verify soft-deleted
    const undoneEvent = await db.participationEvents.get(events[0].id);
    expect(undoneEvent!.deletedAt).not.toBeNull();
  });

  it('seating service enforces bounds and occupied-only storage', async () => {
    const layout = await db.seatingLayouts.toCollection().first();
    const enrollment = await db.classEnrollments
      .where('classSectionId')
      .equals(layout!.classSectionId)
      .first();

    // Out of bounds error
    await expect(
      seatingService.assignSeat(layout!.id, 99, 99, enrollment!.id)
    ).rejects.toThrow(ValidationError);

    // Unassign seat (occupied-only pattern: seat is removed)
    await seatingService.assignSeat(layout!.id, 0, 0, null);
    const emptySeat = await db.seatPositions
      .where({ seatingLayoutId: layout!.id, row: 0, col: 0 })
      .first();
    expect(emptySeat).toBeUndefined();
  });
});
