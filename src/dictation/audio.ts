/** Capture is memory-only, bounded to one minute, and never uses a speech service. */
export interface Capture { stop(): Promise<Uint8Array>; cancel(): void }
export async function captureMicrophone(): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone capture is unavailable. You can still type feedback.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream); } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  let chunks: Blob[] = [], size = 0, cancelled = false;
  let fail: (reason: Error) => void = () => {};
  const stopped = new Promise<Blob>((resolve, reject) => {
    fail = reject;
    recorder.ondataavailable = event => {
      if (!cancelled) { size += event.data.size; if (size > 12 * 1024 * 1024) { cancel(); return; } chunks.push(event.data); }
    };
    recorder.onerror = () => { cancel(); };
    recorder.onstop = () => { const blob = new Blob(chunks, { type: recorder.mimeType }); chunks = []; cancelled ? reject(new Error('Dictation cancelled.')) : resolve(blob); };
  });
  // Cancellation may happen before stop() is awaited.
  void stopped.catch(() => {});
  function release() { stream.getTracks().forEach(track => track.stop()); if (recorder.state !== 'inactive') recorder.stop(); }
  function cancel() { cancelled = true; chunks = []; release(); fail(new Error('Dictation cancelled.')); }
  try { recorder.start(250); } catch (error) { cancel(); throw error; }
  return { cancel, async stop() {
    release(); const blob = await stopped;
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (cancelled) throw new Error('Dictation cancelled.');
      if (decoded.duration > 61 || decoded.duration <= 0) throw new Error('Record at most 60 seconds at a time.');
      const offline = new OfflineAudioContext(1, Math.min(16000 * 60, Math.ceil(decoded.duration * 16000)), 16000);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const resampled = await offline.startRendering();
      if (cancelled) throw new Error('Dictation cancelled.');
      return encodeWav(resampled.getChannelData(0));
    } finally { await context.close(); }
  } };
}
export function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true); });
  return bytes;
}
