/**
 * Static asset + SPA fallback served by the Bun process.
 *
 * - Files in `dist/client/` (Vite build output) are served verbatim.
 * - Any non-/api/* request that doesn't match a file falls back to the
 *   client `index.html` so React Router can take over.
 * - In development mode the dev server runs Vite directly on :5173 and
 *   proxies /api/* to Bun on :3000, so this static handler isn't used.
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
    if (!existsSync(ROOT)) {
      return c.text(
        'client bundle missing — run `bun run build:client` (or use the Vite dev server on :5173)',
        503,
      );
    }
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/')) {
      return c.json({ error: 'not_found' }, 404);
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
    const indexPath = join(ROOT, 'index.html');
    return new Response(Bun.file(indexPath), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
  return app;
}
