const { createServer } = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { boundedBody, DriveError } = require('./captureDrive.cjs');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Operator-owned configuration is never written by the application or exposed over IPC.
function readConfig(filename) {
  try {
    const text = readFileSync(filename, 'utf8');
    if (text.length > 8192) return null;
    const c = JSON.parse(text);
    if (c.approved !== true || typeof c.clientId !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId) || typeof c.clientSecret !== 'string' || !c.clientSecret || c.clientSecret.length > 512) return null;
    return { clientId: c.clientId, clientSecret: c.clientSecret };
  } catch { return null; }
}
async function authorizeDesktop({ config, openExternal, signal, fetchImpl = fetch }) {
  if (!config) throw new DriveError('Desktop Drive setup is not configured. Use a local ZIP.');
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let settle, rejectCallback;
  const callback = new Promise((resolve, reject) => { settle = resolve; rejectCallback = reject; });
  // Attach immediately so cancellation while the browser launches is not an unhandled rejection.
  callback.catch(() => {});
  let redirect;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'");
    let url;
    try { if (!redirect || !req.url?.startsWith('/') || req.url.startsWith('//')) throw new Error(); url = new URL(req.url, redirect); }
    catch { res.writeHead(400); res.end('Invalid sign-in response.'); return; }
    if (url.origin !== new URL(redirect).origin || req.method !== 'GET' || req.headers.host !== new URL(redirect).host || url.pathname !== '/oauth/callback' || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid sign-in response.'); return; }
    if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code') || url.searchParams.get('code').length > 4096) {
      res.end('Sign-in cancelled. Return to Student Organizer.'); rejectCallback(new DriveError('Google sign-in was cancelled or denied.')); return;
    }
    res.end('Sign-in received. Return to Student Organizer.'); settle(url.searchParams.get('code'));
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  const abort = () => { rejectCallback(new DriveError('Google sign-in cancelled.')); server.close(); server.closeAllConnections(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    signal.throwIfAborted();
    redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account', include_granted_scopes: 'false' }).toString();
    await openExternal(url.href);
    const code = await callback; signal.throwIfAborted();
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }).toString() });
    if (!response.ok) { await response.body?.cancel(); throw new DriveError('Google sign-in expired or failed. Connect again.'); }
    const token = JSON.parse((await boundedBody(response, 32 * 1024, signal)).toString('utf8'));
    if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer' || token.scope !== SCOPE || !Number.isFinite(token.expires_in) || token.expires_in <= 30 || token.expires_in > 86400) throw new DriveError('Google did not grant the expected app-only Drive access.');
    // Deliberately discard any refresh token. No credentials/tokens enter storage or the renderer.
    return { token: token.access_token, expiresAt: Date.now() + (token.expires_in - 30) * 1000 };
  } finally { signal.removeEventListener('abort', abort); server.close(); server.closeAllConnections(); }
}
module.exports = { readConfig, authorizeDesktop, SCOPE };
