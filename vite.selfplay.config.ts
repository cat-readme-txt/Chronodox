import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'scripts/selfplay.ts',
    outDir: '.selfplay-dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: ['node:fs/promises', 'node:path', 'node:url'],
      output: {
        entryFileNames: 'selfplay.js',
      },
    },
  },
});
