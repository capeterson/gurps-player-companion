import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mediaUploadQuery } from '../../../shared/schemas/media.ts';
import { requestSource } from '../../auth/rateLimit.ts';
import { loadConfig } from '../../config.ts';
import type { AppEnv } from '../../openapi/app.ts';
import {
  assertUploadsEnabled,
  authorizeMediaTarget,
  consumeMediaBudget,
  mediaDigest,
} from './service.ts';

// Bound simultaneous body buffering per process, before Hono reads up to 14 MiB.
// PostgreSQL budgets and processing leases additionally span all replicas.
let receiving = 0;
export const mediaAdmission: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (receiving >= 2)
    throw new HTTPException(503, { message: 'Image receiver is busy; retry shortly' });
  receiving++;
  try {
    const userId = c.get('user').id;
    await assertUploadsEnabled(userId);
    if (c.req.path === '/api/v1/media/uploads/bytes') {
      const metadata = mediaUploadQuery.safeParse(c.req.query());
      if (!metadata.success) throw new HTTPException(422, { message: 'Invalid upload metadata' });
      await authorizeMediaTarget(userId, metadata.data.targetType, metadata.data.targetId, true);
    }
    await consumeMediaBudget(`receive-user:${userId}`, 1, 100, 3600);
    const source = mediaDigest(requestSource(c, loadConfig()));
    await consumeMediaBudget(`receive-ip:${source}`, 1, 200, 3600);
    await next();
  } finally {
    receiving--;
  }
};
