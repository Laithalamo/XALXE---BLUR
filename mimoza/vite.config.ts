import { defineConfig } from 'vite';

// Built into the game's dist folder, so the one Worker serves both: valve.ist/mimoza/
export default defineConfig({
  base: './',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  // dev: run `wrangler dev` too (the API lives in the Worker)
  server: { host: true, port: 5174, proxy: { '/mimoza/api': 'http://127.0.0.1:8787' } },
  build: { outDir: '../client/dist/mimoza', emptyOutDir: true, target: 'es2022' },
});
