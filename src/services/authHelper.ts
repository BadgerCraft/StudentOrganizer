import { assertClassSectionPolicy, AuthorizationError, type AuthContext } from './classAccessPolicy';
import type { OntarioTeacherDB } from '../db/database';
import type { UUID, ClassSection, Course, Organization } from '../types/schema';

export { AuthorizationError } from './classAccessPolicy';
export type { AuthContext } from './classAccessPolicy';
export const AUTH_TABLES = (db: OntarioTeacherDB) => [
  db.users,
  db.courses,
  db.organizations,
  db.organizationMemberships,
  db.classSectionStaff,
  db.classSections
];

/**
 * Validates in-transaction authorization for modifying records in a class section.
 * Enforces:
 * - User exists and is not deleted.
 * - Section & Course exist and are not deleted.
 * - Resolves organization hierarchy (directOrg -> parentOrg -> root) with cycle and deletion detection.
 * - Checks active memberships:
 *   - 'admin' in any org in hierarchy: GRANTED.
 *   - 'department_head' in directOrg or parent board: GRANTED (cannot alter other schools).
 *   - 'guest': DENIED.
 *   - 'suspended': DENIED.
 *   - 'teacher': requires non-deleted ClassSectionStaff record with primary_teacher, co_teacher, or support role.
 *     (read_only is DENIED).
 */
async function assertClassSectionAccess(db: OntarioTeacherDB, userId: UUID, classSectionId: UUID, access: 'read' | 'write' = 'write'): Promise<AuthContext> {
  const user = await db.users.get(userId);
  const classSection = await db.classSections.get(classSectionId);
  const course = classSection ? await db.courses.get(classSection.courseId) : undefined;
  const organizations = await db.organizations.toArray();
  const memberships = await db.organizationMemberships.where('userId').equals(userId).toArray();
  const staff = await db.classSectionStaff.where('classSectionId').equals(classSectionId).toArray();
  return assertClassSectionPolicy({ user, classSection, course, organizations, memberships, staff }, userId, classSectionId, access);
}

export async function assertClassSectionWriteAccess(db: OntarioTeacherDB, userId: UUID, classSectionId: UUID): Promise<AuthContext> {
  return assertClassSectionAccess(db, userId, classSectionId, 'write');
}

/** Use the same membership/assignment rules for the class picker, allowing read-only staff. */
export async function listAccessibleClassSections(db: OntarioTeacherDB, userId: UUID | null) {
  if (!userId) return [];
  return db.transaction('r', AUTH_TABLES(db), async () => {
    const sections = await db.classSections.filter(s => s.deletedAt === null).toArray();
    const accessible: ClassSection[] = [];
    for (const section of sections) {
      try { await assertClassSectionAccess(db, userId, section.id, 'read'); accessible.push(section); }
      catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    return accessible;
  });
}
