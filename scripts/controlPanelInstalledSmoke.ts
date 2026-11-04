import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Windows CI only: this installs to a fresh temporary per-user path and the
// existing native smoke supplies an independent fictional owner profile.
assert.equal(process.platform, 'win32', 'Installed Control Panel smoke requires Windows');
assert.ok(process.argv[2], 'Pass the exact packaged Control Panel installer');
const installer = path.resolve(process.argv[2]);
const original = await readFile(installer);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(path.join(tmpdir(), 'student-organizer-owner-install-'));
const installDir = path.join(root, 'app');
const executable = path.join(installDir, 'Student Organizer Control Panel.exe');
const uninstaller = path.join(installDir, 'Uninstall Student Organizer Control Panel.exe');
let installed = false;
async function run(command: string, args: string[], timeout: number, verbatim = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsVerbatimArguments: verbatim });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${path.basename(command)}`)); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`${path.basename(command)} exited ${code ?? signal}`));
    });
  });
}
try {
  await run(installer, ['/S', '/currentuser', `/D=${installDir}`], 120000, true);
  installed = true;
  assert.ok((await stat(executable)).isFile(), 'NSIS must create the installed executable');
  assert.ok((await stat(uninstaller)).isFile(), 'NSIS must create the uninstaller');
  await run(process.execPath, ['--import', 'tsx', 'scripts/controlPanelNativeSmoke.ts', executable, installer], 360000);
  assert.equal(sha256(await readFile(installer)), sha256(original), 'Tested installer bytes must remain unchanged');
  await copyFile('release/control-panel/native-smoke-win32-x64.json', 'release/control-panel/installed-native-smoke-win32-x64.json');
  await run(uninstaller, ['/S', '/currentuser'], 120000, true);
  // NSIS can hand off to a temporary uninstaller process before the original
  // exits. Observe the result rather than treating that exit as removal.
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await stat(executable); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      break;
    }
    if (Date.now() >= deadline) throw new Error('Uninstall did not remove the installed app');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  installed = false;
  console.log(`PASS: per-user NSIS install, isolated fictional native smoke and uninstall; installer SHA-256 ${sha256(original)}`);
} finally {
  if (installed) {
    // Only target the uninstaller inside this test's fresh temporary directory.
    try { await run(uninstaller, ['/S', '/currentuser'], 120000, true); } catch (error) { console.error('Disposable uninstall cleanup failed:', error); }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
