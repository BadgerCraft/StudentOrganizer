import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
const { createReportPdfExporter } = createRequire(import.meta.url)('../../electron/reportPdf.cjs');
function fixture() {
  const pdf = Buffer.from('%PDF-1.7\nfictional\n%%EOF\n');
  const window = { loadURL: vi.fn(async () => {}), isDestroyed: () => false, destroy: vi.fn(), webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), printToPDF: vi.fn(async () => pdf) } };
  const construct = vi.fn(function (_options: any) { return window; });
  const request = vi.fn(); const permissions = vi.fn();
  const dialog = { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/fictional/assessment.pdf' })) };
  const write = vi.fn(async () => {});
  const replace = vi.fn(async () => {});
  const makeTemp = vi.fn(async () => '/fictional/.assessment-pdf-temp');
  const cleanup = vi.fn(async () => {});
  const read = vi.fn(async () => pdf);
  const run = createReportPdfExporter({ BrowserWindow: construct, dialog, session: { fromPartition: () => ({ setPermissionRequestHandler: permissions, webRequest: { onBeforeRequest: request } }) }, parent: () => ({}), write, replace, makeTemp, cleanup, read });
  return { run, window, construct, request, permissions, dialog, write, replace, makeTemp, cleanup, read, pdf };
}
describe('local desktop PDF export', () => {
  it('writes actual PDF bytes and isolates the renderer from scripts, permissions, network and local files', async () => {
    const f = fixture(); expect(await f.run('marked-assessment-commit.pdf', '<!doctype html><p>Fictional feedback</p>')).toBe(true);
    expect(f.write).toHaveBeenCalledWith(join('/fictional/.assessment-pdf-temp', 'report.pdf'), f.pdf, { flag: 'wx', mode: 0o600, flush: true });
    expect(f.replace).toHaveBeenCalledWith(join('/fictional/.assessment-pdf-temp', 'report.pdf'), '/fictional/assessment.pdf');
    expect(f.cleanup).toHaveBeenCalledWith('/fictional/.assessment-pdf-temp', { recursive: true, force: true });
    expect(f.construct.mock.calls[0][0].webPreferences).toMatchObject({ javascript: false, nodeIntegration: false, sandbox: true, contextIsolation: true });
    const filter = f.request.mock.calls[0][0];
    for (const [url, cancel] of [['https://example.invalid/private', true], ['file:///private', true], ['data:image/jpeg;base64,abc', false]]) { const callback = vi.fn(); filter({ url }, callback); expect(callback).toHaveBeenCalledWith({ cancel }); }
    expect(f.window.destroy).toHaveBeenCalledOnce();
  });
  it('cancels without rendering or saving and rejects malformed file requests', async () => {
    const f = fixture(); f.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await f.run('marked-assessment-commit.pdf', '<!doctype html>')).toBe(false);
    expect(f.construct).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    await expect(f.run('../other.pdf', '<!doctype html>')).rejects.toThrow('Invalid');
  });
  it('cleans up failed rendering and permits a later retry without writing non-PDF data', async () => {
    const f = fixture(); f.window.webContents.printToPDF.mockResolvedValueOnce(Buffer.from('not a PDF'));
    await expect(f.run('marked-assessment-commit.pdf', '<!doctype html>')).rejects.toThrow('generation');
    expect(f.write).not.toHaveBeenCalled(); expect(f.window.destroy).toHaveBeenCalledOnce();
    expect(await f.run('marked-assessment-commit.pdf', '<!doctype html>')).toBe(true);
  });
});

describe('protected PDF context guards', () => {
  it.each(['save-dialog', 'load', 'print', 'write', 'read'])('rejects context loss during %s without replacing the destination', async phase => {
    const f = fixture(); let current = true;
    if (phase === 'save-dialog') f.dialog.showSaveDialog.mockImplementationOnce(async () => { current = false; return { canceled: false, filePath: '/fictional/report.pdf' }; });
    if (phase === 'load') f.window.loadURL.mockImplementationOnce(async () => { current = false; });
    if (phase === 'print') f.window.webContents.printToPDF.mockImplementationOnce(async () => { current = false; return f.pdf; });
    if (phase === 'write') f.write.mockImplementationOnce(async () => { current = false; });
    if (phase === 'read') f.read.mockImplementationOnce(async () => { current = false; return f.pdf; });
    await expect(f.run('marked-assessment-fictional.pdf', '<!doctype html><p>fictional</p>', { assertCurrent: () => { if (!current) throw Error('revoked'); } })).rejects.toThrow();
    expect(f.replace).not.toHaveBeenCalled();
    if (phase === 'load') expect(f.window.webContents.printToPDF).not.toHaveBeenCalled();
    if (['write', 'read'].includes(phase)) expect(f.cleanup).toHaveBeenCalled();
  });
  it('communicates protected plaintext cleanup failure while preserving legacy behavior', async () => {
    const f = fixture(); f.cleanup.mockRejectedValue(Error('private path'));
    await expect(f.run('marked-assessment-fictional.pdf', '<!doctype html>', { assertCurrent: () => {} })).rejects.toMatchObject({ code: 'REPORT_PUBLISHED_CLEANUP_REQUIRED' });
    expect(f.replace).toHaveBeenCalledOnce();
    expect(await f.run('marked-assessment-fictional.pdf', '<!doctype html>')).toBe(true);
  });
});

describe('PDF overwrite preservation on the real filesystem', () => {
  it.each(['generation', 'invalid-generation', 'write', 'validation', 'replacement', 'success', 'cancel'])
    ('preserves existing bytes and cleans staging on %s', async outcome => {
      const directory = await mkdtemp(join(tmpdir(), 'pdf-overwrite-test-'));
      const destination = join(directory, 'existing.pdf');
      const original = Buffer.from('%PDF-1.7\noriginal assessment\n%%EOF\n');
      const pdf = Buffer.from('%PDF-1.7\nnew assessment\n%%EOF\n');
      try {
        await writeFile(destination, original);
        const f = fixture();
        f.window.webContents.printToPDF.mockImplementation(async () => {
          if (outcome === 'generation') throw new Error('Simulated generation failure');
          return outcome === 'invalid-generation' ? Buffer.from('%PDF-truncated') : pdf;
        });
        const run = createReportPdfExporter({
          BrowserWindow: f.construct, parent: () => ({}),
          dialog: { showSaveDialog: async () => ({ canceled: outcome === 'cancel', filePath: destination }) },
          session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } }) },
          ...(outcome === 'write' ? { write: async (path: string) => {
            await writeFile(path, '%PDF-partial'); throw new Error('Simulated write failure');
          } } : {}),
          ...(outcome === 'validation' ? { write: async (path: string) => { await writeFile(path, '%PDF-corrupt'); } } : {}),
          ...(outcome === 'replacement' ? { replace: async () => { throw new Error('Simulated replacement failure'); } } : {}),
        });
        const result = run('marked-assessment-fictional.pdf', '<!doctype html><p>Fictional assessment</p>');
        if (outcome === 'success' || outcome === 'cancel') expect(await result).toBe(outcome === 'success');
        else await expect(result).rejects.toThrow();
        expect(await readFile(destination)).toEqual(outcome === 'success' ? pdf : original);
        expect(await readdir(directory)).toEqual(['existing.pdf']);
        if (outcome === 'cancel') expect(f.construct).not.toHaveBeenCalled();
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
});
