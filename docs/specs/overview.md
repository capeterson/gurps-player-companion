# Design Spec: Application Overview & Orientation

> **Read this first.** This is the entry point for the design-spec set. It
> describes the current state of GURPS Player Companion — what it does for
> users, how the code is laid out, and where to go for the deep dives. It is
> written so a fresh session (human or LLM) can get oriented **without**
> scanning the whole tree first.

## What this is

GURPS Player Companion is a **local-first Progressive Web App** for running
GURPS 4e player characters, campaigns, and shared campaign content. It is a
single Bun process that serves the HTTP API, a WebSocket push channel, the
OpenAPI document, and the React PWA client — all on one origin, one port.

The defining product promise is **edits never disappear**. Every character
mutation is written to IndexedDB and journaled to a durable outbox *before*
anything touches the network, so a player can keep editing a stale tab with no
connectivity indefinitely and converge later. See
[offline-sync.md](offline-sync.md).

## Document map

| Doc | Covers |
|---|---|
| **overview.md** (this file) | Product surface, feature catalog, codebase map, orientation notes. |
| [architecture.md](architecture.md) | Stack, process model, request lifecycle, data model, auth, testing, deploy. |
| [offline-sync.md](offline-sync.md) | The local-first / outbox / cursor / WebSocket system in depth. |
| [campaign-content-sharing.md](campaign-content-sharing.md) | Campaigns, roles, invitations, the share gate / minimal view, and the YAML library. |
| [history-tracking.md](history-tracking.md) | The append-only audit-log subsystem (character + campaign history). |

The **rules of engagement** (invariants you must not break, and the multi-site
checklists for extending sync/history) live in
[`AGENTS.md`](../../AGENTS.md), not here. These specs describe *what exists*;
`AGENTS.md` prescribes *what you must keep true*. Keep the two in sync — see
"Maintaining these docs" below.

---

## User-facing features

### Accounts & authentication
- Email/password registration and login (`/register`, `/login`).
- **Passkeys / WebAuthn** as an optional second credential — register, list,
  and sign in with a passkey (`/auth/passkeys/*`).
- **Password reset** by emailed token (`/forgot-password` → `/reset-password`).
- **API keys** for programmatic access, created and revoked from Settings.
- JWT access tokens + rotating refresh tokens; logout revokes the refresh token
  server-side.
- **Account suspension**: a suspended user is bounced to `/suspended`; admins
  can suspend / unsuspend / schedule purge.

### Character sheet (the core surface)
Route `/characters/:id`. Tabbed sheet
(`src/client/features/characters/CharacterSheetPage.tsx`), tabs:
**Combat, Identity, Traits, Skills, Magic, Inventory, Notes, History**
(on a read-only view of a non-magical character the Magic tab is hidden;
on any sheet the viewer can edit — their own — it always shows).

- **Attributes & derived stats.** ST/DX/IQ/HT drive HP, FP, Will, Per, Basic
  Speed, Basic Move, Dodge, etc. All GURPS math is pure and shared
  (`src/shared/domain/`).
- **Point ledger.** Live point totals vs the campaign point target, with
  disadvantage / quirk cap warnings.
- **Temporary stat boosts.** Transient DX+2-style bumps with a "revert all"
  gesture, tracked distinctly from permanent edits.
- **Traits** (advantages/disadvantages/perks/quirks) with modifier math.
- **Skills** with attribute/difficulty relative levels.
- **Magic**: spells (college, difficulty, energy cost), a **cast-spell**
  helper, **mana level** from campaign, and **powerstones / magic items**.
- **Inventory**: nested containers (drag-and-drop, touch-enabled),
  encumbrance, armor and weapon data, cost/weight rollups.
- **Combat tracker**: HP/FP pools, posture, conditions, hit-location model.
- **Warnings**: derived rule-violation banners the user can dismiss.
- **History tab**: per-character audit log (see history-tracking.md).

Every editable input on the sheet is **draft-on-blur** and never silently
loses an edit; see `src/client/hooks/useDraftField.ts` and `AGENTS.md`
interaction rules.

### Campaigns
Routes `/campaigns`, `/campaigns/:id`, `/campaigns/:id/library`.

- Create/edit campaigns with **point target, disadvantage cap, quirk cap,
  mana level**, and the **share-character-sheets** toggle.
- **Roles**: `owner` (GM), `manager`, `member`.
- **Membership management**: add/remove members, change roles, **transfer
  ownership**, delete campaign.
- **Invitations**: invite by handle (email or display name), inbox to
  accept/reject, notifications.
- **Character-sheet sharing gate** (`shareCharacterSheets`): when off, only the
  owner (GM) and a character's own player see full sheets; other members get a
  "minimal view" (public columns only). Enforced on both server and client —
  see campaign-content-sharing.md.
- **Campaign library**: per-campaign catalog of traits, skills, spells, and
  items, editable by the owner and **importable/exportable as versioned YAML**
  for sharing between campaigns. The catalog editor lives at
  `/campaigns/:id/library`; the top-nav **Library** page (`/library`,
  `features/library/LibraryPage.tsx`) is the primary home for the YAML
  import/export flow.
- **Adventure log**: session log entries with per-entry visibility
  (campaign-wide or private).
- **Campaign history view**: campaign-level audit log (settings, membership,
  library, log), plus an owner-only roll-up across member characters.

### Cross-cutting UI
- **Sync status indicator** (header): honest pending/syncing/offline/error
  state.
- **Notifications bell**: invitations and other events.
- **Themeable** (light/dark; "Arcane" DaisyUI theme), installable PWA, works
  offline for the character surface.
- **Settings** page: profile, password, passkeys, API keys.

### Admin (separate bundle)
A **separate Vite entry** (`src/client/admin/`, served at `/admin/*`) — not
part of the PWA bundle — for superusers: manage users (suspend/purge) and
campaigns. Per architecture invariant, instance admin never ships in the
player client.

---

## Codebase map

```
src/
  server/        Bun process — Hono routes, auth, Drizzle, OpenAPI, WS
    routes/      One file per resource group (auth, characters, campaigns,
                 campaignLibrary, invitations, notifications, sync, syncWs,
                 history, admin, adventureLog, characterSubResources, apiKeys,
                 health)
    auth/        jwt, password, webauthn (passkeys), apiKey, session,
                 middleware, permissions (the authz helpers)
    services/    syncDispatch (the write chokepoint), wsBus, characterSummary
    db/          schema.ts (Drizzle), migrations/ (hand-written SQL for
                 triggers), auditContext (withAudit), client, migrate, seed
    openapi/     app, emit, check (CI drift guard against docs/openapi.json)
  client/        React 19 PWA
    features/    Route-level screens grouped by domain (auth, characters,
                 campaigns, library, log, settings, history, home)
    sync/        orchestrator, outbox, state, flashBus, minimalViewSweep,
                 wsSubscriber — the local-first engine
    db/          dexie.ts — the IndexedDB stores + outbox (UI source of truth)
    hooks/       useDraftField (canonical draft-on-blur), useDraftToggle, ...
    components/  Shared UI (sync indicator, notifications bell, ui/*)
    admin/       Separate admin SPA entry
  shared/        Pure TypeScript — runs in Bun, browser, AND service worker
    schemas/     Zod schemas — the wire contract (sync.ts is the sync protocol)
    domain/      GURPS math (characterCalc, skillCalc, spellCalc, encumbrance,
                 traitCost, modifierMath, poolBump, warnings)
    constants/   attributes, skills, traits, combat, hitLocations, magic
    yaml/        library.ts — round-trippable campaign-library YAML codec
    history/     summarize.ts — shared history one-liner formatter
  sw/            Service worker registration (app-shell precache + a few
                 read-only GET caches). NOT outbox replay — that lives in the
                 page orchestrator, see src/sw/registerSW.ts.
docs/
  specs/         These design specs
  openapi.json   Emitted OpenAPI contract (CI-checked)
bootstrap/
  sample_library.yaml   Seeded into the "Sample" campaign
```

Read the top-of-file doc comments — most load-bearing modules
(`orchestrator.ts`, `outbox.ts`, `dexie.ts`, `syncDispatch.ts`,
`minimalViewSweep.ts`, `library.ts`) open with a precise description of their
contract and the bugs they exist to prevent.

---

## Architecture at a glance

- **One process, one origin.** The Bun server hosts HTTP + WebSocket + OpenAPI
  + static client. Do not split it.
- **Postgres 18 only.** No SQLite, no cross-DB shims. IDs are `uuidv7()`
  server-defaults (the concrete PG18 dependency); the schema also uses
  `GENERATED ALWAYS AS … STORED` columns. `AGENTS.md` frames PG18 as headroom
  to "lean on" (e.g. `MERGE…RETURNING`); not all of that is used yet.
- **OpenAPI is the contract.** Every route uses `createRoute` from
  `@hono/zod-openapi`; CI fails on drift against `docs/openapi.json`.
- **Shared code is pure TS.** Anything in `src/shared/` must run in Bun, the
  browser, and the service worker — no DOM, no Bun globals, no DB clients, no
  env access.
- **Local-first always.** Every UI mutation for a sync-backed class writes
  IndexedDB + the outbox first. The server is a durable mirror, not the render
  path.
- **WebSockets are acceleration, not correctness.** WS frames only invalidate;
  the HTTP cursor pull + outbox replay is the source of truth.
- **History is a required baseline.** Every syncable entity participates in the
  append-only audit log via DB triggers.

Full detail: [architecture.md](architecture.md).

---

## Orientation notes for future sessions

Things that repeatedly surprise people working in this repo:

1. **Sync coverage is partial and deliberate.** Only the character family
   (`character`, `character_trait`, `character_skill`, `character_spell`,
   `character_inventory`, `character_combat`) flows through the outbox. Campaigns
   are pulled **read-only** into Dexie; the campaign library, adventure log,
   invitations, and notifications are still **online-only** React-Query/HTTP
   surfaces. The `entityClass` enum lists more than the orchestrator pulls —
   that's headroom, not coverage. The authoritative list is `ALL_ENTITY_CLASSES`
   in `src/client/sync/orchestrator.ts`. Confirm before assuming offline
   behaviour. (`AGENTS.md` S0.)

2. **Never write a second draft-on-blur pattern.** `useDraftField.ts` is
   canonical: it queues same-field edits, syncs per-field only when clean, and
   fires toast+flash on rollback. Extend it; don't fork it.

3. **A rollback is a UX event.** Any undo of a user-typed value must fire
   **both** a persistent toast (naming the field + reason) and an input flash.
   Toast-without-flash and flash-without-toast are both bugs. (`AGENTS.md` rule
   2 / S5.)

4. **Adding a syncable entity class touches ~6 sites** (schema enum, Dexie,
   orchestrator switches, outbox switches, server dispatcher + cursor reader,
   purge list) **plus** the history checklist (trigger, `SYNCABLE_TABLES`,
   `summarizeEvent`, `withAudit`). There is no registry that catches a miss —
   follow the `AGENTS.md` S6 and H1–H5 checklists end-to-end or you get silent
   data loss.

5. **Two write paths, one audit chokepoint.** Character writes funnel through
   `dispatchOperation()` in `syncDispatch.ts`; campaign writes go through
   separate REST routes. Both must run inside `withAudit(...)` so DB triggers
   can attribute the change. History capture sits *below* both via Postgres
   triggers.

6. **The share gate is enforced twice.** `decideCharacterAccess` (server,
   `sync.ts`) decides `full` vs `minimal`; `characterIdsToMinimize`
   (`minimalViewSweep.ts`) purges already-cached private rows from Dexie when
   access is downgraded. Changing one without the other reopens a data-leak
   hole.

7. **Dev + tests run in Docker/Bun.** There is no host `bun` requirement. `bun
   test` covers `src/server` + `src/shared`; `vitest` covers client; Playwright
   covers e2e. `npm run check` = lint + typecheck + **`bun test`
   (server+shared only)** + OpenAPI drift — it does **not** run the client
   vitest or Playwright suites, so run those separately for client changes.

8. **When in doubt, read the file's top comment and the relevant `AGENTS.md`
   rule** before editing — most invariants are annotated at the call site
   precisely because they were broken once.

---

## Maintaining these docs (required)

These specs are a **living description of the current state**, not a
point-in-time design record. Keeping them accurate is a firm project
requirement — see the "Design specs are a maintained requirement" section in
[`AGENTS.md`](../../AGENTS.md). In short: any change that alters user-facing
features, the sync/sharing/history architecture, the codebase layout, or an
orientation note above must update the relevant spec **in the same change**,
and this overview's feature catalog and codebase map must not drift from
reality.
