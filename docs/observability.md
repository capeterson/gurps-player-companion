# OpenTelemetry and Grafana Alloy

Sunbolt can export server metrics, traces and selected structured error logs over OTLP to Grafana Alloy. Export is disabled by default. No public metrics endpoint is opened. Grafana is a viewer; configure data sources for your metrics backend (Prometheus or Mimir), Loki and Tempo separately.

Set these environment variables on the Sunbolt server (for example in the app service's Compose `environment`):

```yaml
SUNBOLT_OTEL_ENABLED: "true"
OTEL_SERVICE_NAME: sunbolt
OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4318
OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
OTEL_RESOURCE_ATTRIBUTES: deployment.environment.name=production,service.version=YOUR_RELEASE
# Optional: reduce successful trace volume; 1.0 captures all.
OTEL_TRACES_SAMPLER: parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG: "0.1"
```

`alloy` must resolve from the application container; use `http://127.0.0.1:4318` only when both run on the same network namespace. The SDK appends `/v1/metrics`, `/v1/traces` and `/v1/logs` to the common endpoint. Standard `OTEL_EXPORTER_OTLP_*` endpoint, headers, timeout and per-signal exporter variables apply; use `none` for an unwanted signal. Protect the receiver on a private network or configure TLS/authentication at the collector boundary. Do not publish an unauthenticated collector to the internet.

For a self-hosted Grafana stack, this Alloy configuration receives OTLP/HTTP and forwards to your existing backends. Replace hostnames and add authentication/TLS as needed. Prometheus must have its remote-write receiver enabled; Mimir can be used instead.

```alloy
otelcol.receiver.otlp "sunbolt" {
  http { endpoint = "0.0.0.0:4318" }
  output {
    metrics = [otelcol.processor.batch.sunbolt.input]
    logs    = [otelcol.processor.batch.sunbolt.input]
    traces  = [otelcol.processor.batch.sunbolt.input]
  }
}
otelcol.processor.batch "sunbolt" {
  output {
    metrics = [otelcol.exporter.prometheus.sunbolt.input]
    logs    = [otelcol.exporter.loki.sunbolt.input]
    traces  = [otelcol.exporter.otlphttp.tempo.input]
  }
}
otelcol.exporter.prometheus "sunbolt" {
  forward_to = [prometheus.remote_write.metrics.receiver]
}
prometheus.remote_write "metrics" {
  endpoint { url = "http://prometheus:9090/api/v1/write" }
}
otelcol.exporter.loki "sunbolt" {
  forward_to = [loki.write.logs.receiver]
}
loki.write "logs" {
  endpoint { url = "http://loki:3100/loki/api/v1/push" }
}
otelcol.exporter.otlphttp "tempo" {
  client { endpoint = "http://tempo:4318" }
}
```

For Grafana Cloud, use its Alloy configuration and credentials rather than these backend URLs; see [Grafana's OTLP-to-Grafana guide](https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/).

## Signals

- `http.server.request.duration`: seconds, by method, status and matched route template when available. Each request also gets a server span. The instrumentation deliberately does not capture URLs, query strings, request headers or bodies.
- `sunbolt.sync.operations`: per-operation count by entity class, command and outcome. A successful HTTP response can contain rejected, conflicting or transient operations.
- `sunbolt.sync.batch.size` and `sunbolt.sync.cursor.rows`: histograms of operations and returned changes. HTTP request duration measures batch and cursor latency.
- `sunbolt.db.pool.connections`: active, idle and waiting connections; `sunbolt.websocket.connections` and `sunbolt.websocket.delivery.failures` show push-channel health.
- `sunbolt.worker.runs` and `sunbolt.worker.duration`: nightly user-purge and recycle-bin sweep results and durations. Item-level failures handled inside a sweep do not necessarily make the sweep fail.
- Selected unexpected HTTP and nightly sweep failures produce structured error records and stdout JSON. Existing other service logs remain on stdout/stderr and are not automatically exported through OTLP.

The server cannot observe pending client edits while a device is offline. A quiet sync dashboard does not establish that every outbox is empty. This release does not instrument client queues or notification worker backlog.

Telemetry contains no character data or credentials in these application signals; do not add raw URLs, query strings, request bodies, entity IDs, email addresses or tokens as labels or span attributes. In particular, WebSocket authentication uses a query-string token. Restrict collector and backend access and set retention to your operational needs. Existing non-OTLP application logs have their own contents and retention policies.

On shutdown, the SDK flushes buffered telemetry after the server drains. Export is best effort: collector outages may lose telemetry and do not prevent edits or sync. Monitor Alloy and your backend separately. In Grafana Explore, look for the service `sunbolt`, the HTTP duration histogram, sync outcome counts, and a server trace; exact Prometheus metric names depend on the collector's translation settings. Scrape/ingestion intervals can delay appearance.
