import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { authorizeDesktop, readConfig, SCOPE } = require('../../electron/captureDriveAuth.cjs');
const config = { clientId: 'fictional.apps.googleusercontent.com', clientSecret: 'fictional-public-desktop-client-value' };
describe('desktop OAuth isolation', () => {
  it('uses system browser, loopback state and PKCE, discards refresh tokens', async () => {
    const controller = new AbortController(); let redirect = '', challenge = '';
    const result = await authorizeDesktop({ config, signal: controller.signal,
      openExternal: async (input: string) => {
        const url = new URL(input); expect(url.origin).toBe('https://accounts.google.com');
        expect(url.searchParams.get('scope')).toBe(SCOPE); expect(url.searchParams.get('access_type')).toBe('online'); expect(url.searchParams.get('include_granted_scopes')).toBe('false');
        redirect = url.searchParams.get('redirect_uri')!; challenge = url.searchParams.get('code_challenge')!;
        expect(new URL(redirect).hostname).toBe('127.0.0.1');
        const malformed = await new Promise<string>(resolve => { const socket = connect(Number(new URL(redirect).port), '127.0.0.1', () => socket.write('GET http://[ HTTP/1.1\r\nHost: ' + new URL(redirect).host + '\r\nConnection: close\r\n\r\n')); let reply = ''; socket.on('data', data => { reply += data; }); socket.on('end', () => resolve(reply)); });
        expect(malformed).toContain('400');
        const bad = await fetch(redirect + '?state=bad&code=bad'); expect(bad.status).toBe(400);
        await fetch(redirect + '?state=' + url.searchParams.get('state') + '&code=fictional-code');
      },
      fetchImpl: async (input: string, init: RequestInit) => {
        expect(input).toBe('https://oauth2.googleapis.com/token'); expect(init.redirect).toBe('error');
        const body = new URLSearchParams(init.body as string); expect(body.get('redirect_uri')).toBe(redirect);
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);
        return Response.json({ access_token: 'fictional-token', token_type: 'Bearer', expires_in: 3600, scope: SCOPE, refresh_token: 'discard-this' });
      } });
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'token']); expect(JSON.stringify(result)).not.toContain('discard-this');
    await expect(fetch(redirect)).rejects.toThrow();
  });
  it('cancels a pending browser sign-in and closes the callback listener', async () => {
    const controller = new AbortController(); let redirect = '';
    await expect(authorizeDesktop({ config, signal: controller.signal, openExternal: async (url: string) => { redirect = new URL(url).searchParams.get('redirect_uri')!; controller.abort(); }, fetchImpl: () => { throw new Error('must not exchange'); } })).rejects.toThrow('cancel');
    await expect(fetch(redirect)).rejects.toThrow();
  });
  it('denied consent is recoverable and missing setup fails closed', async () => {
    await expect(authorizeDesktop({ config, signal: new AbortController().signal, openExternal: async (input: string) => { const url = new URL(input); await fetch(url.searchParams.get('redirect_uri') + '?state=' + url.searchParams.get('state') + '&error=access_denied'); } })).rejects.toThrow('denied');
    expect(readConfig('/tmp/nonexistent-fictional-desktop-drive-config')).toBe(null);
  });
});
