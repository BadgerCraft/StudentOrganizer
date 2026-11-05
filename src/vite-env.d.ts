/// <reference types="vite/client" />
declare module 'virtual:local-pdf-assets' { const assets: Record<string, string>; export default assets; }
declare module 'pdfjs-dist/build/pdf.mjs' { export * from 'pdfjs-dist'; }
