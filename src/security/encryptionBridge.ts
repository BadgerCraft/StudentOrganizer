import type { WorkingChange } from './workingDelta';
import type { StudentOrganizerWorkingBundle } from './studentOrganizerSource';
export interface EncryptionStatus {
  mode: 'legacy' | 'encrypted' | 'enrollment-pending'; deviceId: string; activationReady: boolean; ephemeralPartition: boolean;
  appId: 'student-organizer'; vaultId: string; keyVersion: number;
  enrollmentResponse?: { deviceId: string; ciphertext: string };
  state: 'locked' | 'unlocked' | 'preparing'; revision: number | null;
}
export type EncryptionResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
export interface NativeDatedBackup { id: string; createdAt: string; reason: 'automatic' | 'manual' | 'before-restore' | 'before-sync' }
export interface EncryptedFilePreview { token: string; metadata: { exportedAt: string; totalRecords: number; tableCount: number }; operators?: { id: string; name: string }[] }
export type PickedEncryptedFile = { cancelled: true } | ({ cancelled: false } & EncryptedFilePreview);
export interface DesktopEncryption {
  status(): Promise<EncryptionResult<EncryptionStatus>>;
  selectActingTeacher(userId: string | null): Promise<EncryptionResult<null>>;
  unlock(): Promise<EncryptionResult<{ revision: number }>>;
  read(): Promise<EncryptionResult<{ revision: number; snapshot: StudentOrganizerWorkingBundle }>>;
  commitDelta(expectedRevision: number, changes: WorkingChange[]): Promise<EncryptionResult<{ revision: number }>>;
  commit(expectedRevision: number, snapshot: StudentOrganizerWorkingBundle): Promise<EncryptionResult<{ revision: number }>>;
  lock(): Promise<EncryptionResult<null>>;
  reopenSecureStartup(): Promise<EncryptionResult<null>>;
  prepareMigration(snapshot: StudentOrganizerWorkingBundle): Promise<EncryptionResult<{ recoveryCode: string; wrappedKey: string; appId: string; vaultId: string; keyVersion: number }>>;
  verifyRecovery(code: string): Promise<EncryptionResult<null>>;
  createDeviceChallenge(deviceId: string): Promise<EncryptionResult<unknown>>;
  verifyDeviceResponse(deviceId: string, ciphertext: string): Promise<EncryptionResult<null>>;
  completeMigration(snapshot: StudentOrganizerWorkingBundle): Promise<EncryptionResult<{ revision: number }>>;
  enrollFromRecovery(code: string, wrappedKey: string, challenge: unknown): Promise<EncryptionResult<{ deviceId: string; ciphertext: string }>>;
  previewOfflineRecoveryFile(code: string): Promise<EncryptionResult<PickedEncryptedFile>>;
  authorizeOfflineRecovery(token: string, userId: string): Promise<EncryptionResult<EncryptedFilePreview>>;
  applyOfflineRecovery(token: string): Promise<EncryptionResult<{ revision: number }>>;
  cancelOfflineRecovery(): Promise<EncryptionResult<null>>;
  previewRecoveryFile(): Promise<EncryptionResult<PickedEncryptedFile>>;
  authorizeRecovery(token: string, userId: string): Promise<EncryptionResult<EncryptedFilePreview>>;
  previewImportFile(): Promise<EncryptionResult<PickedEncryptedFile>>;
  previewRecovery(ciphertext: string): Promise<EncryptionResult<{ token: string; metadata: { exportedAt: string; totalRecords: number; tableCount: number }; operators?: { id: string; name: string }[] }>>;
  applyRecovery(token: string): Promise<EncryptionResult<{ revision: number }>>;
  listBackups(): Promise<EncryptionResult<NativeDatedBackup[]>>;
  createBackup(reason: NativeDatedBackup['reason'], expectedRevision: number): Promise<EncryptionResult<{ revision: number; backup: NativeDatedBackup | null }>>;
  previewStoredBackup(id: string): Promise<EncryptionResult<{ token: string; metadata: { exportedAt: string; totalRecords: number; tableCount: number } }>>;
  applyStoredBackup(token: string): Promise<EncryptionResult<{ revision: number }>>;
  cancelEnrollment(): Promise<EncryptionResult<null>>;
  previewImport(ciphertext: string): Promise<EncryptionResult<{ token: string; metadata: { exportedAt: string; totalRecords: number; tableCount: number } }>>;
  applyImport(token: string): Promise<EncryptionResult<{ revision: number }>>;
  exportBackupFile(): Promise<EncryptionResult<{ cancelled: boolean; revision?: number }>>;
  exportEncrypted(purpose: 'backup' | 'transfer', recordId: string): Promise<EncryptionResult<{ revision: number; ciphertext: string }>>;
}
declare global { interface Window { desktopEncryption?: DesktopEncryption } }
export function unwrapEncryption<T>(result: EncryptionResult<T>): T {
  if (!result.ok) throw new Error(result.code === 'ENCRYPTION_ACTIVATION_REQUIRED' ? 'Encryption activation is not enabled. Keep the original workspace; complete the separately reviewed platform and device checks first.' : 'The encrypted workspace action was not verified. Keep the original workspace and reopen verified recovery before retrying.');
  return result.value;
}
