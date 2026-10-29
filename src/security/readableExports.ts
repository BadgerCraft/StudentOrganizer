import { protectedLaunchMarker } from './protectedLaunch';
import { rendererStorageMode } from './rendererStorageMode';
/** Protected readable-export policy is pending. Never claim a blocked native download succeeded. */
export function assertReadableExportAllowed(): void {
  if (protectedLaunchMarker() || rendererStorageMode() !== 'legacy') {
    throw new Error('Readable file export is unavailable in this protected workspace. Use an encrypted backup in Settings. No readable file was saved.');
  }
}
