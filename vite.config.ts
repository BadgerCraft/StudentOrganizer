import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  define: {
    __QA_BUILD_ID__: JSON.stringify(process.env.VITE_QA_BUILD_ID || '')
  },
  plugins: [react()],
  server: {
    port: 3000
  }
});
