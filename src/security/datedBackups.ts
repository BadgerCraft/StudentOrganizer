import type { OntarioTeacherDB } from '../db/database';
import type { RecoveryStore, SavedBackup } from '../sync/backupStore';
import { saveBackup } from '../sync/backupStore';
import { assertWorkspaceAccess } from '../sync/snapshot';
import { getIdentityEpoch } from '../services/identityService';
import { protectedNativeMutation } from './encryptedRuntime';
import { rendererStorageMode } from './rendererStorageMode';
import { unwrapEncryption, type NativeDatedBackup } from './encryptionBridge';
/** Protected versions pin native encrypted records; they never copy history bodies into renderer IndexedDB. */
export async function saveDatedBackup(database: OntarioTeacherDB, userId: string, reason: SavedBackup['reason'], store?: RecoveryStore): Promise<NativeDatedBackup | null> {
  if (rendererStorageMode() === 'legacy') return saveBackup(database, userId, reason, store);
  const epoch = getIdentityEpoch(); await assertWorkspaceAccess(database, userId, epoch);
  const native = window.desktopEncryption; if (!native) throw Error('Encrypted backup setup is unavailable.');
  const result = await protectedNativeMutation(async revision => {
    if (epoch !== getIdentityEpoch()) throw Error('Teacher changed before encrypted backup.');
    const saved = unwrapEncryption(await native.createBackup(reason, revision));
    if (epoch !== getIdentityEpoch()) throw Error('Teacher changed during encrypted backup.');
    return saved;
  });
  return result.backup;
}
