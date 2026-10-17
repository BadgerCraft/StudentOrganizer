import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { strict as assert } from 'node:assert';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.CAPTURE_TEST_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage(); const errors = [], external = [];
page.on('pageerror', e => errors.push(String(e)));
context.on('request', req => { if (!req.url().startsWith(base) && !req.url().startsWith('blob:')) external.push(req.url()); });
const settled = () => page.waitForFunction(() => !document.querySelector('#controls').disabled);
const status = async text => { await page.waitForFunction(text => document.querySelector('#status').textContent.includes(text), text); await settled(); };
try {
  await page.goto(base); await status('Opened local batch');
  await page.selectOption('#class', 'fictional-science'); await status('Saved locally');
  await page.selectOption('#assignment', 'Fictional leaf study'); await settled();
  const pictures = await page.evaluate(() => ['Fictional Avery · leaf', 'Fictional Blake · water'].map(text => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = '#173c30'; ctx.font = '18px sans-serif'; ctx.fillText(text, 15, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const files = pictures.map((base64, i) => ({ name: `fictional-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }));
  await page.setInputFiles('#files', files); await status('2 page(s)');
  assert.equal(await page.locator('article').count(), 2);
  assert.equal(await page.locator('#class').isDisabled(), true);
  await page.click('#export'); await status('Label every page');
  for (let i = 0; i < 2; i++) {
    await page.locator('article input').nth(i).fill(`Fictional ${i ? 'Blake' : 'Avery'}`);
    await page.click('#save-labels'); await status('Labels saved locally');
  }
  // A quota/write failure must retain editable text and permit a deliberate retry.
  await page.locator('article input').first().fill('Fictional retry label');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = original;
      throw new DOMException('Fictional quota failure', 'QuotaExceededError');
    };
  });
  await page.click('#save-labels'); await status('Not completed');
  assert.equal(await page.locator('article input').first().inputValue(), 'Fictional retry label');
  await page.click('#save-labels'); await status('Labels saved locally');
  await page.reload(); await status('Opened local batch');
  assert.equal(await page.locator('article input').first().inputValue(), 'Fictional retry label');
  await page.getByRole('button', { name: 'Move down page 1', exact: true }).click(); await settled();
  await page.reload(); await status('Opened local batch');
  assert.equal(await page.locator('article input').first().inputValue(), 'Fictional Blake');
  await page.setInputFiles('#files', [files[0], { name: 'fictional-invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid') }]);
  await status('Not completed'); assert.equal(await page.locator('article').count(), 2);
  await page.setInputFiles('#camera', {name:'fictional-broken.png', mimeType:'image/png', buffer:Buffer.from([137,80,78,71,13,10,26,10])});
  await status('Not completed'); assert.equal(await page.locator('article').count(), 2);
  await page.locator('article input').first().fill('Fictional Blake export edit');
  const downloadPromise = page.waitForEvent('download'); await page.click('#export');
  const download = await downloadPromise; const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  assert.equal(manifest.requiresExplicitDesktopMatching, true);
  assert.equal(manifest.pages[0].labelHint, 'Fictional Blake export edit');
  for (let i = 0; i < 2; i++) {
    const record = manifest.pages[i]; assert.equal(record.studentId, null); assert.equal(record.matchStatus, 'unmatched');
    assert.deepEqual(Buffer.from(zip[record.path]), files[1 - i].buffer);
    assert.equal(record.sha256, createHash('sha256').update(files[1-i].buffer).digest('hex'));
  }
  assert.equal(await page.locator('article').count(), 2);
  await mkdir('test-results', {recursive:true}); await page.screenshot({ path:'test-results/fictional-phone.png', fullPage:true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const stale = await context.newPage(); await stale.goto(base); await stale.waitForFunction(() => !document.querySelector('#controls').disabled);
  await page.locator('article input').first().fill('Fictional revised'); await page.click('#save-labels'); await settled();
  // Even a clean tab must not export a snapshot superseded by another writer.
  const staleDownloads = []; stale.on('download', download => staleDownloads.push(download));
  await stale.click('#export');
  await stale.waitForFunction(() => !document.querySelector('#controls').disabled && document.querySelector('#status').textContent.includes('another tab'));
  assert.equal(staleDownloads.length, 0);
  assert.equal(await stale.locator('article input').first().inputValue(), 'Fictional Blake export edit');
  await stale.locator('article input').first().fill('Fictional stale'); await stale.click('#save-labels');
  await stale.waitForFunction(() => document.querySelector('#status').textContent.includes('another tab'));
  assert.equal(await stale.locator('article input').first().inputValue(), 'Fictional stale');
  await page.reload(); await status('Opened local batch'); assert.equal(await page.locator('article input').first().inputValue(), 'Fictional revised');
  page.once('dialog', d => d.dismiss()); await page.click('#reset'); assert.equal(await page.locator('article').count(), 2);
  page.once('dialog', d => d.accept()); await page.click('#reset'); await status('0 page(s)');
  await page.reload(); await status('Opened local batch'); assert.equal(await page.locator('article').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: mobile viewport; class/assignment; two photos; label gate; reorder/reload; atomic invalid imports; ZIP exact bytes/hash/unmatched; retained originals; stale-tab conflict; cancel/reset/reload; zero external requests/runtime errors.');
} finally { await browser.close(); }
