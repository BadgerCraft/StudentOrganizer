import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pwaBuild } from './scripts/pwaBuild';

export default defineConfig({
  base: './',
  plugins: [react(), pwaBuild(), {
    name: 'local-resource-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', injectTo: 'head-prepend', attrs: {
      'http-equiv': 'Content-Security-Policy',
      content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    } }]
  }],
  server: {
    port: 3000
  }
});
