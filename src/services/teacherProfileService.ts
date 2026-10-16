import Dexie from 'dexie';
import type { OntarioTeacherDB } from '../db/database';
import type { User, UUID } from '../types/schema';
import { initializeDatabase } from '../db/seeds';
import { AuthorizationError } from './authHelper';
import { getActiveTeacherId, getIdentityEpoch, resolveActiveTeacher, subscribeIdentityChange } from './identityService';

export interface TeacherProfileInput { name: string; email?: string; }

function normalize(input: TeacherProfileInput) {
  const name = input.name.trim();
  const email = input.email?.trim().toLowerCase() || '';
  if (!name || name.length > 100) throw new Error('Enter a teacher name of 1 to 100 characters.');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address, or leave it blank.');
  return { name, email };
}

/** Local profile setup, not authentication. Creating a profile grants no existing
 * class assignment and never selects an actor or transfers historical records. */
export async function createTeacherProfile(db: OntarioTeacherDB, input: TeacherProfileInput): Promise<User> {
  const fields = normalize(input);
  await initializeDatabase(db);
  return db.transaction('rw', [db.users, db.organizations, db.organizationMemberships, db.userPreferences], async () => {
    const school = await db.organizations.filter(o => o.deletedAt === null && o.organizationType === 'school').first();
    if (!school) throw new Error('No active school is available. Restore a valid backup or add a school before creating a teacher.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta = { createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
    if (fields.email && await db.users.where('email').equals(fields.email).count()) throw new Error('That email already belongs to a saved profile. Choose that teacher or use a different email.');
    const user: User = { ...meta, id, authSubject: `local-profile:${id}`, email: fields.email || `${id}@local.invalid`, name: fields.name };
    await db.users.add(user);
    await db.organizationMemberships.add({ ...meta, id: crypto.randomUUID(), organizationId: school.id, userId: id, role: 'teacher', status: 'active' });
    await db.userPreferences.add({ id: crypto.randomUUID(), userId: id, theme: 'light', lastOpenedClassSectionId: null, markbookDensity: 'comfortable', seatingShowPhotos: true, createdAt: now, updatedAt: now, version: 1 });
    return user;
  });
}

/** Only the explicitly chosen acting teacher can update their own profile.
 * IDs, memberships and all historical author/owner references remain unchanged. */
export async function updateTeacherProfile(db: OntarioTeacherDB, userId: UUID, input: TeacherProfileInput): Promise<User> {
  const fields = normalize(input);
  const epoch = getIdentityEpoch();
  let unsubscribe: (() => void) | undefined;
  try {
    return await db.transaction('rw', [db.users, db.organizationMemberships], async () => {
      // Revoke the entire write, including the final request-to-commit window.
      const transaction = Dexie.currentTransaction;
      unsubscribe = subscribeIdentityChange(() => transaction?.abort());
      const actor = await resolveActiveTeacher(db);
      const membership = await db.organizationMemberships.where('userId').equals(userId)
        .filter(m => m.deletedAt === null && m.status === 'active' && ['teacher', 'admin', 'department_head'].includes(m.role)).first();
      if (actor.id !== userId || !membership || epoch !== getIdentityEpoch() || getActiveTeacherId() !== userId) throw new AuthorizationError('Choose this teacher explicitly before editing their profile.');
      const duplicate = fields.email && await db.users.where('email').equals(fields.email).first();
      if (duplicate && duplicate.id !== userId) throw new Error('That email already belongs to another saved profile.');
      const updated: User = { ...actor, name: fields.name, email: fields.email || (actor.email.endsWith('@local.invalid') ? actor.email : `${userId}@local.invalid`), updatedAt: new Date().toISOString(), version: actor.version + 1 };
      if (epoch !== getIdentityEpoch() || getActiveTeacherId() !== userId) throw new AuthorizationError('The acting teacher changed. Choose the teacher again before saving.');
      await db.users.put(updated);
      return updated;
    });
  } finally { unsubscribe?.(); }
}
