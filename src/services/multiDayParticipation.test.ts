import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ClassSessionService } from './sessionService';
import { AttendanceService } from './attendanceService';
import { ParticipationDomainService, ConcurrencyError } from './participationService';
import {
  getSchoolLocalDate,
  buildTorontoTimestamp,
  shiftSchoolDate,
  ValidationError
} from '../utils/dateUtils';
import type { UUID } from '../types/schema';

describe('Multi-Day Participation and Observation Reliability Suite', () => {
  let db: OntarioTeacherDB;
  let sessionService: ClassSessionService;
  let attendanceService: AttendanceService;
  let participationService: ParticipationDomainService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-multiday-${crypto.randomUUID()}`);
    await seedDatabase(db);
    sessionService = new ClassSessionService(db);
    attendanceService = new AttendanceService(db, sessionService);
    participationService = new ParticipationDomainService(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. Timezone & DST Boundary Validation (buildTorontoTimestamp)', () => {
    it('aligns summer instant to America/Toronto EDT (UTC-4)', () => {
      // July 15, 2026 at 10:15 local -> UTC 14:15
      const ts = buildTorontoTimestamp('2026-07-15', '10:15');
      expect(ts).toBe('2026-07-15T14:15:00.000Z');
      expect(getSchoolLocalDate(new Date(ts))).toBe('2026-07-15');
    });

    it('aligns winter instant to America/Toronto EST (UTC-5)', () => {
      // January 15, 2026 at 10:15 local -> UTC 15:15
      const ts = buildTorontoTimestamp('2026-01-15', '10:15');
      expect(ts).toBe('2026-01-15T15:15:00.000Z');
      expect(getSchoolLocalDate(new Date(ts))).toBe('2026-01-15');
    });

    it('rejects nonexistent Toronto times during the spring-forward gap', () => {
      // Clocks jump from 02:00 to 03:00 on Sunday, March 8, 2026 in Toronto
      expect(() => {
        buildTorontoTimestamp('2026-03-08', '02:30');
      }).toThrow(ValidationError);
    });

    it('resolves repeated fall-back overlap times to the earlier occurrence (EDT)', () => {
      // Clocks fall back from 02:00 to 01:00 on Sunday, November 1, 2026 in Toronto
      // 01:30 repeats. Earlier occurrence is EDT (UTC-4) -> UTC 05:30
      const ts = buildTorontoTimestamp('2026-11-01', '01:30');
      expect(ts).toBe('2026-11-01T05:30:00.000Z');
      expect(getSchoolLocalDate(new Date(ts))).toBe('2026-11-01');
    });

    it('rejects invalid calendar dates strictly', () => {
      expect(() => buildTorontoTimestamp('2026-02-30', '10:00')).toThrow(ValidationError);
      expect(() => buildTorontoTimestamp('2026-13-01', '10:00')).toThrow(ValidationError);
      expect(() => buildTorontoTimestamp('invalid-date', '10:00')).toThrow(ValidationError);
    });
  });

  describe('2. Date Browsing Invariance (Zero Database Writes)', () => {
    it('browsing multiple historical dates produces zero database writes', async () => {
      const section = await db.classSections.toCollection().first();
      expect(section).toBeDefined();

      const initialSessionCount = await db.classSessions.count();
      const initialAttendanceCount = await db.attendanceRecords.count();
      const initialEventCount = await db.participationEvents.count();
      const initialAuditCount = await db.auditEntries.count();

      // Simulate UI browsing across multiple dates (querying without recording)
      const datesToBrowse = [
        shiftSchoolDate(getSchoolLocalDate(), -1),
        shiftSchoolDate(getSchoolLocalDate(), -2),
        shiftSchoolDate(getSchoolLocalDate(), -5),
        shiftSchoolDate(getSchoolLocalDate(), -10)
      ];

      for (const d of datesToBrowse) {
        // Read queries performed by seating and ledger views
        await db.attendanceRecords.where('localSchoolDate').equals(d).toArray();
        await db.participationDailySummaries.where('localSchoolDate').equals(d).toArray();
        await db.classSessions.where('classSectionId').equals(section!.id).filter(s => s.localSchoolDate === d).first();
      }

      // Assert all table counts remain strictly unchanged
      expect(await db.classSessions.count()).toBe(initialSessionCount);
      expect(await db.attendanceRecords.count()).toBe(initialAttendanceCount);
      expect(await db.participationEvents.count()).toBe(initialEventCount);
      expect(await db.auditEntries.count()).toBe(initialAuditCount);
    });
  });

  describe('3. Historical Session Alignment & Timestamp Separation', () => {
    it('creates a historical session whose startsAt/endsAt belong to the target date while createdAt/updatedAt reflect actual entry time', async () => {
      const section = await db.classSections.toCollection().first();
      const historicalDate = shiftSchoolDate(getSchoolLocalDate(), -4);
      const alignedStartsAt = buildTorontoTimestamp(historicalDate, '10:30');

      const beforeTime = new Date().toISOString();
      const session = await sessionService.getOrCreateSession(section!.id, historicalDate, {
        startsAt: alignedStartsAt,
        durationMinutes: 75
      });
      const afterTime = new Date().toISOString();

      // startsAt and endsAt must resolve to the historical school date in Toronto
      expect(session.localSchoolDate).toBe(historicalDate);
      expect(session.startsAt).toBe(alignedStartsAt);
      expect(getSchoolLocalDate(new Date(session.startsAt))).toBe(historicalDate);
      expect(getSchoolLocalDate(new Date(session.endsAt))).toBe(historicalDate);

      // Duration: 75 minutes = 4500000 ms
      const startMs = new Date(session.startsAt).getTime();
      const endMs = new Date(session.endsAt).getTime();
      expect(endMs - startMs).toBe(75 * 60 * 1000);

      // createdAt and updatedAt must be the actual current entry instant (not backdated to historical startsAt)
      expect(session.createdAt >= beforeTime).toBe(true);
      expect(session.createdAt <= afterTime).toBe(true);
      expect(session.updatedAt >= beforeTime).toBe(true);
    });

    it('rejects session startsAt if it does not resolve to the requested school date in America/Toronto', async () => {
      const section = await db.classSections.toCollection().first();
      const historicalDate = '2026-09-10';
      // Mismatched startsAt on 2026-09-11
      const mismatchedStartsAt = buildTorontoTimestamp('2026-09-11', '10:00');

      await expect(
        sessionService.getOrCreateSession(section!.id, historicalDate, { startsAt: mismatchedStartsAt })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('4. Attendance Service Integrity (Auth, Audit, Outbox, Concurrency)', () => {
    it('creates full AuditEntry and SyncMutation records with versioning when toggling attendance', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const targetEnrollment = enrollments[0];
      const targetDate = shiftSchoolDate(getSchoolLocalDate(), -2);

      const beforeTime = new Date().toISOString();

      // First toggle -> creates 'absent'
      const record1 = await attendanceService.toggleAttendance(
        section!.id,
        targetEnrollment.id,
        targetDate,
        'user-tyler',
        'desktop-client'
      );

      expect(record1.status).toBe('absent');
      expect(record1.localSchoolDate).toBe(targetDate);
      expect(record1.version).toBe(1);
      expect(record1.createdAt >= beforeTime).toBe(true);

      // Verify AuditEntry created
      const audits1 = await db.auditEntries
        .where('entityId')
        .equals(record1.id)
        .toArray();
      expect(audits1.length).toBe(1);
      expect(audits1[0].action).toBe('INSERT');
      expect(audits1[0].entityName).toBe('attendanceRecords');
      expect(audits1[0].userId).toBe('user-tyler');

      // Verify SyncMutation created
      const syncs1 = await db.syncMutations
        .where('entityId')
        .equals(record1.id)
        .toArray();
      expect(syncs1.length).toBe(1);
      expect(syncs1[0].operation).toBe('INSERT');
      expect(syncs1[0].baseVersion).toBe(0);
      expect(syncs1[0].sequenceNumber).toBe(1);
      expect(syncs1[0].transactionSize).toBe(1);
      expect(syncs1[0].status).toBe('pending');

      // Second toggle -> cycles to 'present'
      const record2 = await attendanceService.toggleAttendance(
        section!.id,
        targetEnrollment.id,
        targetDate,
        'user-tyler',
        'desktop-client'
      );

      expect(record2.status).toBe('present');
      expect(record2.id).toBe(record1.id);
      expect(record2.version).toBe(2);
      expect(record2.createdAt).toBe(record1.createdAt); // preserved

      const audits2 = await db.auditEntries
        .where('entityId')
        .equals(record1.id)
        .toArray();
      expect(audits2.length).toBe(2);
      const updateAudit = audits2.find(a => a.action === 'UPDATE');
      expect(updateAudit).toBeDefined();
      expect(JSON.parse(updateAudit!.diffJson!)).toEqual({ status: { old: 'absent', new: 'present' } });

      const syncs2 = await db.syncMutations
        .where('entityId')
        .equals(record1.id)
        .toArray();
      expect(syncs2.length).toBe(2);
      const updateSync = syncs2.find(s => s.operation === 'UPDATE');
      expect(updateSync).toBeDefined();
      expect(updateSync!.baseVersion).toBe(1);
    });
  });

  describe('5. Historical Participation & Observation Notes', () => {
    it('records participation on a historical date with an observation note and verifies summary projection', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const targetEnrollment = enrollments[0];
      const targetDate = shiftSchoolDate(getSchoolLocalDate(), -3);
      const occurredAt = buildTorontoTimestamp(targetDate, '14:20');

      const session = await sessionService.getOrCreateSession(section!.id, targetDate, {
        startsAt: occurredAt
      });

      const noteText = 'Constructed nuanced thesis during seminar discussion';
      const events = await participationService.recordParticipation({
        classEnrollmentIds: [targetEnrollment.id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-risk',
        categoryOverride: 'T',
        note: noteText,
        localSchoolDate: targetDate,
        occurredAt,
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      expect(events.length).toBe(1);
      const ev = events[0];
      expect(ev.localSchoolDate).toBe(targetDate);
      expect(ev.occurredAt).toBe(occurredAt);
      expect(ev.note).toBe(noteText);
      expect(ev.version).toBe(1);

      // Verify daily summary was created for targetDate
      const summary = await db.participationDailySummaries
        .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: targetDate })
        .first();
      expect(summary).toBeDefined();
      expect(summary!.totalPoints).toBe(2);
      expect(summary!.positiveCount).toBe(1);
    });
  });

  describe('6. Optimistic Concurrency & Note Editing (updateEventNote)', () => {
    it('successfully edits an observation note with expectedVersion and logs audit entry', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const targetEnrollment = enrollments[0];
      const targetDate = getSchoolLocalDate();

      const session = await sessionService.getOrCreateSession(section!.id, targetDate);
      const events = await participationService.recordParticipation({
        classEnrollmentIds: [targetEnrollment.id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-idea',
        note: 'Initial rough note',
        localSchoolDate: targetDate,
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      const originalEv = events[0];
      const updated = await participationService.updateEventNote(
        originalEv.id,
        originalEv.version,
        'Polished and verified thesis statement',
        'user-tyler',
        'desktop-client'
      );

      expect(updated.version).toBe(originalEv.version + 1);
      expect(updated.note).toBe('Polished and verified thesis statement');

      // Verify AuditEntry
      const audit = await db.auditEntries
        .where('entityId')
        .equals(originalEv.id)
        .filter(a => a.action === 'UPDATE')
        .first();
      expect(audit).toBeDefined();
      expect(JSON.parse(audit!.diffJson!)).toEqual({
        note: { old: 'Initial rough note', new: 'Polished and verified thesis statement' }
      });
    });

    it('rejects stale version with ConcurrencyError', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const session = await sessionService.getOrCreateSession(section!.id, getSchoolLocalDate());

      const events = await participationService.recordParticipation({
        classEnrollmentIds: [enrollments[0].id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-idea',
        note: 'Original',
        localSchoolDate: getSchoolLocalDate(),
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      const ev = events[0];
      // First update increments version to 2
      await participationService.updateEventNote(ev.id, ev.version, 'First update', 'user-tyler', 'desktop-client');

      // Second update supplying stale version 1 must throw ConcurrencyError
      await expect(
        participationService.updateEventNote(ev.id, 1, 'Stale update', 'user-tyler', 'desktop-client')
      ).rejects.toThrow(ConcurrencyError);
    });

    it('performs a no-op when the normalized note is unchanged without incrementing version', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const session = await sessionService.getOrCreateSession(section!.id, getSchoolLocalDate());

      const events = await participationService.recordParticipation({
        classEnrollmentIds: [enrollments[0].id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-idea',
        note: 'Clean note',
        localSchoolDate: getSchoolLocalDate(),
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      const ev = events[0];
      const initialAuditCount = await db.auditEntries.count();

      // Pass trimmed identical note
      const res = await participationService.updateEventNote(ev.id, ev.version, '  Clean note  ', 'user-tyler', 'desktop-client');
      expect(res.version).toBe(ev.version); // not incremented
      expect(await db.auditEntries.count()).toBe(initialAuditCount); // no audit noise
    });
  });

  describe('7. Retraction & Summary Recalculation (retractEvent)', () => {
    it('retracts event, recalculates daily summary atomically, and logs deletion diff', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const targetEnrollment = enrollments[0];
      const targetDate = shiftSchoolDate(getSchoolLocalDate(), -1);
      const occurredAt1 = buildTorontoTimestamp(targetDate, '10:00');
      const occurredAt2 = buildTorontoTimestamp(targetDate, '10:15');

      const session = await sessionService.getOrCreateSession(section!.id, targetDate, {
        startsAt: occurredAt1
      });

      // Record two events on targetDate
      const evs1 = await participationService.recordParticipation({
        classEnrollmentIds: [targetEnrollment.id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-risk',
        localSchoolDate: targetDate,
        occurredAt: occurredAt1,
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      const evs2 = await participationService.recordParticipation({
        classEnrollmentIds: [targetEnrollment.id],
        classSectionId: section!.id,
        classSessionId: session.id,
        eventTypeId: 'pet-idea',
        localSchoolDate: targetDate,
        occurredAt: occurredAt2,
        userId: 'user-tyler',
        deviceId: 'desktop-client'
      });

      // Daily summary should reflect 3 points (pet-risk: 2.0, pet-idea: 1.0)
      let summary = await db.participationDailySummaries
        .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: targetDate })
        .first();
      expect(summary!.totalPoints).toBe(3);
      expect(summary!.positiveCount).toBe(2);

      // Retract first event (2 points) with expectedVersion 1
      await participationService.retractEvent(
        evs1[0].id,
        evs1[0].version,
        'user-tyler',
        'desktop-client',
        'Recorded against wrong student'
      );

      // Re-fetch event and verify soft-deleted
      const reloadedEv1 = await db.participationEvents.get(evs1[0].id);
      expect(reloadedEv1!.deletedAt).not.toBeNull();
      expect(reloadedEv1!.version).toBe(2);

      // Daily summary should now reflect 1 point and 1 positive count
      summary = await db.participationDailySummaries
        .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: targetDate })
        .first();
      expect(summary!.totalPoints).toBe(1);
      expect(summary!.positiveCount).toBe(1);

      // Retracting already retracted event throws ValidationError
      await expect(
        participationService.retractEvent(evs1[0].id, 2, 'user-tyler', 'desktop-client')
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('8. Indexed Compound Range Query Correctness', () => {
    it('accurately queries events using [classSectionId+localSchoolDate] compound index boundaries', async () => {
      const section = await db.classSections.toCollection().first();
      const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
      const targetEnrollment = enrollments[0];

      // Seed 5 distinct dates
      const dates = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
      for (const d of dates) {
        const occAt = buildTorontoTimestamp(d, '10:00');
        const sessionD = await sessionService.getOrCreateSession(section!.id, d, { startsAt: occAt });
        await participationService.recordParticipation({
          classEnrollmentIds: [targetEnrollment.id],
          classSectionId: section!.id,
          classSessionId: sessionD.id,
          eventTypeId: 'pet-idea',
          localSchoolDate: d,
          occurredAt: occAt,
          userId: 'user-tyler',
          deviceId: 'desktop-client'
        });
      }

      // Query inclusive range 2026-09-09 to 2026-09-11 on compound index
      const queried = await db.participationEvents
        .where('[classSectionId+localSchoolDate]')
        .between([section!.id, '2026-09-09'], [section!.id, '2026-09-11'], true, true)
        .filter(e => e.deletedAt === null)
        .toArray();

      expect(queried.length).toBe(3);
      const datesInResult = queried.map(e => e.localSchoolDate).sort();
      expect(datesInResult).toEqual(['2026-09-09', '2026-09-10', '2026-09-11']);
    });
  });
});
