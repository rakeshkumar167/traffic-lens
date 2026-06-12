import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Serve files under /data/* from the repo's `data/` directory, both in dev
// and in production. The preprocessor writes there; the app reads from there.
function dataAssetsPlugin() {
  const dataDir = resolve(__dirname, 'data');
  const serveData = (req: import('http').IncomingMessage, res: import('http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/data/')) return next();
    const filePath = resolve(dataDir, req.url.replace('/data/', ''));
    if (!filePath.startsWith(dataDir) || !existsSync(filePath)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(readFileSync(filePath));
  };
  return {
    name: 'traffic-lens-data',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(serveData);
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use(serveData);
    },
  };
}

export default defineConfig({
  plugins: [react(), dataAssetsPlugin()],
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
