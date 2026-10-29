import { decryptBytes, encryptBytes, generateMasterKey, recoverMasterKey, MAX_PLAINTEXT_BYTES, type EncryptionContext } from '../../shared/encryption';

export const STUDENT_ORGANIZER_APP_ID = 'student-organizer';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export interface WorkspaceScope { appId: string; vaultId: string; keyVersion: number }
export interface EncryptedCheckpoint { revision: number; ciphertext: string }
/** CAS must be atomic and durable before resolving. No retry is implied by an error. */
export interface EncryptedWorkspaceStore {
  read(): Promise<EncryptedCheckpoint | null>;
  commit(expectedRevision: number | null, next: EncryptedCheckpoint): Promise<void>;
}
export class WorkspaceLockedError extends Error {
  constructor() { super('Encrypted workspace is locked. Reopen the verified saved version before continuing.'); }
}
export class MigrationVerificationError extends Error {
  constructor() { super('Encryption preparation could not be verified. Keep the original workspace and repeat recovery and device checks.'); }
}
function context(scope: WorkspaceScope, purpose: EncryptionContext['purpose'], recordId: string, revision: number): EncryptionContext {
  return { ...scope, purpose, recordId, revision };
}
function strictJSON(value: unknown): string {
  const visit = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) { Object.values(item).forEach(visit); return; }
    throw new MigrationVerificationError();
  };
  visit(value); return JSON.stringify(value);
}
async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(strictJSON(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function same(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0; for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i]; return mismatch === 0;
}

/** A staged, memory-only working state. This does not wrap the existing persistent Dexie database. */
export class EncryptedWorkspaceSession<T> {
  private key: Uint8Array | null;
  private value: T | null;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private constructor(private readonly store: EncryptedWorkspaceStore, private readonly scope: WorkspaceScope, key: Uint8Array, private revision: number, value: T, private readonly validate: (value: unknown) => asserts value is T) {
    this.scope = Object.freeze({ ...scope }); this.key = new Uint8Array(key); this.value = structuredClone(value);
  }
  static async open<T>(store: EncryptedWorkspaceStore, scope: WorkspaceScope, key: Uint8Array, validate: (value: unknown) => asserts value is T): Promise<EncryptedWorkspaceSession<T>> {
    scope = { ...scope }; const ownedKey = new Uint8Array(key);
    try {
      const saved = await store.read(); if (!saved) throw new WorkspaceLockedError();
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new WorkspaceLockedError();
      const plaintext = await decryptBytes(ownedKey, context(scope, 'working-data', 'workspace', saved.revision), saved.ciphertext);
      try { const value: unknown = JSON.parse(decoder.decode(plaintext)); validate(value); strictJSON(value); return new EncryptedWorkspaceSession(store, scope, ownedKey, saved.revision, value, validate); }
      finally { plaintext.fill(0); }
    } finally { ownedKey.fill(0); }
  }
  read(): T { if (!this.key || this.value === null) throw new WorkspaceLockedError(); return structuredClone(this.value); }
  getRevision(): number { if (!this.key) throw new WorkspaceLockedError(); return this.revision; }
  /** Old state remains visible until durable encrypted commit succeeds. A failed/uncertain commit locks the session. */
  transact(edit: (draft: T) => void | Promise<void>): Promise<void> {
    const run = async () => {
      if (!this.key || this.value === null) throw new WorkspaceLockedError();
      const epoch = this.epoch, key = new Uint8Array(this.key), draft = structuredClone(this.value);
      try {
        await edit(draft);
        const candidate = structuredClone(draft); this.validate(candidate);
        const plaintext = encoder.encode(strictJSON(candidate));
        let ciphertext: string;
        try { ciphertext = await encryptBytes(key, context(this.scope, 'working-data', 'workspace', this.revision + 1), plaintext); }
        finally { plaintext.fill(0); }
        if (epoch !== this.epoch || !this.key) throw new WorkspaceLockedError();
        try { await this.store.commit(this.revision, { revision: this.revision + 1, ciphertext }); }
        catch { this.lock(); throw new WorkspaceLockedError(); }
        if (epoch !== this.epoch || !this.key) throw new WorkspaceLockedError();
        this.value = candidate; this.revision++;
      } finally { key.fill(0); }
    };
    const pending = this.queue.then(run); this.queue = pending.catch(() => {}); return pending;
  }
  /** Export takes a serialized committed snapshot; it never exposes a partially edited draft. */
  exportEncrypted(purpose: 'backup' | 'transfer', recordId: string): Promise<EncryptedCheckpoint> {
    const run = async () => {
      if (!this.key || this.value === null) throw new WorkspaceLockedError();
      const epoch = this.epoch, key = new Uint8Array(this.key), plaintext = encoder.encode(strictJSON(this.value));
      try {
        const ciphertext = await encryptBytes(key, context(this.scope, purpose, recordId, this.revision), plaintext);
        if (epoch !== this.epoch || !this.key) throw new WorkspaceLockedError();
        return { revision: this.revision, ciphertext };
      } finally { key.fill(0); plaintext.fill(0); }
    };
    const pending = this.queue.then(run); this.queue = pending.catch(() => {}); return pending;
  }
  /** Main-process only: seals a validated transfer payload; callers never receive key bytes. */
  sealExternal(purpose: 'backup' | 'transfer', recordId: string, input: Uint8Array): Promise<EncryptedCheckpoint> {
    if (!(input instanceof Uint8Array) || input.length > MAX_PLAINTEXT_BYTES) return Promise.reject(new WorkspaceLockedError());
    const plaintext = new Uint8Array(input), requestedEpoch = this.epoch;
    const run = async () => {
      if (!this.key || this.value === null || requestedEpoch !== this.epoch || !['backup', 'transfer'].includes(purpose)) throw new WorkspaceLockedError();
      const key = new Uint8Array(this.key), revision = this.revision;
      try {
        const ciphertext = await encryptBytes(key, context(this.scope, purpose, recordId, revision), plaintext);
        if (requestedEpoch !== this.epoch || !this.key) throw new WorkspaceLockedError();
        return { revision, ciphertext };
      } finally { key.fill(0); }
    };
    const pending = this.queue.then(run).finally(() => plaintext.fill(0)); this.queue = pending.catch(() => {}); return pending;
  }
  /**
   * Main-process only. The caller supplies the explicitly selected immutable artifact's
   * expected identity/revision, then validates all decrypted data before exposing it.
   * This permits deliberate historical review; it does not infer rollback protection.
   */
  openExternal(expected: { purpose: 'backup' | 'transfer'; recordId: string; revision: number }, ciphertext: string): Promise<Uint8Array> {
    expected = { ...expected }; const requestedEpoch = this.epoch;
    const run = async () => {
      if (!this.key || this.value === null || requestedEpoch !== this.epoch || !['backup', 'transfer'].includes(expected.purpose)) throw new WorkspaceLockedError();
      const key = new Uint8Array(this.key);
      let plaintext: Uint8Array | undefined;
      try {
        plaintext = await decryptBytes(key, context(this.scope, expected.purpose, expected.recordId, expected.revision), ciphertext);
        if (requestedEpoch !== this.epoch || !this.key) throw new WorkspaceLockedError();
        return plaintext;
      } catch (error) { plaintext?.fill(0); throw error; }
      finally { key.fill(0); }
    };
    const pending = this.queue.then(run); this.queue = pending.catch(() => {}); return pending;
  }
  lock(): void { this.epoch++; this.key?.fill(0); this.key = null; this.value = null; }
}

/** The adapter must freeze ALL source writers, including recovery and comment-bank writers, for this callback. */
export interface MigrationSource<T> { withReadLock<R>(read: (source: T) => Promise<R>): Promise<R> }
export interface EnrollmentChallenge { deviceId: string; context: EncryptionContext; ciphertext: string }
/** Synthetic/device harness endpoint. Production caller must also verify OS-protected enrollment and physical acceptance separately. */
export async function answerEnrollmentChallenge(master: Uint8Array, challenge: EnrollmentChallenge): Promise<string> {
  const plaintext = await decryptBytes(master, challenge.context, challenge.ciphertext);
  try { return await encryptBytes(master, { ...challenge.context, recordId: challenge.context.recordId + '/response' }, plaintext); }
  finally { plaintext.fill(0); }
}
/** Non-destructive conversion ceremony; writes a new container only. It never deletes or edits its source. */
export class WorkspaceMigration<T> {
  private recovered = false;
  private deviceVerified = false;
  private closed = false;
  private key: Uint8Array;
  private challenge: { deviceId: string; context: EncryptionContext; secret: Uint8Array } | null = null;
  private constructor(private readonly scope: WorkspaceScope, key: Uint8Array, private readonly sourceHash: string, private readonly wrappedKey: string, private readonly currentDeviceId: string, private readonly validate: (value: unknown) => asserts value is T) { this.scope = Object.freeze({ ...scope }); this.key = new Uint8Array(key); }
  static async prepare<T>(source: MigrationSource<T>, scope: WorkspaceScope, key: Uint8Array, wrappedKey: string, currentDeviceId: string, validate: (value: unknown) => asserts value is T): Promise<WorkspaceMigration<T>> {
    scope = { ...scope }; const ownedKey = new Uint8Array(key);
    try {
      const sourceHash = await source.withReadLock(async value => { validate(value); return digest(value); });
      return new WorkspaceMigration(scope, ownedKey, sourceHash, wrappedKey, currentDeviceId, validate);
    } finally { ownedKey.fill(0); }
  }
  private assertOpen() { if (this.closed) throw new MigrationVerificationError(); }
  async verifyRecovery(code: string): Promise<void> {
    this.assertOpen(); this.recovered = false;
    const recovered = await recoverMasterKey(code, this.wrappedKey, this.scope.appId, this.scope.vaultId, this.scope.keyVersion);
    try { if (!same(recovered, this.key)) throw new MigrationVerificationError(); this.assertOpen(); this.recovered = true; }
    finally { recovered.fill(0); }
  }
  async createDeviceChallenge(deviceId: string): Promise<EnrollmentChallenge> {
    this.assertOpen(); this.deviceVerified = false; this.challenge?.secret.fill(0); this.challenge = null;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(deviceId) || deviceId === this.currentDeviceId) throw new MigrationVerificationError();
    const challengeId = crypto.randomUUID(), secret = generateMasterKey();
    const challengeContext = context(this.scope, 'transfer', 'enrollment/' + deviceId + '/' + challengeId, 0);
    this.challenge = { deviceId, context: challengeContext, secret };
    const ciphertext = await encryptBytes(this.key, challengeContext, secret); this.assertOpen();
    return { deviceId, context: challengeContext, ciphertext };
  }
  async verifyDeviceResponse(deviceId: string, ciphertext: string): Promise<void> {
    this.assertOpen(); this.deviceVerified = false;
    const challenge = this.challenge;
    if (!challenge || challenge.deviceId !== deviceId) throw new MigrationVerificationError();
    const plaintext = await decryptBytes(this.key, { ...challenge.context, recordId: challenge.context.recordId + '/response' }, ciphertext);
    try { if (!same(plaintext, challenge.secret)) throw new MigrationVerificationError(); this.assertOpen(); if (this.challenge !== challenge) throw new MigrationVerificationError(); this.deviceVerified = true; }
    finally { plaintext.fill(0); }
  }
  /** Possession proofs are mandatory but do not substitute for separately approved real-device activation. */
  async convert(source: MigrationSource<T>, target: EncryptedWorkspaceStore): Promise<void> {
    this.assertOpen(); if (!this.recovered || !this.deviceVerified) throw new MigrationVerificationError();
    try {
      await source.withReadLock(async value => {
        this.assertOpen(); this.validate(value); if (await digest(value) !== this.sourceHash) throw new MigrationVerificationError();
        if (await target.read() !== null) throw new MigrationVerificationError();
        const plaintext = encoder.encode(strictJSON(value));
        try {
          const ciphertext = await encryptBytes(this.key, context(this.scope, 'working-data', 'workspace', 1), plaintext);
          this.assertOpen(); await target.commit(null, { revision: 1, ciphertext });
        } finally { plaintext.fill(0); }
      });
    } finally { this.close(); }
  }
  close(): void { this.closed = true; this.key.fill(0); this.challenge?.secret.fill(0); this.challenge = null; this.recovered = false; this.deviceVerified = false; }
}
