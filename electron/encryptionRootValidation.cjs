// Native root validation shared by normal startup and code-only recovery.
const { bundleViewFromRecords } = require('./studentOrganizerRecords.cjs');
const fail = () => Object.assign(Error('The complete protected root could not be verified.'), { code: 'ENCRYPTION_ARCHIVE_INVALID' });
function control(record, scope, api, ceiling) {
  const value = record.value, backup = record.key.startsWith('internal-backup/');
  const keys = backup ? 'ciphertext|createdAt|id|primaryHash|reason|revision' : 'ciphertext|createdAt|id|revision';
  if (!value || Object.keys(value).sort().join('|') !== keys || record.key !== (backup ? 'internal-backup/' : 'internal-safety/') + value.id || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision >= ceiling || typeof value.ciphertext !== 'string' || backup && (!['manual','automatic','before-sync','before-restore'].includes(value.reason) || typeof value.primaryHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.primaryHash))) throw fail();
  const actual = api.parseEnvelope(value.ciphertext).context, expected = { ...scope, purpose: 'working-data', recordId: 'workspace', revision: value.revision };
  if (Object.keys(expected).some(key => actual[key] !== expected[key])) throw fail();
  return { id: (backup ? 'snapshot/' : 'workspace/') + value.id, value: Object.freeze(value) };
}
async function readRootView(opened, scope, api, guard) {
  const descriptors = await opened.list(); guard();
  const bodies = new Set(descriptors.filter(record => record.namespace === 'recovery' && record.table === 'backup-content').map(record => record.key));
  // The engine preflights the COMPLETE selected allocation, including safety-root
  // strings, before it materializes any selected record. History bodies stay lazy.
  const selected = await opened.readSelected(descriptors.filter(record => !(record.namespace === 'recovery' && record.table === 'backup-content'))); guard();
  const records = [], controls = [];
  for (const record of selected) {
    if (record.namespace === 'metadata' && /^internal-(backup|safety)\//.test(record.key)) controls.push(control(record, scope, api, opened.getObjectRevisionCeiling()));
    else records.push(record);
  }
  const view = bundleViewFromRecords(records);
  if (view.backupCatalog.length !== bodies.size || view.backupCatalog.some(item => !bodies.has(item.id))) throw fail();
  for (const backup of view.backupCatalog) Object.freeze(backup);
  return { records, controls, ...view };
}
async function verifyRootView(opened, scope, api, validation, guard, actor) {
  const view = await readRootView(opened, scope, api, guard), snapshot = await validation.validateMainBundleIntegrity(view.bundle); guard();
  if (actor !== undefined) { await validation.assertMainFullWorkspaceAuthority(snapshot, actor); guard(); }
  for (const backup of view.backupCatalog) {
    const json = await opened.readRecord({ namespace: 'recovery', table: 'backup-content', key: backup.id }); guard();
    if (typeof json !== 'string') throw fail();
    const historical = await validation.validateMainBundleIntegrity({ ...snapshot, primary: JSON.parse(json) }); guard();
    if (actor !== undefined) { await validation.assertMainFullWorkspaceAuthority(historical, actor); guard(); }
  }
  return { ...view, snapshot };
}
module.exports = { readRootView, verifyRootView };
