const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config');
const asar = require('@electron/asar');
async function main() {
  const root = path.resolve('.');
  const config = await getConfig(root, 'apps/control-panel/electron-builder.cjs', null);
  await validateConfiguration(config, { isEnabled: false, add() {} });
  assert.equal(config.appId, 'ca.badgercraft.studentorganizer.controlpanel');
  assert.equal(config.publish, null);
  assert.equal(config.win.publish, undefined);
  assert.equal(path.resolve(config.directories.app), path.join(root, 'apps/control-panel'));
  assert.equal(config.directories.output, 'release/control-panel');
  const metadata = JSON.parse(await fs.readFile('apps/control-panel/package.json', 'utf8'));
  assert.equal(metadata.main, 'electron/main.cjs');
  assert.notEqual(metadata.name, JSON.parse(await fs.readFile('package.json', 'utf8')).name);
  assert.equal(metadata.dependencies, undefined, 'Console should not pull teacher database libraries into its runtime');
  for (const resource of config.extraResources) {
    assert.equal(resource.to, 'owner-update-contract');
    for (const file of resource.filter) await fs.access(path.join(root, resource.from, file));
  }
  // Optionally audit real packaged resources on Windows or Mac CI (no execution).
  const resources = process.argv[2];
  if (resources) {
    const archive = path.join(resources, 'app.asar');
    const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString());
    assert.equal(packaged.name, metadata.name); assert.equal(packaged.main, metadata.main);
    for (const file of ['electron/main.cjs', 'electron/preload.cjs', 'electron/store.cjs', 'dist/index.html']) assert.ok(asar.extractFile(archive, file).length > 0);
    const entries = asar.listPackage(archive);
    assert.ok(!entries.some(file => /(?:dexie|portabilityService|rosterParser)/i.test(file)), 'Teacher database code must not enter the owner package');
    for (const file of config.extraResources[0].filter) assert.deepEqual(await fs.readFile(path.join(resources, 'owner-update-contract', file)), await fs.readFile(path.join(root, 'electron', file)));
    console.log('PASS: actual packaged owner entry, UI, storage helper and byte-exact shared contracts; no teacher database modules. Native launch remains separate.');
  } else console.log('PASS: resolved separate-executable packaging configuration. Actual native packages/runtime UNVERIFIED by this configuration check.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
