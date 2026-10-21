import { Event, LIMITS, Namespace, validateEvent } from './schema';
export interface LocalStoragePort { read(): string | null; write(value: string): void }
type Pending = { event: Event; attempts: number; nextAt: number };
type State = { schema: 1; consent: 'denied' | 'granted' | 'withdrawn'; generation: number; queue: Pending[] };
export interface Transport { send(events: Event[], signal: AbortSignal): Promise<void> }
export const productionAnalytics = Object.freeze({ available: false, capture: (_value?: unknown) => false, activate: () => false });
/** Only the simulator instantiates this. Never import into teacher application startup. */
export class FictionalOutbox {
  private state: State = {schema:1, consent:'denied', generation:0, queue:[]};
  private busy = false;
  private healthy = true;
  private active?: AbortController;
  constructor(private storage: LocalStoragePort, private namespace: Namespace, private now = () => Date.now(), private timeoutMs = 5000) {
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000) throw new Error('Invalid transport timeout');
    try {
      const raw = storage.read();
      if (raw) {
        if(raw.length > LIMITS.queue * (LIMITS.eventBytes + 128) + 256) throw new Error();
        const s = JSON.parse(raw);
        if (s.schema !== 1 || !['denied','granted','withdrawn'].includes(s.consent) || !Number.isSafeInteger(s.generation) || s.generation < 0 || !Array.isArray(s.queue) || s.queue.length > LIMITS.queue || Object.keys(s).sort().join() !== 'consent,generation,queue,schema') throw new Error();
        s.queue = s.queue.map((p: Pending) => {
          if (!p || Object.keys(p).sort().join() !== 'attempts,event,nextAt' || !Number.isInteger(p.attempts) || p.attempts < 0 || p.attempts >= LIMITS.attempts || !Number.isFinite(p.nextAt) || p.nextAt < 0) throw new Error();
          const event = validateEvent(p.event); if (event.namespace !== namespace) throw new Error(); return {...p,event};
        });
        if (s.consent !== 'granted' && s.queue.length) throw new Error();
        this.state = s;
        // Consent never resumes just because persisted code/data exists. Drop stale
        // test queues on a new session; a fresh grant never replays older activity.
        if(this.state.consent === 'granted') this.state.consent = 'denied'; this.state.queue = []; this.state.generation++;
        this.save();
      }
    } catch { this.healthy = false; } // Preserve corrupt bytes, fail closed, never silently enroll.
  }
  status() { return {consent:this.state.consent, queued:this.state.queue.length, healthy:this.healthy, available:'fictional-tests-only'}; }
  private save() { try { this.storage.write(JSON.stringify(this.state)); return true; } catch { this.healthy = false; this.state.consent = 'denied'; this.state.queue = []; return false; } }
  consent(grant: boolean) {
    if (!this.healthy) return false;
    this.active?.abort();
    this.state.generation++; this.state.consent = grant ? 'granted' : 'denied'; this.state.queue = []; return this.save();
  }
  withdraw() {
    this.active?.abort();
    this.state.generation++; this.state.consent = 'withdrawn'; this.state.queue = []; return this.save();
  }
  capture(input: unknown): boolean {
    try {
      if (!this.healthy || this.state.consent !== 'granted') return false;
      const event = validateEvent(input);
      if (event.namespace !== this.namespace || Date.parse(event.at) > this.now() || Date.parse(event.at) < this.now() - LIMITS.retentionDays * 86400000) return false;
      this.state.queue = this.state.queue.filter(p => Date.parse(p.event.at) >= this.now() - LIMITS.retentionDays * 86400000);
      if (this.state.queue.some(p => p.event.id === event.id)) return false;
      if (this.state.queue.length >= LIMITS.queue) return false;
      this.state.queue.push({event, attempts:0, nextAt:0}); return this.save();
    } catch { return false; } // Analytics must never throw into the marking path.
  }
  async flush(transport: Transport) {
    if (this.busy || !this.healthy || this.state.consent !== 'granted') return;
    this.busy = true;
    const generation = this.state.generation;
    const controller = new AbortController(); this.active=controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const batch = this.state.queue.filter(p => p.nextAt <= this.now() && Date.parse(p.event.at) >= this.now() - LIMITS.retentionDays * 86400000).slice(0,LIMITS.batch);
    try {
      if (!batch.length) return;
      // Explicit caller-driven attempt only; deadline bounds a hung transport.
      const deadline = new Promise<never>((_resolve,reject)=>{
        controller.signal.addEventListener('abort',()=>reject(new Error('Analytics attempt stopped')),{once:true});
        timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      });
      await Promise.race([transport.send(structuredClone(batch.map(p => p.event)),controller.signal),deadline]);
      if (generation === this.state.generation) { const ids = new Set(batch.map(p => p.event.id)); this.state.queue = this.state.queue.filter(p => !ids.has(p.event.id)); }
    } catch {
      if (generation === this.state.generation) for (const p of batch) { p.attempts++; p.nextAt = this.now() + 1000 * 2 ** p.attempts; }
    } finally {
      if(timer)clearTimeout(timer);if(this.active===controller)this.active=undefined;
      this.state.queue = this.state.queue.filter(p => p.attempts < LIMITS.attempts && Date.parse(p.event.at) >= this.now() - LIMITS.retentionDays * 86400000);
      if (this.healthy) this.save(); this.busy = false;
    }
  }
}
