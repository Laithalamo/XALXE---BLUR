import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  publicDir: '../assets',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
  preview: { host: true, port: 4173 },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
});
