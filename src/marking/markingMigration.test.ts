import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { clearActiveTeacherId, getIdentityEpoch, selectActingTeacher } from '../services/identityService';
import { MarkingService } from './markingService';
import { organizerV3Stores } from './fixtures/organizerV3Stores';

const markingTables = ['markingRubrics', 'markingAttempts', 'markingSessions', 'markingCommits'];

async function snapshot(db: Dexie) {
  const records: Record<string, unknown[]> = {};
  for (const name of Object.keys(organizerV3Stores)) {
    records[name] = await db.table(name).orderBy(':id').toArray();
  }
  return records;
}

describe('existing Organizer v3 databases open with Markinator v4', () => {
  it('preserves every legacy collection, indexes and historical records across upgrade and reopen', async () => {
    const name = `organizer-v3-upgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores(organizerV3Stores);
    const upgraded = new OntarioTeacherDB(name);
    try {
      await legacy.open();
      await seedDatabase(legacy as OntarioTeacherDB);
      // This fixture is fictional. Include tombstones and audit/outbox records as well as live data.
      const originalStudent = (await legacy.table('students').toArray())[0];
      await legacy.table('students').add({
        ...originalStudent, id: 'archived-fictional-student',
        localStudentNumber: 'FICTIONAL-ARCHIVED', deletedAt: '2026-10-01T12:00:00.000Z'
      });
      const enrollment = (await legacy.table('classEnrollments').toArray())[0];
      await legacy.table('studentNotes').add({
        id: 'legacy-fictional-note', classEnrollmentId: enrollment.id,
        authorUserId: 'user-tyler', content: 'Fictional historical classroom note',
        isConfidential: true, createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z', deletedAt: null, version: 1
      });
      await legacy.table('auditEntries').add({
        id: 'legacy-audit', entityName: 'students', entityId: originalStudent.id,
        action: 'UPDATE', transactionId: 'legacy-transaction', previousStateJson: null,
        newStateJson: JSON.stringify(originalStudent), diffJson: null,
        userId: 'user-tyler', timestamp: '2026-10-01T12:00:00.000Z', clientVersion: '1.0.0'
      });
      await legacy.table('syncMutations').add({
        id: 'legacy-pending', deviceId: 'fictional-device', mutationId: 'legacy-mutation',
        transactionId: 'legacy-transaction', organizationId: originalStudent.organizationId,
        status: 'pending', entityName: 'students', entityId: originalStudent.id,
        sequenceNumber: 1, transactionSize: 1, operation: 'UPDATE',
        payloadJson: JSON.stringify(originalStudent), baseVersion: originalStudent.version,
        attemptCount: 0, lastAttemptAt: null, lastError: null,
        createdAt: '2026-10-01T12:00:00.000Z', acknowledgedAt: null
      });
      const before = await snapshot(legacy);
      expect(before.students.length).toBeGreaterThan(1);
      expect(before.categoryResults.length).toBeGreaterThan(0);
      expect(before.participationEvents.length).toBeGreaterThan(0);
      expect(before.studentNotes.length).toBeGreaterThan(0);
      const priorIndexes = Object.fromEntries(legacy.tables.map(table => [
        table.name, table.schema.indexes.map(index => ({
          name: index.name, keyPath: index.keyPath, unique: index.unique, multi: index.multi
        }))
      ]));
      legacy.close();

      await upgraded.open();
      expect(upgraded.verno).toBe(4);
      expect(await snapshot(upgraded)).toEqual(before);
      expect(upgraded.tables.map(table => table.name).sort()).toEqual(
        [...Object.keys(organizerV3Stores), ...markingTables].sort()
      );
      for (const [tableName, indexes] of Object.entries(priorIndexes)) {
        expect(upgraded.table(tableName).schema.indexes.map(index => ({
          name: index.name, keyPath: index.keyPath, unique: index.unique, multi: index.multi
        }))).toEqual(indexes);
      }
      for (const table of markingTables) expect(await upgraded.table(table).count()).toBe(0);

      // Normal startup seeding must not replace a previously populated database.
      await seedDatabase(upgraded);
      expect(await snapshot(upgraded)).toEqual(before);
      const identity = await selectActingTeacher(upgraded, 'user-tyler');
      const actor = { userId: identity.userId, deviceId: identity.deviceId, epoch: getIdentityEpoch() };
      const service = new MarkingService(upgraded);
      const afterIdentity = await snapshot(upgraded);
      const context = await service.getContext('assess-eng-essay', actor);
      expect(context.assessment.id).toBe('assess-eng-essay');
      expect(context.currentResults.length).toBeGreaterThan(0);
      expect(await snapshot(upgraded)).toEqual(afterIdentity);
      const rubric = await service.saveRubric('assess-eng-essay', {
        title: 'Fictional post-upgrade rubric', levels: ['3'],
        criteria: [{ id: 'reasoning', name: 'Reasoning', categoryCode: 'T', descriptors: { '3': 'Clear reasoning' } }]
      }, actor);
      const afterRubric = await snapshot(upgraded);
      for (const table of Object.keys(organizerV3Stores).filter(name => name !== 'auditEntries')) {
        expect(afterRubric[table]).toEqual(afterIdentity[table]);
      }
      expect(afterRubric.auditEntries.length).toBe(afterIdentity.auditEntries.length + 1);
      upgraded.close();
      await upgraded.open();
      expect(await snapshot(upgraded)).toEqual(afterRubric);
      expect(await upgraded.markingRubrics.get(rubric.id)).toEqual(rubric);
    } finally {
      clearActiveTeacherId();
      legacy.close();
      await upgraded.delete();
    }
  });

  it('upgrades an empty existing v3 database without injecting classroom data', async () => {
    const name = `organizer-v3-empty-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores(organizerV3Stores);
    const upgraded = new OntarioTeacherDB(name);
    try {
      await legacy.open();
      legacy.close();
      await upgraded.open();
      expect(upgraded.verno).toBe(4);
      for (const table of upgraded.tables) expect(await table.count()).toBe(0);
      upgraded.close();
      await upgraded.open();
      for (const table of upgraded.tables) expect(await table.count()).toBe(0);
    } finally {
      legacy.close();
      await upgraded.delete();
    }
  });
});

