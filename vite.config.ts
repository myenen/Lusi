import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Tauri's font-src allows bundled files from the app origin.
    assetsInlineLimit: (filePath) => filePath.endsWith('.woff2') ? false : undefined,
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: { environment: 'jsdom' },
});
