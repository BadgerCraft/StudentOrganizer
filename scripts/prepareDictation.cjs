// Explicit build-time setup only. Never called by the installed application.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint } = require('./dictationRuntimeIntegrity.cjs');
const REVISION = 'a8d002cfd879315632a579e73f0148d06959de36';
const root = path.resolve(__dirname, '..'), destination = path.join(root, 'dictation-runtime');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'student-dictation-build-'));
const source = path.join(directory, 'source'), build = path.join(directory, 'build');
function run(command, args) { return execFileSync(command, args, { stdio: 'inherit', cwd: root }); }
try {
  run('git', ['clone', '--depth', '1', '--branch', 'v1.7.6', 'https://github.com/ggml-org/whisper.cpp.git', source]);
  if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== REVISION) throw new Error('Unexpected speech runtime revision.');
  const options = ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF', '-DGGML_METAL=OFF', '-DGGML_ACCELERATE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_FMA=OFF', '-DGGML_F16C=OFF', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>'];
  const architecture = process.argv.find(arg => arg.startsWith('--arch='))?.slice(7) || process.arch;
  if (process.platform === 'darwin') options.push(`-DCMAKE_OSX_ARCHITECTURES=${architecture === 'arm64' ? 'arm64' : 'x86_64'}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0');
  if (process.platform === 'win32') options.push('-A', architecture === 'arm64' ? 'ARM64' : 'x64');
  run('cmake', options);
  run('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '--parallel', '2']);
  fs.mkdirSync(destination, { recursive: true });
  const filename = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const binary = path.join(build, 'bin', ...(process.platform === 'win32' ? ['Release'] : []), filename);
  fs.copyFileSync(binary, path.join(destination, filename));
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'));
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ engine: 'whisper.cpp', version: '1.7.6', revision: REVISION, platform: process.platform, architecture, ...fingerprint(binary), modelBundled: false }, null, 2));
  console.log(`Local runtime prepared (${fs.statSync(binary).size} bytes); no model downloaded or bundled.`);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
