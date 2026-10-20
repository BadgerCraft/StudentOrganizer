import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/control-panel', base: './', plugins: [react()],
  server: { host: '127.0.0.1', port: 3011 },
  build: { outDir: 'dist', emptyOutDir: true }
});
