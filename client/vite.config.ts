import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // relative URLs: the same build works at the site root and under a path (valve.ist/blr/)
  base: './',
  publicDir: '../assets',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)) },
  },
  // online rooms in dev: run the home server too (ROOMS_ONLY=1 npm run start -w server)
  server: { host: true, port: 5173, fs: { allow: ['..'] }, proxy: { '/room': { target: 'ws://localhost:3000', ws: true } } },
  preview: { host: true, port: 4173 },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
});
