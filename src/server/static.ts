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
import { join, normalize, resolve } from 'node:path';
import type { Hono } from 'hono';

const ROOT = resolve('dist/client');

function safeJoin(base: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath);
  const joined = normalize(join(base, decoded));
  if (!joined.startsWith(base)) return null;
  return joined;
}

export function attachStaticHandler<T extends Hono<any, any, any>>(app: T): T {
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
