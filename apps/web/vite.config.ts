import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true, ws: true } },
  },
  optimizeDeps: { include: ['@fms/shared'] },
  build: { commonjsOptions: { include: [/shared/, /node_modules/] }, chunkSizeWarningLimit: 900 },
});
