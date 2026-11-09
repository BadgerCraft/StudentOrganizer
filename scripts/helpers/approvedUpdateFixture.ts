import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Test-process instrumentation only. No packaged file, production environment
// flag or renderer authority is changed. The native harness remains responsible
// for restricting execution to its disposable fictional-data Windows runner.
export async function reserveInspectorPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function evaluateBeforeMain(port: number, expression: string) {
  const deadline = Date.now() + 30000;
  let endpoint = '';
  while (!endpoint && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
      endpoint = targets[0]?.webSocketDebuggerUrl || '';
    } catch { /* Inspector has not started yet. */ }
    if (!endpoint) await delay(50);
  }
  assert.ok(endpoint, 'Disposable native inspector must be available before main starts');
  const url = new URL(endpoint);
  assert.equal(url.protocol, 'ws:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, String(port));
  const socket = new WebSocket(endpoint);
  let nextId = 0;
  let onPaused!: () => void;
  const paused = new Promise<void>(resolve => { onPaused = resolve; });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const timer = setTimeout(() => { for (const item of pending.values()) item.reject(new Error('Pre-main policy instrumentation timed out')); socket.close(); }, 15000);
  const fail = () => { for (const item of pending.values()) item.reject(new Error('Pre-main inspector disconnected')); pending.clear(); };
  socket.addEventListener('close', fail); socket.addEventListener('error', fail);
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Debugger.paused') onPaused();
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  const command = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Cannot connect to disposable inspector')), { once: true });
      socket.addEventListener('close', () => reject(new Error('Disposable inspector closed before connection')), { once: true });
    });
    await command('Debugger.enable');
    await command('Runtime.runIfWaitingForDebugger');
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([paused, new Promise<never>((_, reject) => { pauseTimer = setTimeout(() => reject(new Error('Main script did not pause before execution')), 10000); })]);
    } finally { clearTimeout(pauseTimer); }
    const evaluation = await command('Runtime.evaluate', { expression, returnByValue: true });
    if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails));
    await command('Debugger.resume');
    return evaluation.result?.value;
  } finally { clearTimeout(timer); socket.close(); }
}


export async function selectApprovedPolicyBeforeResume(port: number, packagePath: string) {
  const evidence = await evaluateBeforeMain(port, `(() => {
    const { createRequire } = process.getBuiltinModule('module');
    const require = createRequire(${JSON.stringify(packagePath)});
    const main = require.resolve('./electron/main.cjs');
    if (require.cache[main]?.loaded) throw new Error('Main already executed: cannot select a legacy fixture policy safely');
    const id = require.resolve('./electron/desktopUpdatePolicy.cjs');
    if (require.cache[id]) throw new Error('Policy was already consumed before fixture selection');
    const production = require(id);
    if (production.MODE !== 'github-release') throw new Error('Expected direct-GitHub production default');
    require.cache[id].exports = Object.freeze({ MODE: 'approved-release' });
    return { productionMode: production.MODE, fixtureMode: require(id).MODE, technique: 'pre-main inspector module-cache substitution', packagedFilesChanged: false };
  })()`);
  assert.equal(evidence?.fixtureMode, 'approved-release');
  return evidence as { productionMode: string; fixtureMode: string; technique: string; packagedFilesChanged: boolean };
}
