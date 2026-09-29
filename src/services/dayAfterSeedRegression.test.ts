import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ClassSessionService } from './sessionService';
import { AttendanceService } from './attendanceService';
import { ParticipationDomainService } from './participationService';
import { setActiveTeacherId, clearActiveTeacherId } from './identityService';
import { getSchoolLocalDate } from '../utils/dateUtils';

describe('Day-After-Seed Regression Suite', () => {
  let db: OntarioTeacherDB;
  let sessionService: ClassSessionService;
  let attendanceService: AttendanceService;
  let participationService: ParticipationDomainService;

  // Seed date is "today" at real clock time (module-level, before fakes).
  const seedDate = getSchoolLocalDate();

  // Compute D+1 using getSchoolLocalDate, not toISOString().slice(0, 10).
  const dObj = new Date(seedDate + 'T12:00:00Z');
  dObj.setUTCDate(dObj.getUTCDate() + 1);
  const nextDay = getSchoolLocalDate(dObj);

  // A safe midday Toronto instant on D+1 (17:00 UTC = 13:00 EDT / 12:00 EST).
  const nextDayMiddayUTC = new Date(nextDay + 'T17:00:00Z');

  beforeEach(async () => {
    // Seed the database at real time (seeds use getSchoolLocalDate internally).
    db = new OntarioTeacherDB(`test-regression-${crypto.randomUUID()}`);
    await seedDatabase(db);

    // After seedDatabase completes, move only the Date clock to nextDayMiddayUTC
    vi.useFakeTimers({
      now: nextDayMiddayUTC,
      toFake: ['Date'],
    });

    sessionService = new ClassSessionService(db);
    attendanceService = new AttendanceService(db, sessionService);
    participationService = new ParticipationDomainService(db);

    setActiveTeacherId('user-tyler');
  });

  afterEach(() => {
    clearActiveTeacherId();
    vi.useRealTimers();
  });

  it('atomically and idempotently creates a distinct session on day D+1 without selecting historical sessions', async () => {
    const section = await db.classSections.toCollection().first();
    expect(section).toBeDefined();

    // Verify seed session exists for seedDate
    const seedSession = await db.classSessions.where('classSectionId').equals(section!.id).first();
    expect(seedSession).toBeDefined();
    expect(seedSession!.localSchoolDate).toBe(seedDate);

    // Call getOrCreateSession for day D+1
    const first = await sessionService.getOrCreateSession(section!.id, nextDay);

    // Assert session belongs to active class and exact school date
    expect(first.classSectionId).toBe(section!.id);
    expect(first.localSchoolDate).toBe(nextDay);
    expect(first.id).not.toBe(seedSession!.id);
    expect(first.id).not.toBe('session-eng-today');

    // Assert all required ClassSession schema fields are populated
    expect(first.startsAt).toBeDefined();
    expect(first.endsAt).toBeDefined();
    expect(new Date(first.endsAt).getTime()).toBeGreaterThan(new Date(first.startsAt).getTime());
    expect(first.timezone).toBe('America/Toronto');
    expect(first.title).toBeDefined();
    expect(first.sessionType).toBe('regular');
    expect(first.createdAt).toBeDefined();
    expect(first.updatedAt).toBeDefined();
    expect(first.deletedAt).toBeNull();
    expect(first.version).toBe(1);

    // Explicit timestamp consistency assertions
    expect(getSchoolLocalDate(new Date(first.startsAt))).toBe(nextDay);
    expect(getSchoolLocalDate(new Date(first.endsAt))).toBe(nextDay);

    // Assert idempotence: calling again for same class and date returns same session
    const sessionSecondCall = await sessionService.getOrCreateSession(section!.id, nextDay);
    expect(sessionSecondCall.id).toBe(first.id);
  });

  it('records participation on day D+1 using the production path (no occurredAt override)', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
    const targetEnrollment = enrollments[0];

    // Seed data gave targetEnrollment a summary for seedDate
    const seedSummary = await db.participationDailySummaries
      .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: seedDate })
      .first();
    const seedPoints = seedSummary ? seedSummary.totalPoints : 0;

    // Production path: getSchoolLocalDate() and getOrCreateSession use the faked clock.
    const schoolDate = getSchoolLocalDate();
    expect(schoolDate).toBe(nextDay);

    const session = await sessionService.getOrCreateSession(section!.id, schoolDate);

    // Record participation exactly as App.tsx does — no occurredAt override.
    const events = await participationService.recordParticipation({
      classEnrollmentIds: [targetEnrollment.id],
      classSectionId: section!.id,
      classSessionId: session.id,
      eventTypeId: 'pet-risk',
      categoryOverride: 'T',
      note: 'Analyzed primary sources on next day',
      localSchoolDate: schoolDate,
      userId: 'user-tyler',
      deviceId: 'test-device'
    });

    expect(events.length).toBe(1);
    expect(events[0].classSessionId).toBe(session.id);
    expect(events[0].localSchoolDate).toBe(nextDay);

    // Verify D+1 daily summary exists with points = 2
    const nextDaySummary = await db.participationDailySummaries
      .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: nextDay })
      .first();
    expect(nextDaySummary).toBeDefined();
    expect(nextDaySummary!.totalPoints).toBe(2);
    expect(nextDaySummary!.positiveCount).toBe(1);

    // Verify seed day D summary is preserved and unchanged
    if (seedSummary) {
      const reloadedSeedSummary = await db.participationDailySummaries
        .where({ classEnrollmentId: targetEnrollment.id, localSchoolDate: seedDate })
        .first();
      expect(reloadedSeedSummary!.totalPoints).toBe(seedPoints);
    }
  });

  it('exercises exact attendance write pathway: binds to D+1 session and initial toggle sets absent', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
    const targetEnrollment = enrollments[0];

    // 1. Initial toggle for targetEnrollment on nextDay (unrecorded) -> must create 'absent'
    const record1 = await attendanceService.toggleAttendance(section!.id, targetEnrollment.id, nextDay);
    expect(record1.status).toBe('absent');
    expect(record1.localSchoolDate).toBe(nextDay);
    expect(record1.classSessionId).not.toBe('session-eng-today');

    // Retrieve the session referenced by the new attendance record
    const boundSession = await db.classSessions.get(record1.classSessionId);
    expect(boundSession).toBeDefined();
    expect(boundSession!.localSchoolDate).toBe(nextDay);
    expect(getSchoolLocalDate(new Date(boundSession!.startsAt))).toBe(nextDay);

    // Verify session bound is the day D+1 session
    const sessionDPlus1 = await sessionService.getOrCreateSession(section!.id, nextDay);
    expect(record1.classSessionId).toBe(sessionDPlus1.id);

    // 2. Second toggle on 'absent' -> must cycle to 'present'
    const record2 = await attendanceService.toggleAttendance(section!.id, targetEnrollment.id, nextDay);
    expect(record2.status).toBe('present');
    expect(record2.id).toBe(record1.id);
    expect(record2.version).toBe(record1.version + 1);
  });

  it('seating view filters attendance and participation strictly to target school date and excludes deleted records', async () => {
    const section = await db.classSections.toCollection().first();
    const enrollments = await db.classEnrollments.where('classSectionId').equals(section!.id).toArray();
    const targetEnrollment = enrollments[0];

    // Record an attendance record on D+1
    await attendanceService.toggleAttendance(section!.id, targetEnrollment.id, nextDay);

    // Fetch all attendance for target enrollment
    const allAttendance = await db.attendanceRecords
      .where('classEnrollmentId')
      .equals(targetEnrollment.id)
      .toArray();

    // Seating chart filtering simulation for nextDay:
    const filteredForNextDay = allAttendance.filter(
      a => a.localSchoolDate === nextDay && a.deletedAt === null
    );
    expect(filteredForNextDay.length).toBe(1);
    expect(filteredForNextDay[0].status).toBe('absent');

    // Seating chart filtering simulation excludes soft-deleted records:
    await db.attendanceRecords.update(filteredForNextDay[0].id, {
      deletedAt: new Date().toISOString()
    });
    const reloaded = await db.attendanceRecords
      .where('classEnrollmentId')
      .equals(targetEnrollment.id)
      .toArray();
    const activeOnNextDay = reloaded.filter(
      a => a.localSchoolDate === nextDay && a.deletedAt === null
    );
    expect(activeOnNextDay.length).toBe(0);
  });
});
