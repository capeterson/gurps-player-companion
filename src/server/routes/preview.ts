import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { guestAvailability, guestSession } from '../../shared/schemas/auth.ts';
import { signGuestToken } from '../auth/jwt.ts';
import { enforceAuthRateLimit } from '../auth/rateLimit.ts';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { loadPreviewCampaign } from '../services/preview/provision.ts';

/** Public entry to the read-only guest preview; see services/preview/guestAccess.ts. */
export const previewRouter = createOpenApiApp();

async function readyPreview() {
  if (!loadConfig().previewModeEnabled) return null;
  return loadPreviewCampaign();
}

previewRouter.openapi(
  createRoute({
    method: 'get',
    path: '/auth/guest',
    tags: ['auth'],
    summary: 'Report whether the read-only guest preview is available',
    responses: {
      200: {
        description: 'Preview availability',
        content: { 'application/json': { schema: guestAvailability } },
      },
    },
  }),
  async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ available: (await readyPreview()) !== null }, 200);
  },
);

previewRouter.openapi(
  createRoute({
    method: 'post',
    path: '/auth/guest',
    tags: ['auth'],
    summary: 'Start a read-only guest preview session',
    responses: {
      200: {
        description: 'Guest token for the preview campaign',
        content: { 'application/json': { schema: guestSession } },
      },
      404: errorResponse('The guest preview is not available'),
      429: errorResponse('Too many requests'),
    },
  }),
  async (c) => {
    const config = loadConfig();
    if (!config.previewModeEnabled)
      throw new HTTPException(404, { message: 'preview_unavailable' });
    await enforceAuthRateLimit(c, config, 'guest');
    const preview = await loadPreviewCampaign();
    if (!preview) throw new HTTPException(404, { message: 'preview_unavailable' });
    const [guest] = await getDb().select().from(users).where(eq(users.id, preview.guestUserId));
    if (!guest || guest.systemRole !== 'preview_guest' || guest.suspendedAt)
      throw new HTTPException(404, { message: 'preview_unavailable' });
    const token = await signGuestToken(guest.id, guest.authVersion);
    c.header('cache-control', 'no-store');
    return c.json(
      {
        accessToken: token.token,
        accessTokenExpiresIn: token.expiresInSeconds,
        campaignId: preview.campaignId,
      },
      200,
    );
  },
);
