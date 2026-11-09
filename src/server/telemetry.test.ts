import { expect, it } from 'bun:test';

it('exports bounded request, sync and error telemetry to an OTLP HTTP receiver', async () => {
  const received: Array<{ path: string; body: string }> = [];
  const collector = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ path: new URL(request.url).pathname, body: await request.text() });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  try {
    const script = `
      import { startTelemetry, stopTelemetry, syncOutcomes, logTelemetryError, logTelemetryEvent, logUserActivity } from './src/server/telemetry.ts';
      import { createApp } from './src/server/app.ts';
      import { loadConfig } from './src/server/config.ts';
      startTelemetry();
      const app = createApp(loadConfig());
      await app.request('/api/v1/healthz?token=private-token', { headers: { traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' } });
      await app.request('/api/v1/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'test-secret-token' }) });
      syncOutcomes.add(1, { entity_class: 'character', operation: 'patch', outcome: 'rejected' });
      logTelemetryError('test.failure', { status: 500 });
      logUserActivity('synthetic-user', 'mcp');
      logTelemetryEvent('email.accepted', { kind: 'password_reset' });
      logTelemetryEvent('auth.login.failed', { method: 'password', reason: 'invalid_credentials' }, 'WARN');
      await stopTelemetry();
    `;
    const child = Bun.spawn(['bun', '-e', script], {
      env: {
        ...process.env,
        ENVIRONMENT: 'test',
        DATABASE_URL: 'postgres://test:test@localhost/test',
        JWT_SECRET: 'test-secret-which-is-deliberately-very-long',
        SUNBOLT_OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_LOGS_EXPORTER: 'otlp',
        OTEL_TRACES_SAMPLER: 'always_on',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: expect.any(String) });
    const all = JSON.stringify(received);
    const exportedLogs = received
      .filter((record) => record.path === '/v1/logs')
      .map((record) => record.body)
      .join('');
    expect(exportedLogs).toContain('user.activity');
    expect(exportedLogs).toContain('operation.completed');
    expect(exportedLogs).toContain('password_reset.complete');
    expect(exportedLogs).not.toContain('test-secret-token');
    expect(exportedLogs).toContain('auth.login.failed');
    expect(exportedLogs).toContain('email.accepted');
    expect(exportedLogs).not.toContain('private-token');
    expect(received.map((record) => record.path)).toEqual(
      expect.arrayContaining(['/v1/metrics', '/v1/traces', '/v1/logs']),
    );
    expect(all).toContain('http.server.request.duration');
    expect(all).toContain('/api/v1/healthz');
    expect(all).toContain('0123456789abcdef0123456789abcdef');
    expect(all).toContain('sunbolt.sync.operations');
    expect(all).toContain('rejected');
    expect(all).toContain('test.failure');
    expect(all).toContain('user.activity');
    expect(all).toContain('synthetic-user');
    expect(all).toContain('email.accepted');
    expect(all).toContain('auth.login.failed');
    expect(all).not.toContain('private-token');
  } finally {
    collector.stop(true);
  }
}, 20_000);
