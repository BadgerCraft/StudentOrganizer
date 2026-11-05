import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Bundle immutable PDF fonts/CMaps into the worker, never fetch them at runtime. */
export function localPdfAssets(includeLicenses = true): Plugin {
  return { name: 'local-pdf-assets', generateBundle() {
    if (!includeLicenses) return;
    const files = ['LICENSE', 'standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_LIBERATION', 'cmaps/LICENSE'];
    this.emitFile({ type: 'asset', fileName: 'pdfjs-licenses.txt', source: files.map(file => `${file}\n${readFileSync(resolve('node_modules/pdfjs-dist', file), 'utf8')}`).join('\n\n') });
  }, resolveId(id) { if (id === 'virtual:local-pdf-assets') return '\0local-pdf-assets'; }, load(id) {
    if (id !== '\0local-pdf-assets') return;
    const assets: Record<string, string> = {};
    for (const [kind, directory, suffix] of [['standardFontDataUrl', 'standard_fonts', /\.(pfb|ttf)$/], ['cMapUrl', 'cmaps', /\.bcmap$/]] as const) {
      const root = resolve('node_modules/pdfjs-dist', directory);
      for (const name of readdirSync(root).filter(name => suffix.test(name))) assets[`${kind}/${name}`] = readFileSync(resolve(root, name)).toString('base64');
    }
    return `export default ${JSON.stringify(assets)};`;
  } };
}
