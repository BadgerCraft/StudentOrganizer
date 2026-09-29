import type { OntarioTeacherDB } from '../db/database';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import type {
  UUID,
  ClassSection,
  Course,
  GradingPolicy,
  SeatingLayout,
  ClassSectionStaff,
  Unit,
  AuditEntry,
  SyncMutation
} from '../types/schema';

export interface CreateClassSectionParams {
  courseCode: string;
  courseTitle: string;
  sectionNumber: string;
  period: string;
  roomNumber: string;
  colorToken: string;
  termId?: UUID;
  organizationId?: UUID;
  userId: UUID;
  deviceId: UUID;
  department?: string;
  gradeLevel?: number;
  creditValue?: number;
}

export interface DuplicateClassSectionParams {
  sourceSectionId: UUID;
  userId: UUID;
  deviceId: UUID;
}

export class ClassDomainService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Creates a new class section with in-transaction authorization,
   * course reuse or creation, initial unit (U1), standard Ontario grading policy,
   * default seating layout grid, and primary teacher assignment.
   */
  async createClassSection(params: CreateClassSectionParams): Promise<ClassSection> {
    const normCode = params.courseCode?.trim().toUpperCase();
    const normTitle = params.courseTitle?.trim();
    const normSection = params.sectionNumber?.trim();
    const normPeriod = params.period?.trim();
    const normRoom = params.roomNumber?.trim();
    const normColor = params.colorToken?.trim() || '#2563eb';

    if (!normCode || normCode.length > 20) {
      throw new Error('Course code is required and must be at most 20 characters.');
    }
    if (!normTitle || normTitle.length > 100) {
      throw new Error('Course title is required and must be at most 100 characters.');
    }
    if (!normSection || normSection.length > 20) {
      throw new Error('Section number is required and must be at most 20 characters.');
    }
    if (!normPeriod) {
      throw new Error('Period is required.');
    }
    if (!normRoom) {
      throw new Error('Room number is required.');
    }

    return await this.db.transaction(
      'rw',
      [
        this.db.users,
        this.db.organizations,
        this.db.organizationMemberships,
        this.db.terms,
        this.db.courses,
        this.db.classSections,
        this.db.classSectionStaff,
        this.db.gradingPolicies,
        this.db.seatingLayouts,
        this.db.units,
        this.db.markScaleVersions,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // 1. Validate user
        const user = await this.db.users.get(params.userId);
        if (!user || user.deletedAt !== null) {
          throw new Error(`User ${params.userId} not found or inactive.`);
        }

        // 2. Resolve term
        let term = params.termId ? await this.db.terms.get(params.termId) : null;
        if (!term || term.deletedAt !== null) {
          term = (await this.db.terms.toCollection().first()) || null;
        }
        if (!term) {
          throw new Error('No academic term available.');
        }

        // 3. Resolve organization
        let org = params.organizationId ? await this.db.organizations.get(params.organizationId) : null;
        if (!org || org.deletedAt !== null) {
          org = (await this.db.organizations.where('organizationType').equals('school').first()) || null;
          if (!org) {
            org = (await this.db.organizations.toCollection().first()) || null;
          }
        }
        if (!org) {
          throw new Error('No school organization available.');
        }

        // 4. Find or create Course
        let course = await this.db.courses
          .where({ organizationId: org.id, code: normCode })
          .first();

        let newCourseCreated = false;
        if (!course || course.deletedAt !== null) {
          const courseId = `course-${Date.now()}`;
          course = {
            id: courseId,
            organizationId: org.id,
            code: normCode,
            title: normTitle,
            department: params.department?.trim() || 'English',
            gradeLevel: params.gradeLevel || 12,
            creditValue: params.creditValue || 1.0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await this.db.courses.add(course);
          newCourseCreated = true;
        }

        // 5. Check section collision for [courseId+termId+sectionNumber]
        const existingSections = await this.db.classSections
          .where({ courseId: course.id, termId: term.id })
          .toArray();

        const collision = existingSections.find(
          s => s.deletedAt === null && s.sectionNumber.toLowerCase() === normSection.toLowerCase()
        );
        if (collision) {
          throw new Error(`Section "${normSection}" already exists for ${normCode}.`);
        }

        // 6. Create ClassSection
        const sectionId = `class-${Date.now()}`;
        const newSection: ClassSection = {
          id: sectionId,
          courseId: course.id,
          termId: term.id,
          sectionNumber: normSection,
          period: normPeriod,
          roomNumber: normRoom,
          colorToken: normColor,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.classSections.add(newSection);

        // 7. Create Initial Unit (U1)
        const unitId = `unit-${sectionId}-1`;
        const initialUnit: Unit = {
          id: unitId,
          classSectionId: sectionId,
          code: 'U1',
          title: 'Unit 1: Course Foundations',
          sortOrder: 1,
          startsOn: null,
          endsOn: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.units.add(initialUnit);

        // 8. Create Standard Ontario Grading Policy
        const markScaleVersion = await this.db.markScaleVersions.toCollection().first();
        const policy: GradingPolicy = {
          id: `policy-${sectionId}`,
          classSectionId: sectionId,
          reportingPeriodId: null,
          scopeKey: 'DEFAULT',
          weightK: 25,
          weightT: 25,
          weightC: 25,
          weightA: 25,
          excludeFormative: true,
          missingWorkPolicy: 'exclude',
          defaultMarkScaleVersionId: markScaleVersion ? markScaleVersion.id : 'scale-ver-ont-levels-v1',
          decimalPrecision: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.gradingPolicies.add(policy);

        // 9. Create Default Seating Layout (4x5)
        const layout: SeatingLayout = {
          id: `layout-${sectionId}`,
          classSectionId: sectionId,
          name: 'Standard Classroom 4x5',
          rows: 4,
          cols: 5,
          isLocked: false,
          cardSize: 'standard',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.seatingLayouts.add(layout);

        // 10. Assign Primary Teacher
        let membership = await this.db.organizationMemberships
          .where('userId')
          .equals(params.userId)
          .first();

        if (!membership || membership.deletedAt !== null) {
          membership = (await this.db.organizationMemberships.toCollection().first()) || undefined;
        }

        if (membership) {
          const staff: ClassSectionStaff = {
            id: `staff-${sectionId}`,
            classSectionId: sectionId,
            organizationMembershipId: membership.id,
            role: 'primary_teacher',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await this.db.classSectionStaff.add(staff);
        }

        // 11. Emit Audit Entries & Sync Mutations
        const createdEntities: Array<{ name: string; entity: any }> = [];
        if (newCourseCreated) createdEntities.push({ name: 'courses', entity: course });
        createdEntities.push({ name: 'classSections', entity: newSection });
        createdEntities.push({ name: 'units', entity: initialUnit });
        createdEntities.push({ name: 'gradingPolicies', entity: policy });
        createdEntities.push({ name: 'seatingLayouts', entity: layout });

        let seq = 1;
        for (const item of createdEntities) {
          const audit: AuditEntry = {
            id: crypto.randomUUID(),
            entityName: item.name,
            entityId: item.entity.id,
            action: 'INSERT',
            transactionId: txId,
            previousStateJson: null,
            newStateJson: JSON.stringify(item.entity),
            diffJson: JSON.stringify(item.entity),
            userId: params.userId,
            timestamp: now,
            clientVersion: '1.0.0'
          };
          await this.db.auditEntries.add(audit);

          const sync: SyncMutation = {
            id: crypto.randomUUID(),
            deviceId: params.deviceId,
            organizationId: org.id,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: seq++,
            transactionSize: createdEntities.length,
            entityName: item.name,
            entityId: item.entity.id,
            operation: 'INSERT',
            payloadJson: JSON.stringify(item.entity),
            baseVersion: 0,
            status: 'pending',
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          };
          await this.db.syncMutations.add(sync);
        }

        return newSection;
      }
    );
  }

  /**
   * Duplicates an existing class section:
   * - Performs in-transaction authorization check
   * - Resolves section number collision (-COPY, -COPY-2, etc.)
   * - Assigns the current teacher (userId) as primary teacher
   * - Copies active units (or creates initial unit if none)
   * - Copies active grading policies (or creates default if none)
   * - Copies seating layout grid dimensions (rows, cols, cardSize)
   * - Emits atomic audit entries and sync mutations
   */
  async duplicateClassSection(params: DuplicateClassSectionParams): Promise<ClassSection> {
    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.terms,
        this.db.gradingPolicies,
        this.db.seatingLayouts,
        this.db.units,
        this.db.markScaleVersions,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // 1. Authorize write access to source section
        const auth = await assertClassSectionWriteAccess(
          this.db,
          params.userId,
          params.sourceSectionId
        );
        const sourceSection = auth.classSection;
        const orgId = auth.organizationId;

        // 2. Deterministically resolve unique candidate sectionNumber
        const existingSections = await this.db.classSections
          .where({ courseId: sourceSection.courseId, termId: sourceSection.termId })
          .toArray();

        const activeSectionNumbers = new Set(
          existingSections
            .filter(s => s.deletedAt === null)
            .map(s => s.sectionNumber.toLowerCase())
        );

        let candidate = `${sourceSection.sectionNumber}-COPY`;
        let counter = 2;
        while (activeSectionNumbers.has(candidate.toLowerCase())) {
          candidate = `${sourceSection.sectionNumber}-COPY-${counter}`;
          counter++;
        }

        // 3. Create duplicated ClassSection
        const newSectionId = `class-${Date.now()}`;
        const newSection: ClassSection = {
          ...sourceSection,
          id: newSectionId,
          sectionNumber: candidate,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.classSections.add(newSection);

        // 4. Assign the current teacher as primary teacher
        let membership = await this.db.organizationMemberships
          .where('userId')
          .equals(params.userId)
          .first();

        if (!membership || membership.deletedAt !== null) {
          membership = (await this.db.organizationMemberships.toCollection().first()) || undefined;
        }

        if (membership) {
          await this.db.classSectionStaff.add({
            id: `staff-${newSectionId}`,
            classSectionId: newSectionId,
            organizationMembershipId: membership.id,
            role: 'primary_teacher',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          });
        }

        // 5. Duplicate Units (or create U1 if source had none)
        const sourceUnits = (
          await this.db.units.where('classSectionId').equals(sourceSection.id).toArray()
        ).filter(u => u.deletedAt === null);

        const newUnits: Unit[] = [];
        if (sourceUnits.length > 0) {
          for (let i = 0; i < sourceUnits.length; i++) {
            const u = sourceUnits[i];
            const dupeUnit: Unit = {
              ...u,
              id: `unit-${newSectionId}-${i + 1}`,
              classSectionId: newSectionId,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1
            };
            await this.db.units.add(dupeUnit);
            newUnits.push(dupeUnit);
          }
        } else {
          const fallbackUnit: Unit = {
            id: `unit-${newSectionId}-1`,
            classSectionId: newSectionId,
            code: 'U1',
            title: 'Unit 1: Course Foundations',
            sortOrder: 1,
            startsOn: null,
            endsOn: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await this.db.units.add(fallbackUnit);
          newUnits.push(fallbackUnit);
        }

        // 6. Duplicate Grading Policies (or create default Ontario policy)
        const sourcePolicies = (
          await this.db.gradingPolicies.where('classSectionId').equals(sourceSection.id).toArray()
        ).filter(p => p.deletedAt === null);

        const newPolicies: GradingPolicy[] = [];
        if (sourcePolicies.length > 0) {
          for (const p of sourcePolicies) {
            const dupePolicy: GradingPolicy = {
              ...p,
              id: `policy-${newSectionId}-${p.scopeKey}`,
              classSectionId: newSectionId,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1
            };
            await this.db.gradingPolicies.add(dupePolicy);
            newPolicies.push(dupePolicy);
          }
        } else {
          const markScaleVersion = await this.db.markScaleVersions.toCollection().first();
          const defaultPolicy: GradingPolicy = {
            id: `policy-${newSectionId}`,
            classSectionId: newSectionId,
            reportingPeriodId: null,
            scopeKey: 'DEFAULT',
            weightK: 25,
            weightT: 25,
            weightC: 25,
            weightA: 25,
            excludeFormative: true,
            missingWorkPolicy: 'exclude',
            defaultMarkScaleVersionId: markScaleVersion ? markScaleVersion.id : 'scale-ver-ont-levels-v1',
            decimalPrecision: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await this.db.gradingPolicies.add(defaultPolicy);
          newPolicies.push(defaultPolicy);
        }

        // 7. Duplicate Seating Layout (preserve grid dimensions rows, cols, cardSize)
        const sourceLayout = await this.db.seatingLayouts
          .where('classSectionId')
          .equals(sourceSection.id)
          .first();

        const newLayout: SeatingLayout = {
          id: `layout-${newSectionId}`,
          classSectionId: newSectionId,
          name: sourceLayout ? `${sourceLayout.name} (Copy)` : 'Standard Classroom 4x5',
          rows: sourceLayout ? sourceLayout.rows : 4,
          cols: sourceLayout ? sourceLayout.cols : 5,
          isLocked: false,
          cardSize: sourceLayout ? sourceLayout.cardSize : 'standard',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };
        await this.db.seatingLayouts.add(newLayout);

        // 8. Emit Audit Entries and Sync Mutations
        const createdEntities: Array<{ name: string; entity: any }> = [
          { name: 'classSections', entity: newSection },
          ...newUnits.map(u => ({ name: 'units', entity: u })),
          ...newPolicies.map(p => ({ name: 'gradingPolicies', entity: p })),
          { name: 'seatingLayouts', entity: newLayout }
        ];

        let seq = 1;
        for (const item of createdEntities) {
          await this.db.auditEntries.add({
            id: crypto.randomUUID(),
            entityName: item.name,
            entityId: item.entity.id,
            action: 'INSERT',
            transactionId: txId,
            previousStateJson: null,
            newStateJson: JSON.stringify(item.entity),
            diffJson: JSON.stringify(item.entity),
            userId: params.userId,
            timestamp: now,
            clientVersion: '1.0.0'
          });

          await this.db.syncMutations.add({
            id: crypto.randomUUID(),
            deviceId: params.deviceId,
            organizationId: orgId,
            mutationId: crypto.randomUUID(),
            transactionId: txId,
            sequenceNumber: seq++,
            transactionSize: createdEntities.length,
            entityName: item.name,
            entityId: item.entity.id,
            operation: 'INSERT',
            payloadJson: JSON.stringify(item.entity),
            baseVersion: 0,
            status: 'pending',
            createdAt: now,
            attemptCount: 0,
            lastAttemptAt: null,
            lastError: null,
            acknowledgedAt: null
          });
        }

        return newSection;
      }
    );
  }
}
