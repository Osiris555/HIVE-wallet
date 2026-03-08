// Build extension scripts (background, content, inpage) using esbuild
// and copy manifest.json to dist/
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
};

console.log('🔨 Building extension scripts...');

await Promise.all([
  // Background service worker — ES module (MV3 "type": "module")
  build({
    ...shared,
    entryPoints: ['src/background.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
  }),

  // Content script — IIFE (content scripts don't support ES module imports)
  build({
    ...shared,
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
  }),

  // Inpage provider — IIFE (injected as a <script> tag into pages)
  build({
    ...shared,
    entryPoints: ['src/inpage.ts'],
    outfile: 'dist/inpage.js',
    format: 'iife',
  }),
]);

// Copy manifest
cpSync('manifest.json', 'dist/manifest.json');

console.log('✅ Extension scripts ready in dist/');
