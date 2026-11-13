import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const PORT = 5199;
const ORIGIN = `http://localhost:${PORT}`;
const ENTRY = fileURLToPath(new URL('./view/src/main.tsx', import.meta.url));

export default defineConfig({
  root: 'view',
  base: './',
  plugins: [react()],
  // The page the editor loads is not index.html: point the dependency scan
  // at the real entry, or it finds nothing to pre-bundle.
  optimizeDeps: { entries: ['src/main.tsx'] },
  server: {
    port: PORT,
    strictPort: true,
    // The page lives in a `vscode-webview://` frame, not on this origin: the
    // module scripts it pulls from here are cross-origin, so they need CORS,
    // and asset URLs must be absolute to this server.
    cors: true,
    origin: ORIGIN,
    hmr: { host: 'localhost', port: PORT, protocol: 'ws' },
  },
  build: {
    outDir: '../dist/view',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: ENTRY,
      output: {
        // Fixed names: the host links them without reading a manifest.
        entryFileNames: 'assets/main.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (info) =>
          (info.names ?? []).some((n) => n.endsWith('.css')) ? 'assets/main.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
