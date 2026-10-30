import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { createEncryptedBackupFiles } = createRequire(import.meta.url)('../../electron/encryptedBackupFiles.cjs');
const directories: string[] = [];
async function fixture(options: Record<string, unknown> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fictional-encrypted-file-')); directories.push(dir); const destination = path.join(dir, 'copy.sovault');
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: destination }), showOpenDialog: async () => ({ canceled: false, filePaths: [destination] }) };
  return { dir, destination, dialog, files: createEncryptedBackupFiles({ dialog, ...options }) };
}
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
const frame = new TextEncoder().encode('{"synthetic-ciphertext":"opaque-bytes-only"}\n');
describe('native encrypted archive file boundary', () => {
  it('streams user-selected bytes, checks exact readback and exposes no paths to the renderer', async () => {
    const f = await fixture(); const result = await f.files.exportFile(async (write: any) => { await write(frame); await write(frame); return { revision: 7 }; }, () => {});
    expect(result).toEqual({ cancelled: false, revision: 7 }); expect(await fs.readFile(f.destination, 'utf8')).toBe(new TextDecoder().decode(frame).repeat(2));
    const opened = await f.files.previewFile(async (source: AsyncIterable<Uint8Array>) => { const pieces = []; for await (const piece of source) pieces.push(piece); return { token: 'opaque-review-token', bytes: Buffer.concat(pieces).length }; }, () => {});
    expect(opened).toEqual({ cancelled: false, token: 'opaque-review-token', bytes: frame.length * 2 }); expect(JSON.stringify([result, opened])).not.toContain(f.dir); expect(await fs.readdir(f.dir)).toEqual(['copy.sovault']);
  });
  it('does not read or export after a cancelled picker', async () => {
    const f = await fixture(); f.dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); f.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); let actions = 0;
    expect(await f.files.exportFile(async () => { actions++; }, () => {})).toEqual({ cancelled: true }); expect(await f.files.previewFile(async () => { actions++; }, () => {})).toEqual({ cancelled: true }); expect(actions).toBe(0); expect(await fs.readdir(f.dir)).toEqual([]);
  });
  it('handles short filesystem writes without truncating a ciphertext frame', async () => {
    const shortFs = { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); if (args[1] !== 'wx') return handle;
      return { write: (bytes: Buffer, offset: number, length: number, position: null) => handle.write(bytes, offset, Math.min(length, 3), position), sync: () => handle.sync(), close: () => handle.close() };
    } };
    const f = await fixture({ fileSystem: shortFs }); await f.files.exportFile(async (write: any) => { await write(frame); return { revision: 1 }; }, () => {}); expect(await fs.readFile(f.destination, 'utf8')).toBe(new TextDecoder().decode(frame));
  });
  it('removes incomplete ciphertext staging and preserves the prior selected copy on failure', async () => {
    const f = await fixture(); await fs.writeFile(f.destination, 'existing-encrypted-copy');
    await expect(f.files.exportFile(async (write: any) => { await write(frame); throw Error('PRIVATE_ARCHIVE_DETAIL'); }, () => {})).rejects.toMatchObject({ code: 'ENCRYPTION_BACKUP_WRITE_FAILED' });
    expect(await fs.readFile(f.destination, 'utf8')).toBe('existing-encrypted-copy'); expect(await fs.readdir(f.dir)).toEqual(['copy.sovault']);
  });
  it('reports post-publication readback failure as uncertain and never retries the write', async () => {
    let renamed = false, writes = 0;
    const brokenFs = { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => { await fs.rename(...args); renamed = true; }, open: async (...args: Parameters<typeof fs.open>) => { if (renamed && args[1] === 'r') throw Error('PRIVATE_DISK_RESPONSE'); return fs.open(...args); } };
    const f = await fixture({ fileSystem: brokenFs }); await expect(f.files.exportFile(async (write: any) => { writes++; await write(frame); return {}; }, () => {})).rejects.toMatchObject({ code: 'ENCRYPTION_BACKUP_WRITE_UNCONFIRMED' });
    expect(writes).toBe(1); expect(await fs.readFile(f.destination, 'utf8')).toBe(new TextDecoder().decode(frame));
  });
  it('treats a lost rename acknowledgement as uncertain even when publication was not confirmed', async () => {
    let attempts = 0;
    const lostFs = { ...fs, rename: async (...args: Parameters<typeof fs.rename>) => { attempts++; await fs.rename(...args); throw Error('PRIVATE_RENAME_REPLY_LOST'); } };
    const f = await fixture({ fileSystem: lostFs }); await expect(f.files.exportFile(async (write: any) => { await write(frame); return {}; }, () => {})).rejects.toMatchObject({ code: 'ENCRYPTION_BACKUP_WRITE_UNCONFIRMED' });
    expect(attempts).toBe(1); expect(await fs.readFile(f.destination, 'utf8')).toBe(new TextDecoder().decode(frame)); expect(await fs.readdir(f.dir)).toEqual(['copy.sovault']);
  });
  it('checks context after the picker and before any file is opened', async () => {
    const f = await fixture(); await expect(f.files.exportFile(async () => {}, () => { throw Error('revoked'); })).rejects.toThrow('revoked'); expect(await fs.readdir(f.dir)).toEqual([]);
    await expect(f.files.previewFile(async () => {}, () => { throw Error('revoked'); })).rejects.toThrow('revoked');
  });
});
