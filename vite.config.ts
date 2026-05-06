import { resolve } from 'node:path';
import devServer from '@hono/vite-dev-server';
import bunAdapter from '@hono/vite-dev-server/bun';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Strip PWA-injected tags from admin.html.
 *
 * vite-plugin-pwa auto-injects `<link rel="manifest">` and the
 * `vite-plugin-pwa:register-sw` script into every HTML entry it sees.
 * Per AGENTS.md the admin app must NOT participate in the PWA, so this
 * post-bundle pass strips both from the admin entry only.  We can't
 * intercept via transformIndexHtml because vite-plugin-pwa rewrites the
 * file again after that hook fires.
 */
/**
 * Dev-mode middleware that rewrites `/admin` and `/admin/*` to
 * `/admin.html` so Vite serves the admin entry instead of falling back
 * to `/index.html`.  Production handles this in `src/server/static.ts`.
 */
function adminEntryRewriteDev(): Plugin {
  return {
    name: 'admin-entry-rewrite-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();
        // Asset requests (.js, .css, source maps, etc.) keep their real
        // path; only top-level navigations get rewritten.
        if (/\.[a-zA-Z0-9]+(\?|$)/.test(req.url)) return next();
        // Strip query string for the prefix check.
        const path = req.url.split('?')[0] ?? '';
        if (path === '/admin' || path.startsWith('/admin/')) {
          req.url = '/admin.html';
        }
        next();
      });
    },
  };
}

function stripPwaFromAdmin(): Plugin {
  return {
    name: 'strip-pwa-from-admin',
    enforce: 'post',
    apply: 'build',
    async closeBundle() {
      const { readFile, writeFile } = await import('node:fs/promises');
      const { resolve: pathResolve } = await import('node:path');
      const adminHtml = pathResolve(__dirname, 'dist/client/admin.html');
      try {
        const original = await readFile(adminHtml, 'utf8');
        const stripped = original
          .replace(/<link rel="manifest"[^>]*>\s*/g, '')
          .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>\s*/g, '');
        if (stripped !== original) await writeFile(adminHtml, stripped, 'utf8');
      } catch {
        // admin.html not built (e.g. partial build) — nothing to strip.
      }
    },
  };
}

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Two-entry build: the player PWA and the admin app.  Per
      // AGENTS.md the admin surface must NOT ship in the regular
      // client bundle, so it gets its own HTML + JS chunk that loads
      // only when an admin navigates to /admin/*.
      input: {
        main: resolve(__dirname, 'src/client/index.html'),
        admin: resolve(__dirname, 'src/client/admin.html'),
      },
    },
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
    stripPwaFromAdmin(),
    adminEntryRewriteDev(),
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
        // The admin app is a separate entry (admin.html); its assets
        // are excluded from the precache and the SW must not serve the
        // player index.html for /admin/* navigations.
        globIgnores: ['admin.html', 'assets/admin-*'],
        // The SW deliberately does NOT runtime-cache any /api/v1/*
        // responses.  Workbox cache keys are URL-only, but every API
        // response is authenticated and user-specific, so a cache hit
        // across an account switch on a shared device would leak the
        // previous user's data.  Local-first reads go through Dexie,
        // which is purged on signOut(); the SW only owns app-shell
        // caching plus the SPA navigation fallback below.  See
        // `src/sw/registerSW.ts` for the offline-replay strategy.
        // /admin/* is denied so the SW doesn't intercept those
        // navigations and serve the player shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/admin(\/|$)/],
      },
    }),
  ],
});
