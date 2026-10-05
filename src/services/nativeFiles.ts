import { Capacitor, registerPlugin } from '@capacitor/core';

interface FilesPlugin {
  exportBackup(options: { filename: string; content: string }): Promise<{ cancelled: boolean }>;
  importBackup(): Promise<{ cancelled: true } | { cancelled: false; content: string }>;
}

const files = registerPlugin<FilesPlugin>('StudentOrganizerFiles');

export const usesNativeFiles = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

/** A completed picker export is the only native success signal; cancellation is normal. */
export async function exportNativeBackup(filename: string, content: string): Promise<boolean> {
  return !(await files.exportBackup({ filename, content })).cancelled;
}

/** Selection never restores data: callers must validate and request explicit replacement. */
export async function selectNativeBackup(): Promise<string | null> {
  const result = await files.importBackup();
  return result.cancelled ? null : result.content;
}
