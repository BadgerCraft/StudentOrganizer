import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryStore, DEFAULT_OPTIONS, getRecoveryOptions, saveRecoveryOptions, updateRecoveryOptions } from './backupStore';
let store:RecoveryStore;
beforeEach(()=>{store=new RecoveryStore('settings-'+crypto.randomUUID());});
afterEach(async()=>{vi.restoreAllMocks();await store.delete();});
describe('atomic recovery setting intents',()=>{
 it('merges rapid concurrent field changes against committed data rather than a stale render',async()=>{await saveRecoveryOptions({...DEFAULT_OPTIONS},store);await Promise.all([updateRecoveryOptions({intervalHours:6},store),updateRecoveryOptions({retain:14},store),updateRecoveryOptions({automatic:false},store)]);expect(await getRecoveryOptions(store)).toEqual({id:'options',automatic:false,intervalHours:6,retain:14});});
 it('preserves defaults and untouched fields without requiring a previously saved row',async()=>{expect(await updateRecoveryOptions({retain:30},store)).toEqual({...DEFAULT_OPTIONS,retain:30});expect(await updateRecoveryOptions({intervalHours:1},store)).toEqual({...DEFAULT_OPTIONS,retain:30,intervalHours:1});});
 it('leaves the saved row unchanged after invalid patches or a write failure',async()=>{await saveRecoveryOptions({...DEFAULT_OPTIONS,intervalHours:6,retain:14},store);const before=await getRecoveryOptions(store);for(const patch of [{intervalHours:9},{retain:100},{automatic:'yes'},{id:'different'}])await expect(updateRecoveryOptions(patch as any,store)).rejects.toThrow();expect(await getRecoveryOptions(store)).toEqual(before);const original=store.options.put.bind(store.options);vi.spyOn(store.options,'put').mockImplementationOnce((...args:any[])=>original(...args as Parameters<typeof original>).then(()=>{throw new Error('Synthetic failure after row write, before transaction commit');}) as Dexie.Promise<string>);await expect(updateRecoveryOptions({intervalHours:1},store)).rejects.toThrow();expect(await getRecoveryOptions(store)).toEqual(before);});
});
