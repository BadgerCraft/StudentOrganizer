import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { encodeWav } from './audio';
const require = createRequire(import.meta.url);
const { createDictation: realService, MODEL_SHA1 } = require('../../electron/dictation.cjs');
// Synthetic fixture digest stub: tests process lifecycle, never downloads/records real audio.
const moduleStub = { exports: {} as any };
vm.runInNewContext(readFileSync(new URL('../../electron/dictation.cjs', import.meta.url), 'utf8'), {
  module: moduleStub, Buffer, Uint8Array, setTimeout, clearTimeout,
  require: (name: string) => name === 'node:crypto' ? { ...require(name), createHash: () => ({ update: () => ({ digest: () => MODEL_SHA1 }) }) } : require(name)
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'dictation-test-'));
  const runtime = path.join(directory, 'whisper-cli'); await writeFile(runtime, 'synthetic runtime');
  await mkdir(path.join(directory, 'dictation')); await writeFile(path.join(directory, 'dictation', 'ggml-tiny.en.bin'), 'synthetic model');
  const children: any[] = [];
  const spawn = vi.fn(() => { const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }); children.push(child); return child; });
  const service = moduleStub.exports.createDictation({ runtime, userData: directory, spawnProcess: spawn, timeoutMs: 500 });
  return { directory, runtime, service, spawn, children, clean: async () => { service.cancel(); await rm(directory, { recursive: true, force: true }); } };
}
describe('desktop local process boundary', () => {
  it('passes only bounded WAV via stdin to fixed CPU arguments, no files or network, repeatable', async () => {
    const f = await fixture(); try {
      for (let i = 0; i < 2; i++) {
        const token = await f.service.begin(), wav = encodeWav(new Float32Array(160));
        const job = f.service.transcribe(token, wav), child = f.children[i];
        expect(child.stdin.read()).toEqual(Buffer.from(wav));
        expect(f.spawn.mock.calls[i]).toEqual([f.runtime, ['-m', path.join(f.directory, 'dictation', 'ggml-tiny.en.bin'), '-f', '-', '-of', 'unused-dictation-output', '-l', 'en', '-nt', '-np', '-ng', '-t', '4'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }]);
        child.stdout.write(' Fictional feedback.\n'); child.emit('close', 0); expect(await job).toBe('Fictional feedback.');
      }
      expect((await readdir(f.directory)).sort()).toEqual(['dictation', 'whisper-cli']);
      expect(await readdir(path.join(f.directory, 'dictation'))).toEqual(['ggml-tiny.en.bin']);
    } finally { await f.clean(); }
  });
  it('rejects unsolicited, stale, duplicate and malformed transcription without spawning', async () => {
    const f = await fixture(); try {
      const opening = f.service.begin(); f.service.cancel(); await expect(opening).rejects.toThrow('cancelled');
      await expect(f.service.transcribe('forged', new Uint8Array())).rejects.toThrow('expired');
      const token = await f.service.begin(); await expect(f.service.begin()).rejects.toThrow('active');
      await expect(f.service.transcribe(token, new Uint8Array(5))).rejects.toThrow(); expect(f.spawn).not.toHaveBeenCalled();
      const next = await f.service.begin(); f.service.cancel(token); expect(f.service.canCapture()).toBe(true);
      f.service.cancel(next); await expect(f.service.transcribe(next, encodeWav(new Float32Array(5)))).rejects.toThrow('expired');
    } finally { await f.clean(); }
  });
  it('cancellation kills process, suppresses output, and allows a clean new session', async () => {
    const f = await fixture(); try {
      const token = await f.service.begin(), job = f.service.transcribe(token, encodeWav(new Float32Array(5)));
      const rejected = expect(job).rejects.toThrow('cancelled'); f.service.cancel(token); await rejected;
      expect(f.children[0].kill).toHaveBeenCalledOnce(); f.children[0].stdout.write('late'); f.children[0].emit('close', 0);
      expect(await f.service.begin()).not.toBe(token);
    } finally { await f.clean(); }
  });
  it('bounds runaway inference and output and isolates process failure', async () => {
    const f = await fixture(); try {
      let token = await f.service.begin(), job = f.service.transcribe(token, encodeWav(new Float32Array(5)));
      f.children[0].emit('error', new Error('sensitive path')); await expect(job).rejects.toThrow('could not start');
      token = await f.service.begin(); job = f.service.transcribe(token, encodeWav(new Float32Array(5))); f.children[1].stdout.write('x'.repeat(16001)); await expect(job).rejects.toThrow('cancelled');
      token = await f.service.begin(); job = f.service.transcribe(token, encodeWav(new Float32Array(5))); await expect(job).rejects.toThrow('cancelled'); expect(f.children[2].kill).toHaveBeenCalledOnce();
    } finally { await f.clean(); }
  });
  it('rejects wrong models with the REAL checksum and leaves files unchanged', async () => {
    const f = await fixture(); try {
      const service = realService({ runtime: f.runtime, userData: f.directory });
      expect((await service.status()).ready).toBe(false);
      await expect(service.installModel(f.runtime)).rejects.toThrow('did not match');
      expect(await readdir(path.join(f.directory, 'dictation'))).toEqual(['ggml-tiny.en.bin']);
      expect((await realService({ runtime: '/missing', userData: f.directory }).status()).reason).toMatch('no local speech runtime');
    } finally { await f.clean(); }
  });
});

describe('IPC ownership and microphone consent', () => {
  it.each(['win32', 'darwin', 'linux'])('enforces consent and owning-frame lifecycle on %s', async platform => {
    // Execute the actual IPC module's platform branch on every CI host.
    const ipcModule = { exports: {} as any };
    vm.runInNewContext(readFileSync(new URL('../../electron/dictationIpc.cjs', import.meta.url), 'utf8'), {
      module: ipcModule,
      require: createRequire(new URL('../../electron/dictationIpc.cjs', import.meta.url)),
      __dirname: path.dirname(fileURLToPath(new URL('../../electron/dictationIpc.cjs', import.meta.url))),
      process: { platform }
    });
    const { attachDictation } = ipcModule.exports;
    const handlers: Record<string, (...args: any[]) => any> = {};
    const frame = { url: new URL('../../dist/index.html', import.meta.url).href };
    const permissions: any = {};
    const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send: vi.fn(), session: { setPermissionCheckHandler: (fn: any) => permissions.check = fn, setPermissionRequestHandler: (fn: any) => permissions.request = fn } });
    const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false, isFocused: () => true });
    const app = Object.assign(new EventEmitter(), { isPackaged: false, getPath: () => '/tmp/fictional-dictation-profile' });
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
    const systemPreferences = { askForMediaAccess: vi.fn(async () => true) };
    const service = attachDictation({ app, window, ipcMain: { removeHandler: () => {}, handle: (name: string, fn: any) => handlers[name] = fn }, dialog, systemPreferences });
    vi.spyOn(service, 'status').mockResolvedValue({ ready: true }); vi.spyOn(service, 'begin').mockResolvedValue('granted');
    const capture = vi.spyOn(service, 'canCapture').mockReturnValue(false), cancel = vi.spyOn(service, 'cancel');
    const event = { sender: contents, senderFrame: frame };
    await expect(handlers['dictation:begin']({ ...event, senderFrame: { url: frame.url } })).rejects.toThrow('denied');
    await expect(handlers['dictation:begin'](event)).rejects.toThrow('not granted'); expect(service.begin).not.toHaveBeenCalled();
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    if (platform === 'darwin') {
      systemPreferences.askForMediaAccess.mockResolvedValueOnce(false);
      await expect(handlers['dictation:begin'](event)).rejects.toThrow('Microphone permission denied');
      expect(service.begin).not.toHaveBeenCalled();
      expect(service.canCapture()).toBe(false);
    }
    expect(await handlers['dictation:begin'](event)).toBe('granted');
    if (platform === 'darwin') {
      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledTimes(2);
      expect(systemPreferences.askForMediaAccess).toHaveBeenNthCalledWith(1, 'microphone');
      expect(systemPreferences.askForMediaAccess).toHaveBeenNthCalledWith(2, 'microphone');
    } else expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    expect(permissions.check(contents, 'media', '', { mediaType: 'audio', isMainFrame: true })).toBe(false);
    expect(permissions.check(contents, 'clipboard-sanitized-write', '', { isMainFrame: true })).toBe(true);
    expect(permissions.check(contents, 'media', '', { mediaType: 'audio' })).toBe(false);
    capture.mockReturnValue(true);
    expect(permissions.check(contents, 'media', '', { mediaType: 'audio', isMainFrame: true })).toBe(true);
    for (const details of [{ mediaTypes: ['video'], isMainFrame: true }, { mediaTypes: ['audio', 'video'], isMainFrame: true }, { mediaTypes: ['audio'], isMainFrame: false }]) { const cb = vi.fn(); permissions.request(contents, 'media', cb, details); expect(cb).toHaveBeenCalledWith(false); }
    const cb = vi.fn(); permissions.request(contents, 'media', cb, { mediaTypes: ['audio'], isMainFrame: true }); expect(cb).toHaveBeenCalledWith(true);
    window.emit('blur'); expect(cancel).toHaveBeenCalled(); expect(contents.send).toHaveBeenCalledWith('dictation:interrupted');
    expect(() => handlers['dictation:transcribe'](event, 42, [])).toThrow('token');
    frame.url = 'https://example.invalid/'; await expect(handlers['dictation:status'](event)).rejects.toThrow('denied');
    window.emit('closed');
  });
});
