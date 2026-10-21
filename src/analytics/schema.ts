/** This schema deliberately has no student-, path-, error-, or raw-title fields. */
export const SCHEMA = 1 as const;
export type Namespace = 'demo' | 'measured-test';
export type Context = { scale: 'percentage-v1' | 'level-1-4-v1'; category: 'K' | 'T' | 'C' | 'A' | 'overall'; basis: 'assignment' | 'class' };
export type Summary = Context & { sampleSize: number; average: number };
export type Event = {
  schema: 1; namespace: Namespace; id: string; install: string; teacher: string;
  at: string; timezone: string; version: string;
} & ({ kind: 'workflow_completed'; assignment: string; course: string; label?: string; summary?: Summary }
  | { kind: 'reliability'; code: 'save_failed' | 'import_failed' | 'retry'; count: number });
export const LIMITS = { queue: 200, batch: 50, attempts: 3, retentionDays: 400, eventBytes: 2048, collectorEvents: 20000 } as const;
const token = /^sim_[a-z0-9_-]{1,48}$/;
const labels = ['Practice set', 'Unit assessment', 'Project', 'Course summary'] as const;
export type ReportingLabel = typeof labels[number];
/** Fixed teacher-approved vocabulary: arbitrary titles never cross the boundary. */
export function reportingLabel(label: string, approved: boolean): ReportingLabel | undefined {
  return approved && labels.includes(label as ReportingLabel) ? label as ReportingLabel : undefined;
}
function exact(o: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.prototype.hasOwnProperty.call(o, k)) || Object.keys(o).some(k => ![...required, ...optional].includes(k))) throw new Error('Invalid analytics fields');
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new Error('Invalid analytics object');
  return v as Record<string, unknown>;
}
export function validateEvent(input: unknown): Event {
  const e = record(input);
  const common = ['schema', 'namespace', 'id', 'install', 'teacher', 'at', 'timezone', 'version', 'kind'];
  if (e.kind === 'workflow_completed') exact(e, [...common, 'assignment', 'course'], ['label', 'summary']);
  else if (e.kind === 'reliability') exact(e, [...common, 'code', 'count']);
  else throw new Error('Invalid analytics kind');
  if (e.schema !== SCHEMA || !['demo', 'measured-test'].includes(String(e.namespace))) throw new Error('Unsupported analytics schema/source');
  for (const k of ['id', 'install', 'teacher', ...(e.kind === 'workflow_completed' ? ['assignment', 'course'] : [])]) {
    if (typeof e[k] !== 'string' || !token.test(e[k] as string)) throw new Error('Fictional identifiers required');
  }
  if (typeof e.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at) || !Number.isFinite(Date.parse(e.at))) throw new Error('Invalid event time');
  if (new Date(e.at).toISOString() !== e.at) throw new Error('Invalid calendar time');
  if (typeof e.timezone !== 'string' || e.timezone.length > 64) throw new Error('Invalid timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: e.timezone }).format(); } catch { throw new Error('Invalid timezone'); }
  if (typeof e.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(e.version)) throw new Error('Invalid version');
  if (e.kind === 'workflow_completed') {
    if (e.label !== undefined && reportingLabel(String(e.label), true) !== e.label) throw new Error('Unapproved reporting label');
    if (e.summary !== undefined) {
      const s = record(e.summary); exact(s, ['scale', 'category', 'basis', 'sampleSize', 'average']);
      if (!['percentage-v1', 'level-1-4-v1'].includes(String(s.scale)) || !['K', 'T', 'C', 'A', 'overall'].includes(String(s.category)) || !['assignment', 'class'].includes(String(s.basis))) throw new Error('Invalid academic context');
      if (!Number.isInteger(s.sampleSize) || Number(s.sampleSize) < 10 || Number(s.sampleSize) > 1000 || typeof s.average !== 'number' || !Number.isFinite(s.average) || s.average < (s.scale === 'percentage-v1' ? 0 : 1) || s.average > (s.scale === 'percentage-v1' ? 100 : 4)) throw new Error('Invalid/small academic summary');
    }
  } else if (!['save_failed', 'import_failed', 'retry'].includes(String(e.code)) || !Number.isInteger(e.count) || Number(e.count) < 1 || Number(e.count) > 100) throw new Error('Invalid reliability summary');
  if (new TextEncoder().encode(JSON.stringify(e)).length > LIMITS.eventBytes) throw new Error('Oversize analytics event');
  return structuredClone(e) as Event;
}
export function localDay(at: string, timezone: string) {
  const p = new Intl.DateTimeFormat('en', {timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
  const v = (k: string) => p.find(p => p.type === k)!.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
