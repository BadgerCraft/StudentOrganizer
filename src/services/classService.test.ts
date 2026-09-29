import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ClassDomainService } from './classService';

describe('ClassDomainService Suite', () => {
  let db: OntarioTeacherDB;
  let classService: ClassDomainService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-class-${crypto.randomUUID()}`);
    await seedDatabase(db);
    classService = new ClassDomainService(db);
  });

  it('creates class section with unit U1, grading policy, layout, and primary teacher', async () => {
    const section = await classService.createClassSection({
      courseCode: 'SCH3U',
      courseTitle: 'Grade 11 Chemistry',
      sectionNumber: '01',
      period: 'Period 2',
      roomNumber: 'Room 304',
      colorToken: '#10b981',
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(section).toBeDefined();
    expect(section.sectionNumber).toBe('01');

    // 1. Verify initial Unit (U1)
    const unit = await db.units.where('classSectionId').equals(section.id).first();
    expect(unit).toBeDefined();
    expect(unit!.code).toBe('U1');
    expect(unit!.title).toBe('Unit 1: Course Foundations');

    // 2. Verify default GradingPolicy
    const policy = await db.gradingPolicies.where('classSectionId').equals(section.id).first();
    expect(policy).toBeDefined();
    expect(policy!.scopeKey).toBe('DEFAULT');
    expect(policy!.weightK).toBe(25);
    expect(policy!.weightT).toBe(25);
    expect(policy!.weightC).toBe(25);
    expect(policy!.weightA).toBe(25);

    // 3. Verify default SeatingLayout
    const layout = await db.seatingLayouts.where('classSectionId').equals(section.id).first();
    expect(layout).toBeDefined();
    expect(layout!.rows).toBe(4);
    expect(layout!.cols).toBe(5);
    expect(layout!.cardSize).toBe('standard');

    // 4. Verify primary teacher assignment
    const staff = await db.classSectionStaff.where('classSectionId').equals(section.id).first();
    expect(staff).toBeDefined();
    expect(staff!.role).toBe('primary_teacher');

    // 5. Verify AuditEntry and SyncMutation
    const audits = await db.auditEntries.where('transactionId').equals(
      (await db.auditEntries.where('entityId').equals(section.id).first())!.transactionId
    ).toArray();
    expect(audits.length).toBeGreaterThanOrEqual(4);

    const syncs = await db.syncMutations.where('transactionId').equals(
      (await db.syncMutations.where('entityId').equals(section.id).first())!.transactionId
    ).toArray();
    expect(syncs.length).toBeGreaterThanOrEqual(4);
    expect(syncs.every(s => s.baseVersion === 0)).toBe(true);
  });

  it('rejects duplicate section number for the same course and term', async () => {
    const existing = await db.classSections.toCollection().first();
    expect(existing).toBeDefined();

    const course = await db.courses.get(existing!.courseId);
    expect(course).toBeDefined();

    await expect(
      classService.createClassSection({
        courseCode: course!.code,
        courseTitle: course!.title,
        sectionNumber: existing!.sectionNumber,
        period: 'Period 3',
        roomNumber: 'Room 101',
        colorToken: '#2563eb',
        userId: 'user-tyler',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(/already exists/i);
  });

  it('duplicates class section with collision resolution (-COPY, -COPY-2) and assigns current teacher', async () => {
    const sourceSection = (await db.classSections.toCollection().first())!;
    expect(sourceSection).toBeDefined();

    // First duplication -> creates -COPY
    const dupe1 = await classService.duplicateClassSection({
      sourceSectionId: sourceSection.id,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(dupe1.sectionNumber).toBe(`${sourceSection.sectionNumber}-COPY`);

    // Verify dupe1 has unit, policy, layout, and staff
    const unit1 = await db.units.where('classSectionId').equals(dupe1.id).first();
    expect(unit1).toBeDefined();

    const policy1 = await db.gradingPolicies.where('classSectionId').equals(dupe1.id).first();
    expect(policy1).toBeDefined();
    expect(policy1!.scopeKey).toBe('DEFAULT');

    const layout1 = await db.seatingLayouts.where('classSectionId').equals(dupe1.id).first();
    expect(layout1).toBeDefined();
    expect(layout1!.rows).toBe(4);
    expect(layout1!.cols).toBe(5);

    const staff1 = await db.classSectionStaff.where('classSectionId').equals(dupe1.id).first();
    expect(staff1).toBeDefined();
    expect(staff1!.role).toBe('primary_teacher');

    // Second duplication of original section -> resolves collision to -COPY-2
    const dupe2 = await classService.duplicateClassSection({
      sourceSectionId: sourceSection.id,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(dupe2.sectionNumber).toBe(`${sourceSection.sectionNumber}-COPY-2`);

    // Third duplication -> resolves to -COPY-3
    const dupe3 = await classService.duplicateClassSection({
      sourceSectionId: sourceSection.id,
      userId: 'user-tyler',
      deviceId: 'dev-1'
    });

    expect(dupe3.sectionNumber).toBe(`${sourceSection.sectionNumber}-COPY-3`);
  });

  it('rejects duplication when user does not have authorization', async () => {
    const sourceSection = (await db.classSections.toCollection().first())!;

    await expect(
      classService.duplicateClassSection({
        sourceSectionId: sourceSection.id,
        userId: 'user-unauthorized',
        deviceId: 'dev-1'
      })
    ).rejects.toThrow(/AuthorizationError|not found/i);
  });
});
