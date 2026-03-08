import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Builds only the popup React app.
// background.js / content.js / inpage.js are built by scripts/build-scripts.mjs
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // scripts are built first and live in dist/
    rollupOptions: {
      input: resolve(__dirname, 'popup.html'),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
