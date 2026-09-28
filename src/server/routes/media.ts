import { createRoute, z } from '@hono/zod-openapi';
import { desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { uuid } from '../../shared/schemas/common.ts';
import {
  MEDIA_INPUT_BYTES,
  mediaCapabilities,
  mediaLookup,
  mediaManifest,
  mediaUpload,
  mediaUploadQuery,
} from '../../shared/schemas/media.ts';
import { requireActiveUser } from '../auth/middleware.ts';
import { requireSuperuser } from '../auth/permissions.ts';
import { requestSource } from '../auth/rateLimit.ts';
import { loadConfig } from '../config.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { mediaAssets, users } from '../db/schema.ts';
import { createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { mediaConfig } from '../services/media/config.ts';
import {
  assetManifest,
  cancelMedia,
  publicMedia,
  readMediaAsset,
  receiveMedia,
  takeDownMedia,
} from '../services/media/service.ts';

const router = createOpenApiApp();
// Authentication runs in createApp before the bounded body reader. That reader
// may replace Request identity; do not resolve delegated auth a second time.
router.use('/api/v1/media/*', async (c, next) => {
  c.header('cache-control', 'no-store');
  await next();
});
const security = [{ bearerAuth: [] }];
const params = z.object({ id: uuid });
const responses = {
  200: {
    description: 'Image upload status',
    content: { 'application/json': { schema: mediaManifest } },
  },
  403: errorResponse('Forbidden'),
  404: errorResponse('Not found'),
  409: errorResponse('Upload changed'),
  422: errorResponse('Invalid image'),
  429: errorResponse('Quota exceeded'),
  503: errorResponse('Media temporarily unavailable'),
};

router.openapi(
  createRoute({
    method: 'get',
    path: '/api/v1/media/capabilities',
    summary: 'Check whether image uploads are enabled and read their size limit.',
    security,
    responses: {
      200: {
        description: 'Media availability',
        content: { 'application/json': { schema: mediaCapabilities } },
      },
    },
  }),
  (c) => c.json({ enabled: mediaConfig().enabled, maxInputBytes: MEDIA_INPUT_BYTES }, 200),
);
router.openapi(
  createRoute({
    method: 'post',
    path: '/api/v1/media/uploads',
    summary:
      'Upload an image with a stable clientUploadId; retry identical input after a lost response. Attach the returned asset using the character or campaign update.',
    security,
    request: {
      body: { required: true, content: { 'application/json': { schema: mediaUpload } } },
    },
    responses,
  }),
  async (c) => {
    const input = c.req.valid('json');
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.toString('base64') !== input.base64)
      throw new HTTPException(422, { message: 'Invalid base64 image' });
    return c.json(
      await receiveMedia(c.get('user').id, requestSource(c, loadConfig()), input, bytes),
      200,
    );
  },
);
router.openapi(
  createRoute({
    method: 'get',
    path: '/api/v1/media/uploads/{id}',
    summary:
      'Read image status and URLs by asset ID, or by the caller’s clientUploadId after a lost response.',
    security,
    request: { params, query: mediaLookup },
    responses,
  }),
  async (c) =>
    c.json(
      assetManifest(
        await readMediaAsset(
          c.get('user').id,
          c.req.valid('param').id,
          false,
          c.req.valid('query').lookup === 'clientUploadId',
        ),
      ),
      200,
    ),
);
router.openapi(
  createRoute({
    method: 'delete',
    path: '/api/v1/media/uploads/{id}',
    summary:
      'Cancel an unattached image by asset ID or the caller’s clientUploadId. Remove attached images through character or campaign updates.',
    security,
    request: { params, query: mediaLookup },
    responses,
  }),
  async (c) =>
    c.json(
      await cancelMedia(
        c.get('user').id,
        c.req.valid('param').id,
        c.req.valid('query').lookup === 'clientUploadId',
      ),
      200,
    ),
);
router.openapi(
  createRoute({
    method: 'post',
    path: '/api/v1/media/uploads/bytes',
    summary: 'Binary form of the single-request image upload; metadata travels in the query.',
    security,
    request: {
      query: mediaUploadQuery,
      body: {
        required: true,
        content: {
          'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
        },
      },
    },
    responses,
  }),
  async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MEDIA_INPUT_BYTES)
      throw new HTTPException(413, { message: 'Image exceeds 10 MiB' });
    return c.json(
      await receiveMedia(
        c.get('user').id,
        requestSource(c, loadConfig()),
        c.req.valid('query'),
        bytes,
      ),
      200,
    );
  },
);

router.use('/media/*', async (c, next) => {
  c.header('cache-control', 'no-store');
  await next();
});
router.openapi(
  createRoute({
    method: 'get',
    path: '/media/{token}/{variant}',
    request: {
      params: z.object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        variant: z.enum(['thumb.webp', 'display.webp']),
      }),
    },
    responses: {
      200: {
        description: 'Public immutable sanitized image',
        content: { 'image/webp': { schema: z.string().openapi({ format: 'binary' }) } },
      },
      404: errorResponse('Image not found'),
      429: errorResponse('Read budget exceeded'),
      503: errorResponse('Storage unavailable'),
    },
  }),
  async (c) => {
    const { token, variant } = c.req.valid('param');
    const bytes = await publicMedia(
      token,
      variant === 'thumb.webp' ? 'thumb' : 'display',
      requestSource(c, loadConfig()),
    );
    c.header('cache-control', 'public, max-age=31536000, immutable');
    c.header('content-type', 'image/webp');
    c.header('content-length', String(bytes.length));
    c.header('etag', `"${token}-${variant}"`);
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'no-referrer');
    return c.body(new Uint8Array(bytes).buffer, 200);
  },
);

router.use('/api/v1/admin/media', requireActiveUser);
router.use('/api/v1/admin/media/*', requireActiveUser);
router.use('/api/v1/admin/media', async (c, next) => {
  await requireSuperuser(c.get('user').id);
  c.header('cache-control', 'no-store');
  await next();
});
router.use('/api/v1/admin/media/*', async (c, next) => {
  await requireSuperuser(c.get('user').id);
  c.header('cache-control', 'no-store');
  await next();
});
const adminAsset = z.object({
  id: uuid,
  uploaderId: uuid.nullable(),
  uploadsDisabled: z.boolean(),
  previewUrl: z.string().nullable(),
  targetType: z.enum(['character', 'campaign']),
  targetId: uuid,
  state: z.string(),
  bytes: z.number(),
  createdAt: z.string(),
});
router.openapi(
  createRoute({
    method: 'get',
    path: '/api/v1/admin/media',
    security,
    request: { query: z.object({ offset: z.coerce.number().int().min(0).default(0) }) },
    responses: {
      200: {
        description: 'Recent uploads (50 per page)',
        content: { 'application/json': { schema: z.array(adminAsset) } },
      },
    },
  }),
  async (c) => {
    const rows = await getDb()
      .select({ asset: mediaAssets, uploadsDisabled: users.mediaUploadsDisabled })
      .from(mediaAssets)
      .leftJoin(users, eq(users.id, mediaAssets.uploaderId))
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(50)
      .offset(c.req.valid('query').offset);
    return c.json(
      rows.map(({ asset: a, uploadsDisabled }) => ({
        uploadsDisabled: uploadsDisabled ?? true,
        previewUrl: a.state === 'ready' && a.publishedAt ? `/media/${a.token}/thumb.webp` : null,
        id: a.id,
        uploaderId: a.uploaderId,
        targetType: a.targetType,
        targetId: a.targetId,
        state: a.state,
        bytes: a.thumbBytes + a.displayBytes,
        createdAt: a.createdAt.toISOString(),
      })),
      200,
    );
  },
);
router.openapi(
  createRoute({
    method: 'delete',
    path: '/api/v1/admin/media/{id}',
    security,
    request: { params },
    responses: { 204: { description: 'Image taken down' } },
  }),
  async (c) => {
    await takeDownMedia(c.get('user').id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);
router.openapi(
  createRoute({
    method: 'patch',
    path: '/api/v1/admin/media/users/{id}',
    security,
    request: {
      params,
      body: {
        required: true,
        content: { 'application/json': { schema: z.object({ disabled: z.boolean() }).strict() } },
      },
    },
    responses: { 204: { description: 'Upload access changed' } },
  }),
  async (c) => {
    await withAudit(c.get('user').id, undefined, (tx) =>
      tx
        .update(users)
        .set({ mediaUploadsDisabled: c.req.valid('json').disabled })
        .where(eq(users.id, c.req.valid('param').id)),
    );
    return c.body(null, 204);
  },
);
export { router as mediaRouter };
