import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createProtectedReportExports } = require('../../electron/protectedReportExports.cjs');
const { createReadableReportWriter } = require('../../electron/readableReportFile.cjs');
function fixture(overrides: any = {}) {
  let current = true, caller = true;
  const dialog = { showErrorBox: vi.fn(), showMessageBox: vi.fn(async (_parent: any, _options: any) => ({ response: 1 })), showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/fictional/report.csv' })) };
  const assertNative = () => { if (!current) throw Object.assign(Error('PRIVATE_CONTEXT'), { code: 'ENCRYPTION_CONTEXT_CHANGED' }); };
  const captureContext = vi.fn((revision: number) => { if (revision !== 7) throw Object.assign(Error('PRIVATE_REVISION'), { code: 'ENCRYPTION_CONTEXT_CHANGED' }); assertNative(); return assertNative; });
  const saveReadable = vi.fn(async (_path: string, _bytes: Buffer, assert: () => void) => { assert(); return true; });
  const exportPdf = vi.fn(async (_name: string, _html: string, controls: any) => { controls.assertCurrent(); return true; });
  const run = createProtectedReportExports({ dialog, parent: () => ({}), captureContext, saveReadable, exportPdf, ...overrides });
  const invoke = (format = 'csv', filename = 'Markbook-Fictional.csv', content = 'Student,Grade\nFictional,3+', revision: any = 7) => run.run(format, filename, content, () => { if (!caller) throw Error('PRIVATE_CALLER'); }, revision);
  return { run, invoke, dialog, captureContext, saveReadable, exportPdf, revoke: () => { current = false; }, revokeCaller: () => { caller = false; } };
}
describe('focused native readable-copy consent', () => {
  it('requires a fresh native warning for each CSV/PDF, returns exact booleans and permits only a guarded PDF transport', async () => {
    const f = fixture(); expect(await f.invoke()).toBe(true); expect(await f.invoke('pdf', 'marked-assessment-fictional.pdf', '<!doctype html><p>Fictional</p>')).toBe(true);
    expect(f.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    const warning = f.dialog.showMessageBox.mock.calls[0][1] as any;
    expect(warning).toMatchObject({ defaultId: 0, cancelId: 0, buttons: ['Cancel', 'Save unencrypted copy'] }); expect(warning.message).toContain('not be encrypted'); expect(warning.detail).toContain('student information');
    expect(f.exportPdf.mock.calls[0][2].assertCurrent).toBeTypeOf('function'); expect(f.saveReadable.mock.calls[0][1]).toEqual(Buffer.from('Student,Grade\nFictional,3+'));
  });
  it.each(['warning', 'save'])('cancel at %s writes no file and retains no consent for a retry', async phase => {
    const f = fixture(); if (phase === 'warning') f.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }); else f.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await f.invoke()).toBe(false); expect(f.saveReadable).not.toHaveBeenCalled(); expect(f.exportPdf).not.toHaveBeenCalled(); expect(await f.invoke()).toBe(true); expect(f.dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
  it.each(['native', 'caller', 'cancel'])('revokes a held confirmation after %s context loss with no save', async reason => {
    const f = fixture(); let release!: (value: any) => void; f.dialog.showMessageBox.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.invoke(); await Promise.resolve(); if (reason === 'native') f.revoke(); else if (reason === 'caller') f.revokeCaller(); else f.run.cancel(); release({ response: 1 });
    await expect(pending).rejects.toThrow(); expect(f.dialog.showSaveDialog).not.toHaveBeenCalled(); expect(f.saveReadable).not.toHaveBeenCalled();
  });
  it('revokes a held save dialog and prevents repeated clicks while busy', async () => {
    const f = fixture(); let release!: (value: any) => void; f.dialog.showSaveDialog.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.invoke(); await Promise.resolve(); await expect(f.invoke()).rejects.toMatchObject({ code: 'REPORT_BUSY' }); f.run.cancel(); release({ canceled: false, filePath: '/fictional/report.csv' });
    await expect(pending).rejects.toMatchObject({ code: 'REPORT_CONTEXT_CHANGED' }); expect(f.saveReadable).not.toHaveBeenCalled();
  });
  it('rejects stale/missing revision, path requests, unsupported formats and destinations before writing', async () => {
    const f = fixture(); for (const args of [['csv', '../private.csv', 'x', 7], ['html', 'report.html', 'x', 7], ['csv', 'x.csv', 'x', 6], ['csv', 'x.csv', 'x', null], ['pdf', 'marked-assessment-x.pdf', '<script>x</script>', 7]] as [string,string,string,any][]) await expect(f.invoke(...args)).rejects.toThrow();
    expect(f.dialog.showMessageBox).not.toHaveBeenCalled(); f.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/fictional/private.json' }); await expect(f.invoke()).rejects.toMatchObject({ code: 'REPORT_INVALID' }); expect(f.saveReadable).not.toHaveBeenCalled();
  });
  it.each(['REPORT_WRITE_UNCONFIRMED', 'REPORT_CLEANUP_REQUIRED', 'REPORT_PUBLISHED_CLEANUP_REQUIRED'])('notifies independently of a lost renderer for %s exactly once', async code => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ saveReadable: async () => { f.revokeCaller(); throw Object.assign(Error('SECRET_PRIVATE_PATH'), { code }); } });
    await expect(f.invoke()).rejects.toMatchObject({ code });
    expect(f.dialog.showErrorBox).toHaveBeenCalledOnce();
    const notice = f.dialog.showErrorBox.mock.calls[0]; expect(JSON.stringify(notice)).not.toContain('SECRET'); expect(JSON.stringify(notice)).toMatch(/unencrypted|readable/i);
  });
  it('alerts after real plaintext staging cleanup fails while the initiating caller is revoked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'readable-lost-context-')); let f: ReturnType<typeof fixture>;
    try {
      const destination = join(directory, 'fictional.csv'); await writeFile(destination, 'old fictional copy');
      const saveReadable = createReadableReportWriter({ write: async (path: string, bytes: Buffer, options: any) => { await writeFile(path, bytes, options); f.revokeCaller(); }, cleanup: async () => { throw Error('PRIVATE_PATH'); } });
      f = fixture({ saveReadable }); f.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });
      await expect(f.invoke()).rejects.toMatchObject({ code: 'REPORT_CLEANUP_REQUIRED' }); expect(f.dialog.showErrorBox).toHaveBeenCalledOnce(); expect(await readFile(destination, 'utf8')).toBe('old fictional copy');
      expect((await readdir(directory)).some(name => name.startsWith('.teacher-readable-copy-'))).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('retains the sanitized critical rejection if native notification itself fails', async () => {
    const f = fixture({ saveReadable: async () => { throw Object.assign(Error('PRIVATE'), { code: 'REPORT_WRITE_UNCONFIRMED' }); } });
    f.dialog.showErrorBox.mockImplementation(() => { throw Error('PRIVATE_NATIVE'); }); f.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockRejectedValueOnce(Error('PRIVATE_FALLBACK'));
    await expect(f.invoke()).rejects.toMatchObject({ code: 'REPORT_WRITE_UNCONFIRMED' }); expect(f.dialog.showErrorBox).toHaveBeenCalledOnce(); expect(f.dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
  it('does not show a residue/uncertainty alert for ordinary canceled confirmation', async () => {
    const f = fixture(); f.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }); expect(await f.invoke()).toBe(false); expect(f.dialog.showErrorBox).not.toHaveBeenCalled();
  });
  it('sanitizes private failures and communicates uncertain publication or plaintext residue', async () => {
    for (const code of ['REPORT_WRITE_UNCONFIRMED', 'REPORT_CLEANUP_REQUIRED', 'REPORT_PUBLISHED_CLEANUP_REQUIRED', 'PRIVATE_RESPONSE']) {
      const f = fixture({ saveReadable: async () => { throw Object.assign(Error('SECRET_FILE_PATH'), { code }); } });
      try { await f.invoke(); throw Error('unexpected save'); } catch (error: any) { expect(error.message).not.toContain('SECRET'); if (code !== 'PRIVATE_RESPONSE') expect(error.code).toBe(code); }
    }
  });
});
describe('readable report publication on real fictional files', () => {
  it.each(['success', 'write', 'validation', 'before-rename', 'lost-rename', 'after-rename', 'cleanup'])('preserves old bytes or reports uncertainty/cleanup honestly on %s', async phase => {
    const directory = await mkdtemp(join(tmpdir(), 'readable-report-test-')), destination = join(directory, 'fictional.csv'), bytes = Buffer.from('Student,Grade\nFictional,3+'); let current = true;
    try {
      await writeFile(destination, 'old fictional copy');
      const save = createReadableReportWriter({
        ...(phase === 'write' ? { write: async (path: string) => { await writeFile(path, 'partial'); throw Error('PRIVATE_WRITE'); } } : {}),
        ...(phase === 'validation' ? { read: async () => Buffer.from('corrupt') } : {}),
        ...(phase === 'before-rename' ? { read: async (path: string) => { const value = await readFile(path); current = false; return value; } } : {}),
        ...(['lost-rename', 'after-rename'].includes(phase) ? { replace: async (from: string, to: string) => { await rename(from, to); if (phase === 'lost-rename') throw Error('PRIVATE_LOST_ACK'); current = false; } } : {}),
        ...(phase === 'cleanup' ? { cleanup: async () => { throw Error('PRIVATE_CLEANUP'); } } : {})
      });
      const result = save(destination, bytes, () => { if (!current) throw Object.assign(Error('context'), { code: 'REPORT_CONTEXT_CHANGED' }); });
      if (phase === 'success') expect(await result).toBe(true);
      else if (['lost-rename', 'after-rename'].includes(phase)) await expect(result).rejects.toMatchObject({ code: 'REPORT_WRITE_UNCONFIRMED' });
      else if (phase === 'cleanup') await expect(result).rejects.toMatchObject({ code: 'REPORT_PUBLISHED_CLEANUP_REQUIRED' });
      else await expect(result).rejects.toThrow();
      expect(await readFile(destination, 'utf8')).toBe(['success', 'lost-rename', 'after-rename', 'cleanup'].includes(phase) ? bytes.toString() : 'old fictional copy');
      expect((await readdir(directory)).filter(name => name !== 'fictional.csv')).toHaveLength(phase === 'cleanup' ? 1 : 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('reports incomplete plaintext cleanup separately before publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'readable-cleanup-test-')); try {
      const save = createReadableReportWriter({ write: async () => { throw Error('fail'); }, cleanup: async () => { throw Error('cleanup'); } });
      await expect(save(join(directory, 'fictional.csv'), Buffer.from('fictional'), () => {})).rejects.toMatchObject({ code: 'REPORT_CLEANUP_REQUIRED' });
      expect((await readdir(directory)).some(name => name.endsWith('.csv'))).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
