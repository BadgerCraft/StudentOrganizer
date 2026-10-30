import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRendererStorageMode } from './rendererStorageMode';
import { downloadFile } from '../utils/downloadFile';
import { exportMarkingReport } from '../marking/report';
import { exportAnnotatedMarkingReport } from '../marking/annotatedReport';
afterEach(() => { setRendererStorageMode('legacy'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('pending protected readable-export policy', () => {
  it.each(['encrypted', 'bootstrapping', 'locked'] as const)('rejects %s before download or report generation', async mode => {
    setRendererStorageMode(mode);
    const create = vi.spyOn(URL, 'createObjectURL');
    expect(() => downloadFile(new Blob(['fictional']), 'fictional.csv')).toThrow('No readable file was saved');
    await expect(exportMarkingReport({} as any)).rejects.toThrow('Use an encrypted backup');
    await expect(exportAnnotatedMarkingReport({} as any)).rejects.toThrow('Use an encrypted backup');
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a protected launch before storage mode is selected', () => {
    vi.stubGlobal('location', { hash: '#encrypted-workspace' });
    expect(() => downloadFile(new Blob(['fictional']), 'fictional.csv')).toThrow('protected workspace');
  });
  it('preserves ordinary legacy local download behavior', () => {
    const click = vi.fn(), remove = vi.fn(), appendChild = vi.fn(), timeout = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click, remove }), body: { appendChild } });
    vi.stubGlobal('window', { location: { hash: '' }, setTimeout: timeout });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional');
    downloadFile(new Blob(['fictional']), 'fictional.csv');
    expect(appendChild).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });
});
