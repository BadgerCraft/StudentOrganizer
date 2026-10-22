const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
const { inspect, fingerprint, equal } = require('./dictationRuntimeIntegrity.cjs');
// In-memory evidence binds afterSign to this packaging invocation, not a stale file.
const pending = new Map();
function rootFor(context) {
  return path.join(context.packager.getResourcesDir(context.appOutDir), 'dictation-runtime');
}
module.exports = async function afterPack(context) {
  const root = rootFor(context);
  if (!fs.existsSync(root)) return; // Existing upgrade fixtures intentionally omit optional runtime.
  const { manifest, executable } = inspect(root, context.electronPlatformName, Arch[context.arch]);
  const bytes = fs.readFileSync(executable);
  equal(fingerprint(bytes), manifest);
  pending.set(root, { manifest, bytes });
  console.log('Speech runtime before signing:', JSON.stringify(manifest));
};
module.exports.pending = pending;
module.exports.rootFor = rootFor;
