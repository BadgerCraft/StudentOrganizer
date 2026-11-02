import type { FrozenTableSnapshot } from './durableDexieGate';
/** Native-owned structured-workspace protocol. Identity is the tuple, never a slash-joined path. */
export type WorkingChange = { namespace: 'primary' | 'recovery' | 'storage' | 'metadata'; table?: string; key: string } & ({ value: unknown; deleted?: never } | { deleted: true; value?: never });
type PreparedDelta = { changes: WorkingChange[]; accept(): void };
/** Diff only tables reported dirty by the durable transaction gate. Nothing is accepted before host CAS. */
export class WorkingDelta {
  private tables = new Map<string, FrozenTableSnapshot>();
  private storage: Record<string, string>;
  constructor(primary: FrozenTableSnapshot, recovery: FrozenTableSnapshot, storage: Record<string, string>) {
    this.tables.set('primary', primary); this.tables.set('recovery', recovery); this.storage = { ...storage };
  }
  prepare(primary: FrozenTableSnapshot, recovery: FrozenTableSnapshot, storage: Record<string, string>): PreparedDelta {
    const changes: WorkingChange[] = [], acceptedTables = new Map(this.tables), acceptedStorage = { ...storage };
    for (const [namespace, dirty] of [['primary', primary], ['recovery', recovery]] as const) {
      const before = this.tables.get(namespace)!;
      for (const [table, rows] of Object.entries(dirty)) {
        if (!Object.prototype.hasOwnProperty.call(before, table)) throw Error('Unexpected protected table.');
        const prior = rowMap(before[table]), next = rowMap(rows);
        for (const [key, row] of next) {
          // IDB may retain optional undefined properties. Canonical backup semantics omit those fields.
          const encoded = JSON.stringify(row);
          if (!prior.has(key) || encoded !== JSON.stringify(prior.get(key))) changes.push({ namespace, table, key, value: JSON.parse(encoded) });
        }
        for (const key of prior.keys()) if (!next.has(key)) changes.push({ namespace, table, key, deleted: true });
      }
      acceptedTables.set(namespace, { ...before, ...dirty });
    }
    for (const [key, value] of Object.entries(storage)) if (this.storage[key] !== value) changes.push({ namespace: 'storage', key, value });
    for (const key of Object.keys(this.storage)) if (!(key in storage)) changes.push({ namespace: 'storage', key, deleted: true });
    let accepted = false;
    return { changes, accept: () => { if (accepted) throw Error('Protected delta already accepted.'); accepted = true; this.tables = acceptedTables; this.storage = acceptedStorage; } };
  }
}
function rowMap(rows: readonly unknown[]): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof (row as any).id !== 'string' || !(row as any).id || result.has((row as any).id)) throw Error('Invalid protected record identity.');
    result.set((row as any).id, row);
  }
  return result;
}
