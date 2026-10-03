import type { OntarioTeacherDB } from '../db/database';
import type { UUID, ClassSection, Course, Organization } from '../types/schema';

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export interface AuthContext {
  userId: UUID;
  classSection: ClassSection;
  course: Course;
  organizationId: UUID;
}

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
async function assertClassSectionAccess(
  db: OntarioTeacherDB,
  userId: UUID,
  classSectionId: UUID,
  access: 'read' | 'write' = 'write'
): Promise<AuthContext> {
  // 1. User validation
  const user = await db.users.get(userId);
  if (!user || user.deletedAt !== null) {
    throw new AuthorizationError(`User ${userId} not found or inactive.`);
  }

  // 2. Class section & Course validation
  const section = await db.classSections.get(classSectionId);
  if (!section || section.deletedAt !== null) {
    throw new AuthorizationError(`Class section ${classSectionId} not found or deleted.`);
  }

  const course = await db.courses.get(section.courseId);
  if (!course || course.deletedAt !== null) {
    throw new AuthorizationError(`Course ${section.courseId} not found or deleted.`);
  }

  const directOrgId = course.organizationId;

  // 3. Organization hierarchy traversal with cycle detection
  const orgChain: UUID[] = [directOrgId];
  const visited = new Set<UUID>([directOrgId]);

  let currentOrgId: UUID | null = directOrgId;
  let depth = 0;
  while (currentOrgId && depth < 10) {
    depth++;
    const org: Organization | undefined = await db.organizations.get(currentOrgId);
    if (!org || org.deletedAt !== null || !org.parentOrganizationId) {
      break;
    }
    const parentId: UUID = org.parentOrganizationId;
    if (visited.has(parentId)) {
      throw new AuthorizationError('Cycle detected in organization hierarchy.');
    }
    visited.add(parentId);
    orgChain.push(parentId);
    currentOrgId = parentId;
  }

  // 4. Retrieve memberships across the entire ancestor chain
  const memberships = await db.organizationMemberships
    .where('userId')
    .equals(userId)
    .toArray();

  const activeChainMemberships = memberships.filter(
    m => m.deletedAt === null && orgChain.includes(m.organizationId)
  );

  if (activeChainMemberships.length === 0) {
    throw new AuthorizationError(`User has no active organization membership in school/board hierarchy.`);
  }

  const suspendedMembership = activeChainMemberships.find(m => m.status === 'suspended');
  if (suspendedMembership && activeChainMemberships.every(m => m.status === 'suspended')) {
    throw new AuthorizationError('User account membership is suspended.');
  }

  const activeMemberships = activeChainMemberships.filter(m => m.status === 'active');
  if (activeMemberships.length === 0) {
    throw new AuthorizationError('User has no active memberships in organization hierarchy.');
  }

  // 5. Check role-based administrative authority
  // Admin role anywhere in the org chain grants write access
  const hasAdmin = activeMemberships.some(m => m.role === 'admin');
  if (hasAdmin) {
    return { userId, classSection: section, course, organizationId: directOrgId };
  }

  // Department head: grants write access if assigned to direct school org or direct parent
  const hasDeptHead = activeMemberships.some(
    m => m.role === 'department_head' && (m.organizationId === directOrgId || m.organizationId === orgChain[orgChain.length - 1])
  );
  if (hasDeptHead) {
    return { userId, classSection: section, course, organizationId: directOrgId };
  }

  // Guest role is strictly denied write permissions
  if (activeMemberships.every(m => m.role === 'guest')) {
    throw new AuthorizationError('Guest users do not have write permissions.');
  }

  // 6. Teacher assignment check via ClassSectionStaff
  const activeMembershipIds = activeMemberships.map(m => m.id);
  const staffAssignments = await db.classSectionStaff
    .where('classSectionId')
    .equals(classSectionId)
    .toArray();

  const userStaff = staffAssignments.find(
    s => s.deletedAt === null && activeMembershipIds.includes(s.organizationMembershipId)
  );

  if (!userStaff) {
    throw new AuthorizationError(`Teacher is not assigned to class section ${classSectionId}.`);
  }

  if (access === 'write' && userStaff.role === 'read_only') {
    throw new AuthorizationError('Read-only staff cannot alter class records.');
  }

  return { userId, classSection: section, course, organizationId: directOrgId };
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
