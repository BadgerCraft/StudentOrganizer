const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
const { pending, rootFor } = require('./dictationAfterPack.cjs');
const { inspect, fingerprint, verifyMac, compareMacCode, equal } = require('./dictationRuntimeIntegrity.cjs');
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const root = rootFor(context);
  if (!fs.existsSync(root)) return;
  const prepared = pending.get(root);
  const source = prepared?.manifest;
  pending.delete(root);
  const { manifest, executable } = inspect(root, 'darwin', Arch[context.arch]);
  if (!source || JSON.stringify(manifest) !== JSON.stringify(source)) throw new Error('Missing or changed presign runtime provenance.');
  const signed = fs.readFileSync(executable);
  verifyMac(executable, manifest.architecture);
  const code = compareMacCode(prepared.bytes, signed);
  const final = fingerprint(signed);
  equal(fingerprint(executable), final);
  const receipt = { code, stage: 'afterSign', source, final };
  // Outside the signed app: do not invalidate its sealed resources.
  fs.writeFileSync(path.join(context.outDir, `dictation-runtime-${manifest.architecture}.json`), JSON.stringify(receipt, null, 2));
  console.log('Speech runtime after signing:', JSON.stringify(receipt));
};
