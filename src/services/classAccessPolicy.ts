import type { UUID, User, ClassSection, Course, Organization, OrganizationMembership, ClassSectionStaff } from '../types/schema';

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

export interface ClassAccessInput {
  user?: User; classSection?: ClassSection; course?: Course;
  organizations: readonly Organization[]; memberships: readonly OrganizationMembership[]; staff: readonly ClassSectionStaff[];
}
/** Canonical class policy shared by database services and native validated-snapshot inspection. */
export function assertClassSectionPolicy(input: ClassAccessInput, userId: UUID, classSectionId: UUID, access: 'read' | 'write' = 'write'): AuthContext {
  // 1. User validation
  const user = input.user;
  if (!user || user.deletedAt !== null) {
    throw new AuthorizationError(`User ${userId} not found or inactive.`);
  }

  // 2. Class section & Course validation
  const section = input.classSection;
  if (!section || section.deletedAt !== null) {
    throw new AuthorizationError(`Class section ${classSectionId} not found or deleted.`);
  }

  const course = input.course;
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
    const org: Organization | undefined = input.organizations.find(org => org.id === currentOrgId);
    if (!org || org.deletedAt !== null) {
      throw new AuthorizationError('Organization hierarchy contains a missing or deleted organization.');
    }
    if (!org.parentOrganizationId) {
      currentOrgId = null;
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

  if (currentOrgId) throw new AuthorizationError('Organization hierarchy exceeds the supported depth.');

  // 4. Retrieve memberships across the entire ancestor chain
  const memberships = input.memberships.filter(m => m.userId === userId);

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
  const staffAssignments = input.staff.filter(s => s.classSectionId === classSectionId);

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
