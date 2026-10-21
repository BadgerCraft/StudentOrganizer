import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createCaptureDrive, MAX_BYTES } = require('../../electron/captureDrive.cjs');
const owner = 'fictional-owner';
const bytes = Buffer.from('fictional ZIP transport fixture');
const file = { id: 'upload-1', name: 'capture-assignment-r1.zip', size: String(bytes.length), sha256Checksum: createHash('sha256').update(bytes).digest('hex'), mimeType: 'application/zip', parents: ['folder-1'], owners: [{ permissionId: owner }], shared: false, trashed: false, ownedByMe: true, version: '1' };
const folder = { ...file, id: 'folder-1', mimeType: 'application/vnd.google-apps.folder', parents: ['root-id'] };
const permissions = { permissions: [{ id: owner, role: 'owner', type: 'user', deleted: false }] };
function fixture(options: { override?: (url: URL, count: number) => Response | undefined | Promise<Response | undefined>; configured?: boolean } = {}) {
  const calls: { url: URL; init: RequestInit }[] = []; let time = 100, auths = 0;
  const client = createCaptureDrive({ configured: () => options.configured !== false, now: () => time,
    authorize: async () => { auths++; return { token: 'fictional-token-do-not-return', expiresAt: 1000 }; },
    fetchImpl: async (input: string, init: RequestInit) => {
      const url = new URL(input); calls.push({ url, init });
      const override = await options.override?.(url, calls.filter(c => c.url.pathname === url.pathname).length);
      if (override) return override;
      if (url.pathname.endsWith('/about')) return Response.json({ user: { permissionId: owner } });
      if (url.pathname.endsWith('/permissions')) return Response.json(permissions);
      if (url.searchParams.get('alt') === 'media') return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      if (url.pathname.endsWith('/upload-1')) return Response.json(file);
      if (url.pathname.endsWith('/folder-1')) return Response.json(folder);
      if (url.searchParams.get('q')?.includes("'root'")) return Response.json({ files: [folder] });
      return Response.json({ files: [file] });
    } });
  return { client, calls, expire: () => { time = 2000; }, auths: () => auths };
}
async function ready(f: ReturnType<typeof fixture>) { await f.client.connect(); await f.client.list(); }
describe('private capture download boundary', () => {
  it('downloads exact verified bytes using only GET fixed-origin calls and exposes no token', async () => {
    const f = fixture(); await ready(f);
    const result = await f.client.download('upload-1');
    expect(Buffer.from(result.bytes)).toEqual(bytes);
    expect(JSON.stringify([result, f.client.status(), await f.client.list()])).not.toContain('fictional-token');
    expect(f.calls.every(c => c.url.origin === 'https://www.googleapis.com' && c.init.redirect === 'error' && !c.init.method)).toBe(true);
    expect(f.calls.filter(c => c.url.pathname.endsWith('/permissions'))).toHaveLength(4);
  });
  it('fails closed before setup and for arbitrary renderer IDs/URLs', async () => {
    const f = fixture({ configured: false }); await expect(f.client.connect()).rejects.toThrow('not approved'); expect(f.auths()).toBe(0);
    const g = fixture(); await ready(g);
    for (const id of ['https://evil.test', '../token', 'not-listed', null]) await expect(g.client.download(id)).rejects.toThrow();
    expect(g.calls.some(c => c.url.searchParams.has('alt'))).toBe(false);
  });
  it('expires without persisting or refreshing credentials', async () => {
    const f = fixture(); await ready(f); f.expire(); await expect(f.client.download('upload-1')).rejects.toThrow('expired'); expect(f.client.status().connected).toBe(false); expect(f.auths()).toBe(1);
  });
  it.each([401,403,404,429,500])('handles HTTP %s without exposing remote error content', async status => {
    const f = fixture({ override: url => url.searchParams.has('alt') ? new Response('private error token', { status }) : undefined }); await ready(f);
    await expect(f.client.download('upload-1')).rejects.toThrow(/Drive/);
    if (status === 401) expect(f.client.status().connected).toBe(false);
  });
  it.each(['shared', 'wrong-owner', 'extra-permission', 'moved', 'size', 'checksum', 'version'])('rejects %s without importing', async kind => {
    const f = fixture({ override: (url, count) => {
      if (kind === 'extra-permission' && url.pathname.endsWith('/permissions')) return Response.json({ permissions: [...permissions.permissions, { id: 'other', role: 'reader', type: 'user' }] });
      if (kind === 'moved' && url.searchParams.get('q')?.includes("'root'")) return Response.json({ files: [] });
      if (url.pathname.endsWith('/upload-1') && !url.searchParams.has('alt')) return Response.json({ ...file,
        ...(kind === 'shared' ? { shared: true } : {}), ...(kind === 'wrong-owner' ? { owners: [{ permissionId: 'other' }] } : {}),
        ...(kind === 'size' ? { size: String(MAX_BYTES + 1) } : {}), ...(kind === 'checksum' ? { sha256Checksum: '0'.repeat(64) } : {}), ...(kind === 'version' && count > 1 ? { version: '2' } : {}) });
    } }); await ready(f); await expect(f.client.download('upload-1')).rejects.toThrow();
  });
  it('rejects a folder moved after bytes have downloaded', async () => {
    let roots = 0;
    const f = fixture({ override: url => url.searchParams.get('q')?.includes("'root'") && ++roots === 3 ? Response.json({ files: [] }) : undefined });
    await ready(f); await expect(f.client.download('upload-1')).rejects.toThrow('moved during');
    expect(f.calls.some(c => c.url.searchParams.has('alt'))).toBe(true);
  });
  it('rejects incomplete response bytes and privacy changes after download', async () => {
    const f = fixture({ override: url => url.searchParams.has('alt') ? new Response(bytes.subarray(0,3), { headers: { 'content-length': String(bytes.length) } }) : undefined });
    await ready(f); await expect(f.client.download('upload-1')).rejects.toThrow('interrupted');
    let checks = 0;
    const g = fixture({ override: url => url.pathname.endsWith('/upload-1/permissions') && ++checks === 2 ? Response.json({ permissions: [...permissions.permissions, { id: 'other', role: 'reader', type: 'user' }] }) : undefined });
    await ready(g); await expect(g.client.download('upload-1')).rejects.toThrow('private');
  });
  it('enforces streamed size even without content-length', async () => {
    const f = fixture({ override: url => url.searchParams.has('alt') ? new Response(Buffer.alloc(bytes.length + 1)) : undefined }); await ready(f); await expect(f.client.download('upload-1')).rejects.toThrow('size');
  });
  it('discards interrupted bytes and permits one explicit fresh retry', async () => {
    let interrupted = true;
    const f = fixture({ override: url => {
      if (url.searchParams.has('alt') && interrupted) { interrupted = false; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 3)); c.error(new Error('fictional offline with sensitive text')); } })); }
    } }); await ready(f); await expect(f.client.download('upload-1')).rejects.toThrow('connection');
    expect(Buffer.from((await f.client.download('upload-1')).bytes)).toEqual(bytes);
  });
  it('cancels in flight, serializes repeated downloads and permits retry', async () => {
    let release!: () => void; let reached!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { reached = resolve; });
    const f = fixture({ override: async url => { if (url.searchParams.has('alt')) { reached(); await pending; } return undefined; } }); await ready(f);
    const download = f.client.download('upload-1'); await started;
    await expect(f.client.download('upload-1')).rejects.toThrow('running'); f.client.cancel(); release(); await expect(download).rejects.toThrow('cancelled');
    expect(Buffer.from((await f.client.download('upload-1')).bytes)).toEqual(bytes);
    f.client.disconnect(); expect(f.client.status().connected).toBe(false); await expect(f.client.download('upload-1')).rejects.toThrow('Refresh');
  });
  it('paginates and rejects repeated/incomplete pages', async () => {
    const f = fixture({ override: url => url.pathname.endsWith('/files') ? Response.json({ files: [file], nextPageToken: 'repeat' }) : undefined });
    await f.client.connect(); await expect(f.client.list()).rejects.toThrow('invalid listing');
    const g = fixture({ override: url => url.pathname.endsWith('/files') ? Response.json({ files: [], incompleteSearch: true }) : undefined });
    await g.client.connect(); await expect(g.client.list()).rejects.toThrow('incomplete');
  });
});
