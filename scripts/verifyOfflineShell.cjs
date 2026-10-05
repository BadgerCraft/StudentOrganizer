// Exercise the exact built worker without a browser; browser checks remain separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve('dist/sw.js'), 'utf8');

async function verify(base) {
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const prefix = `ontario-app-shell-${encodeURIComponent(new URL(base).pathname)}-`;
  const otherPathCache = `ontario-app-shell-${encodeURIComponent('/other-app/')}-old`;
  let fetched = 0;
  const cache = {
    async addAll(urls) {
      assert.equal(new Set(urls).size, urls.length, 'Duplicate precache entries');
      for (const url of urls) {
        const relative = new URL(url).pathname.slice(new URL(base).pathname.length);
        const filename = path.resolve('dist', relative);
        assert.ok(fs.existsSync(filename), `Precached build file missing: ${relative}`);
        entries.set(url, { cached: relative, body: fs.readFileSync(filename) });
      }
    },
    async match(request) {
      // Vite's preview adds Vary: Origin. Precache URL requests have no Origin;
      // Chromium's subsequent module/style requests can carry the page origin.
      if (typeof request !== 'string' && request.headers?.get('Origin')) return undefined;
      return entries.get(typeof request === 'string' ? request : request.url);
    }
  };
  const context = {
    URL,
    self: {
      location: { href: new URL('sw.js', base).href },
      addEventListener(name, callback) { handlers[name] = callback; },
      skipWaiting() { throw new Error('Worker must not activate over unsaved forms.'); },
      clients: { claim() { throw new Error('Worker must not switch existing page versions.'); } }
    },
    caches: {
      async open(name) { assert.ok(name.startsWith(prefix), 'Cache ownership must include app scope'); return cache; },
      async keys() { return ['unrelated-app-cache', otherPathCache, `${prefix}old`]; },
      async delete(name) { deleted.push(name); return true; }
    },
    async fetch() { fetched++; throw new Error('Offline network unavailable'); }
  };
  vm.runInNewContext(source, context);
  let pending;
  handlers.install({ waitUntil(promise) { pending = promise; } });
  await pending;
  assert.ok(entries.has(new URL('index.html', base).href), 'Offline document must be precached');
  assert.ok([...entries.keys()].some(url => url.endsWith('.js')), 'Bundled JS must be precached');
  assert.ok([...entries.keys()].some(url => url.endsWith('.css')), 'Bundled CSS must be precached');
  async function request(url, mode = 'navigate', method = 'GET') {
    let response;
    const headers = new Headers(mode === 'cors' ? { Origin: new URL(base).origin } : {});
    handlers.fetch({ request: { url, method, mode, headers }, respondWith(promise) { response = promise; } });
    return response ? await response : undefined;
  }
  assert.equal((await request(base)).cached, 'index.html', 'Offline root reopens complete cached build');
  assert.equal((await request(new URL('index.html', base).href)).cached, 'index.html');
  assert.equal(await request(new URL('other-site', base).href), undefined);
  for (const url of entries.keys()) assert.ok(await request(url, 'cors'));
  assert.equal(fetched, 0, 'Offline shell must not require network');
  assert.equal(await request(new URL('student-backup.json', base).href, 'cors'), undefined);
  assert.equal(await request(new URL('api/bug-report', base).href, 'cors', 'POST'), undefined);
  assert.equal(await request('https://example.net/photo.jpg', 'cors'), undefined);
  handlers.activate({ waitUntil(promise) { pending = promise; } });
  await pending;
  assert.deepEqual(deleted, [`${prefix}old`], 'Activation removes own old cache and preserves another same-origin app path');
  console.log(`PASS offline shell: ${base}; ${entries.size} exact assets, no network/record cache/forced activation/cross-path eviction`);
}

(async () => {
  await verify('https://fictional.example/');
  await verify('https://fictional.example/teacher/');
})().catch(error => { console.error(error); process.exitCode = 1; });
