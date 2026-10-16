import { defineConfig } from 'vitest/config';
export default defineConfig({ base: './', test: { include: ['tests/*.check.ts'] }, css: { postcss: { plugins: [] } }, build: { target: 'es2022' }, server: { host: '127.0.0.1', port: 5174 }, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
