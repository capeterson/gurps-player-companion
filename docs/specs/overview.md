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
| [json-fields.md](json-fields.md) | Catalog of every JSON/JSONB field, its Zod schema, and where it's validated. |

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
  Speed, Basic Move, Dodge, basic **thrust/swing damage** (B16 table, shown
  as "Thr / Sw" on the derived card), etc. Temporary ST/HT boosts affect
  their normal derived values but not maximum HP/FP; only the dedicated
  temporary HP/FP modifiers change those maxima (M37). Basic Lift rounds to
  the nearest whole number once it reaches 10 (B15). All GURPS math is pure
  and shared (`src/shared/domain/`).
- **Point ledger.** Live point totals vs the campaign point target, with
  disadvantage / quirk cap warnings.
- **Temporary effects.** A structured list of named, transient buffs
  (`characters.temp_effects`, one JSONB list replacing the old per-stat
  scalar columns) — each entry bundles per-axis modifiers (e.g. "Might
  potion" → ST +2, HT +1). The ✦ modifier popovers on each stat still give
  quick steppers, backed by a reserved `manual` sentinel entry in the same
  list; named effects are added/removed individually from a compact list
  under the Attributes panel. "Revert all temporary buffs" clears the whole
  list in one patch. Tracked distinctly from permanent edits; never counts
  toward point cost.
- **Traits** (advantages/disadvantages/perks/quirks) with modifier math:
  percent modifiers sum, the net is clamped at -80% (B110), the result
  rounds against the character (B102), then flat modifiers add.
- **Skills** with attribute/difficulty relative levels. A 0-point skill
  shows its **attribute default** (attr-4/-5/-6 for E/A/H per B173);
  0-point Very Hard skills have no default, so their level renders as
  an em dash (`level` is null in the API). A computed level is a
  tappable roll target: it opens the same Play Mode roll sheet used
  everywhere else on the character (dispatch only, so read-only
  viewers can roll too); null-level rows stay plain text.
- **Magic**: spells (college, difficulty, energy cost), a **cast-spell**
  helper, **mana level** from campaign, and **powerstones / magic items**.
  Spells have no default: a 0-point (legacy) spell row has a null level,
  gets no energy discount, and its Cast/Maintain actions are held. The
  cast dialog suggests drawing from a single powerstone and warns when
  energy is allocated from more than one (B481).
- **Inventory**: nested containers (drag-and-drop, touch-enabled),
  encumbrance, armor and weapon data, cost/weight rollups. Encumbered
  Move floors at 1 while the load is legal and reads 0 past the 10×BL
  carry cap (B17).
- **Combat tracker**: HP/FP pools, posture, hit-location model, and the
  full 12-entry common-condition set (normalized against legacy
  Capitalized entries so old data still lights the right chip). Shows
  reeling and death-check thresholds (B419/B423) in one caption, and
  pulses a "suggested" highlight on the Reeling chip — never
  auto-applied — when HP drops below ⅓ max and it isn't set yet. HP can
  be tracked down to the certain-death floor at -5×HP; FP floors at -FP,
  with further fatigue charged against HP one-for-one (B426).
- **Warnings**: derived rule-violation banners the user can dismiss.
  Beyond the attribute-range and campaign-cap rules, this includes HP
  modifiers beyond ±30% of ST, FP modifiers beyond ±30% of HT (B16),
  and carried weight past the 10×BL carry cap.
- **History tab**: per-character audit log (see history-tracking.md).

Every editable input on the sheet is **draft-on-blur** and never silently
loses an edit; see `src/client/hooks/useDraftField.ts` and `AGENTS.md`
interaction rules.

### Play Mode (live-gameplay surface)
Route `/characters/:id/play`
(`src/client/features/characters/play/PlayModePage.tsx`). Reached from a
"⚔ Play" link on the sheet header, an "Open Play Mode" link in the Combat
modal, or a per-card "Play" action on HomePage's recent-characters list.
Redirects back to the sheet route for the share-gated minimal view (Play
Mode has nothing to show there).

A condensed, table-friendly layout for the middle of a session — no
editable identity/traits/inventory fields, just what a player touches
mid-combat:

- **Pools** — HP/FP with the same bumper/reset controls as the Combat
  modal (one shared `usePoolBumpers` instance so a sticky mobile bottom
  bar and the in-page card never race each other), posture, and all 12
  common condition chips (the Combat modal shares this same full set).
  Surfaces reeling *and* death-check thresholds (B419/B423) in one
  caption, and pulses a "suggested" highlight on the Reeling chip when
  HP drops below ⅓ max and it isn't set yet — never auto-applied.
  Condition chip taps compose against a latest-intended ref
  (`useConditionsToggle`, shared by PoolsCard and the Combat modal), the
  same pattern `usePoolBumpers` uses for HP/FP, so two rapid taps before
  Dexie re-renders don't coalesce into a single outbox patch and drop
  the first tap.
- **Maneuver** — one-tap chips for all 13 B363-366 maneuvers (active
  chip shows its blurb; tapping it again clears to no maneuver), plus a
  "Custom…" free-text fallback using the same `useDraftField` pattern as
  the sheet's Combat panel.
- **Defenses** — Dodge (with the encumbrance-penalty breakdown and no
  invented minimum; situational active-defense bonuses remain unmodeled), Parry
  per equipped weapon with a parry string (computed from the matched
  skill when one is found, else the raw library string), and Block when
  a Shield skill is known. Every numeric defense opens the roll sheet.
- **Attacks** — one row per equipped weapon: resolved damage dice (ST
  thrust/swing + the weapon's modifiers), reach, an over-ST warning
  badge, and the best-matching skill as a rollable row with hit-location
  preset chips (aim penalties, B398-399). Vitals presets appear only for
  impaling and piercing attacks, and the eye preset only for impaling,
  piercing, and tight-beam burning attacks.
- **Skills / Spells** — every skill and spell with a non-null computed
  level (0-point/no-default entries are the full sheet's job), each
  rollable; spells also get a "Cast" button that reuses the sheet's
  `CastSpellDialog` as-is. Casting is gated by the same ambient-mana
  rule as the sheet's SpellsPanel — both call the shared
  `characterCanCast` helper in `shared/domain/spellCalc.ts` (the one
  mana gate; don't fork it) — the button is disabled with a compact
  notice when the campaign's mana level hasn't synced yet or the
  ambient mana forbids casting here. Rolling a spell row stays
  unrestricted (it's ephemeral, no cost).
- **Roll sheet** — an ephemeral bottom-sheet/dialog roller: modifier
  stepper (−10..+10) plus single-select preset chips (picking a second
  preset replaces the first), a deliberately unobtrusive "Roll 3d6"
  button, and a result panel (dice, total, success/margin, crit badge)
  built on the shared `evaluateRoll`. Defense rows are routed through
  the same success-roll evaluator as skills — GURPS defenses actually
  use a different crit table, an accepted simplification for this pass.
- **Roll history strip** — a collapsible, session-only log of this
  character's rolls this visit (newest first, capped at 20 entries).
  **Never persisted** — no Dexie table, no localStorage — so it carries
  none of the sync/purge/history obligations a durable entity would
  (deliberate: reloading the page clears it).

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
                 health). campaignLibrary.ts is now a thin factory wiring:
                 campaignLibraryEntities.ts (per-entity-kind config: schemas,
                 DTO/insert/update mappers, natural key) and
                 campaignLibraryCrud.ts (generic POST/PATCH/DELETE route
                 registration + YAML upsert-by-key loop) consumed once per
                 entity kind.
    auth/        jwt, password, webauthn (passkeys), apiKey, session,
                 middleware, permissions (the authz helpers, incl.
                 tryLoadCampaignRole)
    services/    syncDispatch (the write chokepoint), wsBus, characterSummary
                 (incl. loadCharacterDetail, the shared character-detail
                 loader), characterAccess (resolveCharacterView, the
                 shared full/minimal/forbidden decision), patchSet
                 (buildPatchSet, the shared PATCH-body-to-`.set()` helper),
                 entityWrites (per-entity insert/upsert-values builders
                 shared by REST and the sync dispatcher — AGENTS.md S12)
    db/          schema.ts (Drizzle), migrations/ (hand-written SQL for
                 triggers), auditContext (withAudit), client, migrate, seed
    openapi/     app, emit, check (CI drift guard against docs/openapi.json)
  client/        React 19 PWA
    features/    Route-level screens grouped by domain (auth, characters,
                 campaigns, library, log, settings, history, home)
      characters/play/  Play Mode — the live-gameplay surface
                 (PlayModePage + PoolsCard/ManeuverCard/DefensesCard/
                 AttacksCard/SkillsCard/RollableRow/RollSheet/
                 RollHistoryStrip + the ephemeral rollHistory store)
      characters/sections/  Sheet-panel form plumbing shared across
                 Traits/Skills/Spells/Inventory: useAddEntityForm (the add
                 form), useEntityRowPatch (per-row field patch dispatch),
                 useClampedJsonbBumper (powerstone/magic-item charge
                 steppers), useTempEffects (the named temporary-effects
                 list backing the Attributes panel's modifier popovers)
    sync/        orchestrator, outbox, state, flashBus, minimalViewSweep,
                 wsSubscriber — the local-first engine
    db/          dexie.ts — the IndexedDB stores + outbox (UI source of truth)
    hooks/       useDraftField (canonical draft-on-blur), useDraftToggle,
                 useFlashState (shared flash-pulse primitive the draft
                 hooks build on), ...
    components/  Shared UI (sync indicator, notifications bell, ui/*)
    admin/       Separate admin SPA entry
  shared/        Pure TypeScript — runs in Bun, browser, AND service worker
    schemas/     Zod schemas — the wire contract (sync.ts is the sync protocol)
    format/      number.ts — formatSigned/formatScaled, the shared
                 sign/scale number formatters used by both client display
                 code and shared warning text
    domain/      GURPS math (characterCalc, skillCalc, spellCalc, encumbrance,
                 traitCost, modifierMath, poolBump, warnings, diceRoll (3d6 +
                 success-roll evaluation), damageParse (weapon damage-string
                 parsing/resolution), defenseCalc (Dodge/Parry/Block +
                 weapon-to-skill matching), conditions (snake_case condition
                 normalization, tolerant of legacy Capitalized entries))
    constants/   attributes, skills, traits, combat (postures, common
                 conditions, maneuvers), hitLocations (+ aim penalties), magic
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
