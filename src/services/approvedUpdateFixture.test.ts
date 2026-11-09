import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reserveInspectorPort, selectApprovedPolicyBeforeResume } from '../../scripts/helpers/approvedUpdateFixture';

describe('disposable pre-main update-policy instrumentation', () => {
  it('selects the retained policy before main consumes it without editing package bytes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fictional-update-policy-'));
    const policyFile = path.join(directory, 'electron', 'desktopUpdatePolicy.cjs');
    const mainFile = path.join(directory, 'electron', 'main.cjs');
    const resultFile = path.join(directory, 'observed.json');
    const policy = "module.exports = Object.freeze({ MODE: 'github-release' });\n";
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await mkdir(path.dirname(policyFile));
      await writeFile(path.join(directory, 'package.json'), '{"type":"commonjs"}');
      await writeFile(policyFile, policy);
      await writeFile(mainFile, `require('node:fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(require('./desktopUpdatePolicy.cjs')));`);
      const port = await reserveInspectorPort();
      child = spawn(process.execPath, ['--inspect=0', `--inspect-brk=127.0.0.1:${port}`, mainFile], { stdio: 'ignore' });
      const exited = new Promise<number | null>((resolve, reject) => { child!.once('exit', resolve); child!.once('error', reject); });
      const evidence = await selectApprovedPolicyBeforeResume(port, path.join(directory, 'package.json'));
      expect(await exited).toBe(0);
      expect(evidence).toMatchObject({ productionMode: 'github-release', fixtureMode: 'approved-release', packagedFilesChanged: false });
      expect(JSON.parse(await readFile(resultFile, 'utf8'))).toEqual({ MODE: 'approved-release' });
      expect(await readFile(policyFile, 'utf8')).toBe(policy);
    } finally { child?.kill(); await rm(directory, { recursive: true, force: true }); }
  }, 45000);
});
