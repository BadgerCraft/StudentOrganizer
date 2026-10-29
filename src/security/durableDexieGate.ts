import Dexie from 'dexie';

/** Pinned internal adapter: any Dexie update requires review of entry/completion/cache hooks. */
export const DURABLE_DEXIE_VERSION = '4.4.6';
const INTERNAL = Symbol('durable-encrypted-workspace');
const AUTHORITY = Symbol('durable-encrypted-authority');
export type FrozenDatabases = ReadonlyMap<Dexie, Readonly<Record<string, readonly unknown[]>>>;
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
  constructor(private readonly persist: (snapshots: FrozenDatabases, assertCurrent: () => void) => Promise<void>, private readonly captureContext: () => (() => void)) {
    if (Dexie.semVer !== DURABLE_DEXIE_VERSION || !promise.PSD || typeof promise.newPSD !== 'function') throw new DurableWorkspaceGateError('Unsupported Dexie runtime; encrypted storage stays disabled.');
  }
  private assertOpen() { if (this.stopped) throw new DurableWorkspaceGateError(); }
  private async freeze(): Promise<FrozenDatabases> {
    const snapshots = new Map<Dexie, Record<string, unknown[]>>();
    for (const db of this.databases) {
      const names = db.tables.map(table => table.name), tx = db.backendDB().transaction(names, 'readonly'), tables: Record<string, unknown[]> = {};
      await Promise.all(names.map(name => new Promise<void>((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onerror = () => reject(request.error);
        request.onsuccess = () => { tables[name] = request.result; resolve(); };
      })));
      snapshots.set(db, tables);
    }
    return snapshots;
  }
  private isolated<T>(task: () => Promise<T>): Promise<T> {
    return promise.newPSD(() => { const zone = promise.PSD; zone[INTERNAL] = null; zone[AUTHORITY] = null; zone.trans = null; zone.transless = zone; return task(); });
  }
  private schedule<T>(task: () => Promise<T>, allowContextChange = false): Promise<T> {
    const assertAuthority = this.captureContext();
    const pending = Dexie.Promise.resolve(this.tail).then(() => {
      this.assertOpen(); assertAuthority(); const epoch = this.epoch;
      return promise.newPSD(() => {
        const zone = promise.PSD; zone[INTERNAL] = this; zone[AUTHORITY] = assertAuthority; zone.transless = zone;
        return Dexie.Promise.resolve(task()).then(value => { if (this.epoch !== epoch) throw new DurableWorkspaceGateError(); if (!allowContextChange) assertAuthority(); return value; });
      });
    });
    this.tail = pending.catch(() => {}); return pending;
  }
  /** Capture receives detached values, never a bypass capability for the live RAM databases. */
  withReadLock<T>(capture: (snapshots: FrozenDatabases) => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested capture is unsupported.');
    return this.schedule(async () => { const snapshots = await this.freeze(); return this.isolated(() => capture(snapshots)); });
  }
  /** Async memory-only storage adapters (comments/private drafts) participate in the same boundary. */
  externalWrite<T>(editMemory: () => Promise<T>): Promise<T> {
    if (promise.PSD[INTERNAL] === this) throw new DurableWorkspaceGateError('Nested external writes are unsupported.');
    return this.schedule(async () => {
      const epoch = this.epoch, assertAuthority = this.captureContext();
      const assertCurrent = () => { this.assertOpen(); assertAuthority(); if (epoch !== this.epoch) throw new DurableWorkspaceGateError(); };
      try {
        const result = await editMemory(); this.assertOpen();
        const snapshots = await this.freeze();
        await this.isolated(() => this.persist(snapshots, assertCurrent));
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
  lock(): void { this.stopped = true; this.epoch++; }
  get locked(): boolean { return this.stopped; }
  register(database: Dexie): void {
    this.assertOpen(); const db = database as any;
    if (!(database instanceof Dexie) || this.databases.has(database) || db._options.cache !== 'disabled' || typeof db._createTransaction !== 'function' || typeof db._transaction !== 'function' || typeof db.Table?.prototype?._trans !== 'function') throw new DurableWorkspaceGateError('Unsupported database configuration; encrypted storage stays disabled.');
    this.databases.add(database);
    const originalTable: AnyFunction = db.Table.prototype._trans;
    const originalExplicit: AnyFunction = db._transaction;
    const originalCreate: AnyFunction = db._createTransaction;
    const gate = this;
    const entry = <T>(mode: string, bound: any, invoke: () => Promise<T>): Promise<T> => {
      gate.assertOpen(); const current: any = Dexie.currentTransaction;
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
              const snapshots = await gate.freeze();
              await gate.isolated(() => gate.persist(snapshots, assertCurrent));
              assertCurrent();
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
