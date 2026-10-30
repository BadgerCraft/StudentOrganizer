import type { OntarioTeacherDB } from '../db/database';
import { validateMainBundleIntegrity } from './mainBundleValidation';
import type { StudentOrganizerWorkingBundle } from './studentOrganizerSource';
export const PRIVATE_STORAGE_KEYS = ['ota.bug-report-draft.v1', 'ota.last-confirmed-teacher.v1', 'ontario_teacher_device_id', 'student-organizer-appearance'] as const;
export function privateStorageKey(key: string): boolean { return PRIVATE_STORAGE_KEYS.includes(key as any) || key.startsWith('ota.comment-bank.v1.'); }
/** Startup view validation uses the canonical record validator, without encoding aggregate history. */
export async function validateEncryptedBundle(value: unknown, _database: OntarioTeacherDB): Promise<StudentOrganizerWorkingBundle> {
  return await validateMainBundleIntegrity(value) as StudentOrganizerWorkingBundle;
}
