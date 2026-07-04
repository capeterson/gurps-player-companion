# GURPS Player Companion — agent notes

Compact, durable rules for anyone (human or agent) editing this repo. Keep
it short; add a section only when a rule has been broken at least once.

## Design specs are a maintained requirement

`docs/specs/` holds the living description of this application's current
state. **Reading them first, and keeping them accurate, is a firm project
requirement — not optional documentation.**

- **Start here.** [docs/specs/overview.md](docs/specs/overview.md) is the
  orientation hub: user-facing feature catalog, codebase map, architecture
  summary, and orientation notes for new sessions. A fresh session (human or
  LLM) should read it before scanning the tree. The set is:
  - `overview.md` — product surface + codebase map + orientation notes.
  - `architecture.md` — stack, process model, request lifecycle, data model.
  - `offline-sync.md` — the local-first / outbox / cursor / WS system.
  - `campaign-content-sharing.md` — roles, invitations, the share gate /
    minimal view, and the YAML library.
  - `history-tracking.md` — the append-only audit log.
- **These docs describe *what exists*; this file (`AGENTS.md`) prescribes
  *what you must keep true*.** When they disagree with the code, the code is
  the truth and the spec is a bug — fix it.
- **Update the relevant spec in the same change** whenever you alter:
  user-facing features, the offline-sync architecture, campaign
  content-sharing behaviour, the history subsystem, the codebase layout, or
  any orientation note. A behaviour change that lands without its spec update
  is incomplete. In particular, `overview.md`'s feature catalog and codebase
  map must not drift from reality.
- **Adding a spec-worthy subsystem** (a new key area, not a small feature)
  means adding a new `docs/specs/*.md` and linking it from `overview.md`'s
  document map and this section.

## Interaction design rules

### 1. Never silently discard user edits — queue them client-side

This is a **fundamental rule** for every editable input in the app, not
just the core attribute (ST/DX/IQ/HT) inputs that prompted it.

When a user makes multiple edits in quick succession to the same input,
or moves between inputs while an earlier save is still in flight:

- Each edit must be retained client-side until it is durably saved or
  the user explicitly supersedes it. Concurrent saves must not roll
  later edits back to a stale server value.
- Same-field edits **serialize**: while a save is in flight for field
  `X`, additional commits to `X` queue (latest value wins) and fire
  when the in-flight save settles. Different fields save in parallel.
- Do **not** wholesale re-sync a draft state from the server cache on
  every refetch — only sync per-field, and only when the user has not
  superseded that field with a newer local edit.

The canonical implementation lives in
`src/client/hooks/useDraftField.ts`. Reuse it. Do not write a second
draft-on-blur pattern; extract or extend the hook instead.

### 2. A rollback is a UX event, not a silent state change

Whenever the client undoes a value the user typed — server rejection,
network failure, optimistic-update bailout, or any client-side state
reconciliation — the app must do **both** of:

1. **Toast** the user with a message that names the field(s) and
   surfaces the underlying reason
   (e.g. `"Couldn't save ST — ST must be >= 1"`).
2. **Briefly highlight** the impacted input(s) so the visual jump back
   is unambiguous. The shared style is `.field-rollback-flash` plus
   `data-flashing="true"` (with `data-flash-parity` toggling on each
   re-trigger so the keyframe restarts). See
   `src/client/styles/theme.css`.

Both are required. A toast without the flash leaves the user hunting
for which input changed; a flash without the toast leaves them
guessing why.

### 3. Tests for the above

Any draft-on-blur input must have UI tests covering, at minimum:
- a save success (the value sticks),
- a save failure with rollback (toast appears, field is flashed),
- a slow save that lets a follow-up edit on a **different** field land
  without being clobbered when the first save returns,
- a slow save that lets a follow-up edit on the **same** field queue
  and fire after the first settles.

The `useDraftField` test file is the working reference.

## Architecture invariants

- **Local-first always.** Every UI mutation writes IndexedDB first and
  appends to the outbox. Online mode is local-first plus active sync
  and WebSocket updates; offline mode pauses sync without changing the
  UI data path.
- **One process.** The Bun server hosts HTTP, WebSocket, OpenAPI, and
  static client. Do not split into separate API/web services.
- **Postgres 18 only.** No SQLite. No cross-DB shims. Lean on PG18
  features (`uuidv7()`, virtual generated columns, MERGE…RETURNING).
- **Shared validation is pure TS.** Code in `src/shared/` must run in
  Bun, the browser, and the service worker. No DOM, no Bun globals,
  no DB clients, no env access.
- **OpenAPI is the contract.** Every Hono route uses `createRoute`
  from `@hono/zod-openapi`. CI fails on drift between routes and
  `docs/openapi.json`.
- **No instance admin in the PWA.** Admin code, if it ever exists,
  lives in a separate process and never ships in the client bundle.
- **WebSockets are acceleration, not correctness.** The HTTP sync
  cursor + outbox replay is the source of truth.

## Offline sync — extension rules

The offline sync system (Dexie + outbox + orchestrator + `/sync/*`) is
load-bearing for the entire UX promise: edits never disappear, the
indicator is honest, and rollbacks are visible. Future code that adds
or modifies sync behaviour MUST follow these rules. Each rule has been
broken at least once; assume the comment in the file already warns you.

### S0. Know what's actually sync-backed.

The outbox + cursor system currently covers only the character
classes: `character`, `character_trait`, `character_skill`,
`character_spell`, `character_inventory`, `character_combat`. Campaigns are pulled
READ-ONLY through `/sync/cursor` (so the minimal-view sweep and
offline campaign-name lookups have local rows to work with) but have
no outbox path — campaign mutations, the campaign library
(traits/skills/items), adventure log entries, invitations,
and notifications are still online-only HTTP/React-Query surfaces.
The `entityClass` enum lists more values than the orchestrator
currently pulls — that's intentional headroom for future migration,
not a claim of current coverage. The authoritative list is
`ALL_ENTITY_CLASSES` in
[src/client/sync/orchestrator.ts](src/client/sync/orchestrator.ts).

When working on an existing surface, check whether it's sync-backed
before assuming offline behaviour. When migrating a surface onto the
outbox, follow the S6 checklist end-to-end.

### S1. Mutations on sync-backed classes go through the outbox. Always.

For any sync-backed class (S0), UI handlers MUST call
`enqueueFieldPatch` / `enqueueCreate` / `enqueueDelete` in
[src/client/sync/outbox.ts](src/client/sync/outbox.ts). Direct
`fetch('/api/v1/...')` for mutations on those classes is forbidden.
The orchestrator is the only module allowed to talk to `/sync/*`.
This is what guarantees:

- the local row and the queued op land in one Dexie transaction,
- the indicator counts the work,
- offline mode and online mode use the same code path,
- coalescing applies (rule S3).

If you find yourself wanting to write a new fetch in a mutation
handler for a sync-backed class, you are on the wrong path — extend
the outbox helpers instead. Surfaces that have not yet been migrated
(see S0) keep using React Query for now.

### S2. Patches carry raw field values, never wrapped objects.

`attemptedValue` and `prevValue` on a `patch` op are the *bare value*
of `fieldPath`. The orchestrator's rollback path writes `prevValue`
straight back into the local row, so wrapping it as
`{ characterId, value }` corrupts the field on revert. Parent
character ids belong on the top-level `parentId` field of the
envelope, not nested inside the value.

### S3. Same-field commits coalesce; never stack pending patches.

The outbox has a `coalesceKey` index of `${entityId}|${fieldPath}`.
When a `pending` or `transient_retry` op already exists for that key,
`enqueueFieldPatch` deletes it and inserts the latest. Do not
introduce a code path that appends a second pending patch for the same
field — it would replay an old value over a newer one.

`create` and `delete` ops are never coalesced. Don't add a "merge two
creates" code path; it doesn't compose with parent/child ordering.

### S4. The server cursor never overwrites local intent.

`applyServerRow` skips any field that has a `pending` or `in_flight`
outbox op for the same `(entityId, fieldPath)`. If you add a new
write-back path (a new entity class, a new bulk-apply path, a hot-path
optimisation), it MUST honour the same skip. The local user's typed
value wins until the server formally rejects it. Re-syncing a whole
draft state from a server cache on every refetch is the bug this rule
exists to prevent.

### S5. Rollbacks must fire **both** a toast and a flash.

When an op is rejected, conflicted, stale-based, or unauthorized:

1. Persist a `RejectionRecord` in `rejectionToasts` and call the
   `RejectionNotifier` so the toast survives a reload, AND
2. Emit a `flashBus` event keyed by
   `${entityClass}:${entityId}:${fieldPath}` so the input that caused
   it pulses.

A toast without the flash leaves the user hunting for the field; a
flash without the toast leaves them guessing why. Inputs subscribe to
the flash bus through `useDraftField`'s `flashKey` option — pass it
whenever you build a new draft-on-blur input.

### S6. Adding an entity class is a multi-site change.

A new sync-participating entity class MUST be added to **all** of:

1. `entityClass` enum in [src/shared/schemas/sync.ts](src/shared/schemas/sync.ts).
2. A Dexie store + `LocalFoo` interface in
   [src/client/db/dexie.ts](src/client/db/dexie.ts), with `id` and
   `revision` columns. Add it to `ALL_STORE_NAMES` and
   `storeForEntityClass`.
3. The orchestrator's per-class switches:
   `applyServerRow`, `revertField`, `deleteLocal`, `reinsertLocal`,
   `stampRevision`, and `ALL_ENTITY_CLASSES`.
4. The outbox helpers' switches: `storesForOp`, `applyLocalPatch`,
   `applyLocalCreate`, `applyLocalDelete`, `readFieldValue`,
   `readEntityRevision`, and `parentIdFor` if the new class is a
   child entity.
5. The server dispatcher in
   [src/server/services/syncDispatch.ts](src/server/services/syncDispatch.ts)
   and the cursor reader in
   [src/server/routes/sync.ts](src/server/routes/sync.ts).
6. The purge list in `orchestrator.purge` so logout wipes it.

A class registered in the schema but missing from any of these is a
silent data-loss bug. There is no automatic registry; review the
checklist.

### S7. Speculative creates use client-generated UUIDs and `revision: -1`.

Optimistic creates write a Dexie row with the client's uuid and
`revision: -1`, post that same id to `/sync/operations`, and let the
server adopt it. Do not generate ids server-side and round-trip to get
them — the UI must render the new row immediately. The orchestrator
overwrites the sentinel revision when the server returns `applied`.

### S8. WebSocket frames carry no row data.

The WS push channel is invalidation-only — frames are
`sync_invalidate` nudges that prompt the orchestrator to drain or
pull. Do not add a path that streams entity payloads over WS, and do
not let the UI react to a WS frame except by triggering the standard
sync cycle. Correctness comes from the cursor pull and the outbox; WS
is performance only.

### S9. Logout purges every local store. New tables MUST be added.

`orchestrator.purge` clears Dexie on logout so account switching never
leaks rows into a `useLiveQuery`. Any new table you add MUST be
included in the purge transaction. The same applies to any new
per-user metadata key in `syncMeta`.

### S10. Use `useDraftField` for editable inputs. Don't reinvent.

[src/client/hooks/useDraftField.ts](src/client/hooks/useDraftField.ts)
is the canonical draft-on-blur pattern. It implements interaction
rules 1 and 2 (queue same-field commits, sync per-field from the
server only when clean, fire toast + flash on rollback, subscribe to
the flash bus). New editable inputs reuse it — do not write a second
draft pattern, and do not bypass it for "just this one place." If
the hook is missing a feature you need, extend it; do not fork.

### S11. Tests for any new sync surface.

A new outbox path, entity class, or draft input MUST have tests for:

- success (op applies, indicator returns to `synced`),
- server rejection (Dexie reverts, toast persisted, flash fired),
- a slow same-field follow-up (queues and fires after the first
  settles, with the user's later value winning),
- a slow different-field follow-up (lands without being clobbered
  when the first save returns),
- and for cursor-pull paths: a server row with a stale field for
  which the client has a pending outbox op (local value MUST be
  preserved).

The `useDraftField`, `outbox`, and orchestrator test files are the
working references.

## History tracking is a required baseline for all new entities

Every new syncable entity class MUST participate in the history/audit log.
Adding a class without it silently loses history forever; retroactive backfills
are impractical. Follow this checklist in addition to S6:

### H1. DB trigger (server)
Add `AFTER INSERT OR UPDATE OR DELETE` trigger `record_history_trg` on the new
table in its migration, using the trigger function family from
`src/server/db/migrations/0013_entity_history.sql`:
- character-family tables → `record_character_child_history('<entity_class>')`
- campaign-family tables → `record_campaign_history('<entity_class>')`
- the root `characters`/`campaigns` tables use their own dedicated wrappers.

### H2. SYNCABLE_TABLES entry (shared)
Add `{ table: '<postgres_table_name>', family: 'character' | 'campaign' }`
to `SYNCABLE_TABLES` in `src/shared/schemas/history.ts`. Guard-1 CI test
(`src/server/db/historyTriggers.test.ts`) will fail until you do.

### H3. summarizeEvent case (shared)
Add a case to the `switch (entityClass)` in `summarizeEvent()` in
`src/shared/history/summarize.ts` so the history panel shows a human-readable
one-liner instead of a raw JSON blob. Add tests to
`src/shared/history/summarize.test.ts`.

### H4. withAudit on write paths (server)
All DB writes for the new entity (both through `/sync/operations` and any REST
routes) MUST run inside `withAudit(actorId, batchId, async (tx) => { ... })`
from `src/server/db/auditContext.ts`. Guard-2 source test
(`src/server/db/auditContext.test.ts`) fails if bare `getDb().insert/update/delete`
calls appear in mutating route files. Campaign-family REST routes that start a new
file must be added to the `MUTATING_ROUTE_FILES` list in the guard test.

### H5. batchId threading (client, if applicable)
For user gestures that enqueue multiple ops at once (bulk moves, "revert all"),
generate a single `newBatchId()` from `src/client/sync/outbox.ts` and pass it
to every `enqueueFieldPatch` / `enqueueCreate` / `enqueueDelete` in that
gesture so the history panel can fold them under one expandable group.

### Design spec
Full rationale and file index: `docs/specs/history-tracking.md`.
REST endpoints: `GET /api/v1/characters/:id/history`, `GET /api/v1/campaigns/:id/history`.

## Dev environment

- Bun is run inside Docker (see `docker-compose.dev.yml`). There is no
  host-level `bun` requirement.
- Bring up local Postgres + dev server: `docker compose -f docker-compose.dev.yml up`.
- Open `http://localhost:3000`.
- Frontend HMR runs through the same Bun process via Vite middleware.

## Database backend

- **Postgres 18 only.** Do not introduce any other backend. SQLite
  is explicitly out of scope and adding it will be reverted.
- IDs come from `uuidv7()` server-default. Never generate UUIDs
  application-side in the write path; use `RETURNING id`.
- Migrations are managed by Drizzle Kit and live under
  `src/server/db/migrations/`. Write idempotent migrations.
