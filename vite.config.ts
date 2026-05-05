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
        // The SW deliberately does NOT runtime-cache any /api/v1/*
        // responses.  Workbox cache keys are URL-only, but every API
        // response is authenticated and user-specific, so a cache hit
        // across an account switch on a shared device would leak the
        // previous user's data.  Local-first reads go through Dexie,
        // which is purged on signOut(); the SW only owns app-shell
        // caching plus the SPA navigation fallback below.  See
        // `src/sw/registerSW.ts` for the offline-replay strategy.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
