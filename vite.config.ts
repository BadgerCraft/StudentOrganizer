import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localPdfAssets } from './scripts/pdfAssetPlugin';

export default defineConfig({
  base: './',
  optimizeDeps: { include: ['pdfjs-dist/build/pdf.mjs', 'pdfjs-dist/build/pdf.worker.mjs'] },
  define: { __QA_BUILD_ID__: JSON.stringify(process.env.VITE_QA_BUILD_ID || '') },
  worker: { format: 'es', plugins: () => [localPdfAssets(false)] },
  plugins: [react(), localPdfAssets(), {
    name: 'local-resource-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', injectTo: 'head-prepend', attrs: {
      'http-equiv': 'Content-Security-Policy',
      content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    } }]
  }],
  server: {
    port: 3000
  }
});
