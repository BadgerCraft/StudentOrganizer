import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { StudentDomainService } from './studentService';
import { SyncOutboxWorker } from './syncOutbox';
import type { SyncMutation, Student } from '../types/schema';

describe('Student Photo Sync Payload Hygiene & Local Photo Preservation', () => {
  let db: OntarioTeacherDB;
  let studentService: StudentDomainService;
  let syncWorker: SyncOutboxWorker;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-photo-sync-${crypto.randomUUID()}`);
    await seedDatabase(db);
    studentService = new StudentDomainService(db);
    syncWorker = new SyncOutboxWorker(db);
  });

  it('Direction 1 (Outbound): updating student profile omits photoUrl completely from SyncMutation.payloadJson', async () => {
    const student = (await db.students.toCollection().first())!;
    const mockDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP==';

    const updated = await studentService.updateStudentProfile({
      studentId: student.id,
      expectedVersion: student.version,
      firstName: student.firstName,
      lastName: student.lastName,
      preferredName: 'Updated Preferred',
      pronouns: 'they/them',
      photoUrl: mockDataUrl,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    // Local student has photoUrl set
    expect(updated.photoUrl).toBe(mockDataUrl);
    const localInDb = await db.students.get(student.id);
    expect(localInDb!.photoUrl).toBe(mockDataUrl);

    // Relational SyncMutation omits photoUrl entirely (not even null!)
    const sync = await db.syncMutations.where({ entityId: student.id, entityName: 'students' }).last();
    expect(sync).toBeDefined();

    const payload = JSON.parse(sync!.payloadJson);
    expect('photoUrl' in payload).toBe(false);
    expect(payload.preferredName).toBe('Updated Preferred');
    expect(payload.pronouns).toBe('they/them');
  });

  it('Direction 2 (Inbound): receiving inbound sync mutation without photoUrl preserves device local photo', async () => {
    const student = (await db.students.toCollection().first())!;
    const localPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Set local photo on student
    await db.students.update(student.id, {
      photoUrl: localPhoto
    });

    const beforeSync = await db.students.get(student.id);
    expect(beforeSync!.photoUrl).toBe(localPhoto);

    // Simulate an inbound SyncMutation arriving from another device/server without photoUrl
    const remoteInboundPayload = {
      id: student.id,
      organizationId: student.organizationId,
      localStudentNumber: student.localStudentNumber,
      oenEncrypted: null,
      firstName: 'RemoteUpdatedFirst',
      lastName: student.lastName,
      preferredName: 'New Remote Preferred',
      pronouns: 'she/her',
      createdAt: student.createdAt,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      version: student.version + 1
      // NOTE: photoUrl is omitted!
    };

    const mockInboundMutation: SyncMutation = {
      id: crypto.randomUUID(),
      deviceId: 'remote-device-42',
      organizationId: student.organizationId,
      mutationId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      sequenceNumber: 1,
      transactionSize: 1,
      entityName: 'students',
      entityId: student.id,
      operation: 'UPDATE',
      payloadJson: JSON.stringify(remoteInboundPayload),
      baseVersion: student.version,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      acknowledgedAt: null
    };

    // Apply inbound mutation
    await syncWorker.applyInboundMutation(mockInboundMutation);

    // Verify local DB: student metadata updated from remote, but local photo preserved!
    const afterSync = await db.students.get(student.id);
    expect(afterSync!.firstName).toBe('RemoteUpdatedFirst');
    expect(afterSync!.preferredName).toBe('New Remote Preferred');
    expect(afterSync!.pronouns).toBe('she/her');
    expect(afterSync!.photoUrl).toBe(localPhoto); // Preserved!
  });
});
