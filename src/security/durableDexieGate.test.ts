import Dexie, { liveQuery } from 'dexie';
import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('seals legacy writers before a confirmed final capture releases its mutex', async () => {
    const f = await setup(), rows = f.primary.table('records'); let release!: () => void, entered!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const final = f.gate.withFinalReadLock(async () => { entered(); await wait; return 'native conversion confirmed'; }); await ready; const queued = rows.put({ id: 'must not resume original' }); const rejection = queued.then(() => false, () => true); release(); expect(await final).toBe('native conversion confirmed'); expect(await rejection).toBe(true); expect(f.gate.locked).toBe(true); expect(f.commits()).toBe(0);
  });
  it('does not accept a final capture after an external revocation', async () => {
    const f = await setup(); let release!: () => void, entered!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    const final = f.gate.withFinalReadLock(async () => { entered(); await wait; return 'late native response'; }); await ready; f.gate.lock(); release(); await expect(final).rejects.toThrow(/locked/);
  });
  it('rejects escaped transaction tables and unsafe cache configurations', async () => {
    const f = await setup(); let escaped!: any; await f.primary.transaction('r', f.primary.table('records'), async tx => { escaped = tx.table('records'); }); await expect(escaped.toArray()).rejects.toThrow(/escape/);
    const unsafe = new Dexie('unsafe'); expect(() => f.gate.register(unsafe)).toThrow(/configuration/);
  });
});


// These assertions measure actual raw table reads and persistent-candidate references,
// rather than timing a synthetic encryption benchmark.
afterEach(() => vi.restoreAllMocks());
async function cachedSetup(seeded = true) {
  const indexedDB = new IDBFactory();
  const primary = new Dexie('cache-primary', { indexedDB, IDBKeyRange, cache:'disabled' });
  const recovery = new Dexie('cache-recovery', { indexedDB, IDBKeyRange, cache:'disabled' });
  primary.version(1).stores({ markingSessions:'id', markingAttempts:'id', evidence:'id' });
  recovery.version(1).stores({ backups:'id', state:'id' });
  await primary.open(); await recovery.open();
  const attempts = [{id:'photo',data:'P'.repeat(128 * 1024)}], backups = [{id:'history',json:'B'.repeat(64 * 1024)}];
  await primary.table('markingAttempts').bulkPut(attempts); await recovery.table('backups').bulkPut(backups);
  const accepted: {snapshot: any; dirty: any}[] = []; let fail=false, epoch=0, persistenceAttempts=0;
  const gate = new DurableDexieGate(async (snapshot,assertCurrent,dirty) => { persistenceAttempts++; assertCurrent();if(fail)throw Error('lost or failed durable response');accepted.push({snapshot,dirty}); },() => {const captured=epoch;return()=>{if(epoch!==captured)throw Error('actor changed');};});
  gate.register(primary,seeded?{markingSessions:[],markingAttempts:attempts,evidence:[]}:undefined);
  gate.register(recovery,seeded?{backups,state:[]}:undefined);
  const reads:string[]=[], original=FakeObjectStore.prototype.getAll;
  vi.spyOn(FakeObjectStore.prototype,'getAll').mockImplementation(function(this:IDBObjectStore,...args:any[]){reads.push(this.transaction.db.name+'/'+this.name);return original.apply(this,args as any);});
  return {primary,recovery,gate,reads,accepted,attempts,persistenceAttempts:()=>persistenceAttempts,fail:()=>{fail=true;},changeActor:()=>{epoch++;}};
}
describe('dirty-table encrypted snapshot cache',()=>{
  it('does not reread or copy attachment/history tables for repeated evidence and private-storage changes',async()=>{
    const f=await cachedSetup();f.attempts[0].data='mutated caller-owned bootstrap';
    await f.primary.table('markingSessions').put({id:'session',text:'first'});
    await f.primary.table('markingSessions').update('session',{text:'second'});
    await f.recovery.table('state').put({id:'sync',version:1});
    const privateValues:string[]=[];await f.gate.externalWrite(async()=>{privateValues.push('comment');});
    expect(await f.gate.readBarrier(()=>privateValues[0])).toBe('comment');
    expect(f.reads).toEqual(['cache-primary/markingSessions','cache-primary/markingSessions','cache-recovery/state']);
    const first=f.accepted[0].snapshot.get(f.primary).markingAttempts, history=f.accepted[0].snapshot.get(f.recovery).backups;
    for(const entry of f.accepted){expect(entry.snapshot.get(f.primary).markingAttempts).toBe(first);expect(entry.snapshot.get(f.recovery).backups).toBe(history);expect(entry.snapshot.set).toBeUndefined();}
    expect(first[0].data).toBe('P'.repeat(128*1024));expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first[0])).toBe(true);
    expect(()=>{first[0].data='retained callback mutation';}).toThrow();
    expect(Object.keys(f.accepted[0].dirty.get(f.primary))).toEqual(['markingSessions']);
    expect(f.accepted[1].dirty.get(f.primary).markingAttempts).toBeUndefined();expect(f.accepted[2].dirty.has(f.primary)).toBe(false);expect(f.accepted[3].dirty.size).toBe(0);
    await f.primary.table('markingAttempts').get('photo');expect(f.reads).toHaveLength(3);
  });
  it('captures all tables once without a seed, and fresh complete sources only when explicitly requested',async()=>{
    const f=await cachedSetup(false);await f.primary.table('markingSessions').put({id:'initial'});
    const all=['cache-primary/evidence','cache-primary/markingAttempts','cache-primary/markingSessions','cache-recovery/backups','cache-recovery/state'];
    expect([...f.reads].sort()).toEqual(all);expect(f.accepted[0].dirty.get(f.primary).markingAttempts).toHaveLength(1);
    f.reads.length=0;await f.primary.table('markingSessions').update('initial',{text:'later'});expect(f.reads).toEqual(['cache-primary/markingSessions']);
    f.reads.length=0;await f.gate.withReadLock(async snapshots=>{expect(snapshots.get(f.primary)!.markingAttempts).toHaveLength(1);expect(snapshots.get(f.recovery)!.backups).toHaveLength(1);});expect([...f.reads].sort()).toEqual(all);
    f.reads.length=0;await f.gate.withFinalReadLock(async snapshots=>{expect(snapshots.get(f.recovery)!.backups).toHaveLength(1);});expect([...f.reads].sort()).toEqual(all);await expect(f.gate.readBarrier(()=>true)).rejects.toThrow(/locked/);
  });
  it('tracks nested, bulk, collection modify/delete and clear without rereading scoped-but-unchanged tables',async()=>{
    const f=await cachedSetup();
    await f.primary.transaction('rw',f.primary.tables,async()=>{await f.primary.table('markingSessions').put({id:'s'});await f.primary.transaction('rw',f.primary.table('evidence'),async()=>{await f.primary.table('evidence').bulkPut([{id:'a',grade:1},{id:'b',grade:2}]);});});
    expect([...f.reads].sort()).toEqual(['cache-primary/evidence','cache-primary/markingSessions']);expect(Object.keys(f.accepted[0].dirty.get(f.primary)).sort()).toEqual(['evidence','markingSessions']);
    f.reads.length=0;await f.primary.table('evidence').toCollection().modify({grade:3});await f.primary.table('evidence').where('id').equals('a').delete();await f.primary.table('evidence').clear();
    expect(f.reads).toEqual(['cache-primary/evidence','cache-primary/evidence','cache-primary/evidence']);expect(f.accepted.at(-1)!.dirty.get(f.primary).evidence).toEqual([]);
  });
  it('keeps aborted mutations out of the cache and refreshes restored tables before a later small save',async()=>{
    const f=await cachedSetup();await expect(f.primary.transaction('rw',f.primary.tables,async()=>{await f.primary.table('markingAttempts').clear();await f.primary.table('markingSessions').put({id:'aborted'});throw Error('rollback');})).rejects.toThrow('rollback');expect(f.reads).toEqual([]);expect(f.accepted).toEqual([]);
    await f.primary.transaction('rw',f.primary.tables,async()=>{await f.primary.table('markingAttempts').clear();await f.primary.table('markingAttempts').put({id:'restored-photo',data:'new-version'});await f.primary.table('markingSessions').clear();});
    const restored=f.accepted[0].snapshot.get(f.primary).markingAttempts;expect(restored).toEqual([{id:'restored-photo',data:'new-version'}]);f.reads.length=0;
    await f.primary.table('markingSessions').put({id:'after-restore'});expect(f.reads).toEqual(['cache-primary/markingSessions']);expect(f.accepted[1].snapshot.get(f.primary).markingAttempts).toBe(restored);
    f.fail();await expect(f.primary.table('markingSessions').put({id:'unconfirmed'})).rejects.toThrow(/locked/);expect(f.accepted).toHaveLength(2);await expect(f.gate.readBarrier(()=>true)).rejects.toThrow();await expect(f.gate.withReadLock(async()=>true)).rejects.toThrow();
  });
  it('rechecks actor authority after raw snapshot reads before invoking persistence',async()=>{
    const original=FakeObjectStore.prototype.getAll, f=await cachedSetup();
    vi.spyOn(FakeObjectStore.prototype,'getAll').mockImplementation(function(this:IDBObjectStore,...args:any[]){const request=original.apply(this,args as any);request.addEventListener('success',()=>f.changeActor(),{once:true});return request;});
    await expect(f.primary.table('markingSessions').put({id:'revoked-during-read'})).rejects.toThrow(/locked/);expect(f.persistenceAttempts()).toBe(0);expect(f.gate.locked).toBe(true);
  });
  it('initializes newly registered stores without rereading accepted stores and rejects stale connections',async()=>{
    const f=await cachedSetup();await f.primary.table('markingSessions').put({id:'existing'});f.reads.length=0;
    const indexedDB=new IDBFactory(),extra=new Dexie('cache-extra',{indexedDB,IDBKeyRange,cache:'disabled'});extra.version(1).stores({newTable:'id',emptyTable:'id'});await extra.open();f.gate.register(extra);
    await extra.table('newTable').put({id:'new'});expect([...f.reads].sort()).toEqual(['cache-extra/emptyTable','cache-extra/newTable']);expect(f.accepted.at(-1)!.dirty.get(extra).newTable).toEqual([{id:'new'}]);
    f.primary.close();expect(f.gate.locked).toBe(true);await expect(extra.table('newTable').toArray()).rejects.toThrow(/locked/);
  });
});
