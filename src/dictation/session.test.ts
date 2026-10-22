import { describe, it, expect, vi, afterEach } from 'vitest';
import { DictationSession, type DictationBridge } from './session';
import { encodeWav } from './audio';
import { createRequire } from 'node:module';
const { validateWav } = createRequire(import.meta.url)('../../electron/dictation.cjs');
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const bridge = { begin: vi.fn(async () => 'token'), cancel: vi.fn(async () => {}), transcribe: vi.fn(async () => 'Fictional feedback') } as unknown as DictationBridge;
  const audio = { stop: vi.fn(async () => new Uint8Array([1])), cancel: vi.fn() }, capture = vi.fn(async () => audio), notify = vi.fn();
  return { bridge, audio, capture, notify, session: new DictationSession(bridge, notify, capture) };
}
afterEach(() => vi.useRealTimers());
describe('local dictation target lifecycle', () => {
  it('requests explicit permission before opening microphone; Stop releases capture and returns review text', async () => {
    const f = fixture(), gate = deferred<string>(); vi.mocked(f.bridge.begin).mockReturnValue(gate.promise);
    const start = f.session.start(); expect(f.capture).not.toHaveBeenCalled(); gate.resolve('one'); await start;
    expect(f.session.phase).toBe('recording'); await f.session.stop();
    expect(f.audio.stop).toHaveBeenCalledOnce(); expect(f.bridge.transcribe).toHaveBeenCalledWith('one', new Uint8Array([1]));
    expect(f.notify.mock.lastCall?.[2]).toBe('Fictional feedback'); expect(f.session.phase).toBe('idle');
    await f.session.start(); await f.session.stop(); expect(f.audio.stop).toHaveBeenCalledTimes(2);
  });
  it('never captures after denied permission and permits retry', async () => {
    const f = fixture(); vi.mocked(f.bridge.begin).mockRejectedValueOnce(new Error('denied'));
    await f.session.start(); expect(f.capture).not.toHaveBeenCalled(); expect(f.notify.mock.lastCall?.[1]).toBe('denied');
    await f.session.start(); expect(f.session.phase).toBe('recording'); f.session.cancel();
  });
  it('cancels a token returned after student/annotation/teacher unmount', async () => {
    const f = fixture(), gate = deferred<string>(); vi.mocked(f.bridge.begin).mockReturnValue(gate.promise);
    const start = f.session.start(); f.session.cancel(); gate.resolve('late'); await start;
    expect(f.capture).not.toHaveBeenCalled(); expect(f.bridge.cancel).toHaveBeenCalledWith('late');
  });
  it('closes a microphone that resolves after cancellation', async () => {
    const f = fixture(), gate = deferred<typeof f.audio>(); f.capture.mockReturnValue(gate.promise);
    const start = f.session.start(); await Promise.resolve(); f.session.cancel(); gate.resolve(f.audio); await start;
    expect(f.audio.cancel).toHaveBeenCalledOnce(); expect(f.bridge.transcribe).not.toHaveBeenCalled();
  });
  it('ignores delayed transcription after cancellation or a new session', async () => {
    const f = fixture(), gate = deferred<string>(); vi.mocked(f.bridge.transcribe).mockReturnValueOnce(gate.promise);
    await f.session.start(); const stop = f.session.stop(); await Promise.resolve(); f.session.cancel(); await f.session.start();
    gate.resolve('Must not enter the new draft'); await stop;
    expect(f.notify.mock.calls.some(call => call[2])).toBe(false); expect(f.session.phase).toBe('recording'); f.session.cancel();
  });
  it('cancels during decode without invoking the runtime', async () => {
    const f = fixture(), gate = deferred<Uint8Array<ArrayBuffer>>(); f.audio.stop.mockReturnValue(gate.promise);
    await f.session.start(); const stop = f.session.stop(); f.session.cancel(); gate.resolve(new Uint8Array()); await stop;
    expect(f.bridge.transcribe).not.toHaveBeenCalled(); expect(f.audio.cancel).toHaveBeenCalledOnce();
  });
  it('isolates no-microphone errors and duplicate starts/stops', async () => {
    const f = fixture(); f.capture.mockRejectedValueOnce(new Error('No microphone'));
    await f.session.start(); expect(f.bridge.cancel).toHaveBeenCalledWith('token');
    await f.session.start(); await f.session.start(); await Promise.all([f.session.stop(), f.session.stop()]);
    expect(f.bridge.begin).toHaveBeenCalledTimes(2); expect(f.bridge.transcribe).toHaveBeenCalledOnce();
  });
  it('automatically turns microphone off at one minute', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.start(); await vi.advanceTimersByTimeAsync(60000);
    expect(f.audio.stop).toHaveBeenCalledOnce(); expect(f.session.phase).toBe('idle');
  });
  it('encodes bounded mono PCM and rejects malformed and oversized data before process launch', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1])); expect(validateWav(wav).length).toBe(50);
    expect(new DataView(wav.buffer).getInt16(46, true)).toBe(32767); expect(new DataView(wav.buffer).getInt16(48, true)).toBe(-32768);
    for (const value of [null, 'path.wav', new Uint8Array(2), new Uint8Array(2000000)]) expect(() => validateWav(value)).toThrow();
    wav[24] = 1; expect(() => validateWav(wav)).toThrow('Unsupported');
  });
});
