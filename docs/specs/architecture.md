# Design Spec: Technical Architecture

Describes the current technical architecture of GURPS Player Companion. For
the product surface see [overview.md](overview.md); for the two key subsystems
see [offline-sync.md](offline-sync.md) and
[campaign-content-sharing.md](campaign-content-sharing.md). Invariants you must
not break live in [`AGENTS.md`](../../AGENTS.md).

## Process & deployment model

**One process, one origin.** A single Bun process (`src/server/index.ts`)
serves everything:

- the HTTP JSON API under `/api/v1/*`,
- the WebSocket push channel at `/api/v1/sync/ws`,
- the OpenAPI document at `/api/v1/openapi.json` (non-production only),
- and, in production, the built React client + SPA fallback (`static.ts`).

Do **not** split this into separate API/web services (`AGENTS.md` — "One
process"). `createApp()` in `src/server/app.ts` composes it: CORS (if
configured) → the per-resource sub-routers mounted under `/api/v1` → the WS
handler (registered *before* `syncRouter` so its `requireActiveUser` guard
doesn't reject the token-in-query handshake) → OpenAPI doc → error handler →
static/SPA fallback (last, so it never shadows `/api/*`).

Deployment is Docker Compose (`docker-compose.yml` for prod; `.dev.yml` for
dev; unraid variants included). Three services: `db` (Postgres 18), a one-shot
`migrate`, and `app`. `app` waits for `migrate` to exit 0. In dev, Vite (via
`@hono/vite-dev-server`) owns the SPA and HMR; the same Bun process serves the
Hono API on the same port — see `dev-entry.ts` and `vite.config.ts`.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun (≥ 1.1) |
| HTTP framework | Hono + `@hono/zod-openapi` |
| Validation | Zod — shared across server, client, and service worker |
| Database | PostgreSQL 18 + Drizzle ORM |
| Client | React 19, React Router 7, TanStack Query 5 |
| Local store | Dexie 6 (IndexedDB) |
| PWA | vite-plugin-pwa + Workbox |
| Styling | Tailwind 4 + DaisyUI 5 ("Arcane" theme) |
| Auth | JWT (`jose`) + refresh tokens; WebAuthn passkeys; API keys |
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
  - `history/summarize.ts` — shared history one-liner formatter.
- **`src/server/`** — the Bun process (routes, auth, Drizzle, services, DB,
  OpenAPI).
- **`src/client/`** — the React PWA (`features/`, `sync/`, `db/`, `hooks/`,
  `components/`), plus a separate `admin/` SPA entry.
- **`src/sw/`** — service worker registration only: app-shell precache + a few
  read-only GET caches (library, `/auth/me`) so a fresh device has a fallback
  when Dexie is empty. It **never** caches mutations or replays sync ops —
  outbox replay is page-orchestrator territory (`src/sw/registerSW.ts`).

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
   headers.
3. **Authorization.** Centralized helpers in `auth/permissions.ts`
   (`loadCampaignOr403`, `requireCampaignOwner/Admin/Member`,
   `loadCharacterOr403`, `assertWrite`, `requireSuperuser`) are the single
   source of permission truth — handlers call these rather than re-checking
   inline.
4. **Write path + audit.** All DB writes run inside
   `withAudit(actorId, batchId, fn)` (`db/auditContext.ts`), which opens a
   transaction and sets transaction-local `app.actor_id` / `app.batch_id` GUCs
   so DB triggers can attribute the change. Character writes funnel through the
   single chokepoint `dispatchOperation()` in `services/syncDispatch.ts`;
   campaign writes go through their REST routes. Both wrap in `withAudit`.
5. **Response / propagation.** Sync writes emit WebSocket `sync_invalidate`
   nudges via `services/wsBus.ts` so other viewers pull sooner.

## Data model (Postgres 18)

**Postgres 18 only** — no SQLite, no other backend (`AGENTS.md` — "Postgres 18
only"). IDs are `uuidv7()` server-defaults; never generate UUIDs in the write
path except the deliberate speculative-create case (see offline-sync.md S7).
Schema is Drizzle (`src/server/db/schema.ts`). Migrations under
`src/server/db/migrations/` are **mixed**: drizzle-kit generates the plain
schema migrations (`db:generate`), while the trigger/sequence migrations
(`0002`, `0003`, `0004`, `0013`) are **hand-written SQL** — trigger logic is
not auto-generated by drizzle-kit.

Tables (grouped):

- **Identity/auth**: `users`, `passkey_credentials`, `passkey_challenges`,
  `refresh_tokens`, `password_reset_tokens`, `api_keys`.
- **Campaigns**: `campaigns`, `campaign_memberships`, `campaign_invitations`,
  `notifications`.
- **Characters (sync-backed)**: `characters`, `character_traits`,
  `character_skills`, `inventory_items` (self-FK for nesting),
  `character_spells`, `combat_states` (1:1 by `character_id`).
- **Campaign content**: `adventure_log_entries`, `campaign_library_traits`,
  `campaign_library_skills`, `campaign_library_spells`,
  `campaign_library_items`, plus online-only live-session `encounters`,
  `encounter_combatants`, and `encounter_effects`.
- **Sync/audit infra**: `entity_tombstones` (deletes for cursor backfill),
  `entity_history` (append-only audit log).

Key PG18 / trigger machinery, layered by migration:

- `bump_revision()` BEFORE-UPDATE trigger + a **shared `revisions_seq`**
  (migrations `0002`/`0004`) — gives every syncable row a globally-ordered
  `revision` so the cursor pull paginates cleanly across classes.
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
  API. Default query options: `staleTime: 30s`, no refetch-on-focus, one retry.
- **Encounters** use query keys scoped by campaign/encounter. The existing WS
  subscriber dispatches `encounter_invalidate` frames to that query cache; the
   frame contains no combat data. A Dexie v6 `soloEncounters` store, keyed by
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
