const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
const { pending, rootFor } = require('./dictationAfterPack.cjs');
const { inspect, fingerprint, verifyMac } = require('./dictationRuntimeIntegrity.cjs');
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const root = rootFor(context);
  if (!fs.existsSync(root)) return;
  const source = pending.get(root);
  pending.delete(root);
  const { manifest, executable } = inspect(root, 'darwin', Arch[context.arch]);
  if (!source || JSON.stringify(manifest) !== JSON.stringify(source)) throw new Error('Missing or changed presign runtime provenance.');
  verifyMac(executable, manifest.architecture);
  const receipt = { stage: 'afterSign', source, final: fingerprint(executable) };
  // Outside the signed app: do not invalidate its sealed resources.
  fs.writeFileSync(path.join(context.outDir, `dictation-runtime-${manifest.architecture}.json`), JSON.stringify(receipt, null, 2));
  console.log('Speech runtime after signing:', JSON.stringify(receipt));
};
