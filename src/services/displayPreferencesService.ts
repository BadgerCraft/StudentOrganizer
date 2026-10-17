import Dexie from 'dexie';
import type { OntarioTeacherDB } from '../db/database';
import { DEFAULT_CHICLET_DISPLAY, type ChicletDisplaySettings } from '../types/schema';
import { AuthorizationError } from './authHelper';
import { getActiveTeacherId, getIdentityEpoch, resolveActiveTeacher, subscribeIdentityChange } from './identityService';

/** Updates only the explicitly selected teacher, preserving unrelated preferences. */
export async function saveClassCardDisplay(db: OntarioTeacherDB, userId: string | undefined, settings: ChicletDisplaySettings, expectedEpoch: number): Promise<void> {
  let unsubscribe: (() => void) | undefined;
  const assertActor = () => {
    if (!userId || getActiveTeacherId() !== userId || getIdentityEpoch() !== expectedEpoch) {
      throw new AuthorizationError('The acting teacher changed. Reopen display settings before saving.');
    }
  };
  assertActor();
  try {
    await db.transaction('rw', [db.users, db.organizationMemberships, db.userPreferences], async () => {
      const transaction = Dexie.currentTransaction;
      unsubscribe = subscribeIdentityChange(() => transaction?.abort());
      const actor = await resolveActiveTeacher(db);
      const membership = await db.organizationMemberships.where('userId').equals(actor.id)
        .filter(m => m.deletedAt === null && m.status === 'active' && ['teacher', 'admin', 'department_head'].includes(m.role)).first();
      assertActor();
      if (!membership) throw new AuthorizationError('Select an active teacher before saving display settings.');
      const preference = await db.userPreferences.where('userId').equals(actor.id).first();
      const now = new Date().toISOString();
      assertActor();
      if (preference) {
        await db.userPreferences.update(preference.id, { chicletDisplay: { ...DEFAULT_CHICLET_DISPLAY, ...settings }, updatedAt: now, version: preference.version + 1 });
      } else {
        await db.userPreferences.add({ id: crypto.randomUUID(), userId: actor.id, theme: 'light', lastOpenedClassSectionId: null,
          markbookDensity: 'comfortable', seatingShowPhotos: true, chicletDisplay: { ...DEFAULT_CHICLET_DISPLAY, ...settings }, createdAt: now, updatedAt: now, version: 1 });
      }
    });
  } finally { unsubscribe?.(); }
}
