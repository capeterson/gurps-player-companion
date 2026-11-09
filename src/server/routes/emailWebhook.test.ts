import { afterEach, expect, it, spyOn } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createApp } from '../app.ts';
import { integrationTestConfig } from '../testConfig.ts';

const secret = Buffer.from('synthetic webhook signing secret');
const body = JSON.stringify({
  type: 'email.delivered',
  data: {
    email_id: '123e4567-e89b-42d3-a456-426614174000',
    to: ['private@example.test'],
    subject: 'private subject',
  },
});
const id = 'msg_synthetic';
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = `v1,${createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
afterEach(() => {
  process.env.ENVIRONMENT = 'test';
});

it('accepts signed provider events and emits only safe correlation fields', async () => {
  const output = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const app = createApp({
      ...integrationTestConfig,
      resendWebhookSecret: `whsec_${secret.toString('base64')}`,
    });
    const response = await app.request('/api/v1/webhooks/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
      body,
    });
    expect(response.status).toBe(204);
    const entries = output.mock.calls.map((call) => String(call[0])).join('\n');
    expect(entries).toContain('email.provider_event');
    expect(entries).toContain('email.delivered');
    expect(entries).not.toContain('private@example.test');
    expect(entries).not.toContain('private subject');
  } finally {
    output.mockRestore();
  }
});

it('rejects forged or unconfigured webhook requests', async () => {
  const config = {
    ...integrationTestConfig,
    resendWebhookSecret: `whsec_${secret.toString('base64')}`,
  };
  const app = createApp(config);
  const response = await app.request('/api/v1/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,invalid' },
    body,
  });
  expect(response.status).toBe(400);
  const unconfigured = createApp(integrationTestConfig);
  expect(
    (await unconfigured.request('/api/v1/webhooks/resend', { method: 'POST', body })).status,
  ).toBe(503);
});
