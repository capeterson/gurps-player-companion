# GURPS Player Companion

A local-first Progressive Web App for managing GURPS 4e player characters,
campaigns, and shared libraries. Single Bun process serves the HTTP API,
WebSocket push channel, OpenAPI doc, and the React PWA client.

> Status: **early development** — see [AGENTS.md](AGENTS.md) for
> architecture invariants and contribution rules.

## Features (target)

See [AGENTS.md](AGENTS.md) for the architecture invariants and the
no-lost-edits rules.

- Local-first IndexedDB store; works indefinitely offline.
- Durable edit outbox with explicit conflict / suspend / stale-base
  reconciliation.
- WebSocket push for live updates; HTTP cursor backfill on reconnect.
- Per-campaign trait/skill/item library with versioned YAML import/export.
- Character sheet with derived stats, point ledger, encumbrance,
  combat tracker, traits/skills/inventory tabs.
- Adventure log with per-entry visibility (campaign/private).

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun |
| HTTP | Hono + `@hono/zod-openapi` |
| Validation | Zod (shared between server, client, service worker) |
| DB | PostgreSQL 18 + Drizzle ORM |
| Client | React 19, React Router 7, TanStack Query 5 |
| Local store | Dexie 4 (IndexedDB) |
| PWA | vite-plugin-pwa + Workbox |
| Styling | Tailwind 4 + DaisyUI 5 (Arcane theme) |
| Tests | Vitest + bun:test + Playwright |
| Lint/format | Biome |
| Container | Docker + docker-compose |

## Quick start (dev)

Bun, Postgres, and the dev server all run in Docker — nothing is
required on the host except Docker itself.

```sh
docker compose -f docker-compose.dev.yml up --build
```

This starts three services:

| Service  | Port | What it does                                              |
|----------|------|-----------------------------------------------------------|
| `db`     | 5432 | Postgres 18 with a persistent `db_data_dev` volume.       |
| `migrate`| —    | One-shot: `bun install` + `bun run db:migrate`, then exits. |
| `app`    | 3000 | Vite dev server (with HMR) hosting the Hono API via `@hono/vite-dev-server`. Single port, single process. |

Open **<http://localhost:3000>** for the UI; the API is on the same
origin at `/api/v1/...` (e.g.
[`/api/v1/healthz`](http://localhost:3000/api/v1/healthz)).

The `migrate` service populates a shared `bun_modules` volume on first
boot — subsequent `up` runs reuse it and skip the install.

## Common operations

Seed the "Sample" campaign and bootstrap library (idempotent):

```sh
docker compose -f docker-compose.dev.yml run --rm migrate bun run db:seed
```

Tail logs from a single service:

```sh
docker compose -f docker-compose.dev.yml logs -f app
```

Open a `psql` shell against the dev database:

```sh
docker compose -f docker-compose.dev.yml exec db psql -U gurps gurps
```

Stop everything but keep data:

```sh
docker compose -f docker-compose.dev.yml down
```

Stop and **wipe** the dev database (the `-v` flag deletes the
`db_data_dev` volume):

```sh
docker compose -f docker-compose.dev.yml down -v
```

## Production build

Generate a JWT signing key (≥ 32 chars) and put it in `.env`:

```sh
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

Build the runtime image and start the stack:

```sh
docker compose up --build -d
```

The prod compose runs three services: `db`, a one-shot `migrate` that
applies migrations baked into the image, and `app`. The `app` service
will not start until `migrate` exits 0. The Bun runtime serves the
built React client and the API on the same port.

Open <http://localhost:3000>. Verify health:

```sh
curl -fsS http://localhost:3000/api/v1/healthz
# => {"ok":true}
```

## Layout

```
src/
  server/      Bun process: Hono routes, auth, Drizzle, OpenAPI, WS
  client/      React PWA
  shared/      Pure TypeScript: Zod schemas, GURPS math, YAML codec
  sw/          Service worker registration (app-shell precache; NOT replay)
docs/
  specs/       Design specs (start at docs/specs/overview.md): product
               surface, architecture, offline sync, campaign sharing, history
  openapi.json Emitted OpenAPI contract (CI-checked)
bootstrap/
  sample_library.yaml    seeded into the "Sample" campaign
```

## Offline sync

Character data is **local-first**: reads render from IndexedDB
(Dexie) and writes commit to IndexedDB before anything leaves the
browser. Online mode adds active sync and WebSocket nudges on top of
the same data path; going offline simply pauses sync.

**Scope.** As of this writing the offline-sync system covers
characters and their child rows — `character`, `character_trait`,
`character_skill`, `character_inventory`, and `character_combat`. The
rest of the app (campaign settings, the campaign trait/skill/item
library, adventure log entries, invitations, notifications, admin)
still talks to the HTTP API directly via React Query and does not
work offline. New surfaces are migrated onto the outbox class by
class; until that work lands for a given surface, treat it as
online-only. The tenets below describe the system as it applies to
the sync-backed classes.

### Tenets

1. **The local store is the UI's source of truth.** React reads from
   Dexie via `useLiveQuery`. The server is a durable mirror, not the
   render path. A user with a stale browser tab and no network can
   keep editing indefinitely.
2. **No edit is silently dropped.** Each mutation is journaled into a
   durable outbox row in the same Dexie transaction as the local
   write — it is either fully applied locally *and* queued for
   replay, or neither. See [AGENTS.md](AGENTS.md) interaction rule 1
   and [src/client/hooks/useDraftField.ts](src/client/hooks/useDraftField.ts).
3. **Per-field coalescing, latest wins.** While a save is in flight
   for field `X`, additional commits to `X` queue (latest value wins);
   commits to other fields proceed in parallel. Pending outbox rows
   for the same `(entityId, fieldPath)` are replaced rather than
   stacked.
4. **A rollback is a visible UX event.** When the server rejects an
   op (validation, conflict, stale base, unauthorized), the
   orchestrator reverts the local row, emits a persistent toast that
   names the field and the reason, and fires a flash event so the
   input pulses. Toast + flash are both required.
5. **Server pulls never clobber local intent.** `/sync/cursor`
   responses are merged into Dexie, but any field with a `pending`
   or `in_flight` outbox row for the same `(entityId, fieldPath)` is
   skipped — the local value wins until the server formally rejects
   it.
6. **WebSockets are acceleration, not correctness.** The HTTP cursor
   pull plus the outbox replay is the source of truth. WS frames
   carry no row data; they only invalidate so the client pulls
   sooner. A client that loses WS forever still converges via the
   periodic pull.
7. **Bootstrap before UI.** A fresh login pulls the full snapshot
   into Dexie before the app renders, so the first paint already
   reflects the user's data. A `bootstrap:<userId>` flag in
   `syncMeta` short-circuits this on subsequent loads.
8. **Logout purges.** Switching accounts wipes every Dexie table so
   a previous user's rows can't leak into a `useLiveQuery`.

### Flow

```
  ┌──────────┐   write     ┌────────────┐   drain    ┌──────────────┐
  │  React   │────────────▶│   Dexie    │──────────▶│ /sync/       │
  │  + Zod   │   (1 txn:   │  (stores + │           │  operations  │
  │          │   row + op) │   outbox)  │◀──────────│              │
  └──────────┘             └────────────┘   pull    └──────┬───────┘
       ▲                          ▲     /sync/cursor       │
       │ useLiveQuery             │                        │
       │                          └────────────────────────┘
       │                            WS sync_invalidate
       │                                     │
       └─────────────────────── flashBus ◀───┘
                  (rollback toast + flash)
```

- **Mutation handlers** call `enqueueFieldPatch`, `enqueueCreate`, or
  `enqueueDelete` from [src/client/sync/outbox.ts](src/client/sync/outbox.ts).
  They never `fetch` directly. The enqueue writes the local row and
  the outbox entry in one Dexie transaction.
- **The orchestrator** ([src/client/sync/orchestrator.ts](src/client/sync/orchestrator.ts))
  is a long-lived singleton. It drains the outbox into
  `POST /sync/operations`, pulls fresh state via
  `POST /sync/cursor`, applies outcomes (stamping the new revision
  on success, rolling back on rejection), and emits sync state to
  the indicator. A `navigator.locks` lease serializes the drain
  across tabs.
- **The server** treats each op in a batch independently — one bad
  op never poisons the rest. HTTP status is always 200; per-op
  outcomes (`applied` / `rejected` / `conflict` / `unauthorized` /
  `suspended` / `stale_base` / `transient`) live in
  `outcomes[].status`. Optimistic concurrency is enforced via
  `baseRevision`; a mismatch returns `stale_base` plus the latest
  entity so the client can reconcile.
- **The protocol** ([src/shared/schemas/sync.ts](src/shared/schemas/sync.ts))
  is a closed set of entity classes plus three operation commands
  (`create`, `patch`, `delete`). Both sides validate every envelope
  with the same Zod schemas.

### Failure modes

| Outcome          | Local effect                                                   |
|------------------|----------------------------------------------------------------|
| `applied`        | Stamp `newRevision` onto the row, drop the outbox op.          |
| `rejected`       | Revert the field/row, persistent toast + input flash.          |
| `unauthorized`   | Same as rejected; toast names the permission failure.          |
| `conflict`       | Server returns `latestEntity`; client adopts it, then flashes. |
| `stale_base`     | Same as conflict — `baseRevision` was behind the server.       |
| `transient`      | Backoff with jitter, retry up to `MAX_ATTEMPTS` (8).           |
| `suspended`      | Permanent fail; toast surfaces the reason.                     |
| network error    | Whole batch reverts to `transient_retry`; loop retries.        |
