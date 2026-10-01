import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pwaBuild } from './scripts/pwaBuild';

export default defineConfig({
  base: './',
  plugins: [react(), pwaBuild()],
  server: {
    port: 3000
  }
});
