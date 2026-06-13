import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'pnpm build',
  outputDirectory: 'dist',
  headers: [
    routes.cacheControl('/data/(.*)', { public: true, maxAge: '1day' }),
    {
      source: '/(.*)',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        // `credentialless` (matching the dev server) keeps the page cross-origin
        // isolated for SharedArrayBuffer while letting MapLibre fetch OSM basemap
        // tiles, whose CDN doesn't send CORP headers. (Chrome/Firefox only — not
        // Safari.) `require-corp` would block the tiles.
        { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
      ],
    },
  ],
};
