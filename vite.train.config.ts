import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'scripts/train-hybrid.ts',
    outDir: '.train-dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: ['node:fs/promises', 'node:path', 'node:url'],
      output: {
        entryFileNames: 'train-hybrid.js',
      },
    },
  },
});
