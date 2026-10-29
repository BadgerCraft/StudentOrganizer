import { describe, expect, it } from 'vitest';
import { generateMasterKey, generateRecoveryCode, encryptBytes, decryptBytes, parseEnvelope, wrapMasterKey, recoverMasterKey, EncryptionError, type EncryptionContext } from './index';

const scope: EncryptionContext = { appId: 'student-organizer', vaultId: 'fictional-vault', purpose: 'working-data', recordId: 'students/fictional', revision: 3, keyVersion: 1 };
const text = new TextEncoder().encode('Fictional classroom record');
describe('shared authenticated encryption v1', () => {
  it('roundtrips bytes, randomizes each seal and never includes plaintext', async () => {
    const master = generateMasterKey(), a = await encryptBytes(master, scope, text), b = await encryptBytes(master, scope, text);
    expect(a).not.toBe(b); expect(a).not.toContain('classroom'); expect(parseEnvelope(a).nonce).not.toBe(parseEnvelope(b).nonce);
    expect(await decryptBytes(master, scope, a)).toEqual(text);
    await expect(decryptBytes(generateMasterKey(), scope, a)).rejects.toThrow(EncryptionError);
  });
  it('binds every context field and refuses old revisions or cross-app decryption', async () => {
    const master = generateMasterKey(), ciphertext = await encryptBytes(master, scope, text);
    const replacements = { appId: 'servetrack', vaultId: 'other-vault', purpose: 'backup', recordId: 'students/other', revision: 2, keyVersion: 2 };
    for (const [field, value] of Object.entries(replacements)) {
      await expect(decryptBytes(master, { ...scope, [field]: value } as EncryptionContext, ciphertext)).rejects.toThrow(EncryptionError);
      const tampered = JSON.parse(ciphertext); tampered.context[field] = value;
      await expect(decryptBytes(master, { ...scope, [field]: value } as EncryptionContext, JSON.stringify(tampered))).rejects.toThrow(EncryptionError);
    }
  });
  it('rejects bit flips, truncation and malformed/versioned formats without plaintext fallback', async () => {
    const master = generateMasterKey(), ciphertext = await encryptBytes(master, scope, text);
    for (const field of ['salt', 'nonce', 'ciphertext']) {
      const tampered = JSON.parse(ciphertext); tampered[field] = (tampered[field][0] === 'A' ? 'B' : 'A') + tampered[field].slice(1);
      await expect(decryptBytes(master, scope, JSON.stringify(tampered))).rejects.toThrow(EncryptionError);
    }
    for (const malformed of ['plain old backup', '', '{}', 'null', ciphertext.slice(0, -1), ciphertext.replace('"version":1', '"version":2'), ciphertext.replace('"version":1', '"version":1,"version":1'), ciphertext.replace('"context":', '"extra":1,"context":'), ' '+ciphertext]) {
      expect(() => parseEnvelope(malformed)).toThrow(EncryptionError);
    }
    for (const invalid of [{ ...scope, revision: -1 }, { ...scope, keyVersion: 0 }, { ...scope, purpose: 'unrecognized' }, { ...scope, recordId: '../private data' }]) {
      await expect(encryptBytes(master, invalid as EncryptionContext, text)).rejects.toThrow(EncryptionError);
    }
    await expect(encryptBytes(new Uint8Array(16), scope, text)).rejects.toThrow(EncryptionError);
  });
  it('handles multi-megabyte attachment bytes, including zero and high bytes', async () => {
    const data = new Uint8Array(2 * 1024 * 1024); for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const master = generateMasterKey(), attachment = { ...scope, purpose: 'attachment' as const };
    const ciphertext = await encryptBytes(master, attachment, data);
    expect(Buffer.from(await decryptBytes(master, attachment, ciphertext)).equals(Buffer.from(data))).toBe(true);
    expect(await decryptBytes(master, scope, await encryptBytes(master, scope, new Uint8Array()))).toEqual(new Uint8Array());
  }, 30000);
  it('recovers the exact independent master on a second device from a random checksummed code', async () => {
    const master = generateMasterKey(), code = await generateRecoveryCode(), wrapped = await wrapMasterKey(master, code, scope.appId, scope.vaultId);
    expect(code).toMatch(/^TV1-/); expect(wrapped).not.toContain(code);
    const recovered = await recoverMasterKey(code.toUpperCase(), wrapped, scope.appId, scope.vaultId);
    expect(recovered).toEqual(master);
    const encrypted = await encryptBytes(master, scope, text);
    expect(await decryptBytes(recovered, scope, encrypted)).toEqual(text);
    await expect(recoverMasterKey(await generateRecoveryCode(), wrapped, scope.appId, scope.vaultId)).rejects.toThrow(EncryptionError);
    await expect(recoverMasterKey(code, wrapped, 'servetrack', scope.vaultId)).rejects.toThrow(EncryptionError);
    await expect(recoverMasterKey(code, wrapped, scope.appId, 'another-vault')).rejects.toThrow(EncryptionError);
    await expect(recoverMasterKey(code.slice(0, -1)+(code.endsWith('0')?'1':'0'), wrapped, scope.appId, scope.vaultId)).rejects.toThrow(EncryptionError);
    await expect(recoverMasterKey('simple-password', wrapped, scope.appId, scope.vaultId)).rejects.toThrow(EncryptionError);
  });
});
