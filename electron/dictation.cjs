// No network APIs, file paths or command-line options are accepted from the renderer.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const MODEL_SHA1 = 'c78c86eb1a8faa21b369bcd33207cc90d64ae9df'; // upstream v1.7.6 models/README.md
const MAX_AUDIO = 44 + 16000 * 2 * 60;
function validateWav(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 46 || value.byteLength > MAX_AUDIO) throw new Error('Record between a moment and 60 seconds.');
  const b = Buffer.from(value);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 16) !== 'WAVEfmt ' || b.readUInt32LE(16) !== 16 || b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1 || b.readUInt32LE(24) !== 16000 || b.readUInt32LE(28) !== 32000 || b.readUInt16LE(32) !== 2 || b.readUInt16LE(34) !== 16 || b.toString('ascii', 36, 40) !== 'data' || b.readUInt32LE(40) !== b.length - 44 || b.readUInt32LE(4) !== b.length - 8 || (b.length - 44) % 2) throw new Error('Unsupported dictation audio.');
  return b;
}
function createDictation({ runtime, userData, spawnProcess = spawn, timeoutMs = 120000 }) {
  const model = path.join(userData, 'dictation', 'ggml-tiny.en.bin');
  let active = null, generation = 0, verifiedModel = null;
  async function status() {
    try { await fs.access(runtime); } catch { return { ready: false, reason: 'This build has no local speech runtime. Install a dictation-enabled desktop build; typing still works.' }; }
    try {
      const info = await fs.stat(model);
      if (!info.isFile() || info.size > 80 * 1024 * 1024) throw new Error('Unsupported model file.');
      const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      if (verifiedModel !== stamp) { verifyModel(await fs.readFile(model)); verifiedModel = stamp; }
    } catch { return { ready: false, reason: 'Install the optional English tiny model (75 MiB, MIT) from a local file. No audio is uploaded.' }; }
    return { ready: true, reason: 'English · whisper.cpp tiny.en · on this computer' };
  }
  function verifyModel(bytes) {
    if (bytes.length > 80 * 1024 * 1024 || createHash('sha1').update(bytes).digest('hex') !== MODEL_SHA1) throw new Error('Choose the original ggml-tiny.en.bin model from whisper.cpp. The file did not match the supported model.');
  }
  async function installModel(file) {
    if (active) throw new Error('Finish or cancel dictation first.');
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 80 * 1024 * 1024) throw new Error('Unsupported model file.');
    const bytes = await fs.readFile(file); verifyModel(bytes);
    await fs.mkdir(path.dirname(model), { recursive: true });
    const staging = model + '.install';
    try { await fs.writeFile(staging, bytes, { mode: 0o600 }); await fs.rename(staging, model); }
    finally { await fs.rm(staging, { force: true }); }
    return status();
  }
  async function begin() {
    if (active) throw new Error('Another dictation is active. Stop or cancel it first.');
    const started = generation;
    const check = await status(); if (started !== generation) throw new Error('Dictation cancelled.'); if (!check.ready) throw new Error(check.reason);
    if (active) throw new Error('Another dictation is active.');
    const id = randomUUID();
    active = { id, phase: 'recording', child: null, timer: setTimeout(() => cancel(id), 90000) };
    return id;
  }
  function cancel(id) {
    if (id === undefined) generation++;
    if (!active || (id !== undefined && active.id !== id)) return;
    const old = active; active = null; clearTimeout(old.timer); old.child?.kill();
    old.reject?.(new Error('Dictation cancelled. Existing feedback is unchanged.'));
  }
  async function transcribe(id, audio) {
    if (!active || active.id !== id || active.phase !== 'recording') throw new Error('Dictation expired. Start again.');
    const job = active; job.phase = 'transcribing'; clearTimeout(job.timer);
    try {
      const wav = validateWav(audio);
      // stdin/stdout only: no output-format flags, so no files are created.
      // A non-"-" output basename enables CLI stdout callbacks with stdin on Windows too.
      return await new Promise((resolve, reject) => {
        job.reject = reject;
        const child = spawnProcess(runtime, ['-m', model, '-f', '-', '-of', 'unused-dictation-output', '-l', 'en', '-nt', '-np', '-ng', '-t', '4'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        job.child = child; let output = '';
        job.timer = setTimeout(() => { cancel(id); }, timeoutMs);
        child.stdout.on('data', bytes => { output += bytes.toString('utf8'); if (output.length > 16000) cancel(id); });
        // Never log audio, recognized feedback, model paths or engine stderr.
        child.stderr.resume();
        child.on('error', () => reject(new Error('Local speech runtime could not start. Typing still works.')));
        child.stdin.on('error', () => {}); // process failure/Cancel may close the pipe
        child.on('close', code => {
          if (active !== job) return reject(new Error('Dictation cancelled.'));
          if (code !== 0) return reject(new Error('Local transcription failed. Try again or type your feedback.'));
          const text = output.trim();
          if (!text) return reject(new Error('No speech recognized. Try again or type your feedback.'));
          resolve(text);
        });
        child.stdin.end(wav);
      });
    } finally { if (active === job) { clearTimeout(job.timer); active = null; } }
  }
  return { status, installModel, begin, cancel, transcribe, canCapture: () => active?.phase === 'recording' };
}
module.exports = { createDictation, validateWav, MAX_AUDIO, MODEL_SHA1 };
