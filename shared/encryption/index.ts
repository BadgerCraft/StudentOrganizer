/** Shared v1 crypto format. No persistence, OS storage, activation or plaintext fallback. */
export type EncryptionPurpose = 'working-data' | 'attachment' | 'backup' | 'transfer' | 'recovery-key';
export interface EncryptionContext {
  appId: string;
  vaultId: string;
  purpose: EncryptionPurpose;
  recordId: string;
  /** Expected revision comes from trusted application state, never from the envelope alone. */
  revision: number;
  keyVersion: number;
}
export interface EncryptedEnvelope {
  format: 'teacher-vault'; version: 1; algorithm: 'AES-256-GCM-HKDF-SHA256';
  context: EncryptionContext; salt: string; nonce: string; ciphertext: string;
}
export const MAX_PLAINTEXT_BYTES = 128 * 1024 * 1024;
const MAX_ENVELOPE_CHARS = Math.ceil((MAX_PLAINTEXT_BYTES + 16) / 3) * 4 + 4096;
const purposes: readonly string[] = ['working-data', 'attachment', 'backup', 'transfer', 'recovery-key'];
const encoder = new TextEncoder();
export class EncryptionError extends Error {
  constructor() { super('Encrypted data could not be verified. Check the app, recovery key and expected version.'); this.name = 'EncryptionError'; }
}
function fail(): never { throw new EncryptionError(); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).sort().join('|') !== keys.sort().join('|')) fail(); }
function context(value: unknown): EncryptionContext {
  if (!object(value)) fail();
  exactKeys(value, ['appId', 'vaultId', 'purpose', 'recordId', 'revision', 'keyVersion']);
  for (const key of ['appId', 'vaultId', 'recordId']) if (typeof value[key] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value[key] as string)) fail();
  if (!purposes.includes(value.purpose as string) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Number.isSafeInteger(value.keyVersion) || (value.keyVersion as number) < 1) fail();
  return { appId: value.appId as string, vaultId: value.vaultId as string, purpose: value.purpose as EncryptionPurpose, recordId: value.recordId as string, revision: value.revision as number, keyVersion: value.keyVersion as number };
}
function bytes(value: Uint8Array): ArrayBuffer { return new Uint8Array(value).buffer; }
function base64(value: Uint8Array): string {
  // Bounded chunks avoid spreading attachment-sized arrays onto the JS stack.
  let text = ''; for (let start = 0; start < value.length; start += 8192) text += String.fromCharCode(...value.subarray(start, start + 8192));
  return btoa(text);
}
function unbase64(value: unknown, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value) || /=/.test(value.slice(0, -2))) fail();
  const result = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (result.length > max || base64(result) !== value) fail(); return result;
}
function keyBytes(key: Uint8Array) { if (!(key instanceof Uint8Array) || key.length !== 32) fail(); }
function aad(value: EncryptionContext) { return encoder.encode(JSON.stringify(['teacher-vault', 1, 'AES-256-GCM-HKDF-SHA256', value.appId, value.vaultId, value.purpose, value.recordId, value.revision, value.keyVersion])); }
async function derive(master: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  keyBytes(master);
  const material = await crypto.subtle.importKey('raw', bytes(master), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: bytes(info) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Fresh independent master for each app/vault. Caller must protect/wipe its copy. */
export function generateMasterKey(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)); }
export async function encryptBytes(master: Uint8Array, expected: EncryptionContext, plaintext: Uint8Array): Promise<string> {
  const scope = context(expected); keyBytes(master);
  if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_PLAINTEXT_BYTES) fail();
  const salt = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12)), additionalData = aad(scope);
  const key = await derive(master, salt, additionalData);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(nonce), additionalData: bytes(additionalData), tagLength: 128 }, key, bytes(plaintext));
  const envelope: EncryptedEnvelope = { format: 'teacher-vault', version: 1, algorithm: 'AES-256-GCM-HKDF-SHA256', context: scope, salt: base64(salt), nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
  return JSON.stringify(envelope);
}
/** Strict canonical format rejects duplicate fields, ambiguity and unsupported versions. */
export function parseEnvelope(serialized: string): EncryptedEnvelope {
  try {
    if (typeof serialized !== 'string' || serialized.length > MAX_ENVELOPE_CHARS) fail();
    const value: unknown = JSON.parse(serialized); if (!object(value)) fail();
    exactKeys(value, ['format', 'version', 'algorithm', 'context', 'salt', 'nonce', 'ciphertext']);
    if (value.format !== 'teacher-vault' || value.version !== 1 || value.algorithm !== 'AES-256-GCM-HKDF-SHA256') fail();
    const scope = context(value.context);
    if (unbase64(value.salt, 32).length !== 32 || unbase64(value.nonce, 12).length !== 12 || unbase64(value.ciphertext, MAX_PLAINTEXT_BYTES + 16).length < 16) fail();
    const result: EncryptedEnvelope = { format: value.format, version: 1, algorithm: value.algorithm, context: scope, salt: value.salt as string, nonce: value.nonce as string, ciphertext: value.ciphertext as string };
    if (JSON.stringify(result) !== serialized) fail(); return result;
  } catch { return fail(); }
}
export async function decryptBytes(master: Uint8Array, expected: EncryptionContext, serialized: string): Promise<Uint8Array> {
  try {
    const scope = context(expected), envelope = parseEnvelope(serialized); keyBytes(master);
    if (JSON.stringify(scope) !== JSON.stringify(envelope.context)) fail();
    const additionalData = aad(scope), key = await derive(master, unbase64(envelope.salt, 32), additionalData);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(unbase64(envelope.nonce, 12)), additionalData: bytes(additionalData), tagLength: 128 }, key, bytes(unbase64(envelope.ciphertext, MAX_PLAINTEXT_BYTES + 16))));
  } catch { return fail(); }
}
function hex(value: Uint8Array): string { return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''); }
async function checksum(raw: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(encoder.encode('teacher-vault-recovery-v1:' + hex(raw)))))).slice(0, 8); }
/** Random 256-bit recovery secret, hex groups plus a SHA-256 typo checksum. Not a password KDF. */
export async function generateRecoveryCode(): Promise<string> {
  const raw = generateMasterKey(); try { return 'TV1-' + hex(raw).match(/.{8}/g)!.join('-') + '-' + await checksum(raw); } finally { raw.fill(0); }
}
async function recoveryKey(code: string): Promise<Uint8Array> {
  if (typeof code !== 'string' || !/^TV1-(?:[0-9a-f]{8}-){8}[0-9a-f]{8}$/i.test(code)) fail();
  const groups = code.toLowerCase().split('-'), raw = Uint8Array.from(groups.slice(1, 9).join('').match(/../g)!, pair => parseInt(pair, 16));
  if (await checksum(raw) !== groups[9]) { raw.fill(0); fail(); } return raw;
}
/** A separate wrapper for this app/vault; the recovery code is never stored in the envelope. */
export async function wrapMasterKey(master: Uint8Array, code: string, appId: string, vaultId: string, keyVersion = 1): Promise<string> {
  keyBytes(master); const recovery = await recoveryKey(code);
  try { return await encryptBytes(recovery, { appId, vaultId, purpose: 'recovery-key', recordId: 'master-key', revision: 0, keyVersion }, master); } finally { recovery.fill(0); }
}
export async function recoverMasterKey(code: string, wrapped: string, appId: string, vaultId: string, keyVersion = 1): Promise<Uint8Array> {
  const recovery = await recoveryKey(code);
  try { const master = await decryptBytes(recovery, { appId, vaultId, purpose: 'recovery-key', recordId: 'master-key', revision: 0, keyVersion }, wrapped); keyBytes(master); return master; } finally { recovery.fill(0); }
}
