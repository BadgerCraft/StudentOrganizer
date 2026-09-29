import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { MarkbookDomainService, ValidationError, ConcurrencyConflictError } from './markbookService';
import { ParticipationDomainService } from './participationService';
import { SeatingDomainService } from './seatingService';
import { SyncOutboxWorker } from './syncOutbox';
import { AuthorizationError } from './authHelper';
import type { User, OrganizationMembership, ClassSectionStaff, ParticipationEventType, SeatingLayout } from '../types/schema';

describe('Transactional Domain Services Suite', () => {
  let db: OntarioTeacherDB;
  let markbookService: MarkbookDomainService;
  let participationService: ParticipationDomainService;
  let seatingService: SeatingDomainService;
  let syncWorker: SyncOutboxWorker;

  beforeEach(async () => {
    // Unique in-memory database for test isolation
    db = new OntarioTeacherDB(`test-db-${crypto.randomUUID()}`);
    await seedDatabase(db);
    markbookService = new MarkbookDomainService(db);
    participationService = new ParticipationDomainService(db);
    seatingService = new SeatingDomainService(db);
    syncWorker = new SyncOutboxWorker(db);
    SyncOutboxWorker.resetMockServer();
  });

  // -------------------------------------------------------------
  // Markbook Domain Service Tests
  // -------------------------------------------------------------

  it('records category result with atomic audit entry and sync mutation', async () => {
    const sa = await db.studentAssessments.toCollection().first();
    expect(sa).toBeDefined();

    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();
    expect(cat).toBeDefined();

    const existing = await db.categoryResults
      .where({ studentAssessmentId: sa!.id, assessmentCategoryId: cat!.id })
      .first();

    const result = await markbookService.recordCategoryResult({
      studentAssessmentId: sa!.id,
      assessmentCategoryId: cat!.id,
      rawScore: '4+',
      inputFormat: 'scale_code',
      feedback: 'Excellent textual synthesis',
      expectedVersion: existing?.version,
      expectedStudentAssessmentVersion: sa!.version,
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
    expect(sync!.status).toBe('pending');
    expect(sync!.acknowledgedAt).toBeNull();

    // Process sync outbox
    const pushResult = await syncWorker.processOutbox('dev-1', 'org-school-port-credit');
    expect(pushResult.processedMutations).toBeGreaterThan(0);

    const syncUpdated = await db.syncMutations.get(sync!.id);
    expect(syncUpdated!.status).toBe('acknowledged');
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
        expectedStudentAssessmentVersion: sa!.version,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(ConcurrencyConflictError);
  });

  it('rejects score exceeding denominator with clear validation message', async () => {
    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();
    const existing = await db.categoryResults
      .where({ studentAssessmentId: sa!.id, assessmentCategoryId: cat!.id })
      .first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '105%',
        inputFormat: 'percentage',
        expectedVersion: existing?.version,
        expectedStudentAssessmentVersion: sa!.version,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // In-Transaction Authorization Tests
  // -------------------------------------------------------------

  it('denies unassigned teacher write access to class section', async () => {
    const now = new Date().toISOString();
    const unassignedUser: User = {
      id: 'user-unassigned',
      authSubject: 'auth0|unassigned',
      email: 'unassigned@example.invalid',
      name: 'Unassigned Teacher',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.users.add(unassignedUser);

    const membership: OrganizationMembership = {
      id: 'mem-unassigned',
      organizationId: 'org-school-port-credit',
      userId: 'user-unassigned',
      role: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.organizationMemberships.add(membership);

    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '4',
        inputFormat: 'scale_code',
        userId: 'user-unassigned',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies read-only staff write access to class section', async () => {
    const now = new Date().toISOString();
    const roUser: User = {
      id: 'user-readonly',
      authSubject: 'auth0|readonly',
      email: 'readonly@example.invalid',
      name: 'Read-Only Staff',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.users.add(roUser);

    const membership: OrganizationMembership = {
      id: 'mem-readonly',
      organizationId: 'org-school-port-credit',
      userId: 'user-readonly',
      role: 'teacher',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.organizationMemberships.add(membership);

    const staff: ClassSectionStaff = {
      id: 'staff-ro-eng',
      classSectionId: 'class-eng4u-01',
      organizationMembershipId: 'mem-readonly',
      role: 'read_only',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.classSectionStaff.add(staff);

    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '4',
        inputFormat: 'scale_code',
        userId: 'user-readonly',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies guest role write access', async () => {
    const now = new Date().toISOString();
    const guestUser: User = {
      id: 'user-guest',
      authSubject: 'auth0|guest',
      email: 'guest@example.invalid',
      name: 'Guest Observer',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.users.add(guestUser);

    const membership: OrganizationMembership = {
      id: 'mem-guest',
      organizationId: 'org-school-port-credit',
      userId: 'user-guest',
      role: 'guest',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.organizationMemberships.add(membership);

    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '4',
        inputFormat: 'scale_code',
        userId: 'user-guest',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('denies suspended user write access', async () => {
    const now = new Date().toISOString();
    const suspUser: User = {
      id: 'user-suspended',
      authSubject: 'auth0|suspended',
      email: 'suspended@example.invalid',
      name: 'Suspended Teacher',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.users.add(suspUser);

    const membership: OrganizationMembership = {
      id: 'mem-suspended',
      organizationId: 'org-school-port-credit',
      userId: 'user-suspended',
      role: 'teacher',
      status: 'suspended',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.organizationMemberships.add(membership);

    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();

    await expect(
      markbookService.recordCategoryResult({
        studentAssessmentId: sa!.id,
        assessmentCategoryId: cat!.id,
        rawScore: '4',
        inputFormat: 'scale_code',
        userId: 'user-suspended',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it('permits board administrator write access across school hierarchy', async () => {
    const now = new Date().toISOString();
    const adminUser: User = {
      id: 'user-board-admin',
      authSubject: 'auth0|boardadmin',
      email: 'admin@example.invalid',
      name: 'Board Admin',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.users.add(adminUser);

    // Board level admin
    const membership: OrganizationMembership = {
      id: 'mem-board-admin',
      organizationId: 'org-board-peel',
      userId: 'user-board-admin',
      role: 'admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.organizationMemberships.add(membership);

    const sa = await db.studentAssessments.toCollection().first();
    const cat = await db.assessmentCategories.where('assessmentId').equals(sa!.assessmentId).first();
    const existing = await db.categoryResults
      .where({ studentAssessmentId: sa!.id, assessmentCategoryId: cat!.id })
      .first();

    const result = await markbookService.recordCategoryResult({
      studentAssessmentId: sa!.id,
      assessmentCategoryId: cat!.id,
      rawScore: '4',
      inputFormat: 'scale_code',
      expectedVersion: existing?.version,
      expectedStudentAssessmentVersion: sa!.version,
      userId: 'user-board-admin',
      deviceId: 'dev-admin'
    });

    expect(result.normalizedPercentage).toBe(87);
  });

  // -------------------------------------------------------------
  // Participation Domain Service Tests
  // -------------------------------------------------------------

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
      eventTypeId: 'pet-prep',
      occurredAt: '2026-09-14T14:00:00.000Z',
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

  it('rejects duplicate student enrollment IDs in participation batch', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollment = await db.classEnrollments
      .where('classSectionId')
      .equals(section!.id)
      .first();

    await expect(
      participationService.recordParticipation({
        classEnrollmentIds: [enrollment!.id, enrollment!.id],
        classSectionId: section!.id,
        eventTypeId: 'pet-prep',
        occurredAt: '2026-09-14T14:00:00.000Z',
        localSchoolDate: '2026-09-14',
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(ValidationError);
  });

  it('accepts global event type where organizationId is null', async () => {
    const now = new Date().toISOString();
    const globalType: ParticipationEventType = {
      id: 'type-global-kindness',
      organizationId: null, // Global preset
      name: 'Peer Assistance',
      code: 'PEER_ASST',
      icon: 'heart',
      color: '#10b981',
      classification: 'positive',
      recordingMode: 'quick_tally',
      defaultCategoryCode: null,
      sortOrder: 10,
      defaultPoints: 1.5,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.participationEventTypes.add(globalType);

    const section = await db.classSections.toCollection().first();
    const enrollment = await db.classEnrollments
      .where('classSectionId')
      .equals(section!.id)
      .first();

    const events = await participationService.recordParticipation({
      classEnrollmentIds: [enrollment!.id],
      classSectionId: section!.id,
      eventTypeId: globalType.id,
      occurredAt: '2026-09-14T14:00:00.000Z',
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(events.length).toBe(1);
    expect(events[0].snapshottedName).toBe('Peer Assistance');
    expect(events[0].snapshottedPoints).toBe(1.5);
  });

  it('atomic participation undo recalculates lastEventAt from remaining active events', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollment = await db.classEnrollments
      .where('classSectionId')
      .equals(section!.id)
      .first();

    const t1 = '2026-09-14T14:00:00.000Z';
    const t2 = '2026-09-14T15:00:00.000Z';

    // Batch 1 at 14:00
    const b1 = await participationService.recordParticipation({
      classEnrollmentIds: [enrollment!.id],
      classSectionId: section!.id,
      eventTypeId: 'pet-prep',
      occurredAt: t1,
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    // Batch 2 at 15:00
    const b2 = await participationService.recordParticipation({
      classEnrollmentIds: [enrollment!.id],
      classSectionId: section!.id,
      eventTypeId: 'pet-question',
      occurredAt: t2,
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    const summaryAfterB2 = await db.participationDailySummaries
      .where({ classEnrollmentId: enrollment!.id, localSchoolDate: '2026-09-14' })
      .first();
    expect(summaryAfterB2!.lastEventAt).toBe(t2);

    // Undo Batch 2
    await participationService.undoBatch(b2[0].batchId, 'user-tyler', 'dev-1');

    const summaryAfterUndo = await db.participationDailySummaries
      .where({ classEnrollmentId: enrollment!.id, localSchoolDate: '2026-09-14' })
      .first();
    expect(summaryAfterUndo).toBeDefined();
    // lastEventAt should now reflect Batch 1
    expect(summaryAfterUndo!.lastEventAt).toBe(t1);
  });

  // -------------------------------------------------------------
  // Seating Domain Service Tests
  // -------------------------------------------------------------

  it('seating service enforces bounds and occupied-only storage', async () => {
    const layout = await db.seatingLayouts.toCollection().first();
    const enrollment = await db.classEnrollments
      .where('classSectionId')
      .equals(layout!.classSectionId)
      .first();

    // Out of bounds error
    await expect(
      seatingService.assignSeat(layout!.id, 99, 99, enrollment!.id, 'user-tyler', 'dev-1')
    ).rejects.toThrow(ValidationError);

    // Unassign seat (occupied-only pattern: seat is removed)
    await seatingService.assignSeat(layout!.id, 0, 0, null, 'user-tyler', 'dev-1');
    const emptySeat = await db.seatPositions
      .where({ seatingLayoutId: layout!.id, row: 0, col: 0 })
      .first();
    expect(emptySeat).toBeUndefined();
  });

  it('arrangeAlphabetically prevents silent student drop on capacity overflow', async () => {
    const section = await db.classSections.toCollection().first();
    const now = new Date().toISOString();

    // Create a cramped 1x1 layout
    const smallLayout: SeatingLayout = {
      id: 'layout-tiny-1x1',
      classSectionId: section!.id,
      name: 'Tiny Layout',
      rows: 1,
      cols: 1,
      isLocked: false,
      cardSize: 'standard',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    await db.seatingLayouts.add(smallLayout);

    // There are 30 students in this class section
    await expect(
      seatingService.arrangeAlphabetically(smallLayout.id, 'user-tyler', 'dev-1')
    ).rejects.toThrow(ValidationError);
  });

  // -------------------------------------------------------------
  // Sync Outbox Worker Tests
  // -------------------------------------------------------------

  it('transaction completeness failure marks mutations failed without committing to server', async () => {
    const now = new Date().toISOString();
    const txId = crypto.randomUUID();
    const mutId = crypto.randomUUID();

    // Insert an incomplete transaction (expected 2 mutations, but only 1 exists)
    await db.syncMutations.add({
      id: crypto.randomUUID(),
      deviceId: 'dev-outbox-test',
      organizationId: 'org-school-port-credit',
      mutationId: mutId,
      transactionId: txId,
      sequenceNumber: 1,
      transactionSize: 2, // Expects 2!
      entityName: 'seatPositions',
      entityId: crypto.randomUUID(),
      operation: 'INSERT',
      payloadJson: '{}',
      baseVersion: 0,
      status: 'pending',
      createdAt: now,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      acknowledgedAt: null
    });

    const result = await syncWorker.processOutbox('dev-outbox-test', 'org-school-port-credit');
    expect(result.failedMutations).toBe(1);
    expect(result.processedMutations).toBe(0);

    const stored = await db.syncMutations.where('mutationId').equals(mutId).first();
    expect(stored!.status).toBe('failed');
    expect(stored!.lastError).toContain('Incomplete transaction');

    // Server must NOT have processed it
    expect(SyncOutboxWorker.isServerProcessed(mutId)).toBe(false);
  });

  it('transient network error keeps mutations pending with backoff and retries when error clears', async () => {
    const now = new Date().toISOString();
    const txId = crypto.randomUUID();
    const mutId = crypto.randomUUID();

    // Add a single valid mutation
    const recordId = crypto.randomUUID();
    await db.syncMutations.add({
      id: recordId,
      deviceId: 'dev-retry-test',
      organizationId: 'org-school-port-credit',
      mutationId: mutId,
      transactionId: txId,
      sequenceNumber: 1,
      transactionSize: 1,
      entityName: 'seatPositions',
      entityId: crypto.randomUUID(),
      operation: 'INSERT',
      payloadJson: '{}',
      baseVersion: 0,
      status: 'pending',
      createdAt: now,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      acknowledgedAt: null
    });

    // 1. Simulate transient 503 error
    SyncOutboxWorker.simulateTransientNetworkError = true;
    const res1 = await syncWorker.processOutbox('dev-retry-test', 'org-school-port-credit');
    expect(res1.failedMutations).toBe(1);
    expect(res1.processedMutations).toBe(0);

    const afterTransient = await db.syncMutations.get(recordId);
    expect(afterTransient!.status).toBe('pending'); // Retained pending for retry!
    expect(afterTransient!.attemptCount).toBe(1);
    expect(afterTransient!.lastError).toContain('Simulated transient 503');
    expect(SyncOutboxWorker.isServerProcessed(mutId)).toBe(false);

    // 2. Immediate second call should be skipped by exponential backoff (1000ms)
    const res2 = await syncWorker.processOutbox('dev-retry-test', 'org-school-port-credit');
    expect(res2.processedMutations).toBe(0);
    expect(res2.failedMutations).toBe(0);

    // 3. Clear transient error and simulate time elapsed past backoff
    SyncOutboxWorker.simulateTransientNetworkError = false;
    await db.syncMutations.update(recordId, {
      lastAttemptAt: new Date(Date.now() - 5000).toISOString() // 5 seconds ago
    });

    const res3 = await syncWorker.processOutbox('dev-retry-test', 'org-school-port-credit');
    expect(res3.processedMutations).toBe(1);

    const finalRec = await db.syncMutations.get(recordId);
    expect(finalRec!.status).toBe('acknowledged');
    expect(finalRec!.acknowledgedAt).not.toBeNull();
    expect(SyncOutboxWorker.isServerProcessed(mutId)).toBe(true);
  });
});
