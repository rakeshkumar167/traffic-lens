import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// COOP/COEP headers are required for SharedArrayBuffer (spec: shared-state schema).
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    port: 5174,
    headers: crossOriginIsolation,
  },
  worker: {
    format: 'es',
  },
});
