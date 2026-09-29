import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { StudentDomainService } from './studentService';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';

describe('StudentDomainService Suite', () => {
  let db: OntarioTeacherDB;
  let service: StudentDomainService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`student-service-test-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new StudentDomainService(db);
  });

  describe('Validation & Privacy Constraints', () => {
    it('rejects empty first name and empty last name', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version,
          firstName: '   ',
          lastName: 'Smith',
          preferredName: null,
          pronouns: null,
          photoUrl: null,
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version,
          firstName: 'John',
          lastName: '',
          preferredName: null,
          pronouns: null,
          photoUrl: null,
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(ValidationError);
    });

    it('forbids external http:// and https:// photo URLs', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version,
          firstName: student!.firstName,
          lastName: student!.lastName,
          preferredName: null,
          pronouns: null,
          photoUrl: 'https://example.com/student-photo.jpg',
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(/External photo URLs are not permitted/);

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version,
          firstName: student!.firstName,
          lastName: student!.lastName,
          preferredName: null,
          pronouns: null,
          photoUrl: 'http://insecure.com/student-photo.png',
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(/External photo URLs are not permitted/);
    });

    it('enforces maximum stored size limit of 64 KB for photo data URL', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      // Create a 70 KB data URL
      const largeData = 'data:image/jpeg;base64,' + 'A'.repeat(70 * 1024);

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version,
          firstName: student!.firstName,
          lastName: student!.lastName,
          preferredName: null,
          pronouns: null,
          photoUrl: largeData,
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(/exceeds the maximum allowed size of 64 KB/);
    });

    it('accepts valid local data URL photo under 64 KB', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      // Compact valid data URL
      const validPhoto = 'data:image/jpeg;base64,' + 'B'.repeat(1024);

      const updated = await service.updateStudentProfile({
        studentId: student!.id,
        expectedVersion: student!.version,
        firstName: 'Jane',
        lastName: 'Doe',
        preferredName: 'Janey',
        pronouns: 'she/they',
        photoUrl: validPhoto,
        userId: 'user-tyler',
        deviceId: 'device-test'
      });

      expect(updated.firstName).toBe('Jane');
      expect(updated.lastName).toBe('Doe');
      expect(updated.preferredName).toBe('Janey');
      expect(updated.pronouns).toBe('she/they');
      expect(updated.photoUrl).toBe(validPhoto);
      expect(updated.version).toBe(student!.version + 1);

      // Verify persisted in DB
      const stored = await db.students.get(student!.id);
      expect(stored!.photoUrl).toBe(validPhoto);
    });
  });

  describe('Optimistic Concurrency Control', () => {
    it('rejects update if expectedVersion does not match current record', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      await expect(
        service.updateStudentProfile({
          studentId: student!.id,
          expectedVersion: student!.version + 99,
          firstName: 'Alice',
          lastName: 'Smith',
          preferredName: null,
          pronouns: null,
          photoUrl: null,
          userId: 'user-tyler',
          deviceId: 'device-test'
        })
      ).rejects.toThrow(ConcurrencyError);
    });
  });

  describe('Audit Logging & Sync Mutation', () => {
    it('creates AuditEntry with redacted photoUrl in diffJson to prevent database bloat', async () => {
      const student = await db.students.toCollection().first();
      expect(student).toBeDefined();

      const photoData = 'data:image/jpeg;base64,' + 'C'.repeat(5000);

      const updated = await service.updateStudentProfile({
        studentId: student!.id,
        expectedVersion: student!.version,
        firstName: 'UpdatedFirst',
        lastName: 'UpdatedLast',
        preferredName: 'Nickname',
        pronouns: 'they/them',
        photoUrl: photoData,
        userId: 'user-tyler',
        deviceId: 'device-test'
      });

      const audit = await db.auditEntries
        .where('entityId')
        .equals(student!.id)
        .reverse()
        .first();

      expect(audit).toBeDefined();
      expect(audit!.action).toBe('UPDATE');
      expect(audit!.entityName).toBe('students');

      const diff = JSON.parse(audit!.diffJson!);
      expect(diff.photoUrl).toBeDefined();
      expect(diff.photoUrl.old).toBe(student!.photoUrl ? 'SET' : 'NONE');
      expect(diff.photoUrl.new).toBe('SET');
      expect(diff.photoUrl.changed).toBe(true);

      // Verify raw base64 data is NOT leaked into diffJson
      expect(audit!.diffJson).not.toContain(photoData);

      // Verify previousStateJson and newStateJson also redact photoUrl
      const prev = JSON.parse(audit!.previousStateJson!);
      const next = JSON.parse(audit!.newStateJson!);
      expect(prev.photoUrl).toBe(student!.photoUrl ? '[REDACTED]' : null);
      expect(next.photoUrl).toBe('[REDACTED]');

      // Verify SyncMutation record created
      const sync = await db.syncMutations
        .where('entityId')
        .equals(student!.id)
        .reverse()
        .first();

      expect(sync).toBeDefined();
      expect(sync!.operation).toBe('UPDATE');
      expect(sync!.entityName).toBe('students');
      expect(sync!.baseVersion).toBe(student!.version);
    });
  });
});
