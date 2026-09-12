# Design Spec: Technical Architecture

Describes the current technical architecture of GURPS Player Companion. For
the product surface see [overview.md](overview.md); for the two key subsystems
see [offline-sync.md](offline-sync.md) and
[campaign-content-sharing.md](campaign-content-sharing.md). Invariants you must
not break live in [`AGENTS.md`](../../AGENTS.md).

## Process & deployment model

**One process, one origin.** A single Bun process (`src/server/index.ts`,
whose `startServer` factory is also used by real HTTP/WebSocket tests)
serves everything:

- the HTTP JSON API under `/api/v1/*`,
- OAuth metadata, authorization, token, and revocation under `/.well-known/*`
  and `/oauth/*`,
- MCP 2025-11-25 Streamable HTTP at `/mcp`,
- the WebSocket push channel at `/api/v1/sync/ws`,
- the OpenAPI document at `/api/v1/openapi.json` (non-production only),
- and, in production, the built React client + SPA fallback (`static.ts`).

Do **not** split this into separate API/web services (`AGENTS.md` — "One
process"). `createApp()` in `src/server/app.ts` composes it: CORS (if
configured) → OAuth and the per-resource sub-routers → the WS
handler (registered *before* `syncRouter` so its `requireActiveUser` guard
doesn't reject the token-in-query handshake) → raw bounded MCP transport →
OpenAPI doc → error handler →
static/SPA fallback (last, so it never shadows `/api/*`).

Deployment is Docker Compose (`docker-compose.yml` for prod; `.dev.yml` for
dev; unraid variants included). Three services: `db` (Postgres 18), a one-shot
`migrate`, and `app`. `app` waits for `migrate` to exit 0. In dev, Vite (via
`@hono/vite-dev-server`) owns the SPA and HMR; the same Bun process serves the
Hono API on the same port — see `dev-entry.ts` and `vite.config.ts`.

## MCP and delegated authorization

[MCP agent access](mcp-agent-access.md) defines the `/mcp` Streamable HTTP
adapter and OAuth authorization server in this same Bun process. The SDK's
web-standard stateless transport negotiates MCP 2025-11-25. An in-process
executor sends a Request through the same OpenAPI handler graph; a private
object-identity capability supplies the trusted OAuth actor, so no token is
forwarded and external requests cannot inject one. App JWTs/API keys remain
distinct from audience-bound, scoped, revocable OAuth credentials.

Authorization-server discovery advertises Client ID Metadata Documents and a
Dynamic Client Registration endpoint. CIMD metadata retrieval pins a public DNS
address for an HTTPS-only, no-redirect, size/time-bounded request; DCR creates
public clients only and issues no secret. Operator-defined `OAUTH_CLIENTS` are an
optional compatibility path and do not disable self-registered clients.

Migration 0042 stores clients, grants, one-time codes, hashed access/refresh
tokens, and mutation idempotency outcomes. The outer idempotency transaction
and nested `withAudit` savepoints commit writes, cached outcomes, history, and
post-commit effects together. Audit context includes actor, OAuth client, and
grant. `docs/mcp-tools.json` and `mcp:check` guard exact route coverage and live
tool schema/catalog drift.
Migration 0044 records whether a client is operator-configured, CIMD-resolved,
or dynamically registered and stores CIMD cache expiry.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun (≥ 1.1) |
| HTTP framework | Hono + `@hono/zod-openapi` |
| Validation | Zod — shared across server, client, and service worker |
| Database | PostgreSQL 18 + Drizzle ORM |
| Client | React 19, React Router 7, TanStack Query 5 |
| Local store | Dexie 4 package (IndexedDB), application schema version 10 |
| PWA | vite-plugin-pwa + Workbox |
| Styling | Tailwind 4 + DaisyUI 5 ("Arcane" theme) |
| Auth | JWT (`jose`) + refresh tokens; WebAuthn passkeys verified by `@simplewebauthn/server`; API keys |
| Email | Resend |
| Tests | `bun:test` (server/shared), Vitest (client), Playwright (e2e) |
| Lint/format | Biome |
| Build/bundler | Vite 6 (client + admin entries), `bun build` (server) |

## The three-layer source tree

The hard boundary is **`src/shared/` must be environment-agnostic pure TS** —
it runs in Bun, the browser, *and* the service worker. No DOM, no Bun globals,
no DB clients, no env access (`AGENTS.md` — "Shared validation is pure TS").
This is what lets the same Zod schema validate a request on the server and an
optimistic write in the client with a single definition. (Outbox replay itself
lives in the **page** orchestrator, not the service worker — see below.)

- **`src/shared/`** — the contract and the rules engine:
  - `schemas/` — Zod schemas = the wire contract. `sync.ts` is the sync
    protocol (entity classes, operation commands, outcome statuses).
  - `domain/` — pure GURPS math: `characterCalc` (derived stats),
    `skillCalc`, `spellCalc`, `traitCost`, `modifierMath`, `encumbrance`,
    `poolBump`, `warnings`, `attributeTooltips`. All unit-tested in isolation.
  - `constants/` — GURPS reference data (attributes, skills, traits, combat,
    hit locations, magic).
  - `yaml/library.ts` — the round-trippable campaign-library YAML codec.
  - `domain/traitEffects.ts` — the pure shared resolver for global, skill, and
    deterministic item-aware weapon effects. Server and Dexie-built character
    details use this same path and annotate weapon selectors with zero/one/multiple
    equipped-row matches for UI diagnostics. It merges immutable owned library
    declarations with the character trait's user-authored `customEffects`.
  - `history/summarize.ts` — shared history one-liner formatter.
- **`src/server/`** — the Bun process (routes, auth, Drizzle, services, DB,
  OpenAPI).
- **`src/client/`** — the React PWA (`features/`, `sync/`, `db/`, `hooks/`,
  `components/`), plus a separate `admin/` SPA entry.
- **`src/sw/`** — service worker registration and app-shell precache. Authenticated
  API responses are not cached by URL. Mechanical declarations needed offline
  arrive with character cursor rows and persist in Dexie. It never caches mutations or replays sync ops —
  outbox replay is page-orchestrator territory (`src/sw/registerSW.ts`).
  It also owns **update discovery** — see below.

### Stale-build discovery

`registerType: 'autoUpdate'` only means a newly installed worker skips waiting;
it does **not** reload the page, and the browser only looks for a new worker on
a navigation. This app is a SPA whose router never navigates, so a tab left
open for days would keep running the JS it booted with — against freshly
precached assets — and never say so.

`registerSwLifecycle()` therefore polls `registration.update()` every
`SW_UPDATE_POLL_MS` (1h) and on focus / visibility / `online`, throttled to one
check per 5 minutes. It resolves its registration via `getRegistration()` and
falls back to `navigator.serviceWorker.ready`: on a **first visit** there is no
registration when this module runs (vite-plugin-pwa registers the worker on the
window `load` event), so keying off `getRegistration()` alone would leave that
tab with no timer and no listeners for the rest of its life. `ready` simply
stays pending when the app runs without a service worker (dev), which is the
correct no-op. When a new worker reaches `installed` **and the page is
already controlled** (so a first-ever install isn't mistaken for an update), or
when a worker installed by another tab is found parked in `registration.waiting`
at startup, or when one is found **already installing** at startup (a
navigation-triggered update can begin before the async registration lookup
resolves, firing `updatefound` with no listener attached and leaving `waiting`
still null — once autoUpdate activates it, no later `update()` call can recreate
the lost event), it dispatches `gpc:sw-update-ready` with a `reload()` callback
and latches it in `getPendingSwUpdate()` — the latch matters because
`registerSwLifecycle()` runs at module load in `main.tsx`, before React mounts.

`SwUpdatePrompt` (mounted inside `<ToastProvider>`, outside the router so it
survives navigation) turns that into a **persistent toast with a Reload
action**. The reload is always the user's call: never automatic, since swapping
the running bundle mid-edit is worse than being one build behind.

Dismissing the prompt calls `dismissPendingSwUpdate()`, which drops the
outstanding announcement so polling resumes — `checkForUpdate` short-circuits
while one is pending, so without this a single dismissal would latch the tab
closed against every future release. The *announced worker* is remembered
separately, so polling won't re-nag about the same build while a genuinely
newer one still gets through.

## Request lifecycle

1. **Routing/validation.** Every route is declared with `createRoute` from
   `@hono/zod-openapi` (`AGENTS.md` — "OpenAPI is the contract"). Request params
   and bodies are validated by Zod before the handler runs; the same schemas are
   reused client-side. CI (`openapi:check`) fails on drift between the live
   routes and `docs/openapi.json`, so the emitted contract can't silently rot.
2. **Auth middleware.** `requireActiveUser` (`auth/middleware.ts`) resolves a
   bearer token — either a JWT access token or a `gpc_`-prefixed API key — into
   `c.get('user')`, and rejects suspended users. The WS channel authenticates
   via `?token=` query string because the browser WebSocket API can't set
   headers. `/mcp` resolves a scoped, audience-bound OAuth access token and
   supplies the same actor through a private Request identity capability.
3. **Authorization.** Centralized helpers in `auth/permissions.ts`
   (`loadCampaignOr403`, `requireCampaignOwner/Admin/Member`,
   `loadCharacterOr403`, `assertWrite`, `requireSuperuser`) are the single
   source of permission truth — handlers call these rather than re-checking
   inline.
4. **Write path + audit.** All DB writes run inside
   `withAudit(actorId, batchId, fn)` (`db/auditContext.ts`), which opens a
   transaction and sets transaction-local `app.actor_id` / `app.batch_id` GUCs
   so DB triggers can attribute the change. Sync writes use `dispatchOperation()` in `services/syncDispatch.ts`;
   character and campaign REST routes also write using shared services and
   their own handlers. Both paths wrap in `withAudit`.
   Delegated mutations add a durable idempotency reservation and response in
   the same outer transaction and set OAuth client/grant audit provenance.
5. **Response / propagation.** Shared mutation middleware takes pre/post access
   snapshots and emits post-commit WebSocket `sync_invalidate` nudges for REST
   and delegated writes so every affected viewer pulls sooner.

## Data model (Postgres 18)

**Postgres 18 only** — no SQLite, no other backend (`AGENTS.md` — "Postgres 18
only"). IDs are `uuidv7()` server-defaults; never generate UUIDs in the write
path except the deliberate speculative-create case (see offline-sync.md S7).
Schema is Drizzle (`src/server/db/schema.ts`). Migrations under
`src/server/db/migrations/` are **mixed**: drizzle-kit generates the plain
schema migrations (`db:generate`), while the trigger/sequence migrations
(`0002`, `0003`, `0004`, `0013`) are **hand-written SQL** — trigger logic is
not auto-generated by drizzle-kit. Every later migration that adds a syncable
table repeats that trigger set by hand (`bump_revision_trg`,
`record_tombstone_trg` for character-family children, `record_history_trg`);
see `0026_languages.sql` for the current template.

Tables (grouped):

- **Identity/auth**: `users`, `passkey_credentials`, `passkey_challenges`,
  `refresh_tokens`, `password_reset_tokens`, `api_keys`, and durable
  `auth_rate_limits` counters. Public login, registration, password-reset, and
  passkey-login challenge requests consume bounded source and normalized-account
  buckets before expensive hashing, email, or challenge work. Source checks
  run first; a blocked source never allocates or consumes account buckets.
  The counters are shared through Postgres, reset after their fixed window,
  and expired rows are deleted during subsequent limiter requests. Throttling
  returns JSON `429` with a `Retry-After` header. Source addresses come from
  Bun's server binding or Vite's incoming socket, with an `unknown` bucket
  when no peer is available; client-supplied `X-Gpc-Client-Ip` is ignored.
  `TRUST_PROXY` must be set only behind a proxy that overwrites
  `X-Forwarded-For`; missing forwarding headers fall back to the socket peer.
  The Bun fetch handler preserves its original Request and server binding so
  WebSocket upgrades continue to work.
  Access and refresh JWTs also carry the user's server-checked authentication
  version. Password changes and recovery increment it to reject every older
  JWT. Refresh rotation preserves the original primary-authentication time;
  passkey and API-key creation require that time to be no more than ten minutes
  old. Recovery revokes API keys and removes passkeys, leaving the new password
  as the account's sole credential. Refresh rows form token families. Rotation
  consumes the parent and inserts one descendant atomically; the same client
  request id can recover a lost response for 30 seconds, while conflicting or
  late reuse revokes every still-active token in the family.
- **Campaigns**: `campaigns`, `campaign_memberships`, `campaign_invitations`,
  `notifications`.
- **Characters (sync-backed)**: `characters`, `character_traits`,
  `character_skills`, `inventory_items` (self-FK for nesting),
  `character_spells`, `character_languages`, `character_techniques`,
  `combat_states` (1:1 by `character_id`).
- **Campaign content**: `adventure_log_entries`, `campaign_library_traits`,
  `campaign_library_skills`, `campaign_library_spells`,
  `campaign_library_items`, `campaign_library_languages`,
  `campaign_library_techniques`, `campaign_library_styles`, plus
  online-only live-session `encounters`, `encounter_combatants`, and
  `encounter_effects`.
- **Sync/audit infra**: `entity_tombstones` (deletes for cursor backfill),
  `entity_history` (append-only audit log).

Key PG18 / trigger machinery, layered by migration:

- `bump_revision()` BEFORE-UPDATE trigger + a **shared `revisions_seq`**
  (migrations `0002`/`0004`) — gives every syncable row a global revision.
  Migration `0040` routes live-row defaults, updates, tombstones, and history
  through `next_sync_revision()`, which takes one transaction-scoped advisory
  lock before allocating. Transactions therefore become visible in revision
  order and a cursor cannot advance past an older uncommitted write.
- `record_*_tombstone()` AFTER-DELETE triggers (`0003`/`0004`) — deletes leave
  tombstones so `/sync/cursor` can tell a client to drop a row it no longer has
  access to.
- `record_history()` AFTER INSERT/UPDATE/DELETE triggers (`0013`) — the audit
  log; see [history-tracking.md](history-tracking.md).

## Client architecture

- **Router** (`src/client/main.tsx`): public auth routes + an authenticated
  shell (`RequireAuth` → `App`) wrapping the feature routes. TanStack Query
  provider + a `ToastProvider` wrap the tree.
- **Local-first data layer**: the UI reads from Dexie via `useLiveQuery` and
  writes through the outbox; the sync orchestrator is a long-lived singleton.
  This is the heart of the app — see [offline-sync.md](offline-sync.md).
- **Online-only surfaces** (campaign library, adventure log, invitations,
  notifications, settings, admin, and campaign encounters) use TanStack Query directly against the HTTP
  API. Query hashes include the current token-session id. Both the PWA and admin
  entry mount `SessionQueryCacheBoundary`, which cancels and clears all query and
  mutation state whenever login identity changes locally or in another tab.
  Authenticated HTTP responses are also session-fenced before parsing, so a late
  old-account response cannot repopulate the new session's cache. Default query
  options: `staleTime: 30s`, no refetch-on-focus, one retry.
- **Encounters** use query keys scoped by campaign/encounter. The existing WS
  subscriber dispatches `encounter_invalidate` frames to that query cache; the
   frame contains no combat data. The `soloEncounters` store (introduced in
   application schema version 6, currently schema version 10), keyed by
   `characterId`, is explicitly device-only and is included in the logout purge.
- **Draft inputs**: `useDraftField.ts` is the canonical draft-on-blur hook (do
  not fork it). It queues same-field edits, per-field syncs from the server only
  when clean, and fires toast+flash on rollback.
- **Admin** is a **separate Vite entry** (`src/client/admin/`) so admin code
  never ships in the player bundle (`AGENTS.md` — "No instance admin in the
  PWA"). Header links to `/admin/*` are hard `<a>` anchors, not SPA `Link`s, to
  cross the bundle boundary.

## Testing & CI

- `bun test src/server src/shared` — server + shared unit/integration
  (`sync.test.ts`, `syncDispatch.test.ts`, `historyTriggers.test.ts`, and the
  domain math suites). Server tests hit a real Postgres. Live-Postgres suites
  share `src/server/testConfig.ts`: they use `DATABASE_URL` when provided
  (Compose app container: `db:5432`) and otherwise default to the CI/host URL
  at `localhost:5432`.
- `vitest run` — client component/hook tests (happy-dom DOM environment;
  `fake-indexeddb` for Dexie).
- `playwright test` — end-to-end.
- `npm run check` = `lint` (Biome) + `typecheck` (`tsc --build`) + `bun test`
  (**server + shared only**) + `openapi:check` (contract drift). It does **not**
  run the client vitest or Playwright suites — run those separately for client
  changes. This is the baseline gate before finishing a change.
- **Guard tests** enforce the extension invariants: `historyTriggers.test.ts`
  (every syncable table has a history trigger), `auditContext.test.ts` (no bare
  `getDb().insert/update/delete` in mutating route files). A forgotten step in
  the sync/history checklists fails CI.

## Configuration

- `src/server/config.ts` reads env (JWT secret ≥ 32 chars, DB URL, CORS
  origins, Resend key, environment). `.env.example` documents the surface.
- Seed: `bun run db:seed` (`src/server/db/seed.ts`) creates the idempotent
  "Sample" campaign and imports `bootstrap/sample_library.yaml`.
