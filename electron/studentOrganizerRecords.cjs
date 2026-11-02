// Logical-record mapping only. Canonical schema/byte/authority validation remains mandatory at the host boundary.
const message = 'Encrypted workspace records do not match the supported Student Organizer structure.';
const fail = () => { throw new Error(message); };
function names(input) { const value = input || require('./generated/encryption/src/services/backupValidation.js').BACKUP_TABLE_NAMES; if (!Array.isArray(value) || value.some(name => typeof name !== 'string') || new Set(value).size !== value.length) fail(); return value; }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(); return value; }
function* recordsFromBundle(bundle, trustedTables) {
  const tables = names(trustedTables); object(bundle); object(bundle.primary); object(bundle.recovery); object(bundle.applicationStorage);
  if (bundle.format !== 'student-organizer-working' || bundle.version !== 1 || Object.keys(bundle.primary.tables).sort().join('|') !== [...tables].sort().join('|') || Object.keys(bundle.recovery).sort().join('|') !== 'backups|options|state') fail();
  const { tables: ignored, ...header } = bundle.primary;
  yield { namespace: 'metadata', key: 'bundle', value: { format: bundle.format, version: bundle.version, recoveryTables: ['backups', 'options', 'state'] } };
  yield { namespace: 'metadata', key: 'primary', value: { header, tables } };
  for (const table of tables) {
    if (!Array.isArray(bundle.primary.tables[table])) fail();
    for (const row of bundle.primary.tables[table]) { if (!row || typeof row.id !== 'string' || !row.id) fail(); yield { namespace: 'primary', table, key: row.id, value: row }; }
  }
  for (const table of ['backups','options','state']) {
    if (!Array.isArray(bundle.recovery[table])) fail();
    for (const row of bundle.recovery[table]) {
      if (!row || typeof row.id !== 'string' || !row.id) fail();
      if (table === 'backups') {
        if (typeof row.json !== 'string') fail(); const { json, ...metadata } = row;
        yield { namespace: 'recovery', table, key: row.id, value: metadata };
        yield { namespace: 'recovery', table: 'backup-content', key: row.id, value: json };
      } else yield { namespace: 'recovery', table, key: row.id, value: row };
    }
  }
  for (const key of Object.keys(bundle.applicationStorage)) { if (typeof bundle.applicationStorage[key] !== 'string') fail(); yield { namespace: 'storage', key, value: bundle.applicationStorage[key] }; }
}
function reconstruct(records, trustedTables, view) {
  const tables = names(trustedTables), primary = Object.fromEntries(tables.map(name => [name, []])), recovery = { backups: [], options: [], state: [] }, storage = {}, contents = new Map(), seen = new Set(); let meta, header;
  for (const record of records) {
    object(record); const { namespace, table, key, value } = record;
    const identity = JSON.stringify([namespace, table || '', key]); if (seen.has(identity) || typeof key !== 'string' || !key) fail(); seen.add(identity);
    if (namespace === 'metadata' && table === undefined) {
      if (key === 'bundle') { object(value); if (Object.keys(value).sort().join('|') !== 'format|recoveryTables|version' || value.format !== 'student-organizer-working' || value.version !== 1 || JSON.stringify(value.recoveryTables) !== '["backups","options","state"]') fail(); meta = value; }
      else if (key === 'primary') { object(value); object(value.header); if (Object.keys(value).sort().join('|') !== 'header|tables' || !Array.isArray(value.tables) || value.tables.length !== tables.length || [...value.tables].sort().join('|') !== [...tables].sort().join('|') || 'tables' in value.header) fail(); header = value.header; }
      else if (/^internal-safety\/[0-9a-f-]{36}$/.test(key)) {
        object(value); if (Object.keys(value).sort().join('|') !== 'ciphertext|createdAt|id|revision' || value.id !== key.slice('internal-safety/'.length) || typeof value.ciphertext !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) fail();
        // Native encrypted root checkpoints are control records, outside the legacy data bundle.
      } else fail();
    } else if (namespace === 'primary') { if (!tables.includes(table) || !value || value.id !== key) fail(); primary[table].push(value); }
    else if (namespace === 'recovery') {
      if (table === 'backup-content') { if (view || typeof value !== 'string') fail(); contents.set(key, value); }
      else {
        if (!['backups','options','state'].includes(table) || !value || value.id !== key) fail();
        if (table === 'backups' && (Object.keys(value).sort().join('|') !== 'createdAt|id|reason' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !['automatic','manual','before-restore','before-sync'].includes(value.reason))) fail();
        recovery[table].push(value);
      }
    }
    else if (namespace === 'storage' && table === undefined) { if (typeof value !== 'string') fail(); Object.defineProperty(storage, key, { value, enumerable: true, writable: true, configurable: true }); }
    else fail();
  }
  if (!meta || !header) fail();
  // IndexedDB string primary keys compare by UTF-16 code units, not locale-sensitive collation.
  const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  for (const rows of [...Object.values(primary), ...Object.values(recovery)]) rows.sort(compare);
  const backupCatalog = recovery.backups;
  if (!view && (contents.size !== backupCatalog.length || backupCatalog.some(backup => !contents.has(backup.id)))) fail();
  recovery.backups = view ? [] : backupCatalog.map(backup => ({ ...backup, json: contents.get(backup.id) }));
  const bundle = { format: meta.format, version: meta.version, primary: { ...header, tables: primary }, recovery, applicationStorage: storage };
  return view ? { bundle, backupCatalog } : bundle;
}
function bundleFromRecords(records, trustedTables) { return reconstruct(records, trustedTables, false); }
function bundleViewFromRecords(records, trustedTables) { return reconstruct(records, trustedTables, true); }
function recordChangesFromLegacyDelta(changes) {
  if (!Array.isArray(changes)) fail();
  return changes.flatMap(change => {
    object(change);
    if (change.namespace !== 'recovery' || change.table !== 'backups') return [change];
    if (change.deleted === true) return [change, { namespace: 'recovery', table: 'backup-content', key: change.key, deleted: true }];
    object(change.value); if (change.value.id !== change.key || typeof change.value.json !== 'string') fail();
    const { json, ...metadata } = change.value;
    return [{ ...change, value: metadata }, { namespace: 'recovery', table: 'backup-content', key: change.key, value: json }];
  });
}
module.exports = { recordsFromBundle, bundleFromRecords, bundleViewFromRecords, recordChangesFromLegacyDelta };
