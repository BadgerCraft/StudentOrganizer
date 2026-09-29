import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService, parseCSV } from './portabilityService';

describe('Transactional Roster Import & CSV Parser Suite', () => {
  let db: OntarioTeacherDB;
  let portability: PortabilityService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-roster-${crypto.randomUUID()}`);
    await seedDatabase(db);
    portability = new PortabilityService(db);
  });

  describe('RFC 4180 parseCSV', () => {
    it('correctly handles quoted fields containing commas', () => {
      const csv = 'Student ID,Last Name,First Name\n1001,"Smith, Jr.",John\n1002,"O\'Connor, III",Mary';
      const parsed = parseCSV(csv);

      expect(parsed.length).toBe(3);
      expect(parsed[1][1]).toBe('Smith, Jr.');
      expect(parsed[1][2]).toBe('John');
      expect(parsed[2][1]).toBe("O'Connor, III");
    });

    it('handles escaped quotes inside quoted strings', () => {
      const csv = 'ID,Name,Note\n101,John,"He said ""Hello"" to everyone"';
      const parsed = parseCSV(csv);

      expect(parsed.length).toBe(2);
      expect(parsed[1][2]).toBe('He said "Hello" to everyone');
    });

    it('strips UTF-8 BOM if present', () => {
      const csv = '\uFEFFStudent ID,Last Name,First Name\n2001,Taylor,Alex';
      const parsed = parseCSV(csv);

      expect(parsed[0][0]).toBe('Student ID');
      expect(parsed[1][0]).toBe('2001');
    });

    it('handles both CRLF and LF newlines', () => {
      const csv = 'ID,Last,First\r\n1,Alpha,One\r\n2,Beta,Two\n3,Gamma,Three';
      const parsed = parseCSV(csv);

      expect(parsed.length).toBe(4);
      expect(parsed[1][1]).toBe('Alpha');
      expect(parsed[3][1]).toBe('Gamma');
    });
  });

  describe('importRosterCSV Transactionality & Idempotency', () => {
    it('imports new students and enrollments with photoUrl omitted from SyncMutation', async () => {
      const section = (await db.classSections.toCollection().first())!;
      const csv = `Student ID,Last Name,First Name
S99001,"MacDonald, Jr.",Fiona
S99002,Kowalski,Stan`;

      const result = await portability.importRosterCSV({
        classSectionId: section.id,
        csvText: csv,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      });

      expect(result.importedCount).toBe(2);
      expect(result.newStudentsCount).toBe(2);
      expect(result.skippedDuplicates).toBe(0);

      // Verify students exist in DB with photoUrl: null
      const fiona = await db.students.where('localStudentNumber').equals('S99001').first();
      expect(fiona).toBeDefined();
      expect(fiona!.lastName).toBe('MacDonald, Jr.');
      expect(fiona!.photoUrl).toBeNull();

      // Verify SyncMutation omits photoUrl entirely from JSON payload
      const sync = await db.syncMutations.where('entityId').equals(fiona!.id).first();
      expect(sync).toBeDefined();
      const payload = JSON.parse(sync!.payloadJson);
      expect('photoUrl' in payload).toBe(false);
      expect(payload.firstName).toBe('Fiona');
      expect(payload.lastName).toBe('MacDonald, Jr.');

      // Verify ClassEnrollment
      const enr = await db.classEnrollments.where({ classSectionId: section.id, studentId: fiona!.id }).first();
      expect(enr).toBeDefined();
      expect(enr!.enrollmentStatus).toBe('active');
    });

    it('is idempotent on repeated imports: reuses students and skips duplicate enrollments', async () => {
      const section = (await db.classSections.toCollection().first())!;
      const csv = `Student ID,Last Name,First Name
S88001,Dupont,Jean
S88002,Tremblay,Luc`;

      // First import
      const res1 = await portability.importRosterCSV({
        classSectionId: section.id,
        csvText: csv,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      });

      expect(res1.importedCount).toBe(2);
      expect(res1.newStudentsCount).toBe(2);

      // Re-run same import on same class
      const res2 = await portability.importRosterCSV({
        classSectionId: section.id,
        csvText: csv,
        userId: 'user-tyler',
        deviceId: 'dev-1'
      });

      expect(res2.importedCount).toBe(0);
      expect(res2.newStudentsCount).toBe(0);
      expect(res2.existingLinkedCount).toBe(0);
      expect(res2.skippedDuplicates).toBe(2);

      // Verify total students did not duplicate
      const duponts = await db.students.where('localStudentNumber').equals('S88001').toArray();
      expect(duponts.length).toBe(1);
    });

    it('rolls back completely if any student row has invalid names', async () => {
      const section = (await db.classSections.toCollection().first())!;
      const initialStudentCount = await db.students.count();

      const invalidCsv = `Student ID,Last Name,First Name
S77001,ValidLast,ValidFirst
S77002,,`;

      await expect(
        portability.importRosterCSV({
          classSectionId: section.id,
          csvText: invalidCsv,
          userId: 'user-tyler',
          deviceId: 'dev-1'
        })
      ).rejects.toThrow();

      // Verify complete rollback: no new students committed
      const afterCount = await db.students.count();
      expect(afterCount).toBe(initialStudentCount);

      const partialStudent = await db.students.where('localStudentNumber').equals('S77001').first();
      expect(partialStudent).toBeUndefined();
    });
  });
});
