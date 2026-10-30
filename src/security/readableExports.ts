import { protectedLaunchMarker } from './protectedLaunch';
import { rendererStorageMode } from './rendererStorageMode';
import { unwrapEncryption } from './encryptionBridge';
/** Protected readable-export policy is pending. Never claim a blocked native download succeeded. */
export function assertReadableExportAllowed(): void {
  if (protectedLaunchMarker() || rendererStorageMode() !== 'legacy') {
    throw new Error('Readable file export is unavailable in this protected workspace. Use an encrypted backup in Settings. No readable file was saved.');
  }
}

/** Pin generation to the protected revision that the native export will recheck. */
export async function protectedReadableRevision(): Promise<number> {
  if (rendererStorageMode() !== 'encrypted' || !window.desktopEncryption) throw new Error('Unlock the protected workspace before exporting. No readable file was saved.');
  const status = unwrapEncryption(await window.desktopEncryption.status());
  if (rendererStorageMode() !== 'encrypted' || status.mode !== 'encrypted' || status.state !== 'unlocked' || !Number.isSafeInteger(status.revision) || !status.revision || status.revision < 1) throw new Error('The protected workspace changed. No readable file was saved.');
  return status.revision;
}
