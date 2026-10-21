import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { openUnifiedMarking } from './helpers/unifiedMarking';
import { installFictionalClassroom } from './helpers/classroomFixture';
import { encodeCapturePackage, capturePagePath, captureSha256, type CaptureManifest } from '../shared/capturePackage';
const require = createRequire(import.meta.url);
const { createCaptureDrive } = require('../electron/captureDrive.cjs');
const origin = 'http://127.0.0.1:4237';
const server = await createServer({ server: { host: '127.0.0.1', port: 4237, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage(), errors: string[] = [], external: string[] = [];
  page.on('dialog', dialog => void dialog.accept()); page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => { if (route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
  let payload = Buffer.alloc(0), failure = '', waiting = false, disconnects = 0;
  const requests: string[] = [];
  const client = createCaptureDrive({ configured: () => true, authorize: async () => ({ token: 'fictional-main-only', expiresAt: Date.now() + 3600_000 }), fetchImpl: async (input: string, init: RequestInit) => {
    requests.push(input); const url = new URL(input);
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(init.redirect, 'error'); assert.equal(init.method, undefined);
    const metadata = { id: 'upload-1', name: 'capture-fictional-r1.zip', size: String(payload.length), sha256Checksum: createHash('sha256').update(payload).digest('hex'), mimeType: 'application/zip', parents: ['folder-1'], owners: [{ permissionId: 'owner-1' }], shared: false, trashed: false, ownedByMe: true, version: '1' };
    const folder = { ...metadata, id: 'folder-1', name: 'Fictional river assignment', mimeType: 'application/vnd.google-apps.folder', parents: ['root-id'] };
    if (url.pathname.endsWith('/about')) return Response.json({ user: { permissionId: 'owner-1' } });
    if (url.pathname.endsWith('/permissions')) return Response.json({ permissions: [{ id: 'owner-1', type: 'user', role: 'owner', deleted: false }] });
    if (url.searchParams.has('alt')) {
      if (failure === 'offline') throw new Error('fictional offline');
      if (failure === 'expired') return new Response('', { status: 401 });
      if (failure === 'wait') { waiting = true; await new Promise<void>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); }
      return new Response(payload);
    }
    if (url.pathname.endsWith('/upload-1')) return Response.json(metadata);
    if (url.pathname.endsWith('/folder-1')) return Response.json(folder);
    return Response.json({ files: url.searchParams.get('q')?.includes("'root'") ? [folder] : [metadata] });
  } });
  await context.exposeBinding('fictionalDriveCall', async (_source, method: string, id?: string) => {
    assert.ok(['status','connect','list','download','cancel','disconnect'].includes(method));
    if (method === 'disconnect') disconnects++;
    try { const value = await client[method](id); if (value.bytes) value.bytes = Array.from(value.bytes); return { ok: true, value }; }
    catch (e) { return { ok: false, message: (e as Error).message }; }
  });
  await context.addInitScript(`window.desktopCaptureDrive = {
    status: () => window.fictionalDriveCall('status'), connect: () => window.fictionalDriveCall('connect'),
    list: () => window.fictionalDriveCall('list'), download: id => window.fictionalDriveCall('download', id),
    cancel: () => window.fictionalDriveCall('cancel'), disconnect: () => window.fictionalDriveCall('disconnect')
  };`);
  await page.goto(origin); await installFictionalClassroom(page); await page.locator('[data-testid^="select-teacher-"]').first().click();
  const rows = (table: string) => page.evaluate(async table => { const module = '/src/db/database.ts'; return (await import(module)).db.table(table).toArray(); }, table);
  const beforeResults = await rows('categoryResults');
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200; canvas.getContext('2d')!.fillRect(0,0,100,100); return canvas.toDataURL('image/png').split(',')[1]; });
  const bytes = new Uint8Array(Buffer.from(png,'base64')), hash = await captureSha256(bytes), files: Record<string, Uint8Array> = {};
  const manifest: CaptureManifest = { format: 'studentorganizer-capture', version: 2, packageId: 'fictional-drive-package', assignmentId: 'fictional-assignment', assignmentName: 'Fictional river assignment', revision: 1, completed: true, submissions: [] };
  for (let i=0;i<2;i++) { const id = `set-${i}`, pageId = `page-${i}`, path = capturePagePath(id,pageId,'image/png'); files[path] = bytes; manifest.submissions.push({ id, label: 'Fictional ambiguous label', pages: [{ id: pageId, order: 0, path, mime: 'image/png', byteLength: bytes.length, sha256: hash, edits: { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } } }] }); }
  const valid = Buffer.from(await encodeCapturePackage(manifest, files)); payload = valid;
  const connect = async () => { await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click(); await page.getByRole('button', { name: /^Import Fictional river assignment/ }).waitFor(); };
  const download = () => page.getByRole('button', { name: /^Import Fictional river assignment/ }).click();
  await openUnifiedMarking(page); await connect(); await download();
  await page.getByTestId('capture-set-set-0').waitFor(); assert.equal((await rows('captureAttachments')).length,0);
  assert.equal(await page.getByTestId('capture-confirm').isDisabled(),true);
  await page.getByTestId('capture-set-set-0').click(); await page.locator('[data-testid^="capture-student-"]').first().click(); await page.getByTestId('capture-confirm').click();
  await page.getByTestId('image-markup').waitFor(); assert.equal((await rows('captureAttachments')).length,1);
  const saved = await rows('captureAttachments'); assert.equal(saved[0].pages[0].base64,png);
  // Return and repeat download: existing receipt, no duplicate and no all-roster requirement.
  await openUnifiedMarking(page); await connect(); await download();
  await page.getByTestId('capture-set-set-0').getByText(/^Saved to /).waitFor(); assert.equal(await page.getByTestId('capture-set-set-1').isDisabled(),false);
  assert.equal((await rows('captureAttachments')).length,1);
  failure = 'offline'; await download(); await page.getByRole('alert').filter({hasText:'connection'}).waitFor();
  failure = 'expired'; await download(); await page.getByRole('alert').filter({hasText:'expired'}).waitFor();
  failure = ''; await connect();
  payload = Buffer.from([1,2,3]); await download(); await page.getByRole('alert').filter({hasText:'ZIP'}).waitFor();
  payload = valid; failure = 'wait'; await download();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled === true);
  for (let i=0;!waiting && i<100;i++) await new Promise(resolve=>setTimeout(resolve,10)); assert.ok(waiting);
  await page.getByRole('button',{name:'Cancel Drive action',exact:true}).click(); await page.getByRole('alert').filter({hasText:'cancelled'}).waitFor();
  failure = ''; await download(); await page.getByRole('status').filter({hasText:'1 already saved'}).waitFor();
  assert.deepEqual(await rows('captureAttachments'),saved); assert.deepEqual(await rows('categoryResults'),beforeResults);
  // Leaving clears session credentials. Reload then local fallback still reconciles the same receipt.
  await page.getByRole('button',{name:'Close matching',exact:true}).click(); assert.equal(client.status().connected,false); assert.ok(disconnects>0);
  await page.reload(); const teacher=page.locator('[data-testid^="select-teacher-"]').first(); if(await teacher.isVisible()) await teacher.click(); await openUnifiedMarking(page);
  await page.getByTestId('capture-zip').setInputFiles({name:'fictional.zip',mimeType:'application/zip',buffer:valid}); await page.getByTestId('capture-set-set-0').getByText(/^Saved to /).waitFor();
  assert.equal((await rows('captureAttachments')).length,1); assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.ok(requests.some(url=>url.includes('alt=media')));
  await page.screenshot({path:'/tmp/capture-drive-matching.png',fullPage:true});
  // A teacher identity change during retrieval aborts main access and hides old previews.
  await connect(); failure = 'wait'; waiting = false; await download();
  for (let i=0;!waiting && i<100;i++) await new Promise(resolve=>setTimeout(resolve,10)); assert.ok(waiting);
  await page.evaluate(async () => { const path = '/src/services/identityService.ts'; (await import(path)).clearActiveTeacherId(); });
  await page.waitForFunction(() => !document.querySelector('[data-testid="capture-set-set-0"]'));
  assert.equal(client.status().connected,false); assert.deepEqual(await rows('captureAttachments'),saved);
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
  console.log('PASS real main transport with isolated Drive responses -> Chromium written workflow -> ZIP validation -> explicit partial match -> durable exact pages/receipt -> repeated download; offline/expired/malformed/cancel recovery; disconnect; reload/local fallback; mid-download teacher switch; unchanged official grades; no external requests.');
} finally { await browser.close(); await server.close(); }
