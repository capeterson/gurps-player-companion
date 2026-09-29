# Image uploads

Character portraits and campaign covers are local-first edits backed by private
S3-compatible object storage. PostgreSQL stores identity, ownership, references,
processing state, quotas, and public URL tokens; it never stores image bytes.
Production app replicas share PostgreSQL and the bucket; local filesystem storage
is forbidden in production. Explicit development/test environments default to
`.local/media` when no S3 connection is configured. This adapter implements the
same object operations with atomic file replacement and path/symlink checks, so
sanitization, quotas, attachment, caching and cleanup use the same paths. It is
only for a single dev/test instance. Item images are future work: the reusable storage/processing/client
layers exist, but their target types, authorization, schemas and UI are not enabled.

## Access and caching contract

Character write permission controls portrait changes. Only the campaign owner
changes its cover. Authorized campaign members discover covers and portraits,
including portraits in the minimal character projection when sheet sharing is off.
Manifests require normal read permission and are not publicly enumerable.

After attachment, anyone holding `/media/<256-bit random token>/<variant>.webp`
can read the image without login. These are public bearer links, not confidential
attachments. They have `Cache-Control: public, max-age=31536000, immutable` and
never change contents. Replacement allocates a new token. Tokens are independent
of IDs, filenames, and source hashes. API errors and metadata use `no-store`;
failed image responses are not cached. The private bucket has no public ACL.
The same Bun process serves sanitized images from S3 and can sit behind a CDN.

Normal `<img>` elements use the browser HTTP cache. The production service worker
adds same-origin CacheFirst caches: 256 thumbnails and 32 display images, each
with a one-year maximum age, only caching successful responses. Metadata sync
warms accessible thumbnails; full images load on demand. Offline display can fall
back to a cached thumbnail. Browser eviction and images never downloaded can
still leave a placeholder; this is best-effort offline availability. App-shell
precaching and authenticated JSON remain separate from these public caches.

Logout, account switching, membership loss and takedown cannot erase HTTP/CDN
copies. Logout clears account-scoped URL manifests and pending source blobs, but
intentionally leaves public image caches. Origin takedown stops future uncached
reads; it is not a remote wipe. The upload UI states the public-link/cache policy.
Configure proxy access logs to redact `/media/` tokens as the app's error logs do.

## Upload and attachment lifecycle

1. Validate a static JPEG, PNG or WebP selection and atomically persist its Blob,
   digest, target and optimistic reference alongside a normal outbox patch in
   IndexedDB. Selection is durable before any network request. The device has a
   50 MiB aggregate pending-source limit. Object URLs provide immediate previews.
2. A separate cross-tab media lock drains uploads without blocking ordinary
   text edits. It waits for speculative character creation to be acknowledged.
   One request carries bytes plus the client upload UUID, target, SHA-256 and
   exact byte length. Retrying the identical request returns the same server
   asset, including after a lost success response. No initialization round trip
   or status-before-upload request is needed.
3. The authenticated binary endpoint streams through a bounded body reader;
   JSON/base64 is an equivalent endpoint for MCP clients. The server checks bytes against the
   declaration before allocating storage, reserves quota internally, takes a
   PostgreSQL processing lease, decodes, rotates, strips
   metadata and re-encodes to sRGB WebP. Only sanitized variants enter S3.
4. Two immutable variants are generated, without enlargement: portrait 256/1024
   pixels and cover 640/1920 pixels (longest side). Thumbnails are limited to
   128 KiB; both variants together to 2 MiB. Client/source filenames and original
   metadata are discarded. Source bytes remain only on the selecting device until
   attachment acknowledgement. Failed local sources can be retried, downloaded
   individually, explicitly discarded, or exported through the sync log.
5. Once both objects are durable, the held outbox operation receives the real
   asset UUID and becomes eligible for ordinary replay. The parent update checks
   the asset is ready and bound to that exact target, then publishes it atomically
   with the audited reference change. An uploaded but unattached image is not
   publicly readable. Partial object writes and DB failures can be retried.

The existing field queue preserves replacements/removal order, uncertain
predecessors, unrelated field edits, cursor masking, rejection toasts and flashes.
The `campaign` dispatcher accepts only `coverAssetId`; other campaign edits remain
online REST operations. REST and sync use the same attachment guard. Reference
changes use existing parent revision/history triggers and cursor invalidations.
Asset infrastructure is not a new syncable entity class. No JSONB column is added.

`mediaUploads` and `mediaManifests` are Dexie v14 stores, both included in purge.
A session abort fences upload responses and metadata writes during logout/resync.
The sync log exports `gpc-pending-images-v1` JSON with source bytes in base64;
these bytes and URL manifests are excluded from shareable diagnostic exports.
Sign-out and password change ask before discarding any queued edits, pending
theme preferences, or unsaved sources. **Keep editing** retains the session and
work for later synchronization; explicit discard removes the account's local
data. Export unsaved images before confirming discard or clearing local data.

## Abuse and failure bounds

Input maximum is 10 MiB, 40 megapixels, 12,000 pixels on either axis and one frame.
Sharp 0.35.5 supplies patched native dependencies. Before any metadata decode,
all native input loaders are blocked except JPEG, PNG and WebP buffer loaders.
Unsupported formats (including AVIF/HEIF, TIFF, GIF and SVG) cannot enter their
parsers; the metadata gate still rejects animated inputs and enforces dimensions.
Sharp applies a ten-second timeout to each output conversion; one decoder runs per
process. PostgreSQL limits concurrent processing across replicas to two by
default. The authenticated receiver permits two simultaneous media POST handlers
per process, with a 14 MiB transport ceiling (10 MiB binary after decoding).
Admission checks precede HTTP body buffering; MCP's authenticated JSON envelope
has the same 14 MiB ceiling, with four in-flight MCP requests per process.
Public object reads are capped at sixteen in flight per process. No remote-URL
import or arbitrary object key is accepted.

Durable counters bound upload allocation per account (10/hour, 50/day), source
(100/hour), and instance (1,000/hour). Content requests also have account/source
limits. Reservation serializes in PostgreSQL before processing: 100 MiB/account
and 10 GiB/instance, reserving the 2 MiB worst-case output for unfinished uploads.
Unused previous attempt generations must be removed before writing more objects.
Reservations remain until cleanup, including failed/cancelled uploads. Quotas are
application bounds, not a substitute for a bucket/disk quota during storage
failures. Configure proxy body/time/connection limits and storage-capacity alerts.
Public origin reads have source request limits and a global 10 GiB/hour byte
budget; CDN hits do not consume app counters. Proxy trust must be configured
correctly, or all users behind it share a source budget.

`MEDIA_UPLOADS_ENABLED=false` disables new uploads without breaking existing reads.
`/admin/media` lists uploads, removes an image, and disables/enables an uploader.
It belongs exclusively to the separate admin bundle. These controls plus existing
registration throttles/suspension bound open-signup abuse. Operators still need a
reporting contact, copyright/abuse response process and budget/disk monitoring.
There is no automated content-moderation service or antivirus integration.

Every app replica runs cleanup at startup and hourly thereafter; a PostgreSQL
lease coordinates sweeps.
Unattached uploads expire after 24 hours, detached published images after seven
days, and cancelled or orphaned assets on the next eligible sweep. Active leases
are protected with an additional grace period. Parent references are checked
under locks before objects are deleted; a failed deletion remains retryable.
History retains reference UUIDs, not an indefinite archive of old photographs.

## API, MCP and code map

Authenticated `/api/v1/media`: `GET /capabilities`, `POST /uploads` (metadata plus
canonical base64 JSON), `POST /uploads/bytes` (binary with metadata in query),
and `GET|DELETE /uploads/{id}`. Status/cancellation default to server asset IDs;
`?lookup=clientUploadId` uses the caller’s retry UUID, scoped to that uploader.
This permits recovery and cancellation during processing without a separate
initialization endpoint. A cancelled active writer retains its lease so cleanup
cannot race object writes. Cancellation before allocation may return 404;
callers must still settle/check an uncertain in-flight upload before discarding
its identity. Repeated uploads with altered target or content fail rather than
allocating another asset under the same key.

One typed `media` task tool groups capabilities/upload/status/cancel, with
per-action OAuth scopes, canonical schemas, shared handlers and exact parity
coverage. Mutation results are compact acknowledgements; status reads return the
manifest. Existing parent update tools attach/remove images. Media uses its bound
client UUID and processing state for idempotency, avoiding the generic response
journal’s outer transaction and duplicate body buffering. Binary transport,
public delivery and admin routes have explicit exclusions. Reservation and lease
transactions commit before object I/O on both REST and MCP paths.

- Shared contract: `src/shared/schemas/media.ts`.
- Server: `src/server/routes/media.ts`, `src/server/services/media/`;
  migration `0059_media_uploads.sql` and parent reference fields in `schema.ts`.
- Storage selection: `media/config.ts` and `media/storage.ts`; development/CI
  filesystem adapter `media/localStorage.ts`. `MEDIA_STORAGE=auto|s3|local`;
  production startup rejects local selection (also when `NODE_ENV=production`).
- Client: `MediaImage.tsx`, `sync/mediaUploads.ts`, `sync/mediaRecovery.ts`;
  outbox/orchestrator integration and `vite.config.ts` cache rules.
- Operator UI: `src/client/admin/pages/MediaPage.tsx`.
- Deployment and recovery: [media-storage.md](../media-storage.md),
  `docker-compose.media.yml`, `deploy/garage.toml`.

Cleanup holds the `gpc:media-cleanup` transaction advisory barrier for its entire
sweep, allowing
backup-pause installation to wait for active deletions safely. See the generic
backup coordination procedure in [media-storage.md](../media-storage.md).
