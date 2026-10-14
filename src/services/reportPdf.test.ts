import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { createReportPdfExporter } = createRequire(import.meta.url)('../../electron/reportPdf.cjs');
function fixture() {
  const pdf = Buffer.from('%PDF-1.7\nfictional');
  const window = { loadURL: vi.fn(async () => {}), isDestroyed: () => false, destroy: vi.fn(), webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), printToPDF: vi.fn(async () => pdf) } };
  const construct = vi.fn(function (_options: any) { return window; });
  const request = vi.fn(); const permissions = vi.fn();
  const dialog = { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/fictional/assessment.pdf' })) };
  const write = vi.fn(async () => {});
  const run = createReportPdfExporter({ BrowserWindow: construct, dialog, session: { fromPartition: () => ({ setPermissionRequestHandler: permissions, webRequest: { onBeforeRequest: request } }) }, parent: () => ({}), write });
  return { run, window, construct, request, permissions, dialog, write, pdf };
}
describe('local desktop PDF export', () => {
  it('writes actual PDF bytes and isolates the renderer from scripts, permissions, network and local files', async () => {
    const f = fixture(); expect(await f.run('marked-assessment-commit.pdf', '<!doctype html><p>Fictional feedback</p>')).toBe(true);
    expect(f.write).toHaveBeenCalledWith('/fictional/assessment.pdf', f.pdf);
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
