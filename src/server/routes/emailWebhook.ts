import { createRoute, z } from '@hono/zod-openapi';
import { Resend } from 'resend';
import type { AppConfig } from '../config.ts';
import { createOpenApiApp } from '../openapi/app.ts';
import { logTelemetryEvent } from '../telemetry.ts';

const events = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);

/** Provider events are untrusted until signature verification succeeds. */
export function createEmailWebhookRouter(config: AppConfig) {
  const router = createOpenApiApp();
  router.openapi(
    createRoute({
      method: 'post',
      path: '/api/v1/webhooks/resend',
      tags: ['webhooks'],
      summary: 'Receive signed Resend delivery events',
      request: {
        body: { required: true, content: { 'application/json': { schema: z.unknown() } } },
      },
      responses: {
        204: { description: 'Event accepted' },
        400: {
          description: 'Invalid signature or event',
          content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        },
        413: { description: 'Webhook body too large' },
        503: {
          description: 'Webhook not configured',
          content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        },
      },
    }),
    async (c) => {
      if (!config.resendWebhookSecret) return c.json({ error: 'webhook_not_configured' }, 503);
      const id = c.req.header('svix-id');
      const timestamp = c.req.header('svix-timestamp');
      const signature = c.req.header('svix-signature');
      if (!id || id.length > 200 || !timestamp || !signature)
        return c.json({ error: 'invalid_webhook' }, 400);
      let event: unknown;
      try {
        event = new Resend(config.resendApiKey || 're_webhook').webhooks.verify({
          payload: await c.req.text(),
          headers: { id, timestamp, signature },
          webhookSecret: config.resendWebhookSecret,
        });
      } catch {
        logTelemetryEvent('email.webhook.invalid', {}, 'WARN');
        return c.json({ error: 'invalid_webhook' }, 400);
      }
      const parsed = z
        .object({ type: z.string(), data: z.object({ email_id: z.string().uuid() }) })
        .safeParse(event);
      if (parsed.success && events.has(parsed.data.type)) {
        logTelemetryEvent(
          'email.provider_event',
          {
            kind: parsed.data.type,
            provider_email_id: parsed.data.data.email_id,
            provider_event_id: id,
          },
          parsed.data.type === 'email.bounced' || parsed.data.type === 'email.failed'
            ? 'WARN'
            : 'INFO',
        );
      }
      return c.body(null, 204);
    },
  );
  return router;
}
