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

    expect(csv).toContain('Student ID,Last Name,First Name,Status');
    expect(csv).toContain('Overall Calculated %');
    expect(csv).toContain('Overall Final %');
    expect(csv).toContain('Avery');
    expect(csv).toContain('Jordan');
  });

  it('exports raw participation events CSV with timestamps', async () => {
    const section = await db.classSections.toCollection().first();
    const csv = await portability.exportParticipationEventsCSV(section!.id);

    expect(csv).toContain('Event ID,Student ID,Student Name,Date,Time (UTC)');
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
});
