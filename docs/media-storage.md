# Running image storage

Production uploads are optional. Without bucket credentials production keeps
existing gameplay features available and disables image selection. Development
and test environments can use local disk without a storage service. PostgreSQL
contains metadata only. Production replicas must share the same database, bucket,
credentials and region.
Serve the browser app over HTTPS (or localhost in development): source hashing
and the offline service worker require a secure browser context. Garage itself
may use HTTP inside the private Compose network.

The browser upload acceptance suite works with either local or S3 storage and
skips unless explicitly enabled. Run the app and Playwright on localhost (or
use an HTTPS origin), then set
`MEDIA_E2E_STORAGE=1` and `PLAYWRIGHT_BASE_URL` to the app origin:

```sh
MEDIA_E2E_STORAGE=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  bun run test:e2e -- tests/e2e/media.spec.ts
```

## Development and CI without a storage service

With explicit `ENVIRONMENT=development` or `ENVIRONMENT=test`, the default
`MEDIA_STORAGE=auto` selects local disk when no S3 endpoint, bucket or credentials
are supplied. `docker-compose.dev.yml` needs no extra service: sanitized variants
persist in this checkout's `.local/media`, mounted at `/app/.local/media` in the
container. The directory is excluded from Git and Docker build contexts. Raw
originals are still not server-retained. For non-Compose tests, set
`MEDIA_LOCAL_DIR` to a job-specific temporary directory if isolation is needed.

`MEDIA_STORAGE=local` explicitly selects disk; `MEDIA_STORAGE=s3` explicitly
selects the object store. `auto` prefers S3 even if its configuration is partial,
so a missing credential never silently redirects bucket data to disk. Use
`MEDIA_UPLOADS_ENABLED=false` to disable new uploads regardless of backend.

Local storage is allowed only in explicit development/test environments and
is **forbidden when either `ENVIRONMENT` or `NODE_ENV` is `production`**.
Production startup fails if local storage is explicitly selected; `auto` in
production requires S3 and never falls back to disk. The app's production-mode
configuration is checked at startup as well. Unset/unknown environments cannot
enable local storage. No production Compose file enables or mounts local media.

The filesystem adapter uses the same upload processing, authorization, public
URLs, quotas and cleanup as S3. It is intended for one dev/test instance. Keep
the database and `.local/media` together across restarts; deleting the directory
alone leaves database references to missing images. Changing backend does not
automatically migrate existing objects.

For the built-app offline browser test, run the compiled server with
`ENVIRONMENT=test` and a localhost `APP_BASE_URL`: this serves built assets and
the service worker while permitting local storage and HTTP loopback OAuth.

## Garage on Unraid

The optional `docker-compose.media.yml` overlay starts Garage 2.3.0 in single-node
mode with a private default bucket. It publishes no storage/admin ports. The app
accesses Garage over the Compose network and serves cacheable image responses on
its existing origin. This uses your Unraid disks; it does not make a single host
highly available. Cached images can remain usable during a host outage, while
uncached reads and uploads retry when storage returns.

Add secrets to your untracked `.env` (generate each independently):

```sh
# Access key: GK followed by 24 hex characters; secret and RPC key: 64 hex.
printf 'GK'; openssl rand -hex 12
openssl rand -hex 32
openssl rand -hex 32
```

```dotenv
MEDIA_S3_ACCESS_KEY=GK_REPLACE_WITH_24_HEX_CHARACTERS
MEDIA_S3_SECRET_KEY=REPLACE_WITH_64_HEX_CHARACTERS
MEDIA_GARAGE_RPC_SECRET=REPLACE_WITH_64_HEX_CHARACTERS
MEDIA_S3_BUCKET=gpc-images
MEDIA_METADATA_DIR=/mnt/user/appdata/gpc-garage/meta
MEDIA_DATA_DIR=/mnt/user/gpc-media/data
```

Choose persistent Unraid shares; fast reliable metadata storage is preferable.
The Garage configuration's SQLite setting is Garage's internal metadata engine,
not the application's database (which remains PostgreSQL 18).

```sh
# Add to your existing production stack, preserving its Compose project name:
docker compose -f docker-compose.yml -f docker-compose.media.yml up -d
# Or development, always isolated to this checkout:
./scripts/dev-worktree.sh -f docker-compose.media.yml up -d
```

For the Unraid base deployment, substitute `docker-compose.unraid.yml` for the
production base file. Keep the repository/configuration mount available. If you
use Unraid templates instead, reproduce the two mounts and Garage environment
from the overlay and put app + Garage on the same private Docker network.
Never expose Garage's RPC port to the Internet. Remote app replicas need a secure
private network or a TLS endpoint reachable by all replicas.

## Other S3-compatible storage

Omit the Garage overlay and set these app environment variables:

| Variable | Value |
| --- | --- |
| `MEDIA_S3_ENDPOINT` | Provider HTTPS endpoint; omit for AWS S3 |
| `MEDIA_S3_REGION` | Provider region (`garage` for local Garage) |
| `MEDIA_S3_BUCKET` | Pre-created private bucket |
| `MEDIA_S3_ACCESS_KEY`, `MEDIA_S3_SECRET_KEY` | Scoped service credentials |
| `MEDIA_S3_PATH_STYLE` | `true` for Garage; use provider's requirement |
| `MEDIA_UPLOADS_ENABLED` | `false` to stop uploads, retain reads |

The adapter uses Put/Get/Head/Delete/ListObjectsV2 and avoids optional SDK checksum
features for compatibility. Grant only the configured bucket and `images/`
prefix: list plus object read/write/delete, without bucket administration. The
local default-bucket bootstrap key is convenient for a dedicated Garage service;
use a scoped key for shared storage. No browser bucket CORS or presigned upload
configuration is required. The app accepts and sanitizes the bytes itself. Each upload sends metadata and
bytes in one request; retries reuse the same client-generated upload ID. MCP
exposes one `media` tool with typed capabilities/upload/status/cancel actions.
Migration to S3, R2, B2 or another compatible provider consists of copying the
objects with exact keys, preserving the DB and changing app connection settings;
exercise provider compatibility before production cutover. Native Azure/GCS APIs
are not implemented.

Optional budgets are documented in `src/server/services/media/config.ts`:
`MEDIA_USER_BYTES`, `MEDIA_TOTAL_BYTES`, `MEDIA_UPLOADS_PER_HOUR`,
`MEDIA_UPLOADS_PER_DAY`, `MEDIA_UPLOADS_PER_IP_HOUR`,
`MEDIA_UPLOADS_PER_HOUR_TOTAL`, `MEDIA_READS_PER_IP_HOUR`,
`MEDIA_READ_BYTES_PER_HOUR`, `MEDIA_PROCESSING_CONCURRENCY`.
Pass overrides into the app container's environment; a host `.env` entry alone
only affects variables explicitly interpolated by your Compose file.

## Backup and restore

Back up both PostgreSQL and sanitized objects **off the Unraid host**. RAID/parity
is not a backup. This repository cannot configure an off-host destination without
your destination and credentials. Include Garage configuration and secrets in an
encrypted operator backup. Raw originals are not server-retained.

A consistent maintenance-window procedure is:

1. Stop every app replica (or otherwise block writes and drain active uploads).
   Leave PostgreSQL and Garage available for backup tools. This also stops cleanup.
2. Take a PostgreSQL custom-format dump (`pg_dump -Fc`). Copy all bucket objects
   to a dated, versioned off-host backup using an S3-aware tool such as rclone,
   preserving every `images/<id>/<generation>/<variant>.webp` key. Prefer `copy`
   over destructive `sync` so an accidental source deletion does not erase backup.
3. Verify object counts, sizes and backup checksums; record the DB dump and object
   snapshot as one recovery point. Resume app replicas and check an uncached image.

For online backup automation, prevent garbage collection before taking the DB
snapshot: insert/update `media_counters` key `backup-pause`, amount `0`, with an
`expires_at` covering the entire backup. Wait for the current sweep to finish;
acquire the `gpc:media-cleanup` advisory barrier to do this
without guessing the sweep duration. Then dump DB **before** copying objects.
Immutable generations make copying safe while uploads continue. Keep cleanup paused until verification completes; renew
its expiry for long copies. Extra objects uploaded after the snapshot are harmless.
A stopped-app maintenance window is easier to verify and is the default procedure.

Restore drills must use a **separate** Compose project/database/bucket, never the
live volumes. Restore the dump and exact object keys, configure the restored app
against that bucket, and verify: (1) an uncached portrait and cover render;
(2) their old public URLs still return the correct WebP; (3) new uploads work;
(4) disabled accounts/takedowns remain enforced. Preserve asset IDs, tokens and
prefixes; do not regenerate them. Exercise this drill before relying on a backup,
and schedule repeated checks. To restore Garage's native data/metadata instead of
S3 object copies, stop Garage before snapshotting both directories consistently.

## Operating limits and cache policy

Use reverse-proxy request size/time/concurrency limits, monitored disk quotas and
alerts for storage errors, processing failures, exhausted budgets and backup age.
Check `/admin/media` for upload state/usage and takedowns; existing app error
correlation IDs support investigation. Restrict admin access. Redact media tokens
from reverse-proxy logs and avoid placing source names or tokens in analytics.

Configure CDN caching only for successful `/media/*` image responses and preserve
`public, max-age=31536000, immutable`; do not override API/auth error responses.
Browser/service-worker caches deliberately outlive logout and origin takedown.
Uploads carry a public-link notice; this feature is unsuitable for confidential
files requiring access revocation. A CDN purge can reduce shared-cache exposure,
but cannot delete copies already stored on a user's device.
