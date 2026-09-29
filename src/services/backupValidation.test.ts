import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from './portabilityService';
import { parseRosterText } from './rosterParser';

describe('Backup Pre-Validation and Safe Atomic Restore Suite', () => {
  let db: OntarioTeacherDB;
  let portability: PortabilityService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-backupval-${crypto.randomUUID()}`);
    await seedDatabase(db);
    portability = new PortabilityService(db);
  });

  it('rejects malformed JSON syntax and leaves database completely untouched', async () => {
    const studentCountBefore = await db.students.count();
    const courseCountBefore = await db.courses.count();

    const corruptJson = '{"version": 1, "tables": { not valid json';

    await expect(portability.restoreFromJSON(corruptJson)).rejects.toThrow(
      'Invalid backup file: Not a valid JSON document.'
    );

    // Assert DB is untouched
    expect(await db.students.count()).toBe(studentCountBefore);
    expect(await db.courses.count()).toBe(courseCountBefore);
  });

  it('rejects JSON missing the tables dictionary and leaves database untouched', async () => {
    const studentCountBefore = await db.students.count();

    const invalidJson = JSON.stringify({ version: 2, schemaVersion: 3, somethingElse: true });

    await expect(portability.restoreFromJSON(invalidJson)).rejects.toThrow(
      'Invalid backup file format: Missing "tables" dictionary.'
    );

    expect(await db.students.count()).toBe(studentCountBefore);
  });

  it('rejects backup with unsupported or missing schemaVersion and leaves database untouched', async () => {
    const studentCountBefore = await db.students.count();

    const noSchemaVersionJson = JSON.stringify({
      version: 1,
      tables: {}
    });

    await expect(portability.restoreFromJSON(noSchemaVersionJson)).rejects.toThrow(
      'Invalid backup file: Unsupported or missing schemaVersion'
    );

    const unsupportedSchemaJson = JSON.stringify({
      version: 1,
      schemaVersion: 99,
      tables: {}
    });

    await expect(portability.restoreFromJSON(unsupportedSchemaJson)).rejects.toThrow(
      'Invalid backup file: Unsupported or missing schemaVersion (99)'
    );

    expect(await db.students.count()).toBe(studentCountBefore);
  });

  it('rejects partial backup with only four core tables, missing courses, and leaves all existing data intact', async () => {
    const studentCountBefore = await db.students.count();
    const courseCountBefore = await db.courses.count();
    const sectionCountBefore = await db.classSections.count();

    // Partial backup containing only 4 tables, leaving omitted tables like 'courses' out
    const partialBackupJson = JSON.stringify({
      version: 2,
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      tables: {
        users: [{ id: 'u1' }],
        organizations: [{ id: 'org1' }],
        classSections: [{ id: 'cs1' }],
        students: [{ id: 's1' }]
        // Missing 'courses', 'academicYears', 'terms', 'units', etc.
      }
    });

    await expect(portability.restoreFromJSON(partialBackupJson)).rejects.toThrow(
      'Invalid backup file: Incomplete backup. Missing table'
    );

    // Assert database remains 100% untouched across all tables
    expect(await db.students.count()).toBe(studentCountBefore);
    expect(await db.courses.count()).toBe(courseCountBefore);
    expect(await db.classSections.count()).toBe(sectionCountBefore);
  });

  it('rejects backup where a table is non-array and leaves database untouched', async () => {
    const studentCountBefore = await db.students.count();
    const fullBackup = JSON.parse(await portability.createFullBackupJSON());
    fullBackup.tables.students = 'not an array';

    await expect(portability.restoreFromJSON(JSON.stringify(fullBackup))).rejects.toThrow(
      'Invalid backup file: Table "students" must be an array of records.'
    );

    expect(await db.students.count()).toBe(studentCountBefore);
  });

  it('rejects backup with invalid record shapes (missing or invalid id) and leaves database untouched', async () => {
    const studentCountBefore = await db.students.count();
    const fullBackup = JSON.parse(await portability.createFullBackupJSON());
    // Insert invalid record shape into students table
    fullBackup.tables.students.push({ id: '', firstName: 'NoId' });

    await expect(portability.restoreFromJSON(JSON.stringify(fullBackup))).rejects.toThrow(
      'contains record at index'
    );

    expect(await db.students.count()).toBe(studentCountBefore);
  });

  it('successfully pre-validates and restores a valid backup atomically', async () => {
    // 1. Create a full backup of current state
    const originalBackupJson = await portability.createFullBackupJSON();

    // 2. Validate metadata without touching DB
    const metadata = portability.validateBackupJSON(originalBackupJson);
    expect(metadata.totalRecords).toBeGreaterThan(50);
    expect(metadata.tableSummary.students).toBeGreaterThan(0);
    expect(metadata.tableSummary.classSections).toBeGreaterThan(0);

    // 3. Mutate the DB (delete all students)
    await db.students.clear();
    expect(await db.students.count()).toBe(0);

    // 4. Restore from backup
    const result = await portability.restoreFromJSON(originalBackupJson);
    expect(result.restoredTables).toBeGreaterThan(20);
    expect(result.totalRecords).toBeGreaterThan(50);

    // 5. Verify records are fully recovered in the database
    const studentCountAfter = await db.students.count();
    expect(studentCountAfter).toBe(metadata.tableSummary.students);
    const recoveredStudent = await db.students.toCollection().first();
    expect(recoveredStudent).toBeDefined();
    expect(recoveredStudent!.lastName).toBeDefined();
  });

  it('rejects id-only user backup and leaves original user full record completely unchanged', async () => {
    // 1. Create full backup
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);

    // 2. Capture original user record from database
    const originalUser = await db.users.get('user-tyler');
    expect(originalUser).toBeDefined();
    expect(originalUser!.name).toBe('Taylor Demo');
    expect(originalUser!.email).toBe('taylor.demo@example.invalid');
    expect(originalUser!.authSubject).toBe('google-oauth2|local-teacher-demo');

    // 3. Mutate backup: replace first record in tables.users with { "id": "<original user's ID>" }
    backup.tables.users[0] = { id: originalUser!.id };

    // 4. Attempt restore: must reject before clearing any table
    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      'Table "users" contains record at index 0 with missing or invalid required field'
    );

    // 5. Verify original user's full record remains completely intact and unchanged
    const userAfter = await db.users.get('user-tyler');
    expect(userAfter).toBeDefined();
    expect(userAfter!.name).toBe('Taylor Demo');
    expect(userAfter!.email).toBe('taylor.demo@example.invalid');
    expect(userAfter!.authSubject).toBe('google-oauth2|local-teacher-demo');
    expect(userAfter!.version).toBe(originalUser!.version);
  });

  it('rejects malformed student record and leaves existing student data completely intact', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);

    const originalStudent = await db.students.get('student-1');
    expect(originalStudent).toBeDefined();
    const studentCountBefore = await db.students.count();

    // Incomplete student missing lastName, organizationId, localStudentNumber
    backup.tables.students[0] = { id: originalStudent!.id, firstName: 'Malformed' };

    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      'Table "students" contains record at index 0 with missing or invalid required field'
    );

    // Assert existing data remains untouched
    expect(await db.students.count()).toBe(studentCountBefore);
    const studentAfter = await db.students.get('student-1');
    expect(studentAfter).toEqual(originalStudent);
  });

  it('rejects malformed classEnrollment record and leaves existing enrollment data completely intact', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);

    const originalEnr = (await db.classEnrollments.toCollection().first())!;
    expect(originalEnr).toBeDefined();
    const enrCountBefore = await db.classEnrollments.count();

    // Incomplete enrollment missing classSectionId, enrollmentStatus, enrolledDate
    backup.tables.classEnrollments[0] = { id: originalEnr.id, studentId: 'student-1' };

    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      'Table "classEnrollments" contains record at index 0 with missing or invalid required field'
    );

    // Assert existing data remains untouched
    expect(await db.classEnrollments.count()).toBe(enrCountBefore);
    const enrAfter = await db.classEnrollments.get(originalEnr.id);
    expect(enrAfter).toEqual(originalEnr);
  });

  it('validates and restores backup exported immediately after real roster import containing syncMutations with operation', async () => {
    const section = (await db.classSections.toCollection().first())!;
    const rosterPaste = 'QA Student, Fictional\tQA-SYNC-001\n';
    const parsed = parseRosterText(rosterPaste);
    const candidates = await portability.validateRosterCandidates(section.id, parsed.rows);

    const importResult = await portability.importRosterBatch({
      classSectionId: section.id,
      rows: candidates,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(importResult.importedCount).toBe(1);

    // Verify syncMutations were created with 'operation' field (not 'action')
    const syncCount = await db.syncMutations.count();
    expect(syncCount).toBeGreaterThan(0);
    const mutation = (await db.syncMutations.toCollection().first())!;
    expect(mutation.operation).toBe('INSERT');
    expect((mutation as any).action).toBeUndefined();

    // Export full backup immediately afterward
    const backupWithSync = await portability.createFullBackupJSON();
    const parsedBackup = JSON.parse(backupWithSync);
    expect(parsedBackup.tables.syncMutations.length).toBeGreaterThan(0);
    expect(parsedBackup.tables.syncMutations[0].operation).toBe('INSERT');

    // Pre-validate backup: MUST pass without error
    const meta = portability.validateBackupJSON(backupWithSync);
    expect(meta.tableSummary.syncMutations).toBe(syncCount);

    // Wipe database and restore from backup into a fresh database instance
    const freshDb = new OntarioTeacherDB(`test-fresh-sync-restore-${crypto.randomUUID()}`);
    const freshPortability = new PortabilityService(freshDb);
    const restoreRes = await freshPortability.restoreFromJSON(backupWithSync);

    expect(restoreRes.restoredTables).toBeGreaterThan(20);
    expect(await freshDb.syncMutations.count()).toBe(syncCount);
    expect(await freshDb.students.where('localStudentNumber').equals('QA-SYNC-001').count()).toBe(1);
    const importedStudent = await freshDb.students.where('localStudentNumber').equals('QA-SYNC-001').first();
    expect(importedStudent!.lastName).toBe('QA Student');
    expect(importedStudent!.firstName).toBe('Fictional');
  });

  it('rejects backup with enrollment pointing to nonexistent student and leaves entire database unchanged', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);

    const studentCountBefore = await db.students.count();
    const enrollmentCountBefore = await db.classEnrollments.count();
    const sectionCountBefore = await db.classSections.count();
    const originalEnrollment = await db.classEnrollments.get(backup.tables.classEnrollments[0].id);

    // Break foreign key: point studentId to a nonexistent student ID
    const nonexistentStudentId = 'nonexistent-student-id-99999';
    backup.tables.classEnrollments[0].studentId = nonexistentStudentId;

    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      `Invalid backup file: Broken reference in table "classEnrollments" at index 0. Field "studentId" references nonexistent record "${nonexistentStudentId}" in table "students".`
    );

    // Assert entire database remains completely intact and untouched
    expect(await db.students.count()).toBe(studentCountBefore);
    expect(await db.classEnrollments.count()).toBe(enrollmentCountBefore);
    expect(await db.classSections.count()).toBe(sectionCountBefore);
    const enrollmentAfter = await db.classEnrollments.get(originalEnrollment!.id);
    expect(enrollmentAfter).toEqual(originalEnrollment);
  });

  it('rejects backup with broken categoryResult reference to nonexistent studentAssessment and leaves DB untouched', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);
    const resultCountBefore = await db.categoryResults.count();

    backup.tables.categoryResults[0].studentAssessmentId = 'nonexistent-sa-id-88888';

    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      'Broken reference in table "categoryResults" at index 0. Field "studentAssessmentId" references nonexistent record "nonexistent-sa-id-88888" in table "studentAssessments"'
    );

    expect(await db.categoryResults.count()).toBe(resultCountBefore);
  });

  it('rejects backup with broken classSection reference to nonexistent course and leaves DB untouched', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);
    const sectionCountBefore = await db.classSections.count();

    backup.tables.classSections[0].courseId = 'nonexistent-course-id-77777';

    await expect(portability.restoreFromJSON(JSON.stringify(backup))).rejects.toThrow(
      'Broken reference in table "classSections" at index 0. Field "courseId" references nonexistent record "nonexistent-course-id-77777" in table "courses"'
    );

    expect(await db.classSections.count()).toBe(sectionCountBefore);
  });

  it('successfully validates and restores a representative schemaVersion 2 backup with legacy fields', async () => {
    const fullBackup = JSON.parse(await portability.createFullBackupJSON());

    // Transform into a genuine schemaVersion 2 backup:
    // - schemaVersion: 2
    // - assessmentCategories use 'weight' instead of 'evidenceWeight'
    // - markScaleEntries use 'name' instead of 'label'
    // - participationEventTypes use 'name' instead of 'label', omit recordingMode and sortOrder
    // - participationEvents omit snapshottedRecordingMode and achievementLevel
    // - studentAssessments omit classSectionId
    const v2Backup = {
      version: 1,
      schemaVersion: 2,
      exportedAt: '2026-08-15T12:00:00.000Z',
      tables: {
        ...fullBackup.tables,
        assessmentCategories: fullBackup.tables.assessmentCategories.map((cat: any) => {
          const { evidenceWeight, ...rest } = cat;
          return { ...rest, weight: evidenceWeight ?? 1.5 };
        }),
        markScaleEntries: fullBackup.tables.markScaleEntries.map((entry: any) => {
          const { label, ...rest } = entry;
          return { ...rest, name: label ?? entry.code };
        }),
        participationEventTypes: fullBackup.tables.participationEventTypes.map((t: any) => {
          const { label, recordingMode, defaultCategoryCode, sortOrder, ...rest } = t;
          return { ...rest, name: label ?? t.code };
        }),
        participationEvents: fullBackup.tables.participationEvents.map((ev: any) => {
          const { snapshottedRecordingMode, achievementLevel, ...rest } = ev;
          return rest;
        }),
        studentAssessments: fullBackup.tables.studentAssessments.map((sa: any) => {
          const { classSectionId, ...rest } = sa;
          return rest;
        })
      }
    };

    // 1. Pre-validation must succeed
    const meta = portability.validateBackupJSON(JSON.stringify(v2Backup));
    expect(meta.totalRecords).toBeGreaterThan(50);

    // 2. Restore into fresh database must succeed
    const freshDb = new OntarioTeacherDB(`test-v2-restore-${crypto.randomUUID()}`);
    const freshPortability = new PortabilityService(freshDb);
    const res = await freshPortability.restoreFromJSON(JSON.stringify(v2Backup));
    expect(res.restoredTables).toBeGreaterThan(20);

    // 3. Verify in-memory migrations occurred:
    // - assessmentCategories evidenceWeight migrated from weight
    const restoredCat = (await freshDb.assessmentCategories.toCollection().first())!;
    expect(restoredCat.evidenceWeight).toBeDefined();
    expect(typeof restoredCat.evidenceWeight).toBe('number');

    // - markScaleEntries label migrated from name
    const restoredEntry = (await freshDb.markScaleEntries.toCollection().first())!;
    expect(restoredEntry.label).toBeDefined();

    // - participationEventTypes backfilled with recordingMode, sortOrder, label
    const restoredType = (await freshDb.participationEventTypes.toCollection().first())!;
    expect(restoredType.recordingMode).toBe('quick_tally');
    expect(restoredType.name).toBeDefined();
    expect(typeof restoredType.sortOrder).toBe('number');

    // - studentAssessments classSectionId backfilled from enrollment
    const restoredSa = (await freshDb.studentAssessments.toCollection().first())!;
    expect(restoredSa.classSectionId).toBeDefined();
    expect(typeof restoredSa.classSectionId).toBe('string');
  });

  it('preserves historical audit and sync records that reference past entities without error', async () => {
    const backupJson = await portability.createFullBackupJSON();
    const backup = JSON.parse(backupJson);

    // Add historical audit entry for an entity that was deleted and no longer in the tables
    backup.tables.auditEntries.push({
      id: crypto.randomUUID(),
      entityName: 'students',
      entityId: 'historical-deleted-student-999',
      action: 'DELETE',
      transactionId: crypto.randomUUID(),
      previousStateJson: JSON.stringify({ id: 'historical-deleted-student-999', firstName: 'Old' }),
      newStateJson: null,
      diffJson: null,
      userId: 'user-tyler',
      timestamp: new Date().toISOString(),
      clientVersion: '1.0.0'
    });

    // Add sync mutation for past entity
    backup.tables.syncMutations.push({
      id: crypto.randomUUID(),
      deviceId: 'dev-1',
      organizationId: backup.tables.organizations[0].id,
      mutationId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      sequenceNumber: 1,
      transactionSize: 1,
      entityName: 'students',
      entityId: 'historical-deleted-student-999',
      operation: 'DELETE',
      payloadJson: JSON.stringify({ id: 'historical-deleted-student-999' }),
      baseVersion: 1,
      status: 'acknowledged',
      createdAt: new Date().toISOString(),
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
      acknowledgedAt: new Date().toISOString()
    });

    // Must pass validation and restore without discarding historical records
    const meta = portability.validateBackupJSON(JSON.stringify(backup));
    expect(meta.tableSummary.auditEntries).toBe(backup.tables.auditEntries.length);
    expect(meta.tableSummary.syncMutations).toBe(backup.tables.syncMutations.length);

    const freshDb = new OntarioTeacherDB(`test-hist-restore-${crypto.randomUUID()}`);
    const freshPortability = new PortabilityService(freshDb);
    await freshPortability.restoreFromJSON(JSON.stringify(backup));

    expect(await freshDb.auditEntries.where('entityId').equals('historical-deleted-student-999').count()).toBe(1);
    expect(await freshDb.syncMutations.where('entityId').equals('historical-deleted-student-999').count()).toBe(1);
  });
});
