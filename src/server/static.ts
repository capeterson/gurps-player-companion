/**
 * Static asset + SPA fallback served by the Bun process in production.
 *
 * - Files in `dist/client/` (Vite build output) are served verbatim.
 * - Any non-/api/* request that doesn't match a file falls back to the
 *   client `index.html` so React Router can take over.
 * - In development this handler isn't attached at all: Vite owns the
 *   dev server and mounts the Hono app via `@hono/vite-dev-server`
 *   (see `vite.config.ts` + `dev-entry.ts`).
 */

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from './openapi/app.ts';

const ROOT = resolve('dist/client');

/**
 * Resolve a request path under `base`, rejecting anything that escapes
 * the directory.  Uses `path.relative` rather than `startsWith` so a
 * sibling like `dist/client-private/` cannot match `dist/client`.
 */
export function safeJoin(base: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const joined = normalize(join(base, decoded));
  const rel = relative(base, joined);
  if (rel === '') return joined;
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return joined;
}

export function attachStaticHandler(app: OpenAPIHono<AppEnv>): OpenAPIHono<AppEnv> {
  app.get('*', async (c) => {
    const url = new URL(c.req.url);
    // API routes that didn't match anything earlier are 404s, regardless
    // of whether the static bundle has been built.  This must run BEFORE
    // the missing-bundle 503 check so tests and API consumers see a
    // proper JSON 404 even in environments without `dist/client/`.
    if (url.pathname.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
    }
    if (!existsSync(ROOT)) {
      return c.text(
        'client bundle missing — run `bun run build:client` (or use `bun run dev` for the Vite dev server)',
        503,
      );
    }
    const asFile = safeJoin(ROOT, url.pathname);
    if (asFile) {
      try {
        const s = await stat(asFile);
        if (s.isFile()) {
          const file = Bun.file(asFile);
          return new Response(file);
        }
      } catch {
        // fall through to index.html
      }
    }
    // Per AGENTS.md, /admin/* is served by a separate Vite entry
    // (admin.html) so the regular client bundle stays admin-free.
    const isAdmin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    const fallbackPath = join(ROOT, isAdmin ? 'admin.html' : 'index.html');
    return new Response(Bun.file(fallbackPath), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  return app;
}
