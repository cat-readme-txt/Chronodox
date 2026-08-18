import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
          if (id.includes('framer-motion')) return 'motion-vendor';
          return 'vendor';
        },
      },
    },
  },
});
