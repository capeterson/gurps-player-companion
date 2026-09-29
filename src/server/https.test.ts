import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { productionHttps } from './https.ts';
import { integrationTestConfig } from './testConfig.ts';

function appFor(
  environment: 'development' | 'test' | 'production',
  trustProxy = true,
  rawResponse = false,
) {
  const app = new Hono();
  app.use(
    '*',
    productionHttps({
      ...integrationTestConfig,
      environment,
      trustProxy,
      appHostname: 'gpc.example',
    }),
  );
  app.all('*', (c) =>
    rawResponse
      ? new Response('<main>Registration</main>', {
          headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
        })
      : c.json({ ok: true }),
  );
  return app;
}

describe('production HTTPS boundary', () => {
  it('redirects before mutations to the configured origin with path/query intact', async () => {
    const response = await appFor('production').request('http://attacker.example//login?x=1', {
      method: 'POST',
      headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' },
    });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://gpc.example//login?x=1');
  });

  it('accepts HTTPS at the trusted edge and sets HSTS', async () => {
    const response = await appFor('production').request('http://internal/api/v1/auth/login', {
      headers: { 'x-forwarded-proto': 'http, https' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });

  it('ignores forwarded protocol when proxy trust is explicitly disabled', async () => {
    expect(
      (
        await appFor('production', false).request('http://internal/', {
          headers: { 'x-forwarded-proto': 'https' },
        })
      ).status,
    ).toBe(308);
    expect((await appFor('production', false).request('https://gpc.example/')).status).toBe(200);
  });

  it('sets HSTS on raw static responses while preserving their body and headers', async () => {
    const response = await appFor('production', true, true).request('http://internal/register', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<main>Registration</main>');
  });

  it('allows internal health probes over HTTP without redirect loops', async () => {
    for (const path of ['/api/v1/healthz', '/api/v1/readyz']) {
      expect((await appFor('production').request(path)).status).toBe(200);
    }
  });

  it('leaves HTTP development and test requests unchanged', async () => {
    for (const environment of ['development', 'test'] as const) {
      const response = await appFor(environment).request('http://localhost/login');
      expect(response.status).toBe(200);
      expect(response.headers.has('strict-transport-security')).toBe(false);
    }
  });
});
