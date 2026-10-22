import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { fingerprint, equal, inspect, verifyFinal, compareMacCode } = require('../../scripts/dictationRuntimeIntegrity.cjs');
const afterPack = require('../../scripts/dictationAfterPack.cjs');
const afterSign = require('../../scripts/dictationAfterSign.cjs');
const { Arch } = require('builder-util');
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); afterPack.pending.clear(); });
function fixture(platform = 'darwin', architecture = 'arm64') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-integrity-')); directories.push(dir);
  const root = path.join(dir, 'dictation-runtime'); fs.mkdirSync(root);
  const binary = path.join(root, platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  fs.writeFileSync(binary, 'original bytes'); fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT fixture');
  const manifest = { engine: 'whisper.cpp', version: '1.7.6', revision: 'a8d002cfd879315632a579e73f0148d06959de36', platform, architecture, modelBundled: false, ...fingerprint(binary) };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const context = { electronPlatformName: platform, arch: Arch[architecture], appOutDir: dir, outDir: dir, packager: { getResourcesDir: () => dir } };
  return { root, binary, manifest, context };
}
describe('packaged speech runtime integrity', () => {
  it.each(['win32', 'linux', 'darwin'])('checks exact prepared bytes on %s before signing', async platform => {
    const f = fixture(platform); await afterPack(f.context);
    fs.writeFileSync(f.binary, 'modified bytes'); // Same size corruption must fail too.
    await expect(afterPack(f.context)).rejects.toThrow('bytes/hash');
  });
  it('retains Windows exact hash verification', () => {
    const f = fixture('win32', 'x64'); inspect(f.root, 'win32', 'x64'); equal(fingerprint(f.binary), f.manifest);
    fs.appendFileSync(f.binary, 'changed'); expect(() => equal(fingerprint(f.binary), f.manifest)).toThrow('bytes/hash');
  });
  it.each(['platform', 'architecture', 'revision', 'sha256'])('rejects wrong %s provenance', key => {
    const f = fixture(); fs.writeFileSync(path.join(f.root, 'manifest.json'), JSON.stringify({ ...f.manifest, [key]: 'wrong' }));
    expect(() => inspect(f.root, 'darwin', 'arm64')).toThrow('provenance');
  });
  it('requires a license', () => {
    const f = fixture(); fs.unlinkSync(path.join(f.root, 'LICENSE')); expect(() => inspect(f.root, 'darwin', 'arm64')).toThrow();
  });
  it('rejects afterSign without same-invocation presign evidence', async () => {
    const f = fixture(); await expect(afterSign(f.context)).rejects.toThrow('presign');
  });
  it('rejects manifest changes between hooks', async () => {
    const f = fixture(); await afterPack(f.context);
    fs.writeFileSync(path.join(f.root, 'manifest.json'), JSON.stringify({ ...f.manifest, bytes: 200 }));
    await expect(afterSign(f.context)).rejects.toThrow('presign');
  });
  it.each(['arm64', 'x64'])('accepts signed-byte changes only with matching final receipt and native checks (%s)', architecture => {
    const f = fixture('darwin', architecture); fs.appendFileSync(f.binary, 'synthetic signature');
    const receipt = { stage: 'afterSign', source: f.manifest, final: fingerprint(f.binary) };
    const commands: string[] = [];
    const run = (cmd: string) => { commands.push(cmd); return cmd.endsWith('lipo') ? (architecture === 'x64' ? 'x86_64' : 'arm64') : ''; };
    verifyFinal(f.root, architecture, receipt, run);
    expect(commands).toEqual(['/usr/bin/lipo', '/usr/bin/codesign']);
    fs.appendFileSync(f.binary, 'tampered'); expect(() => verifyFinal(f.root, architecture, receipt, run)).toThrow('bytes/hash');
  });
  it('rejects absent or stale signing receipts and architecture/signature failures', () => {
    const f = fixture(); const receipt = { stage: 'afterSign', source: f.manifest, final: fingerprint(f.binary) };
    expect(() => verifyFinal(f.root, 'arm64', null)).toThrow('receipt');
    expect(() => verifyFinal(f.root, 'arm64', { ...receipt, source: { ...f.manifest, bytes: 1 } })).toThrow('receipt');
    expect(() => verifyFinal(f.root, 'arm64', receipt, () => 'x86_64')).toThrow('architecture');
    expect(() => verifyFinal(f.root, 'arm64', receipt, (cmd: string) => { if (cmd.endsWith('codesign')) throw new Error('invalid signature'); return 'arm64'; })).toThrow('invalid signature');
  });
});


describe('prepared code binding', () => {
  it('compares every normalized byte and never rewrites its inputs', () => {
    const source = Buffer.from('prepared executable');
    const commands: string[][] = [];
    const run = (_cmd: string, args: string[]) => { commands.push(args.slice(0, -1)); };
    expect(compareMacCode(source, Buffer.from(source), run).sha256).toHaveLength(64);
    expect(commands).toEqual([
      ['--force', '--sign', '-', '--identifier', 'ca.on.teacher.dictation-integrity', '--timestamp=none'], ['--remove-signature'],
      ['--force', '--sign', '-', '--identifier', 'ca.on.teacher.dictation-integrity', '--timestamp=none'], ['--remove-signature'],
    ]);
    expect(() => compareMacCode(source, Buffer.from('replaced executable'), run)).toThrow('bytes/hash');
    expect(source.toString()).toBe('prepared executable');
  });
  it('fails closed if normalization fails', () => {
    expect(() => compareMacCode(Buffer.from('a'), Buffer.from('a'), () => { throw new Error('signing failed'); })).toThrow('signing failed');
  });
  it.skipIf(process.platform !== 'darwin')('native hooks accept re-signing but reject another validly signed same-architecture program', async () => {
    const architecture = process.arch;
    const f = fixture('darwin', architecture);
    const c = path.join(f.context.appOutDir, 'fixture.c');
    const compile = (result: number) => {
      fs.writeFileSync(c, `int main(void) { return ${result}; }\n`);
      execFileSync('/usr/bin/clang', [c, '-o', f.binary]);
    };
    const sign = () => execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'different.packaging.identifier', '--timestamp=none', f.binary]);
    compile(0);
    // Include unsigned input on Intel and linker-signed input on ARM.
    const manifest = { ...f.manifest, ...fingerprint(f.binary) };
    fs.writeFileSync(path.join(f.root, 'manifest.json'), JSON.stringify(manifest));
    await afterPack(f.context);
    sign();
    await afterSign(f.context);
    const receiptPath = path.join(f.context.outDir, `dictation-runtime-${architecture}.json`);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    verifyFinal(f.root, architecture, receipt);
    expect(receipt.code.method).toBe('apple-codesign-normalize-remove-v1');
    fs.unlinkSync(receiptPath);
    compile(0);
    fs.writeFileSync(path.join(f.root, 'manifest.json'), JSON.stringify({ ...manifest, ...fingerprint(f.binary) }));
    await afterPack(f.context);
    compile(1); sign();
    // Prove the substituted executable itself passes native signature validation.
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', f.binary]);
    await expect(afterSign(f.context)).rejects.toThrow('bytes/hash');
    expect(fs.existsSync(receiptPath)).toBe(false);
  });
});
