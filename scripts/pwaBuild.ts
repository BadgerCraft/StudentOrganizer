import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { pwaIcons } from './pwaIcons';

/** Precache a complete build. A new version waits until all old tabs close. */
export function pwaBuild(): Plugin {
  let root = process.cwd();
  return {
    name: 'local-app-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      for (const [fileName, data] of Object.entries(pwaIcons)) {
        this.emitFile({ type: 'asset', fileName, source: Buffer.from(data, 'base64') });
      }
      const files = Object.keys(bundle).filter(name => !name.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const file of files) {
        const output = bundle[file];
        hash.update(file).update(output.type === 'chunk' ? output.code : output.source);
      }
      hash.update(JSON.stringify(pwaIcons));
      for (const file of ['manifest.webmanifest', 'app-icon.svg']) hash.update(readFileSync(resolve(root, 'public', file)));
      const version = hash.digest('hex').slice(0, 20);
      const shell = [...new Set(['index.html', ...files, 'manifest.webmanifest', 'app-icon.svg', ...Object.keys(pwaIcons)])];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'ontario-app-shell-${version}';
const BASE = new URL('./', self.location.href);
const SHELL = ${JSON.stringify(shell)}.map(path => new URL(path, BASE).href);
const HOME = new URL('index.html', BASE).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('ontario-app-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin) return;
  const shellNavigation = request.mode === 'navigate' && (url.pathname === BASE.pathname || url.pathname === new URL(HOME).pathname);
  // Only bundled assets and the app document. No downloads, reports, or student records.
  if (!shellNavigation && !SHELL.includes(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(shellNavigation ? HOME : request);
    return cached || fetch(request);
  }));
});
` });
    }
  };
}
