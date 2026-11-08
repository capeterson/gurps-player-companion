import { SeverityNumber, logs, metrics, trace } from '@opentelemetry/api';
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
  console.error(JSON.stringify({ severity: 'ERROR', event, ...attributes }));
  logs
    .getLogger('sunbolt')
    .emit({ severityNumber: SeverityNumber.ERROR, severityText: 'ERROR', body: event, attributes });
}
