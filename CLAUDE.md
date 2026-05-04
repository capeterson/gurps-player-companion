This file's content lives in [AGENTS.md](AGENTS.md). The two are kept in
sync deliberately so any harness (Claude Code, Codex, Cursor, …) sees the
same rules. Edit AGENTS.md and copy the contents here.

# GURPS Player Companion — agent notes

Compact, durable rules for anyone (human or agent) editing this repo. Keep
it short; add a section only when a rule has been broken at least once.

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
