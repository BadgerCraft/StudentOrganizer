// Compile the reviewed shared crypto/session into packaged CommonJS, without a runtime TS loader.
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'electron', 'generated', 'encryption');
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], strict: true, skipLibCheck: true, rootDir: root, outDir: out, noEmitOnError: true };
const program = ts.createProgram([path.join(root, 'shared/encryption/index.ts'), path.join(root, 'src/security/encryptedWorkspace.ts')], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) { process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: n => n, getCurrentDirectory: () => root, getNewLine: () => '\n' })); process.exitCode = 1; }
else {
  const result = program.emit();
  if (result.emitSkipped) process.exitCode = 1;
  else { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}\n'); }
}
