import Dexie, { liveQuery } from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DurableDexieGate } from './durableDexieGate';
const sleep = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
async function setup() {
  const indexedDB = new IDBFactory(); Dexie.dependencies.indexedDB = indexedDB; Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  const primary = new Dexie('primary', { indexedDB, IDBKeyRange, cache: 'disabled' }), recovery = new Dexie('recovery', { indexedDB, IDBKeyRange, cache: 'disabled' });
  primary.version(1).stores({ records: 'id,group' }); recovery.version(1).stores({ snapshots: 'id' }); await primary.open(); await recovery.open();
  let commits = 0, failed = false, epoch = 0, hold: Promise<void> | null = null, entered = () => {}, durable: unknown = null; const comments: string[] = [];
  let gate!: DurableDexieGate;
  gate = new DurableDexieGate(async (snapshots, assertCurrent) => {
    const bundle = { records: snapshots.get(primary)!.records, snapshots: snapshots.get(recovery)!.snapshots, comments: [...comments] };
    entered(); if (hold) await hold; assertCurrent(); if (failed) throw new Error('synthetic CAS failed'); durable = structuredClone(bundle); commits++;
  }, () => { const captured = epoch; return () => { if (captured !== epoch) throw new Error('Context changed'); }; });
  gate.register(primary); gate.register(recovery);
  return { primary, recovery, gate, comments, commits: () => commits, durable: () => durable as any, fail: () => { failed = true; }, changeContext: () => { epoch++; }, hold: () => { let release!: () => void, started!: () => void; hold = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { started = resolve; }); entered = started; return { ready, release: () => { hold = null; release(); } }; } };
}
describe('pinned durable Dexie boundary', () => {
  it('covers implicit bulk/update and nested explicit transactions with one commit per root', async () => {
    const f = await setup(), rows = f.primary.table('records');
    await rows.bulkPut([{ id: 'a', group: 1 }, { id: 'b', group: 1 }]); expect(f.commits()).toBe(1);
    await f.primary.transaction('rw', rows, async () => { await rows.update('a', { name: 'changed' }); await f.primary.transaction('rw', rows, async () => { await rows.put({ id: 'c', group: 2 }); }); });
    expect(f.commits()).toBe(2); expect(f.durable().records.length).toBe(3);
    await rows.where('group').equals(1).modify({ name: 'modified' }); await rows.where('group').equals(2).delete(); expect(f.commits()).toBe(4); expect(f.durable().records.every((r: any) => r.name === 'modified')).toBe(true);
  });
  it('blocks readers, write acknowledgments and liveQuery emissions until durable acceptance', async () => {
    const f = await setup(), rows = f.primary.table('records'); await rows.put({ id: 'a', name: 'before' });
    const emissions: any[][] = []; const subscription = liveQuery(() => rows.toArray()).subscribe(value => emissions.push(value)); await sleep();
    const held = f.hold(); let writeDone = false, readDone = false; const writing = rows.update('a', { name: 'pending' }).then(() => { writeDone = true; }); await held.ready;
    const reading = rows.get('a').then(value => { readDone = true; return value; }); await sleep(); expect(writeDone).toBe(false); expect(readDone).toBe(false); expect(emissions.at(-1)?.[0].name).toBe('before');
    held.release(); await writing; expect((await reading).name).toBe('pending'); await sleep(); expect(emissions.at(-1)?.[0].name).toBe('pending'); subscription.unsubscribe();
  });
  it('preserves multi-operation abort and supported async mutator rollback without a vault commit', async () => {
    const f = await setup(), rows = f.primary.table('records'); await rows.put({ id: 'a', name: 'original' }); const before = f.commits();
    await expect(f.primary.transaction('rw', rows, async () => { await rows.put({ id: 'bad' }); await Dexie.waitFor(Promise.resolve()); await rows.update('a', { name: 'wrong' }); await rows.delete('a'); throw Error('abort'); })).rejects.toThrow();
    expect(await rows.get('bad')).toBeUndefined(); expect((await rows.get('a')).name).toBe('original'); expect(f.commits()).toBe(before);
  });
  it.each(['rw!', 'rw?'])('rejects unsupported nested %s roots before independent writes', async mode => {
    const f = await setup(), rows = f.primary.table('records');
    await expect(f.primary.transaction('rw', rows, async () => { await rows.put({ id: 'outer' }); await f.primary.transaction(mode as any, rows, () => rows.put({ id: 'inner' })); })).rejects.toThrow(/unsupported/);
    expect(await rows.count()).toBe(0); expect(f.commits()).toBe(0);
  });
  it('rejects ignoreTransaction and cross-database nested roots without deadlock', async () => {
    const f = await setup(), rows = f.primary.table('records');
    await expect(f.primary.transaction('rw', rows, async () => { await rows.put({ id: 'outer' }); await Dexie.ignoreTransaction(() => rows.put({ id: 'independent' })); })).rejects.toThrow(/unsupported/);
    await expect(f.primary.transaction('rw', rows, async () => { await rows.put({ id: 'outer' }); await f.recovery.table('snapshots').put({ id: 'cross' }); })).rejects.toThrow(/unsupported/);
    expect(await rows.count()).toBe(0); expect(await f.recovery.table('snapshots').count()).toBe(0);
  });
  it('coordinates both databases and explicit external storage without losing concurrent changes', async () => {
    const f = await setup(); await Promise.all([f.primary.table('records').put({ id: 'primary' }), f.recovery.table('snapshots').put({ id: 'backup' }), f.gate.externalWrite(async () => { f.comments.push('fictional comment'); })]);
    expect(f.commits()).toBe(3); expect(f.durable()).toEqual({ records: [{ id: 'primary' }], snapshots: [{ id: 'backup' }], comments: ['fictional comment'] });
    await f.gate.withReadLock(async snapshots => { expect(snapshots.get(f.primary)!.records.length).toBe(1); });
  });
  it('locks all registered stores after persistence failure; no later writes or success events', async () => {
    const f = await setup(), rows = f.primary.table('records'); await rows.put({ id: 'old' }); f.fail(); let completed = false;
    await expect(f.primary.transaction('rw', rows, async tx => { tx.on('complete', () => { completed = true; }); await rows.put({ id: 'failed' }); })).rejects.toThrow(/locked/);
    expect(f.gate.locked).toBe(true); expect(completed).toBe(false); await expect(rows.toArray()).rejects.toThrow(); await expect(f.recovery.table('snapshots').toArray()).rejects.toThrow(); expect(f.durable().records).toEqual([{ id: 'old' }]);
  });
  it('rechecks captured context during pending encryption and blocks close acknowledgment', async () => {
    const f = await setup(), held = f.hold(); const writing = f.primary.table('records').put({ id: 'old-actor' }); await held.ready; f.changeContext(); held.release(); await expect(writing).rejects.toThrow(); expect(f.commits()).toBe(0); expect(f.gate.locked).toBe(true);
    const g = await setup(), pending = g.hold(); const closing = g.primary.table('records').put({ id: 'close' }); await pending.ready; g.gate.lock(); pending.release(); await expect(closing).rejects.toThrow(); expect(g.commits()).toBe(0);
  });
  it('never grants late capture callbacks a bypass into a pending RAM revision', async () => {
    const f = await setup(), rows = f.primary.table('records'); await rows.put({ id: 'a', name: 'before' });
    let resume!: () => void, capturedRead!: Promise<any>; const delayed = new Dexie.Promise<void>(resolve => { resume = resolve; });
    await f.gate.withReadLock(async snapshots => { expect(snapshots.get(f.primary)!.records.length).toBe(1); capturedRead = delayed.then(() => rows.get('a')); });
    const held = f.hold(); const pending = rows.update('a', { name: 'after' }); await held.ready; let readDone = false; capturedRead.then(() => { readDone = true; }); resume(); await sleep(); expect(readDone).toBe(false); held.release(); await pending; expect((await capturedRead).name).toBe('after');
  });
  it('captures queued caller authority before waiting behind another save', async () => {
    const f = await setup(), held = f.hold(), rows = f.primary.table('records'); const first = rows.put({ id: 'first' }); await held.ready; const second = rows.put({ id: 'old-caller' });
    f.changeContext(); held.release(); await expect(first).rejects.toThrow(); await expect(second).rejects.toThrow(); expect(f.commits()).toBe(0); expect(f.gate.locked).toBe(true);
  });
  it('rejects escaped transaction tables and unsafe cache configurations', async () => {
    const f = await setup(); let escaped!: any; await f.primary.transaction('r', f.primary.table('records'), async tx => { escaped = tx.table('records'); }); await expect(escaped.toArray()).rejects.toThrow(/escape/);
    const unsafe = new Dexie('unsafe'); expect(() => f.gate.register(unsafe)).toThrow(/configuration/);
  });
});
