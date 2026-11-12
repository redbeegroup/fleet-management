import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Compile the shared package from source: no stale pre-bundled copy in dev,
    // ESM for tree-shaking in production builds.
    alias: { '@fms/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true, ws: true } },
  },
  build: { chunkSizeWarningLimit: 900 },
});
