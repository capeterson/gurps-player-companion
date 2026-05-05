import devServer from '@hono/vite-dev-server';
import bunAdapter from '@hono/vite-dev-server/bun';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@shared': new URL('./src/shared', import.meta.url).pathname,
      '@client': new URL('./src/client', import.meta.url).pathname,
    },
  },
  server: {
    port: 3000,
    host: true,
    strictPort: true,
  },
  plugins: [
    react(),
    tailwind(),
    // Mount the Hono API into the Vite dev server: requests to `/api/*`
    // are dispatched to `src/server/dev-entry.ts`; everything else falls
    // through to Vite for SPA serving + HMR. Single port, single process.
    devServer({
      adapter: bunAdapter,
      entry: 'src/server/dev-entry.ts',
      exclude: [/^\/(?!api(\/|$)).*/],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'GURPS Player Companion',
        short_name: 'GURPS PC',
        description: 'Local-first GURPS character + campaign companion',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Treat sync POSTs as opaque; they're handled by the page-side
        // orchestrator (`src/client/sync/orchestrator.ts`).  The SW
        // only owns app-shell caching and read-side fallback for
        // reference data.  See `src/sw/registerSW.ts` for the registration
        // glue and the offline-replay strategy summary.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Read-only campaign/library lookups are large but stable;
          // serve cached copies first to keep the UI snappy and to
          // give offline launches something useful to render.  The
          // SW never caches mutating verbs.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.pathname.startsWith('/api/v1/campaigns/') &&
              url.pathname.endsWith('/library'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gpc-library-v1',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname === '/api/v1/auth/me',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gpc-me-v1',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
});
