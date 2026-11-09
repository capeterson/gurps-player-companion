# OpenTelemetry and Grafana Alloy

Sunbolt can export server metrics, traces and structured application events over OTLP to Grafana Alloy. Export is disabled by default. No public metrics endpoint is opened. Grafana is a viewer; configure data sources for your metrics backend (Prometheus or Mimir), Loki and Tempo separately.

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
- Structured events include `user.activity`, `auth.login.succeeded`, `auth.login.failed`, `auth.rate_limited`, `auth.refresh.replay`, `email.attempted`, `email.accepted`, `email.skipped`, `email.retry_scheduled`, `email.exhausted`, `email.failed`, and selected HTTP and worker failures. Each event is emitted as a JSON line and an OTLP log record, with trace correlation when a span is active. Configure **one** ingestion path per record; collecting stdout as well as OTLP duplicates events.
- Email acceptance means the provider accepted the API request, not that a message reached an inbox. Reset delivery is best effort; queued notification delivery retries up to eight attempts. `email.queue_observed` records first-attempt jobs when the worker observes a committed queue row; insertion is performed by a database trigger, so this is not the insertion time and a transaction retry can repeat it. `email.queue.backlog` reports pending and exhausted row counts and whether delivery is configured when the worker checks for its next deadline; unconfigured delivery is also reported at startup.

## Active users in Grafana

`user.activity` carries an opaque `user_id` as a log attribute and a `channel` (`web`, `api`, or `mcp`). It is never a metric label. Successful password and passkey sign-ins, successful authenticated application requests, and MCP tool calls produce events. Guest sessions, token refresh, cursor polling, notification polling and media requests are excluded; sync writes count. Multiple devices and processes can emit the same user. Deduplicate in the logs backend, never sum daily counts for a monthly total. Browser activity performed entirely offline is invisible until an eligible server request. No events are generated retrospectively. Sampling or telemetry loss lowers the count.

With Loki configured to expose OTLP log attributes as structured metadata, this LogQL instant query counts distinct users over a rolling day (use `30d` for a rolling 30-day count):

```logql
sum(count by (user_id) (count_over_time({service_name="sunbolt"} |= "user.activity" | user_id != "" [1d])))
```

The service label and attribute mapping depend on the collector and Loki configuration. Check an ingested record in Explore; `user_id` must remain structured metadata, not an indexed stream label. For calendar-day and calendar-month counts, set Grafana's timezone to UTC, use aligned calendar ranges and evaluate the distinct-user query over each full range; a rolling 30-day window is not a calendar month. Retain unsampled activity logs for the longest desired reporting period, restrict access to identifiers, and monitor ingestion loss. Login failures and email outcomes can be filtered by event and grouped by their bounded attributes.

The server cannot observe pending client edits while a device is offline. A quiet sync dashboard does not establish that every outbox is empty. Client queues remain invisible to the server; email queue observations occur when the worker claims jobs.

Telemetry contains no character data or credentials in these application signals; do not add raw URLs, query strings, request bodies, entity IDs, email addresses or tokens as metric labels or span attributes. Activity logs intentionally include opaque user IDs, and email worker logs include opaque job IDs; keep both out of indexed Loki stream labels. In particular, WebSocket authentication uses a query-string token. Restrict collector and backend access and set retention to your operational needs. Existing non-OTLP application logs have their own contents and retention policies.

On shutdown, the SDK flushes buffered telemetry after the server drains. Export is best effort: collector outages may lose telemetry and do not prevent edits or sync. Monitor Alloy and your backend separately. In Grafana Explore, look for the service `sunbolt`, the HTTP duration histogram, sync outcome counts, and a server trace; exact Prometheus metric names depend on the collector's translation settings. Scrape/ingestion intervals can delay appearance.

## Scheduled sweep logs

`worker.sweep.started` and `worker.sweep.finished` report each scheduled user purge, recycle-bin purge and media cleanup. Finish records contain UTC `started_at`, `ended_at`, `duration_seconds`, `outcome` and `rows_processed`; a failure preserves progress reported before the error. Counts cover committed top-level user and expired refresh-token rows for user purge, campaign and character rows for recycle-bin purge, and media asset rows for cleanup. They do not include cascaded child rows or storage objects. A zero count can also mean another replica held the advisory lock or cleanup was paused. Item-level failures are logged separately and can occur in an otherwise successful run.

## Significant operations and failures

`operation.completed` records a fixed operation name, HTTP status, request ID and an authenticated actor ID when available for credential changes, administrator account actions, OAuth, library imports, media uploads and campaign invitations. Request bodies, paths, tokens, email addresses and affected resource IDs are excluded. An HTTP success means the endpoint accepted the request, not necessarily that an OAuth token existed or a password-reset message was sent. `sync.operation.not_applied` identifies per-operation rejected, conflicting, stale or transient outcomes, including those returned inside HTTP 200; it omits values and server error text. `sync.protocol_or_service_unavailable` marks sync 426/503 responses. `oauth.authorization.failed` records a bounded OAuth error code without client identifiers. `server.started` and `server.shutdown.*` record process lifecycle and drain outcomes. The migration process emits `db.migration.started`, `.completed` or `.failed` and flushes before exiting when telemetry is enabled. `mcp.tool.failed` records a registered tool name and bounded failure category without tool arguments or responses. Existing sync counters and request spans remain the preferred way to follow overall volume and latency.

## Resend delivery events

Set `RESEND_WEBHOOK_SECRET` to the signing secret from a Resend webhook configured to POST to `https://<APP_HOSTNAME>/api/v1/webhooks/resend`. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`. Configure this in the Resend dashboard; adding the secret alone does not register the webhook. Invalid signatures are rejected; payloads are limited to 64 KiB. Logs include the provider event and email IDs, but never recipient addresses or email content. Correlate `email.accepted` and `email.provider_event` by `provider_email_id`; deduplicate callbacks by `provider_event_id` when counting, because Resend can retry. A delivered event means the recipient's mail server accepted the message; it cannot establish inbox placement. These IDs are log attributes, never metric or Loki stream labels. The endpoint and telemetry are best effort; collector loss is not retried by the application.

## PostgreSQL trigger events

Migration 0076 adds an `AFTER INSERT` trigger on the existing email queue. PostgreSQL emits `sunbolt_trigger {"event":"email.queue.insert_attempt", "job_id":"…", "kind":"…"}` at `WARNING` severity (the function suppresses the message to the database client), containing only the opaque queue UUID and bounded email kind. The trigger logs an actual insert, including one subsequently rolled back. It does not fire for an `ON CONFLICT DO NOTHING` row. **This is an insert attempt, not proof of a committed or delivered email.** Match `job_id` with the application's `email.queue_observed`, `email.attempted`, and `email.accepted` records to follow later outcomes. Postgres and collector logs are best effort; do not derive exact counts from them. No new database table or OTLP network access from PostgreSQL is needed.

Configure collection **on the host running PostgreSQL**, in that host's existing Alloy deployment. PostgreSQL defaults to `log_min_messages=warning`, `log_min_error_statement=error`, and `log_destination=stderr`. Verify with `SHOW log_min_messages; SHOW log_min_error_statement; SHOW log_destination; SHOW logging_collector;` on that server. The trigger uses WARNING so the default `log_min_error_statement=error` does not attach the SQL statement and email content. If that setting is `warning` or more verbose, PostgreSQL can log the triggering SQL and sensitive values; correct that host configuration before enabling collection. If using container logs, confirm `logging_collector` is off or that the selected destination also reaches the container's stderr. Avoid enabling statement or parameter logging merely for this feature: those can expose credentials or character data.

For the supplied Unraid Compose file, the production database container is named `gurps-db`. The following Alloy example selects only that container and only the explicit trigger marker, forwarding to the existing Loki writer from the earlier example. Replace the container name and Loki component with those on your host; the database host's Alloy must have access to its Docker socket. Docker socket access is privileged: use your host's established restricted collector arrangement.

```alloy
discovery.docker "sunbolt_postgres" {
  host = "unix:///var/run/docker.sock"
  filter {
    name = "name"
    values = ["^/gurps-db$"]
  }
}
loki.source.docker "sunbolt_postgres" {
  host = "unix:///var/run/docker.sock"
  targets = discovery.docker.sunbolt_postgres.targets
  labels = { source = "sunbolt-postgres" }
  forward_to = [loki.process.sunbolt_postgres.receiver]
}
loki.process "sunbolt_postgres" {
  stage.match {
    selector = "{source=\"sunbolt-postgres\"} !~ \"sunbolt_trigger \""
    action = "drop"
  }
  forward_to = [loki.write.logs.receiver]
}
```

In Grafana Explore, query `{source="sunbolt-postgres"} |= "sunbolt_trigger "`. The PostgreSQL prefix precedes the JSON; extract it at query time if needed, and keep `job_id` out of indexed labels. Verify the real container name, collector positions and retention, and inspect a synthetic event after deployment. If PostgreSQL is a host service or managed database, use that platform's supported PostgreSQL log source instead of Docker discovery. The WARNING severity is a PostgreSQL logging mechanism for this informational event; filter by the event name instead of treating it as an application failure. Some logging configurations include SQL context or statement text on separate lines; forward only the marker line and independently restrict access to the original database logs.
