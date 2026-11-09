import { SeverityNumber, context, logs, metrics, trace } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';

const meter = () => metrics.getMeter('sunbolt');
const histogram = (name: string, unit: string) => ({
  record: (value: number, attributes: Record<string, string | number> = {}) =>
    meter()
      .createHistogram(name, {
        unit,
        ...(name === 'http.server.request.duration'
          ? {
              advice: {
                explicitBucketBoundaries: [
                  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
                ],
              },
            }
          : {}),
      })
      .record(value, attributes),
});
const counter = (name: string) => ({
  add: (value: number, attributes: Record<string, string | number> = {}) =>
    meter().createCounter(name).add(value, attributes),
});
export const requestDuration = histogram('http.server.request.duration', 's');
export const syncOutcomes = counter('sunbolt.sync.operations');
export const syncBatchSize = histogram('sunbolt.sync.batch.size', '{operation}');
export const syncCursorRows = histogram('sunbolt.sync.cursor.rows', '{row}');
export const workerDuration = histogram('sunbolt.worker.duration', 's');
export const workerRuns = counter('sunbolt.worker.runs');
export const websocketConnections = {
  add: (value: number) => meter().createUpDownCounter('sunbolt.websocket.connections').add(value),
};
export const websocketDeliveryFailures = counter('sunbolt.websocket.delivery.failures');
export const tracer = trace.getTracer('sunbolt');

let sdk: NodeSDK | undefined;
/** Opt-in; SDK export failures must never block application work. */
export function startTelemetry(): void {
  if (process.env.SUNBOLT_OTEL_ENABLED !== 'true' || sdk) return;
  process.env.OTEL_SERVICE_NAME ||= 'sunbolt';
  // Process detection captures command-line arguments, which can contain secrets.
  process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ||= 'http/protobuf';
  process.env.OTEL_METRICS_EXPORTER ||= 'otlp';
  process.env.OTEL_LOGS_EXPORTER ||= 'otlp';
  process.env.OTEL_TRACES_EXPORTER ||= 'otlp';
  sdk = new NodeSDK();
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  if (current) await current.shutdown();
}

/** Only fixed event names and explicitly safe attributes belong here. */
export function logTelemetryError(
  event: string,
  attributes: Record<string, string | number>,
): void {
  logTelemetryEvent(event, attributes, 'ERROR');
}

/** Emit only curated event names and safe fields; never include request or mail content. */
export function logTelemetryEvent(
  event: string,
  attributes: Record<string, string | number> = {},
  severity: 'INFO' | 'WARN' | 'ERROR' = 'INFO',
): void {
  try {
    const span = trace.getSpanContext(context.active());
    const correlation = span ? { trace_id: span.traceId, span_id: span.spanId } : {};
    const record = JSON.stringify({ severity, event, ...correlation, ...attributes });
    if (severity === 'ERROR') console.error(record);
    else if (severity === 'WARN') console.warn(record);
    else console.log(record);
    logs.getLogger('sunbolt').emit({
      severityNumber: SeverityNumber[severity],
      severityText: severity,
      body: event,
      attributes,
    });
  } catch {
    // Telemetry must never change application outcomes.
  }
}

/** Log activity without identifiers in metric labels. Loki deduplicates across instances. */
export function logUserActivity(userId: string, channel: 'web' | 'api' | 'mcp'): void {
  logTelemetryEvent('user.activity', { user_id: userId, channel });
}

/** Background polling is not evidence of an actively used account. */
export function isUserActivityRequest(path: string, status: number): boolean {
  return (
    status >= 200 &&
    status < 400 &&
    path.startsWith('/api/v1/') &&
    !path.startsWith('/api/v1/auth/') &&
    !path.startsWith('/api/v1/sync/cursor') &&
    !path.startsWith('/api/v1/notifications') &&
    !path.startsWith('/api/v1/media/')
  );
}

/** Summarize committed top-level deletions even when a later item fails. */
export async function observeSweep(
  worker: string,
  run: (processed: (count?: number) => void) => Promise<unknown>,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let rowsProcessed = 0;
  let outcome = 'success';
  logTelemetryEvent('worker.sweep.started', { worker, started_at: startedAt });
  try {
    await run((count = 1) => {
      rowsProcessed += count;
    });
  } catch (error) {
    outcome = 'failure';
    throw error;
  } finally {
    logTelemetryEvent(
      'worker.sweep.finished',
      {
        worker,
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        duration_seconds: (performance.now() - start) / 1000,
        rows_processed: rowsProcessed,
        outcome,
      },
      outcome === 'failure' ? 'ERROR' : 'INFO',
    );
  }
}

/** Classify operationally significant requests without retaining paths or input. */
export function observedOperation(method: string, path: string): string | undefined {
  const rules: Array<[string, RegExp, string]> = [
    ['POST', /^\/api\/v1\/auth\/passkeys\/register$/, 'passkey.register'],
    ['DELETE', /^\/api\/v1\/auth\/passkeys\/[^/]+$/, 'passkey.revoke'],
    ['POST', /^\/api\/v1\/auth\/api-keys$/, 'api_key.create'],
    ['DELETE', /^\/api\/v1\/auth\/api-keys\/[^/]+$/, 'api_key.revoke'],
    ['POST', /^\/api\/v1\/auth\/password$/, 'password.change'],
    ['POST', /^\/api\/v1\/auth\/forgot-password$/, 'password_reset.request'],
    ['POST', /^\/api\/v1\/auth\/reset-password$/, 'password_reset.complete'],
    ['POST', /^\/api\/v1\/admin\/users\/[^/]+\/suspend$/, 'admin.suspend'],
    ['POST', /^\/api\/v1\/admin\/users\/[^/]+\/unsuspend$/, 'admin.unsuspend'],
    ['POST', /^\/api\/v1\/admin\/users\/[^/]+\/purge$/, 'admin.schedule_purge'],
    ['POST', /^\/api\/v1\/admin\/users\/[^/]+\/cancel-purge$/, 'admin.cancel_purge'],
    ['POST', /^\/api\/v1\/oauth\/authorization$/, 'oauth.consent'],
    ['POST', /^\/oauth\/register$/, 'oauth.client_register'],
    ['POST', /^\/oauth\/token$/, 'oauth.token'],
    ['POST', /^\/oauth\/revoke$/, 'oauth.revoke'],
    ['DELETE', /^\/api\/v1\/oauth\/grants\/[^/]+$/, 'oauth.grant_revoke'],
    ['POST', /^\/api\/v1\/campaigns\/[^/]+\/library\/import$/, 'library.import'],
    ['POST', /^\/api\/v1\/campaigns\/[^/]+\/invitations$/, 'invitation.create'],
    ['DELETE', /^\/api\/v1\/campaigns\/[^/]+\/invitations\/[^/]+$/, 'invitation.cancel'],
    ['POST', /^\/api\/v1\/invitations\/[^/]+\/accept$/, 'invitation.accept'],
    ['POST', /^\/api\/v1\/invitations\/[^/]+\/reject$/, 'invitation.reject'],
    ['POST', /^\/api\/v1\/media\/uploads(?:\/bytes)?$/, 'media.upload'],
  ];
  return rules.find(([verb, pattern]) => verb === method && pattern.test(path))?.[2];
}
