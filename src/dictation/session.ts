import { captureMicrophone, type Capture } from './audio';
export interface DictationStatus { ready: boolean; reason: string }
export interface DictationBridge {
  status(): Promise<DictationStatus>;
  install(): Promise<DictationStatus>;
  begin(): Promise<string>;
  cancel(token: string): Promise<void>;
  transcribe(token: string, audio: Uint8Array): Promise<string>;
  onInterrupted(callback: () => void): () => void;
}
declare global { interface Window { desktopDictation?: DictationBridge } }
export type Phase = 'idle' | 'permission' | 'opening' | 'recording' | 'transcribing';
/** A generation belongs to exactly one mounted feedback target. Late work is discarded. */
export class DictationSession {
  private generation = 0;
  private token?: string;
  private capture?: Capture;
  private timer?: ReturnType<typeof setTimeout>;
  phase: Phase = 'idle';
  constructor(private bridge: DictationBridge, private notify: (phase: Phase, message?: string, transcript?: string) => void, private captureAudio = captureMicrophone) {}
  private set(phase: Phase, message?: string, transcript?: string) { this.phase = phase; this.notify(phase, message, transcript); }
  cancel(message?: string) {
    ++this.generation; clearTimeout(this.timer); this.capture?.cancel(); this.capture = undefined;
    if (this.token) void this.bridge.cancel(this.token).catch(() => {});
    this.token = undefined; this.set('idle', message);
  }
  async start() {
    if (this.phase !== 'idle') return;
    const current = ++this.generation;
    this.set('permission', 'Waiting for microphone permission…');
    try {
      const token = await this.bridge.begin();
      if (current !== this.generation) { void this.bridge.cancel(token).catch(() => {}); return; }
      this.token = token;
      this.set('opening', 'Opening microphone…');
      const capture = await this.captureAudio();
      if (current !== this.generation) { capture.cancel(); return; }
      this.capture = capture; this.set('recording', 'Recording — microphone on (maximum 60 seconds).');
      this.timer = setTimeout(() => { void this.stop(); }, 60000);
    } catch (error) { if (current === this.generation) this.cancel(error instanceof Error ? error.message : 'Microphone unavailable. You can still type feedback.'); }
  }
  async stop() {
    if (this.phase !== 'recording' || !this.capture || !this.token) return;
    const current = this.generation, token = this.token, capture = this.capture;
    clearTimeout(this.timer); this.set('transcribing', 'Microphone off. Transcribing on this computer…');
    try {
      const wav = await capture.stop();
      if (current !== this.generation) return;
      const transcript = await this.bridge.transcribe(token, wav);
      if (current !== this.generation) return;
      this.capture = undefined; this.token = undefined;
      this.set('idle', 'Review and edit the transcript, then add it to this feedback draft.', transcript);
    } catch (error) { if (current === this.generation) this.cancel(error instanceof Error ? error.message : 'Local transcription failed.'); }
  }
}
