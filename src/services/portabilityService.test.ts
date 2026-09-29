import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from './portabilityService';

describe('Portability Service Suite (CSV & Backup/Restore)', () => {
  let db: OntarioTeacherDB;
  let portability: PortabilityService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-port-${crypto.randomUUID()}`);
    await seedDatabase(db);
    portability = new PortabilityService(db);
  });

  it('exports valid class markbook CSV with category subcolumns', async () => {
    const section = await db.classSections.toCollection().first();
    const csv = await portability.exportClassMarkbookCSV(section!.id, null);

    expect(csv).toContain('"Student ID","Last Name","First Name","Status"');
    expect(csv).toContain('Overall Calculated %');
    expect(csv).toContain('Overall Final %');
    expect(csv).toContain('Avery');
    expect(csv).toContain('Jordan');
  });

  it('exports raw participation events CSV with timestamps', async () => {
    const section = await db.classSections.toCollection().first();
    const csv = await portability.exportParticipationEventsCSV(section!.id);

    expect(csv).toContain('"Event ID","Student ID","Student Name","Date","Time (America/Toronto)"');
    expect(csv).toContain('Recording Mode');
    expect(csv).toContain('Contributed an idea');
    expect(csv).toContain('Used evidence');
  });

  it('backs up and restores full database state without loss', async () => {
    const backupJson = await portability.createFullBackupJSON();
    expect(backupJson.length).toBeGreaterThan(100);

    const res = await portability.restoreFromJSON(backupJson);
    expect(res.restoredTables).toBeGreaterThan(20);
    expect(res.totalRecords).toBeGreaterThan(50);
  });

  it('restores legacy backup with backfilled v3 fields, neutral events, and preserves null eventTypeId', async () => {
    const fullBackup = JSON.parse(await portability.createFullBackupJSON());
    const sampleOrgId = fullBackup.tables.organizations[0].id;
    const sampleEnrollmentId = fullBackup.tables.classEnrollments[0].id;
    const sampleSectionId = fullBackup.tables.classSections[0].id;
    const sampleSessionId = fullBackup.tables.classSessions[0].id;

    const legacyBackup = {
      ...fullBackup,
      version: 1,
      schemaVersion: 2,
      tables: {
        ...fullBackup.tables,
        participationEventTypes: [
          {
            id: 'legacy-type-1',
            organizationId: sampleOrgId,
            code: 'LEGACY_TYPE',
            name: 'Legacy Type',
            classification: 'positive',
            defaultPoints: 1.0,
            isArchived: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            version: 1
          }
        ],
        participationEvents: [
          {
            id: 'legacy-ev-1',
            classEnrollmentId: sampleEnrollmentId,
            classSectionId: sampleSectionId,
            classSessionId: sampleSessionId,
            eventTypeId: null,
            snapshottedName: 'Old Event 1',
            snapshottedClassification: 'positive',
            snapshottedPoints: 1.5,
            categoryCode: 'C',
            localSchoolDate: '2026-09-15',
            occurredAt: '2026-09-15T10:00:00.000Z',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            version: 1
          },
          {
            id: 'legacy-ev-2',
            classEnrollmentId: sampleEnrollmentId,
            classSectionId: sampleSectionId,
            classSessionId: sampleSessionId,
            eventTypeId: null,
            snapshottedName: 'Old Neutral Event',
            snapshottedClassification: 'neutral',
            snapshottedPoints: 0.0,
            categoryCode: null,
            localSchoolDate: '2026-09-15',
            occurredAt: '2026-09-15T10:10:00.000Z',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            version: 1
          }
        ],
        participationDailySummaries: []
      }
    };

    await portability.restoreFromJSON(JSON.stringify(legacyBackup));

    // Verify event type backfilled
    const restoredType = await db.participationEventTypes.get('legacy-type-1');
    expect(restoredType!.recordingMode).toBe('quick_tally');
    expect(restoredType!.defaultCategoryCode).toBeNull();
    expect(typeof restoredType!.sortOrder).toBe('number');
    expect(restoredType!.name).toBe('Legacy Type');

    // Verify historical events: eventTypeId remains null
    const restoredEv1 = await db.participationEvents.get('legacy-ev-1');
    expect(restoredEv1!.eventTypeId).toBeNull();
    expect(restoredEv1!.snapshottedRecordingMode).toBe('quick_tally');
    expect(restoredEv1!.achievementLevel).toBeNull();

    const restoredEv2 = await db.participationEvents.get('legacy-ev-2');
    expect(restoredEv2!.eventTypeId).toBeNull();
    expect(restoredEv2!.snapshottedClassification).toBe('neutral');

    // Verify rebuilt summary
    const summary = await db.participationDailySummaries
      .where({ classEnrollmentId: sampleEnrollmentId, localSchoolDate: '2026-09-15' })
      .first();
    expect(summary).toBeDefined();
    expect(summary!.positiveCount).toBe(1);
    expect(summary!.neutralCount).toBe(1);
    expect(summary!.totalPoints).toBe(1.5);
  });
});
