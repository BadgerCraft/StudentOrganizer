// Pure main-process pre-publication budget. No data is written, cloned or discarded.
// Caller supplies every startup-loaded primary/control record and excludes only lazy bodies.
// The raw encoded-byte budget is not a JavaScript heap or packaged-photo capacity guarantee.
const { measureRecord, structuredRecordKey } = require('./structuredWorkspace.cjs');
const MAX_RECORD_BYTES = 256 * 1024 * 1024, MAX_ALL_BYTES = 512 * 1024 * 1024;
const MAX_RECORDS = 2000000, MAX_KEY_BYTES = 64 * 1024 * 1024;
// Only entries created here for the same deeply frozen value can authorize reuse.
const verifiedMeasurements = new WeakMap();
function failure(reason) {
  const message = reason === 'invalid'
    ? 'The protected startup records could not be measured. The current workspace has not been replaced.'
    : 'This change exceeds the supported protected startup size. The current workspace has not been replaced. Keep the original data and choose a smaller supported change or source.';
  return Object.assign(Error(message),{code:'ENCRYPTION_CAPACITY_LIMIT',reason});
}
function cap(value,maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw failure('invalid'); return value; }
function deeplyFrozen(value,visiting = new Set(),complete = new Set(),depth = 0) {
  if (value === null || typeof value !== 'object') return true;
  if (depth > 128 || !Object.isFrozen(value) || visiting.has(value)) return false;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    for (let index=0;index<value.length;index++) if (!Object.hasOwn(value,index)) return false;
  } else if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  if (complete.has(value)) return true;
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !deeplyFrozen(descriptor.value,visiting,complete,depth+1)) return false;
  }
  visiting.delete(value); complete.add(value); return true;
}
function measuredBytes(value,cache) {
  const object = value !== null && typeof value === 'object';
  if (object && cache) {
    const prior = WeakMap.prototype.get.call(cache,value);
    if (prior && verifiedMeasurements.get(prior) === value) return prior.bytes;
  }
  const measurement = measureRecord(value);
  if (object && cache && deeplyFrozen(value)) {
    const trusted = Object.freeze({...measurement}); verifiedMeasurements.set(trusted,value); WeakMap.prototype.set.call(cache,value,trusted);
  }
  return measurement.bytes;
}
function preflightStartupRecords(records,options = {}) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key=>!['maxRecordBytes','maxAllBytes','measurements'].includes(key))) throw failure('invalid');
    const maxRecordBytes = cap(options.maxRecordBytes ?? MAX_RECORD_BYTES,MAX_RECORD_BYTES), maxAllBytes = cap(options.maxAllBytes ?? MAX_ALL_BYTES,MAX_ALL_BYTES), cache = options.measurements;
    if (cache !== undefined && !(cache instanceof WeakMap)) throw failure('invalid');
    if (!records || typeof records === 'string' || typeof records[Symbol.iterator] !== 'function') throw failure('invalid');
    const seen = new Set(); let total = 0, keyBytes = 0;
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort().join('|') !== ['namespace',...(record.table === undefined ? []:['table']),'key','value'].sort().join('|')) throw failure('invalid');
      const key = structuredRecordKey(record), overhead = Buffer.byteLength(key,'utf8')+128;
      if (seen.has(key) || seen.size >= MAX_RECORDS || (keyBytes += overhead) > MAX_KEY_BYTES) throw failure('invalid'); seen.add(key);
      const bytes = measuredBytes(record.value,cache);
      if (bytes > maxRecordBytes) throw failure('record'); total += bytes+overhead;
      if (total > maxAllBytes) throw failure('aggregate');
    }
    return total;
  } catch (error) { if (error?.code === 'ENCRYPTION_CAPACITY_LIMIT') throw error; throw failure('invalid'); }
}
module.exports = {preflightStartupRecords};
