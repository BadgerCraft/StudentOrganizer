import Dexie from 'dexie';

/** Pinned internal adapter: any Dexie update requires review of entry/completion/cache hooks. */
export const DURABLE_DEXIE_VERSION = '4.4.6';
const INTERNAL = Symbol('durable-encrypted-workspace');
const AUTHORITY = Symbol('durable-encrypted-authority');
export type FrozenTableSnapshot = Readonly<Record<string, readonly unknown[]>>;
export type FrozenDatabases = ReadonlyMap<Dexie, FrozenTableSnapshot>;
/** Only tables reread after a mutation; empty for a private-storage-only boundary. */
export type DirtyTableSnapshots = FrozenDatabases;
function mapView<K,V>(source: Map<K,V>): ReadonlyMap<K,V> {
  const view: ReadonlyMap<K,V> = { get size() { return source.size; }, get: key => source.get(key), has: key => source.has(key), entries: () => source.entries(), keys: () => source.keys(), values: () => source.values(), [Symbol.iterator]: () => source[Symbol.iterator](), forEach(callback, thisArg) { for (const [key,value] of source) callback.call(thisArg,value,key,view); } };
  return Object.freeze(view);
}
function immutableRows(rows: readonly unknown[]): readonly unknown[] {
  const seen = new WeakSet<object>();
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new DurableWorkspaceGateError('Unsupported mutable record data; encrypted storage stays locked.');
    seen.add(value); for (const item of Object.values(value)) freeze(item); Object.freeze(value);
  };
  freeze(rows); return rows;
}
type AnyFunction = (...args: any[]) => any;
const promise = Dexie.Promise as any;
export class DurableWorkspaceGateError extends Error {
  constructor(message = 'Encrypted workspace is locked; reopen its verified durable version.') { super(message); this.name = 'DurableWorkspaceGateError'; }
}

/**
 * Serializes all public Dexie roots, including reads, across registered memory databases.
 * The supplied persistence callback must encrypt+durably CAS the complete resulting bundle.
 * No existing persistent database should be registered as an encrypted working store.
 */
export class DurableDexieGate {
  private tail: PromiseLike<unknown> = Dexie.Promise.resolve();
  private stopped = false;
  private epoch = 0;
  private databases = new Set<Dexie>();
  private accepted = new Map<Dexie, FrozenTableSnapshot>();
  private observed = new WeakMap<object, Set<string>>();
  private pendingOperations = 0;
  constructor(private readonly persist: (snapshots: FrozenDatabases, assertCurrent: () => void, dirty: DirtyTableSnapshots) => Promise<void>, private readonly captureContext: () => (() => void), private readonly onLocked: () => void = () => {}) {
    if (Dexie.semVer !== DURABLE_DEXIE_VERSION || !promise.PSD || typeof promise.newPSD !== 'function') throw new DurableWorkspaceGateError('Unsupported Dexie runtime; encrypted storage stays disabled.');
  }
  private assertOpen() { if (this.stopped) throw new DurableWorkspaceGateError(); }
  private async readTables(db: Dexie, names: string[]): Promise<Record<string, unknown[]>> {
    if (!names.length) return {};
    return new Promise((resolve, reject) => {
      const tx = db.backendDB().transaction(names, 'readonly'), tables: Record<string, unknown[]> = {};
      tx.onabort = () => reject(tx.error ?? new DurableWorkspaceGateError());
      tx.onerror = () => reject(tx.error ?? new DurableWorkspaceGateError());
      tx.oncomplete = () => resolve(tables);
      for (const name of names) {
        const request = tx.objectStore(name).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { tables[name] = request.result; };
      }
    });
  }
  /** Explicit source capture always rereads every table; it never populates accepted cache. */
  private async freeze(): Promise<FrozenDatabases> {
    const snapshots = new Map<Dexie, FrozenTableSnapshot>();
    for (const db of this.databases) snapshots.set(db, await this.readTables(db, db.tables.map(table => table.name)));
    return mapView(snapshots);
  }
  private async candidate(changed: Map<Dexie, Set<string>>): Promise<{ snapshots: Map<Dexie, FrozenTableSnapshot>; dirty: DirtyTableSnapshots }> {
    const snapshots = new Map(this.accepted), dirty = new Map<Dexie, FrozenTableSnapshot>();
    for (const db of this.databases) {
      const previous = snapshots.get(db), names = db.tables.map(table => table.name);
      if (previous && (Object.keys(previous).length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(previous,name)))) throw new DurableWorkspaceGateError('Database schema changed; reopen the verified encrypted workspace.');
      const selected = previous ? [...(changed.get(db) ?? [])] : names;
      if (!selected.length && previous) continue;
      if (selected.some(name => !names.includes(name))) throw new DurableWorkspaceGateError();
      const read = await this.readTables(db, selected), updated: Record<string, readonly unknown[]> = {};
      for (const name of selected) updated[name] = immutableRows(read[name]);
      const frozen = Object.freeze(updated);
      snapshots.set(db, Object.freeze({ ...previous, ...frozen }));
      if (selected.length) dirty.set(db, frozen);
    }
    return { snapshots, dirty: mapView(dirty) };
  }
  private dirtyTables(database: Dexie, native: any, parts: any): Set<string> {
    const names = database.tables.map(table => table.name), changed = new Set(this.observed.get(native) ?? []);
    this.observed.delete(native);
    for (const part of Object.keys(parts ?? {})) {
      const matches = names.filter(name => part.startsWith(`idb://${database.name}/${name}/`));
      if (!matches.length) throw new DurableWorkspaceGateError('Unrecognized database mutation; encrypted storage stays locked.');
      for (const name of matches) changed.add(name);
    }
    return changed;
  }
  private isolated<T>(task: () => Promise<T>): Promise<T> {
    return promise.newPSD(() => { const zone = promise.PSD; zone[INTERNAL] = null; zone[AUTHORITY] = null; zone.trans = null; zone.transless = zone; return task(); });
  }
  private schedule<T>(task: () => Promise<T>, allowContextChange = false, finalRead?: () => boolean): Promise<T> {
    const assertAuthority = this.captureContext(); this.pendingOperations++;
    const pending = Dexie.Promise.resolve(this.tail).then(() => {
      this.assertOpen(); assertAuthority(); const epoch = this.epoch;
      return promise.newPSD(() => {
        const zone = promise.PSD; zone[INTERNAL] = this; zone[AUTHORITY] = assertAuthority; zone.transless = zone;
        return Dexie.Promise.resolve(task()).then(value => { if (this.epoch !== epoch && !(finalRead?.() && this.stopped)) throw new DurableWorkspaceGateError(); if (!allowContextChange) assertAuthority(); return value; });
      });
    });
    const completed = pending.finally(() => { this.pendingOperations--; });
    this.tail = completed.catch(() => {}); return completed;
  }
  /** Cheap serialized boundary for private-memory/native work. Callback must not query these databases. */
  readBarrier<T>(read: () => T | Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested read barriers are unsupported.');
    return this.schedule(() => this.isolated(async () => read()));
  }
  /** Capture receives detached values, never a bypass capability for the live RAM databases. */
  withReadLock<T>(capture: (snapshots: FrozenDatabases) => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested capture is unsupported.');
    return this.schedule(async () => { const snapshots = await this.freeze(); return this.isolated(() => capture(snapshots)); });
  }
  /** Irreversible launch transition: seal queued legacy access before releasing the source freeze. */
  withFinalReadLock<T>(capture: (snapshots: FrozenDatabases) => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested final capture is unsupported.');
    let retiredHere = false;
    return this.schedule(async () => {
      try { const snapshots = await this.freeze(); return await this.isolated(() => capture(snapshots)); }
      finally { retiredHere = !this.stopped; this.lock(); }
    }, false, () => retiredHere);
  }
  /** Async memory-only storage adapters (comments/private drafts) participate in the same boundary. */
  externalWrite<T>(editMemory: () => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested external writes are unsupported.');
    return this.schedule(async () => {
      const epoch = this.epoch, assertAuthority = this.captureContext();
      const assertCurrent = () => { this.assertOpen(); assertAuthority(); if (epoch !== this.epoch) throw new DurableWorkspaceGateError(); };
      try {
        const result = await editMemory(); this.assertOpen();
        const next = await this.candidate(new Map()); assertCurrent();
        await this.isolated(() => this.persist(mapView(next.snapshots), assertCurrent, next.dirty));
        assertCurrent(); this.accepted = next.snapshots;
        if (epoch !== this.epoch) throw new DurableWorkspaceGateError();
        return result;
      } catch { this.lock(); throw new DurableWorkspaceGateError(); }
    });
  }
  /** Context transitions serialize behind accepted work; immediate revocation uses lock(). */
  contextBoundary<T>(change: () => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested context transition is unsupported.');
    return this.schedule(change, true);
  }
  lock(): void { if (this.stopped) return; this.stopped = true; this.epoch++; this.accepted.clear(); this.observed = new WeakMap(); this.onLocked(); }
  get locked(): boolean { return this.stopped; }
  register(database: Dexie, initialTableSnapshot?: Readonly<Record<string, readonly unknown[]>>): void {
    this.assertOpen(); const db = database as any;
    if (this.pendingOperations || !database.isOpen() || !(database instanceof Dexie) || this.databases.has(database) || db._options.cache !== 'disabled' || typeof db._createTransaction !== 'function' || typeof db._transaction !== 'function' || typeof db.Table?.prototype?._trans !== 'function') throw new DurableWorkspaceGateError('Unsupported database configuration; encrypted storage stays disabled.');
    if (initialTableSnapshot) {
      const names = database.tables.map(table => table.name);
      if (Object.keys(initialTableSnapshot).length !== names.length || names.some(name => !Array.isArray(initialTableSnapshot[name]))) throw new DurableWorkspaceGateError('Incomplete initial encrypted snapshot.');
      const initial: Record<string, readonly unknown[]> = {};
      for (const name of names) initial[name] = immutableRows(structuredClone(initialTableSnapshot[name]));
      this.accepted.set(database,Object.freeze(initial));
    }
    this.databases.add(database);
    const backend = database.backendDB(), core = db.core, originalCoreTable = core.table.bind(core), wrapped = new Map<string,any>();
    core.table = (name: string) => {
      if (!wrapped.has(name)) {
        const table = originalCoreTable(name), mutate = table.mutate;
        wrapped.set(name,{ ...table, mutate: (request: any) => mutate.call(table,request).then((result: any) => {
          const changed = this.observed.get(request.trans) ?? new Set<string>(); changed.add(name); this.observed.set(request.trans,changed); return result;
        }) });
      }
      return wrapped.get(name);
    };
    for (const table of database.tables) { (table as any).core = core.table(table.name); if (db[table.name] instanceof db.Table) db[table.name].core = (table as any).core; }
    database.on('close',() => this.lock());
    const originalTable: AnyFunction = db.Table.prototype._trans;
    const originalExplicit: AnyFunction = db._transaction;
    const originalCreate: AnyFunction = db._createTransaction;
    const gate = this;
    const entry = <T>(mode: string, bound: any, invoke: () => Promise<T>): Promise<T> => {
      gate.assertOpen(); if (database.backendDB() !== backend || db.core !== core) { gate.lock(); throw new DurableWorkspaceGateError('Database connection changed.'); } const current: any = Dexie.currentTransaction;
      if (bound && bound !== current) throw new DurableWorkspaceGateError('A transaction-bound table cannot escape its active scope.');
      const ownZone = promise.PSD[INTERNAL] === gate;
      if (current && current.db === database) {
        if (/[!?]/.test(mode) || !current.active) throw new DurableWorkspaceGateError('Forced or fallback nested transactions are unsupported in encrypted mode.');
        return invoke();
      }
      if (ownZone) throw new DurableWorkspaceGateError('Independent or cross-database nested transactions are unsupported in encrypted mode.');
      return gate.schedule(invoke);
    };
    db.Table.prototype._trans = function(mode: string, ...args: any[]) { try { return entry(mode, this._tx, () => originalTable.call(this, mode, ...args)); } catch (error) { return Dexie.Promise.reject(error); } };
    db._transaction = function(mode: string, ...args: any[]) { try { return entry(mode, null, () => originalExplicit.call(this, mode, ...args)); } catch (error) { return Dexie.Promise.reject(error); } };
    db._createTransaction = function(mode: string, stores: any, schema: any, parent: any) {
      const tx = originalCreate.call(this, mode, stores, schema, parent);
      if (mode === 'readwrite' && !parent) {
        const epoch = gate.epoch, resolve = tx._resolve.bind(tx), assertAuthority = promise.PSD[AUTHORITY] ?? gate.captureContext();
        const assertCurrent = () => { gate.assertOpen(); assertAuthority(); if (epoch !== gate.epoch) throw new DurableWorkspaceGateError(); };
        tx._resolve = () => {
          const parts = tx.idbtrans?.mutatedParts;
          if (parts) delete tx.idbtrans.mutatedParts;
          // Native RAM commit has completed. All public readers/writers are still gated.
          void (async () => {
            try {
              assertCurrent();
              const changed = gate.dirtyTables(database, tx.idbtrans, parts);
              const next = await gate.candidate(new Map([[database,changed]])); assertCurrent();
              await gate.isolated(() => gate.persist(mapView(next.snapshots), assertCurrent, next.dirty));
              assertCurrent(); gate.accepted = next.snapshots;
              resolve();
              if (parts) (Dexie.on as any).storagemutated.fire(parts);
            } catch {
              gate.lock(); tx._reject(new DurableWorkspaceGateError());
            }
          })();
        };
      }
      return tx;
    };
  }
}
