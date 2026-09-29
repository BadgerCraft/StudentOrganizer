import type { OntarioTeacherDB } from '../db/database';
import type { UUID, User, Device } from '../types/schema';
import { AuthorizationError } from './authHelper';

export interface AppIdentity {
  userId: UUID;
  user: User;
  deviceId: UUID;
  device: Device;
}

const STORAGE_ACTIVE_USER_KEY = 'ontario_active_user_id';
const STORAGE_DEVICE_ID_KEY = 'ontario_teacher_device_id';

let inMemoryActiveUserId: UUID | null = null;
let inMemoryDeviceId: UUID | null = null;

/**
 * Resolves the active teacher identity strictly from the current session:
 * 1. Check explicit in-memory active user ID.
 * 2. Check explicit sessionStorage active user ID.
 *
 * NEVER selects the class primary teacher.
 * NEVER selects user preferences.
 * NEVER checks localStorage for user identity.
 * NEVER selects the first user in the database.
 * Throws AuthorizationError if no verified active teacher has been selected for this session.
 */
export async function resolveActiveTeacher(
  db: OntarioTeacherDB,
  _unusedSectionId?: UUID | null
): Promise<User> {
  let candidateUserId: UUID | null = null;

  if (inMemoryActiveUserId) {
    candidateUserId = inMemoryActiveUserId;
  } else {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(STORAGE_ACTIVE_USER_KEY);
        if (stored && stored.trim()) {
          candidateUserId = stored.trim();
        }
      }
    } catch (_) {}
  }

  if (!candidateUserId) {
    throw new AuthorizationError(
      'No acting teacher selected. Please select a teacher for this session to continue.'
    );
  }

  // Verify that the candidate user exists and is not soft-deleted
  const user = await db.users.get(candidateUserId);
  if (!user || user.deletedAt !== null) {
    throw new AuthorizationError(
      `Active teacher user "${candidateUserId}" not found or has been deactivated.`
    );
  }

  return user;
}

/**
 * Explicitly sets the active teacher identity for the session.
 * Stores strictly in session storage and in-memory.
 */
export function setActiveTeacherId(userId: UUID): void {
  inMemoryActiveUserId = userId;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(STORAGE_ACTIVE_USER_KEY, userId);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_ACTIVE_USER_KEY);
    }
  } catch (_) {}
}

/**
 * Returns the active teacher ID if one is set in memory or sessionStorage, or null.
 */
export function getActiveTeacherId(): UUID | null {
  if (inMemoryActiveUserId) return inMemoryActiveUserId;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const stored = sessionStorage.getItem(STORAGE_ACTIVE_USER_KEY);
      if (stored && stored.trim()) return stored.trim();
    }
  } catch (_) {}
  return null;
}

/**
 * Clears any explicit active teacher override from session storage and memory.
 */
export function clearActiveTeacherId(): void {
  inMemoryActiveUserId = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(STORAGE_ACTIVE_USER_KEY);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_ACTIVE_USER_KEY);
    }
  } catch (_) {}
}

/**
 * Queries active teachers who have an active organization membership.
 * Handles first-run seeding gracefully by returning an empty array if tables are not yet populated.
 */
export async function getAvailableTeachers(db: OntarioTeacherDB): Promise<User[]> {
  try {
    const activeMemberships = await db.organizationMemberships
      .filter(m => m.deletedAt === null && m.status === 'active' && ['teacher', 'admin', 'department_head'].includes(m.role))
      .toArray();

    if (activeMemberships.length === 0) {
      return [];
    }

    const teacherUserIds = Array.from(new Set(activeMemberships.map(m => m.userId)));
    const users = await db.users
      .where('id')
      .anyOf(teacherUserIds)
      .filter(u => u.deletedAt === null)
      .toArray();

    return users.sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return [];
  }
}

/**
 * Establishes an explicit acting teacher for the current session.
 * Validates that the user exists and has an active organization membership.
 * Immediately sets the session storage and resolves device identity.
 */
export async function selectActingTeacher(
  db: OntarioTeacherDB,
  userId: UUID
): Promise<AppIdentity> {
  const user = await db.users.get(userId);
  if (!user || user.deletedAt !== null) {
    throw new AuthorizationError(`Teacher user "${userId}" not found or has been deactivated.`);
  }

  const membership = await db.organizationMemberships
    .where('userId')
    .equals(userId)
    .filter(m => m.deletedAt === null && m.status === 'active' && ['teacher', 'admin', 'department_head'].includes(m.role))
    .first();

  if (!membership) {
    throw new AuthorizationError(`User "${userId}" does not have an active teacher or staff membership.`);
  }

  setActiveTeacherId(userId);
  const device = await resolveAppDevice(db, user.id);

  return {
    userId: user.id,
    user,
    deviceId: device.id,
    device
  };
}

/**
 * Resolves or initializes a stable local device ID for this browser/desktop installation.
 */
export async function resolveAppDevice(
  db: OntarioTeacherDB,
  userId: UUID
): Promise<Device> {
  let deviceId: string | null = inMemoryDeviceId;
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_DEVICE_ID_KEY);
      if (stored) deviceId = stored;
    }
  } catch (_) {}

  if (!deviceId) {
    deviceId = `dev-${crypto.randomUUID()}`;
    inMemoryDeviceId = deviceId;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_DEVICE_ID_KEY, deviceId);
      }
    } catch (_) {}
  }

  const now = new Date().toISOString();
  let device = await db.devices.get(deviceId);
  if (!device) {
    device = {
      id: deviceId,
      userId,
      installationId: deviceId,
      name: 'Local Desktop Client',
      lastSeenAt: now
    };
    await db.devices.put(device);
  } else if (device.userId !== userId) {
    // Associate with current user
    device = {
      ...device,
      userId,
      lastSeenAt: now
    };
    await db.devices.put(device);
  }

  return device;
}

/**
 * Convenience helper returning full validated app identity context for the session.
 */
export async function getAppIdentity(
  db: OntarioTeacherDB,
  _unusedSectionId?: UUID | null
): Promise<AppIdentity> {
  const user = await resolveActiveTeacher(db);
  const device = await resolveAppDevice(db, user.id);

  return {
    userId: user.id,
    user,
    deviceId: device.id,
    device
  };
}
