import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { createTeacherProfile } from './teacherProfileService';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from './identityService';
import { DEFAULT_CHICLET_DISPLAY } from '../types/schema';
import { saveClassCardDisplay } from './displayPreferencesService';
let db: OntarioTeacherDB;
let a: string, b: string;
beforeEach(async () => {
  db = new OntarioTeacherDB(`fictional-display-preferences-${crypto.randomUUID()}`);
  a = (await createTeacherProfile(db, { name: 'Avery Fictional' })).id;
  b = (await createTeacherProfile(db, { name: 'Blair Fictional' })).id;
});
afterEach(async () => { clearActiveTeacherId(); await db.delete(); });
it('isolates repeat saves and switches while preserving other preferences and teacher rows', async () => {
  const beforeB = await db.userPreferences.where('userId').equals(b).first();
  setActiveTeacherId(a);
  await saveClassCardDisplay(db, a, { ...DEFAULT_CHICLET_DISPLAY, showRoom: false }, getIdentityEpoch());
  await saveClassCardDisplay(db, a, { ...DEFAULT_CHICLET_DISPLAY, showRoom: false }, getIdentityEpoch());
  expect(await db.userPreferences.where('userId').equals(b).first()).toEqual(beforeB);
  setActiveTeacherId(b);
  await saveClassCardDisplay(db, b, { ...DEFAULT_CHICLET_DISPLAY, primaryTitleFormat: 'code_only' }, getIdentityEpoch());
  expect((await db.userPreferences.where('userId').equals(a).first())?.chicletDisplay?.showRoom).toBe(false);
  expect((await db.userPreferences.where('userId').equals(b).first())?.chicletDisplay?.primaryTitleFormat).toBe('code_only');
  expect(await db.userPreferences.count()).toBe(2);
});
it('rejects absent actors, foreign actors and stale drafts after switching away and back without writes', async () => {
  const before = await db.userPreferences.toArray();
  clearActiveTeacherId();
  await expect(saveClassCardDisplay(db, undefined, DEFAULT_CHICLET_DISPLAY, getIdentityEpoch())).rejects.toThrow();
  setActiveTeacherId(a);
  const epoch = getIdentityEpoch();
  await expect(saveClassCardDisplay(db, b, DEFAULT_CHICLET_DISPLAY, epoch)).rejects.toThrow();
  setActiveTeacherId(b); setActiveTeacherId(a);
  await expect(saveClassCardDisplay(db, a, DEFAULT_CHICLET_DISPLAY, epoch)).rejects.toThrow();
  expect(await db.userPreferences.toArray()).toEqual(before);
});
it('creates a missing preference only for the selected teacher and rejects revoked membership', async () => {
  await db.userPreferences.where('userId').equals(a).delete();
  setActiveTeacherId(a);
  await saveClassCardDisplay(db, a, DEFAULT_CHICLET_DISPLAY, getIdentityEpoch());
  expect(await db.userPreferences.where('userId').equals(a).count()).toBe(1);
  const before = await db.userPreferences.toArray();
  await db.organizationMemberships.where('userId').equals(a).delete();
  await expect(saveClassCardDisplay(db, a, DEFAULT_CHICLET_DISPLAY, getIdentityEpoch())).rejects.toThrow();
  expect(await db.userPreferences.toArray()).toEqual(before);
});
it('rolls back an identity change in the final write window', async () => {
  setActiveTeacherId(a);
  const before = await db.userPreferences.toArray();
  const hook = () => { setActiveTeacherId(b); };
  db.userPreferences.hook('updating', hook);
  await expect(saveClassCardDisplay(db, a, { ...DEFAULT_CHICLET_DISPLAY, showRoom: false }, getIdentityEpoch())).rejects.toThrow();
  db.userPreferences.hook('updating').unsubscribe(hook);
  expect(await db.userPreferences.toArray()).toEqual(before);
});
