import { describe,expect,it } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),{preflightStartupRecords}=require('../../electron/startupBudget.cjs'),{measureRecord,structuredRecordKey}=require('../../electron/structuredWorkspace.cjs');
const record=(key:string,value:unknown)=>({namespace:'primary',table:'students',key,value});
function freeze<T>(value:T):T { if(value&&typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }
describe('native pre-publication startup budget',()=>{
  it('matches selected-reader encoded value, UTF-8 identity and fixed overhead budgets exactly',()=>{
    const records=[record('fictional/😀',{name:'fictional',text:'quote " slash \\ lone \ud800'}),{namespace:'metadata',key:'internal-safety/fictional',value:{revision:1,ciphertext:'opaque-root'}}];
    const expected=records.reduce((bytes,value)=>bytes+measureRecord(value.value).bytes+Buffer.byteLength(structuredRecordKey(value),'utf8')+128,0);
    expect(preflightStartupRecords(records,{maxAllBytes:expected})).toBe(expected);expect(()=>preflightStartupRecords(records,{maxAllBytes:expected-1})).toThrowError(expect.objectContaining({code:'ENCRYPTION_CAPACITY_LIMIT',reason:'aggregate'}));
    expect(preflightStartupRecords([])).toBe(0);expect(preflightStartupRecords(records.values())).toBe(expected);
  });
  it('checks per-record and aggregate limits without changing inputs or permitting raised caps',()=>{
    const values=[record('a',{text:'fictional'.repeat(40)}),record('b',{text:'fictional'.repeat(40)})],before=structuredClone(values);
    expect(()=>preflightStartupRecords(values,{maxRecordBytes:100})).toThrowError(expect.objectContaining({code:'ENCRYPTION_CAPACITY_LIMIT',reason:'record'}));
    expect(()=>preflightStartupRecords(values,{maxRecordBytes:1000,maxAllBytes:700})).toThrowError(expect.objectContaining({code:'ENCRYPTION_CAPACITY_LIMIT',reason:'aggregate'}));expect(values).toEqual(before);
    for(const options of [{maxRecordBytes:256*1024*1024+1},{maxAllBytes:512*1024*1024+1},{maxAllBytes:0},{maxRecordBytes:1.5},{unknown:true}])expect(()=>preflightStartupRecords(values,options)).toThrowError(expect.objectContaining({code:'ENCRYPTION_CAPACITY_LIMIT',reason:'invalid'}));
  });
  it('reuses only helper-measured deeply frozen identities without rereading large unchanged values',()=>{
    let reads=0;const target=freeze({text:'fictional large bytes '.repeat(10000),nested:{comment:'kept'}}),value=new Proxy(target,{get:(object,key,receiver)=>{reads++;return Reflect.get(object,key,receiver);}}),measurements=new WeakMap();
    const records=[record('a',value)],first=preflightStartupRecords(records,{measurements});expect(reads).toBeGreaterThan(0);const measured=reads;
    expect(preflightStartupRecords(records,{measurements})).toBe(first);expect(reads).toBe(measured);expect(Object.isFrozen(measurements.get(value))).toBe(true);
    expect(()=>preflightStartupRecords(records,{measurements,maxRecordBytes:100})).toThrowError(expect.objectContaining({reason:'record'}));expect(reads).toBe(measured);
    const replacement=freeze({text:'different '.repeat(20000)});measurements.set(replacement,measurements.get(value));
    expect(preflightStartupRecords([record('a',replacement)],{measurements})).toBe(measureRecord(replacement).bytes+Buffer.byteLength(structuredRecordKey(record('a',replacement)))+128);
  });
  it('remeasures mutable or shallow-frozen values and ignores fabricated cache entries',()=>{
    const measurements=new WeakMap(),value={nested:{text:'short'}},records=[record('a',value)];measurements.set(value,Object.freeze({bytes:1,contentHash:'0'.repeat(64)}));
    const initial=preflightStartupRecords(records,{measurements});value.nested.text='fictional'.repeat(100);expect(preflightStartupRecords(records,{measurements})).toBeGreaterThan(initial);
    const shallow=Object.freeze({nested:{text:'a'}}),first=preflightStartupRecords([record('b',shallow)],{measurements});shallow.nested.text='b'.repeat(100);expect(preflightStartupRecords([record('b',shallow)],{measurements})).toBeGreaterThan(first);
  });
  it('never caches frozen accessors whose returned content can change',()=>{
    let text='short',reads=0;const value=Object.freeze({get text(){reads++;return text;}}),measurements=new WeakMap(),initial=preflightStartupRecords([record('a',value)],{measurements}),firstReads=reads;
    text='fictional'.repeat(100);expect(preflightStartupRecords([record('a',value)],{measurements})).toBeGreaterThan(initial);expect(reads).toBeGreaterThan(firstReads);expect(measurements.has(value)).toBe(false);
  });
  it('does not cache frozen arrays with mutable inherited content',()=>{
    let text='short';const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,'0',{get:()=>text});const array=new Array(1);Object.setPrototypeOf(array,prototype);Object.freeze(array);
    const value=Object.freeze({array}),measurements=new WeakMap(),initial=preflightStartupRecords([record('a',value)],{measurements});text='fictional'.repeat(100);
    expect(preflightStartupRecords([record('a',value)],{measurements})).toBeGreaterThan(initial);expect(measurements.has(value)).toBe(false);
  });
  it('budgets all records supplied by the caller, including controls, and rejects ambiguous collections',()=>{
    const primary=record('a',{text:'kept'}),history={namespace:'recovery',table:'backup-content',key:'history',value:'history'.repeat(1000)},control={namespace:'metadata',key:'internal-backup/id',value:{ciphertext:'opaque-root'.repeat(200)}};
    expect(preflightStartupRecords([primary],{maxAllBytes:300})).toBeLessThanOrEqual(300);expect(()=>preflightStartupRecords([primary,control],{maxAllBytes:300})).toThrow();expect(()=>preflightStartupRecords([primary,history],{maxAllBytes:300})).toThrow();
    for(const records of [[primary,primary],[{...primary,deleted:true}],[{...primary,key:''}],[{namespace:'storage',table:'not-allowed',key:'x',value:'text'}],[record('invalid',{text:undefined})],null])expect(()=>preflightStartupRecords(records)).toThrowError(expect.objectContaining({code:'ENCRYPTION_CAPACITY_LIMIT'}));
  });
});
