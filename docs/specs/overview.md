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
(the Combat tab is first — it's the live-gameplay surface a player
touches mid-session, front-loaded so one tap lands there; on a
read-only view of a non-magical character the Magic tab is hidden, and
on any sheet the viewer can edit — their own — it always shows).

- **Attributes, Secondary & Status cards.** ST/DX/IQ/HT drive HP, FP,
  Will, Per, Basic Speed, Basic Move, Dodge, basic **thrust/swing
  damage** (B16 table, shown as "Thr / Sw"), etc. The **Secondary** card
  surfaces the six secondary stats (HP, Will, Per, FP, Basic Speed, Basic
  Move) with their effective values and per-stat ✦ temp-modifier
  popovers. The **Status** card shows the current HP/FP pools (with
  meters) plus the derived combat values not displayed elsewhere —
  Dodge, Basic Lift, and Thr / Sw — while pool mutations live only in
  the Combat tab so independently mounted editors cannot race. The
  sheet's top row no longer duplicates the six secondary numbers. Temporary ST/HT boosts
  affect their normal derived values but not maximum HP/FP; only the
  dedicated temporary HP/FP modifiers change those maxima (M37). Basic
  Lift rounds to the nearest whole number once it reaches 10 (B15). All
  GURPS math is pure and shared (`src/shared/domain/`).
- **Point ledger.** Live point totals vs the campaign point target, with
  disadvantage / quirk cap warnings.
- **Temporary effects.** Per-stat ✦ modifier popovers are the single
  way to add temp modifiers, backed by a reserved `manual` sentinel
  entry in the `characters.temp_effects` JSONB list. There is no longer
  any named-effects list or add form — the `manual` entry is the only
  entry that ever gets written, keyed by axis (ST/DX/IQ/HT/HP/Will/Per/
  FP/Speed/Move). "Revert all temporary buffs" clears the whole list in
  one patch. Tracked distinctly from permanent edits; never counts
  toward point cost. (Legacy named effects from before the add form was
  removed still exist in the DB and contribute to derived totals, but
  have no UI surface — "Revert all" clears them too.)
- **Traits** (advantages/disadvantages/perks/quirks) with modifier math:
  percent modifiers sum, the net is clamped at -80% (B110), the result
  rounds against the character (B102), then flat modifiers add.
- **Skills** with attribute/difficulty relative levels. A 0-point skill
  shows its **attribute default** (attr-4/-5/-6 for E/A/H per B173);
  0-point Very Hard skills have no default, so their level renders as
  an em dash (`level` is null in the API). A computed level is a
  tappable roll target: it opens the same roll sheet used everywhere
  else on the character (dispatch only, so read-only viewers can roll
  too); null-level rows stay plain text.
- **Magic**: spells (college, difficulty, energy cost), a **cast-spell**
  helper, **mana level** from campaign, and **powerstones / magic items**.
  Spells have no default: a 0-point (legacy) spell row has a null level,
  gets no energy discount, and its Cast/Maintain actions are held. The
  cast dialog suggests drawing from a single powerstone and warns when
  energy is allocated from more than one (B481).
- **Inventory**: nested containers (drag-and-drop, touch-enabled),
  encumbrance, armor and weapon data, cost/weight rollups. Equipped
  armor DR is aggregated per hit location on the Combat tab's Armor DR
  card. An item's categories (container/armor/weapon/powerstone/magic
  item) are **derived facet chips** (`FacetChips.tsx`) rather than
  independent checkboxes — clicking an inactive chip (`+ Weapon`)
  turns the facet on and reveals its fieldset; clicking an active chip
  turns it off, confirming first if the facet already carries data.
  The same chip row appears in the item edit dialog and the inventory
  add form's "More options" expander. Weapon data (damage, reach,
  parry, ST required, governing **skill**, shield **Defense Bonus**,
  and an optional **ranged** stat block — Acc/Range/RoF/Shots/Bulk/
  Recoil) is editable from the item edit dialog, and copied from
  campaign library items on the inventory add form. Encumbered Move
  floors at 1 while the load is legal and reads 0 past the 10×BL carry
  cap (B17).
- **Combat tab (live-gameplay surface)**. The first tab on the sheet
  (`src/client/features/characters/sections/combat/CombatTab.tsx`),
  consolidating everything a player touches mid-session onto one inline
  surface. There is no combat modal or separate live-gameplay route; the
  player taps between live combat and the editable sheet without a route
  hop. Two-column "state vs. action" layout: the left column holds
  Pools and Armor DR; the right column stacks Maneuver, Defenses (with
  Move), and Attacks; the roll history strip spans full width below.
  - **Pools** — HP/FP with bumpers/reset, posture chips, and all 12
    common-condition chips (normalized against legacy Capitalized entries
    so old data still lights the right chip). Surfaces reeling
    *and* death-check thresholds (B419/B423) in one caption, pulses a
    "suggested" highlight on the Reeling chip when HP drops below ⅓ max
    and it isn't set yet — never auto-applied — and tracks HP down to
    the certain-death floor at −5×HP; FP floors at −FP, with further
    fatigue charged against HP one-for-one (B426). One shared
    `usePoolBumpers` instance feeds both the in-grid PoolsCard and the
    sticky mobile bottom bar so a fast tap on both UIs never races;
    `useConditionsToggle` mirrors the same latest-intended-ref pattern
    so two rapid condition taps before Dexie re-renders don't coalesce
    into one outbox patch and drop the first tap.
  - **Armor DR** — aggregates equipped armor DR per hit location
    (`src/shared/domain/armorDr.ts`), complementing the Attacks card's
    hit-location aim presets. Crushing-specific DR is shown where it
    differs from the default. An **"Incoming damage…"** button opens a
    dialog (`IncomingDamageDialog.tsx`) that resolves a hit against the
    character's own DR: basic damage − DR(location, honoring an armor
    divisor and the skull's natural DR 2, B400) → penetrating ×
    wounding multiplier (B379/B398-400) = injury
    (`src/shared/domain/injuryCalc.ts`), applied to HP through the same
    shared `usePoolBumpers` instance as the rest of the tab. Crippling
    is surfaced as a hint only, never auto-applied.
  - **Maneuver** — one-tap chips for all 13 B363-366 maneuvers (active
    chip shows its blurb; tapping it again clears to no maneuver), plus
    a "Custom…" free-text fallback using the same `useDraftField`
    pattern as the sheet's Status card.
  - **Defenses** — Move (read-only, net of encumbrance), Dodge (with
    the encumbrance-penalty breakdown and no invented minimum;
    situational trait-based active-defense bonuses remain unmodeled),
    Parry per equipped weapon, and Block. A weapon's governing skill is
    resolved via `resolveWeaponSkill` (`src/shared/domain/defenseCalc.ts`):
    an explicit `weaponData.skill` binding (exact case-insensitive
    name match, shown as "Skill 'X' not on sheet" if missing) takes
    priority; unset falls back to fuzzy name-matching the weapon's own
    name against the sheet's skills. The ST-shortfall penalty (B270,
    −1/point under `stRequired`) is subtracted from the matched level
    before Parry is computed. **Block** is derived from an actually-
    equipped shield — an item whose `weaponData.db` (Defense Bonus) is
    set, picked by `pickShield` — not merely the presence of a
    "Shield"-named skill; that shield's DB then adds to Dodge, every
    Parry, and Block (B287). Every numeric defense opens the roll sheet.
  - **Attacks** — one row per equipped weapon: resolved damage dice (ST
    thrust/swing + the weapon's modifiers) as **tappable chips that
    roll damage** (NdM+adds, B269, with the type/cut/imp/piercing
    1-point floor from B378), reach, an ST-shortfall badge/caption
    (B270, applied to the roll target), a ranged stat line (Acc/Range/
    RoF/Shots/Bulk/Recoil) when the weapon has one, and the resolved
    skill as a rollable row with hit-location preset chips (aim
    penalties, B398-399) plus, for ranged weapons, an Aim(+Acc) preset
    and the B550 speed/range-penalty presets. Vitals presets appear
    only for impaling and piercing attacks, and the eye preset only for
    impaling, piercing, and tight-beam burning attacks.
  - **Roll sheet** — an ephemeral bottom-sheet/dialog roller with two
    variants sharing one shell. The default **check** variant: modifier
    stepper (−25..+10 — deep enough that a 200 yd range preset, B550,
    can still be topped up toward a deep hit-location penalty via the
    stepper) plus single-select preset chips, a "Roll 3d6" button, and
    a result panel (dice, total, success/margin, crit badge) built on
    the shared `evaluateRoll`. Defense rows route through the same
    success-roll evaluator as skills — GURPS defenses actually use a
    different crit table, an accepted simplification for this pass.
    The **damage** variant (triggered by a `RollRequest.damage` payload,
    e.g. from an Attacks card damage chip) rolls NdM+adds instead of
    3d6-vs-target: the stepper adjusts flat adds, presets are hidden,
    and the result shows the individual dice plus total with no
    success/crit call. The sheet's Skills and Magic tabs share the same
    roll sheet (`.RollSheet` / `RollableRow` live under `sections/`) so
    tapping a skill/spell level in those tables opens the identical
    roller.
  - **Roll history strip** — a collapsible log of this character's
    recent rolls (newest first, capped at 100 entries per character),
    rendering both check entries (target/margin/crit) and damage
    entries (dice + total + type) distinctly; entries persisted before
    damage rolls existed have no `kind` and deserialize as checks.
    Persisted to `localStorage` (keyed `gurps:rollHistory:<characterId>`)
    so the log survives page reloads, but **not sync'd to the server**
    and carrying no sync/purge/history obligations. Cleared on logout
    (`clearAllRollHistory`) so account switching on the same device
    doesn't leak roll labels.
- **Warnings**: derived rule-violation banners the user can dismiss.
  Beyond the attribute-range and campaign-cap rules, this includes HP
  modifiers beyond ±30% of ST, FP modifiers beyond ±30% of HT (B16),
  and carried weight past the 10×BL carry cap.
- **History tab**: per-character audit log (see history-tracking.md).

Every editable input on the sheet is **draft-on-blur** and never silently
loses an edit; see `src/client/hooks/useDraftField.ts` and `AGENTS.md`
interaction rules.

### Campaigns
Routes `/campaigns`, `/campaigns/:id`, `/campaigns/:id/gm`, `/campaigns/:id/library`.
The campaign detail page (`/campaigns/:id`) hosts the browseable character
roster for the campaign — every member character in the campaign is listed
there, regardless of the share gate; rows a viewer only sees minimally deep-link
to `/characters/:id`, which renders `CharacterMinimalView`.

- Create/edit campaigns with **point target, disadvantage cap, quirk cap,
  mana level**, and the **share-character-sheets** toggle.
- **Roles**: `owner` (GM), `manager`, `member`.
- **Membership management**: add/remove members, change roles, **transfer
  ownership**, delete campaign.
- **Invitations**: invite by handle (email or display name), inbox to
  accept/reject, notifications.
- **Character-sheet sharing gate** (`shareCharacterSheets`): when off, only the
  owner (GM) and a character's own player see full sheets; other members get a
  "minimal view" (identity columns only — no stats, temp effects, HP/FP,
  traits/skills/spells/inventory/combat, or history). Enforced on the server
  sync emission, the local Dexie purge, and the UI discovery surfaces: minimal
  characters are **excluded from `/characters`** and browsable only from the
  campaign detail page; full-share and editable-manager rows remain listed.
  See campaign-content-sharing.md.
- **Campaign library**: per-campaign catalog of traits, skills, spells, and
  items, editable by the owner and **importable/exportable as versioned YAML**
  for sharing between campaigns. The catalog editor lives at
  `/campaigns/:id/library`; the top-nav **Library** page (`/library`,
  `features/library/LibraryPage.tsx`) is the primary home for the YAML
  import/export flow.
- **Adventure log**: session log entries with per-entry visibility
  (campaign-wide or private). The body is **markdown** (CommonMark + GFM)
  rendered through a sanitized pipeline that never interprets raw HTML or
  scripts. The create/edit form offers a Tiptap **rich text editor** with a
  raw-markdown toggle; entries can be **edited or deleted** by their author or
  the campaign owner. See campaign-content-sharing.md.
- **Campaign history view**: campaign-level audit log (settings, membership,
  library, log), plus an owner/manager roll-up across member characters.
- **GM campaign dashboard** (`/campaigns/:id/gm`): an owner/manager live-session
  view with a responsive grid of compact, read-only character cards backed by
  the local Dexie character model, plus a five-second character-history feed.
   Newly observed changes remain highlighted for 30 seconds. Cards open the full
   sheet in a new tab; a dense-display toggle fits larger parties.
- **Encounter tracker foundation**: the online-only REST aggregate under
  `/campaigns/:id/encounters` stores campaign encounter state, PC/NPC
   combatants, turn order, and timed effects. Members can read a privacy-aware
   projection (hidden NPCs and effects targeting them omitted; other players'
   copied PC combat fields masked when character sheets are not shared; hidden
   casters' effect ids masked), while
   owners/managers control the tracker. Encounter updates use optimistic turn
   concurrency and `encounter_invalidate` WebSocket nudges.
    - **Encounter tracker**: campaign pages list active and ended encounters;
     owners/managers can select PCs from the campaign roster, create and fully
     edit NPC combatants, reorder combatants (including Wait reslots), end
      combat, advance turns while combat is active, and maintain or
    acknowledge timed effects. Effect add/edit supports templates, manual
    round/minute/hour/indefinite durations, known-spell prefills, maintenance
    costs, and optional PC-sheet links; expiry acknowledgement/removal confirms
     and, after the REST acknowledgement succeeds, clears linked sheet values through the character outbox. Members receive the server's privacy-safe
   projection; a player can use local-first HP/FP and condition quick actions
    only for their own PC. Each character's Combat tab also has its own
    device-only initiative scratchpad in Dexie, with local combatants and
    timed effects. Effects can use shared templates or manual round/minute/
    hour/indefinite durations, show expiry and maintenance prompts, and can
    be acknowledged or removed locally. The scratchpad is cleared at logout
    and never sent to the server.
- **Optional GM character editing**: an owner-controlled, default-off campaign
  setting lets owners and managers edit player-owned sheets through the normal
  local-first outbox. REST and sync use the same central write decision.

### Cross-cutting UI
- **Sync status indicator and log** (header): honest pending/syncing/offline/error
  state. Clicking it opens the local sync log, with current unsynced changes,
  the latest 1,000 pushed/pulled changes and timestamps, repeatedly failing
  changes with diagnostics and an explicit revert action, plus a confirmed
  emergency action to abandon local changes and pull a fresh server copy.
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
                 health, encounters). campaignLibrary.ts is now a thin factory wiring:
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
                 campaigns, encounters, library, log, settings, history, home)
      characters/sections/  Sheet-panel form plumbing shared across
                 Traits/Skills/Spells/Inventory: useAddEntityForm (the add
                 form), useEntityRowPatch (per-row field patch dispatch),
                 useClampedJsonbBumper (powerstone/magic-item charge
                  steppers), useTempEffects (the temporary-effects list
                  backing the Attributes panel's modifier popovers), shared
                  RollSheet/RollableRow/rollHistory (per-character
                  localStorage roll log) primitives, and combat/
                  (CombatTab + Pools/Maneuver/Defenses/Attacks/DrSummary cards)
    sync/        orchestrator, outbox, state, flashBus, minimalViewSweep,
                 wsSubscriber — the local-first engine
    db/          dexie.ts — the IndexedDB stores + outbox (UI source of truth),
                  plus per-character device-only solo tracker scratchpads
    hooks/       useDraftField (canonical draft-on-blur), useDraftToggle,
                 useFlashState (shared flash-pulse primitive the draft
                 hooks build on), ...
    components/  Shared UI (sync indicator/log, notifications bell, ui/*,
                 markdown/ — sanitized markdown renderer + Tiptap WYSIWYG
                 markdown editor used by the adventure log)
    admin/       Separate admin SPA entry
  shared/        Pure TypeScript — runs in Bun, browser, AND service worker
    schemas/     Zod schemas — the wire contract (sync.ts is the sync protocol)
    format/      number.ts — formatSigned/formatScaled, the shared
                 sign/scale number formatters used by both client display
                 code and shared warning text
     domain/      GURPS math (characterCalc, skillCalc, spellCalc, encumbrance,
                  traitCost, modifierMath, poolBump, warnings, diceRoll (3d6 +
                  success-roll evaluation + NdM damage-dice rolling),
                  damageParse (weapon damage-string parsing/resolution +
                  the cut/imp/piercing 1-point damage floor), defenseCalc
                  (Dodge/Parry/Block, explicit-or-fuzzy weapon-to-skill
                  matching via `resolveWeaponSkill`, `skillDisplayName` for
                  specialization-disambiguated skill names, ST-shortfall
                  penalty, equipped-shield picking), injuryCalc (incoming-
                  damage DR/divisor/wounding-multiplier resolution for the
                  Armor DR card's damage dialog), armorDr (equipped-armor DR
                  aggregation per hit location), conditions (snake_case
                  condition normalization, tolerant of legacy Capitalized
                  entries))
    constants/   attributes, skills, traits, combat (postures, common
                 conditions, maneuvers), hitLocations (+ aim penalties),
                 rangePenalty (B550 speed/range roll presets), magic
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

6. **The share gate is enforced three ways.** `decideCharacterAccess`
   (server, `sync.ts`) decides `full` vs `minimal` and the server
   `projectCharacterRow` ships only identity fields for minimal rows;
   `characterIdsToMinimize` + the orchestrator's character-row rewrite
   (`minimalViewSweep.ts` + `orchestrator.ts`) purges already-cached private
   child rows **and** rewrites cached character rows down to identity so
   stale `st`/`hpMod`/`tempEffects`/`activeConditionGroups` can't be recovered locally; and the
   UI discovery surfaces filter minimal rows off `/characters` and onto the
   campaign detail page. Changing one without the others reopens a leak
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
