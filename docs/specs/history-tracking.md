# Design Spec: History Tracking for Player & Campaign Sections

## Context

GURPS Player Companion is a local-first PWA (React 19 + Dexie/IndexedDB) backed by a Bun/Hono/Postgres/Drizzle server. Today the app records *current* state and a `revision` per row, plus `entity_tombstones` for deletes — but there is **no human-readable history** of what changed, when, and by whom. Players cannot review past edits to their sheet, and a GM has no way to audit changes across the characters in their campaign.

This spec adds an **append-only history/audit log** that:
- Captures every mutation to characters (attributes incl. **temporary stat boosts**, traits, skills, spells, inventory, combat) and to campaign-level data (settings, membership, library, adventure log).
- Surfaces a **History tab** on the character sheet (one-line summaries; foldable detail for batched changes) and a **History view** on the campaign page (campaign-level changes only).
- Provides **local filtering & search** over loaded history.
- Becomes a **required baseline**: every new syncable table must participate in history capture, enforced by an automated test.

Chosen approach: **Postgres triggers** for capture, **paginated REST endpoints** for delivery, **indefinite retention**.

### Why triggers (the key architectural decision)
All *character* writes funnel through one server chokepoint — `dispatchOperation()` in `src/server/services/syncDispatch.ts`. But *campaign* writes (settings, membership, library, adventure log) go through separate REST routes (`campaigns.ts`, `invitations.ts`, `campaignLibrary.ts`, `adventureLog.ts`) and do **not** pass through sync. A database-trigger capture sits *below* both paths, so it records every write uniformly with no per-route bookkeeping. It also reuses machinery the codebase already trusts: the `bump_revision()` BEFORE-UPDATE trigger (migration `0002`/`0004`) and the `record_*_tombstone()` AFTER-DELETE triggers (migration `0003`/`0004`) on the same set of syncable tables.

The one thing triggers can't see on their own — *who* made the change and *which user gesture* it belongs to — is threaded in via Postgres session settings (`current_setting('app.actor_id', true)` / `current_setting('app.batch_id', true)`) set at the start of each request's DB work.

---

## Data model

### New table: `entity_history` (append-only)
Created in a new migration `src/server/db/migrations/0013_entity_history.sql`, mirrored as a Drizzle table in `src/server/db/schema.ts` (`entityHistory`).

Columns:
- `id` uuid PK default `gen_random_uuid()`
- `revision` bigint NOT NULL default `nextval('revisions_seq')` — reuses the shared global sequence so history is totally ordered against all other changes and paginates cleanly.
- `scope` text NOT NULL — `'character'` or `'campaign'` (the discriminator that keeps the two views separate).
- `entity_class` text NOT NULL — `character` | `character_trait` | `character_skill` | `character_spell` | `character_inventory` | `character_combat` | `campaign` | `campaign_membership` | `campaign_library_trait` | `campaign_library_skill` | `campaign_library_item` | `adventure_log` (the existing `entityClass` enum from `src/shared/schemas/sync.ts`).
- `entity_id` uuid NOT NULL.
- `op` text NOT NULL — `create` | `patch` | `delete` (matches `operationCommand`).
- `character_id` uuid NULL — set for `scope='character'` rows (the parent character), so per-character queries are a single indexed lookup. NULL for campaign scope.
- `campaign_id` uuid NULL — set when the change belongs to a campaign (the character's campaign, or the campaign itself / its children). Drives the campaign view and GM access scoping.
- `owner_user_id` uuid NOT NULL — denormalized character/campaign owner (same pattern as `entity_tombstones`), used for access scoping when `campaign_id` is null.
- `actor_user_id` uuid NULL — who made the change (from `app.actor_id`; null for system/migration writes).
- `batch_id` uuid NULL — correlation id grouping changes from one user gesture (from `app.batch_id`).
- `old_row` jsonb NULL — full pre-image (`OLD` on update/delete).
- `new_row` jsonb NULL — full post-image (`NEW` on insert/update).
- `created_at` timestamptz NOT NULL default `now()`.

Indexes:
- `(character_id, revision DESC)` — per-character history page query.
- `(campaign_id, scope, revision DESC)` — per-campaign view filtered to `scope='campaign'`, and GM "all characters in campaign" filtered to `scope='character'`.
- `(owner_user_id, revision DESC)` — fallback scoping for campaign-less characters.

We store full row images (not field-level diffs) because the one-line summary and the expanded detail are both **derived on demand** by a shared formatter; storing images keeps the trigger trivial and future-proof against schema changes.

---

## Capture: triggers + session-variable plumbing

### Migration `0013_entity_history.sql`
Modeled directly on `0003`/`0004`. Adds:

1. **`record_history()` generic trigger function** taking `TG_ARGV[0] = entity_class`, `TG_ARGV[1] = scope`. It:
   - Reads `actor := nullif(current_setting('app.actor_id', true), '')::uuid` and `batch := nullif(current_setting('app.batch_id', true), '')::uuid` (the `true` = "missing_ok" so it never errors when unset, e.g. during migrations/seed).
   - Resolves `owner_user_id`, `campaign_id`, `character_id` from `NEW`/`OLD`:
     - For `characters`: owner = `id`'s `owner_id`, campaign = `campaign_id`, character_id = `id`.
     - For character children (trait/skill/spell/inventory/combat): look up `owner_id`, `campaign_id` from `characters WHERE id = coalesce(NEW,OLD).character_id`; character_id = that `character_id`. (Combat is 1:1 keyed by `character_id`.)
     - For `campaigns`: owner = `owner_id`, campaign = `id`, character_id = NULL.
     - For campaign children (membership/library/adventure_log): resolve `owner_id`/`campaign_id` from the parent `campaigns` row via `OLD/NEW.campaign_id`; character_id = NULL.
   - Inserts one `entity_history` row with `op = lower(TG_OP)` mapped (`INSERT`→`create`, `UPDATE`→`patch`, `DELETE`→`delete`), `old_row = to_jsonb(OLD)`, `new_row = to_jsonb(NEW)`.
   - On the parent-lookup-returns-null case (parent already cascade-deleted), still insert with whatever is resolvable — mirrors the defensive handling in `record_character_child_tombstone()`.

2. **`AFTER INSERT OR UPDATE OR DELETE` triggers** named `record_history_trg` on every syncable table, each passing its `(entity_class, scope)` labels — the exact same 12-table list enumerated in `0002`/`0004`. Use three wrapper functions mirroring the tombstone trio: `record_character_history()` (the `characters` root), `record_character_child_history(entity_class)` (trait/skill/spell/inventory/combat — resolves owner/campaign from the parent `characters` row), and `record_campaign_history(entity_class)` (campaigns + children). **Use AFTER, not BEFORE** (unlike `bump_revision`) so the trigger sees the post-bump `NEW.revision`; the history row pulls its *own* separate `nextval('revisions_seq')` so one live update maps to exactly one distinctly-ordered history row.

### Setting `app.actor_id` / `app.batch_id` — MUST be transaction-local
**Critical constraint (verified against the code):** `getDb()` is a Drizzle instance over a shared `pg.Pool`, and the hot write path `patchEntity()` issues a **bare** `getDb().update(table)...` (syncDispatch.ts:719, 760) with *no surrounding transaction*. A bare statement borrows an arbitrary pooled connection for one statement. Therefore the GUC **must be set with `SET LOCAL` inside the same transaction as the write** — a non-`LOCAL` `SET`, or a `SET` run on a different pooled checkout, would either be invisible to the write or leak the actor id onto a pooled connection and mis-attribute the *next* request.

Add a helper `withAudit(actorId, batchId, fn)` in a new `src/server/db/auditContext.ts`:
```
db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);   // true = LOCAL
  await tx.execute(sql`select set_config('app.batch_id', ${batchId ?? ''}, true)`);
  return fn(tx);
});
```
Wire it in at the write paths:
- **Sync path:** wrap the whole `dispatchOperationInner` body in `withAudit(ctx.userId, ctx.batchId)` and thread the resulting `tx` down — replace the bare `getDb()` writes in `patchEntity` and each `dispatch*` with the passed `tx`. The inventory create's existing nested `db.transaction` (syncDispatch.ts:464) collapses into this outer tx. Extend the dispatch context to `{ userId, batchId }`; `/sync/operations` (sync.ts) reads `op.batchId`. When an op has no `batchId`, default `app.batch_id` to the op's `clientOpId` so even singleton edits get a stable, non-null batch id.
- **Campaign REST path:** wrap each mutating handler's writes in `campaigns.ts`, `invitations.ts`, `campaignLibrary.ts`, `adventureLog.ts` in `withAudit(c.get('user').id, ...)`. (Prefer explicit per-handler wrapping over a global request-tx middleware — these handlers already issue multiple independent `getDb()` calls and a couple manage their own `db.transaction`, so a request-scoped tx retrofit is more invasive.) Authz *reads* (`loadCharacterOr403`, etc.) may stay on `getDb()`; only the **writes** must run on the audit `tx`.

Edge case: writes with no GUC set (DB seed, migrations, scripts) record `actor_user_id = NULL` — acceptable, attributable to "system".

### Batch grouping (foldable detail requirement)
A "batch" = the set of mutations from one user gesture (e.g. multi-select inventory move). Implement with a client-generated `batchId`:
- Add optional `batchId: uuid` to `operationEnvelope` in `src/shared/schemas/sync.ts` and to `OutboxEntry` in `src/client/db/dexie.ts`.
- `enqueueFieldPatch` / `enqueueCreate` / `enqueueDelete` in `src/client/sync/outbox.ts` accept an optional `batchId`; a new helper `runBatch(fn)` generates one id and tags every op enqueued within the callback. Wire the concrete multi-row gestures: `revertAllTemps()` (CharacterSheetPage.tsx:760 — the canonical "Temp DX +2 / Revert all" batch), the inventory bulk toolbar / drag-move in `sections/InventoryPanel.tsx`, and any bulk add-from-library flows that enqueue multiple creates. Single edits omit `batchId` (rendered as standalone one-liners).
- The orchestrator already sends the full envelope; pass `batchId` through to the server, where `dispatchOperation` sets `app.batch_id`. History rows from one gesture therefore share a `batch_id` regardless of how the outbox coalesces/drains them.

---

## Delivery: paginated REST read endpoints

Two new read routes (no client writes), using the same OpenAPI/zod pattern as existing routes and reusing access helpers from `src/server/auth/permissions.ts` and the scoping logic in `sync.ts` (`listAccessibleCampaignIds`, `decideCharacterAccess`).

- **`GET /api/v1/characters/:id/history`** (new handlers in `src/server/routes/characters.ts` or a new `history.ts` router): returns `entity_history` rows where `character_id = :id`, scope `character`, ordered `revision DESC`, with `?before=<revision>&limit=<n>` cursor pagination. Authz: `loadCharacterOr403` — owner OR campaign GM/member (respecting minimal-view; see Risks). The GM "view all characters in the campaign" requirement is satisfied because the campaign owner has `full` access to every member character (`decideCharacterAccess`), so the per-character endpoint works for them; the campaign History view (below) also offers a roll-up across all characters.
- **`GET /api/v1/campaigns/:id/history`**: returns rows where `campaign_id = :id` **AND `scope = 'campaign'`**, ordered `revision DESC`, paginated. Authz: `loadCampaignOr403` (member can read; only owner/manager-relevant rows as appropriate). The `scope='campaign'` filter is what **excludes character-level changes** from the campaign view, per requirement.
- **GM character roll-up (optional, same endpoint family):** `GET /api/v1/campaigns/:id/history?scope=character` returns `scope='character'` rows across all characters in the campaign for the GM (owner-only), so a GM can audit "all characters in the campaign" in one stream. Gated to campaign owner.

Response shape: array of `historyEventOut` (new zod schema in `src/shared/schemas/history.ts`): `{ id, revision, scope, entityClass, entityId, op, characterId, campaignId, actorUserId, actorDisplayName, batchId, summary, createdAt }`. The server **computes `summary` server-side** with the shared formatter (below) and joins `users.displayName` for the actor, so the list payload is small and never ships raw private `old_row`/`new_row` jsonb by default. The full field-level `oldRow`/`newRow` is returned **only** when the client requests `?detail=1` (used when expanding a batch) and only after the same authz/redaction check — minimal-view characters get no detail.

Client data access via **TanStack Query** (consistent with campaigns/notifications HTTP reads), with `useInfiniteQuery` for "load older". Filtering & search run **locally** over the loaded pages (see UI).

---

## Shared summary formatter (reused by both views)

New module `src/shared/history/summarize.ts` — pure functions, unit-testable, no DB/UI deps:
- `summarizeEvent(event): { line: string; icon?: string; detail: FieldChange[] }` — produces the one-line summary and the structured field-level diff for the expanded view by diffing `oldRow` vs `newRow` keyed on `entityClass` + `op`.
- Examples it must handle:
  - Attribute change: `"ST 10 → 12"`, `"IQ 12 → 13"`.
  - **Temporary effects** (`characters.temp_effects`, a JSONB list since migration 0017): `"Temporary effect added: Might (ST +2, HT +1)"`, `"Temporary effect removed: Might"`, `"Temporary effects cleared"`, `"Temporary adjustment: ST +2"` (the reserved `manual` sentinel entry the ✦ popovers write to). Pre-migration history rows still carry the old per-stat scalar columns (`tempSt`, `tempDx`, …) in their jsonb snapshot forever — `TEMP_ATTR_LABELS` keeps those readable as `"Temp DX +2"` / `"Temp DX boost cleared"`.
  - Skill/spell/trait: `"Added skill Broadsword (DX/A)"`, `"Removed spell Fireball"`, `"Acrobatics points 2 → 4"`.
  - Inventory: `"Added Torch ×2"`, `"Moved Sword into Backpack"`, `"Removed Rations"`.
  - Campaign: `"Point target 100 → 125"`, `"Disadvantage cap changed"`.
  - Membership: `"Promoted Alice to manager"`, `"Removed Bob from campaign"`.
  - Library: `"Added library item Fine Sword"`.
  - Adventure log: `"Posted session log: The Caves of Chaos"`.
- `groupIntoBatches(events): HistoryGroup[]` — folds consecutive events sharing a non-null `batchId` into one group with a synthesized header line (`"Moved 4 items into Backpack"` when uniform, else `"4 changes"`), exposing children for the expand panel. Standalone events become single-item groups (rendered without a fold arrow).

Diff helpers live alongside (`diffRows(old, new, ignoreKeys)` ignoring `revision`/`updatedAt`/`createdAt`).

---

## UI

### Character History tab
- Add `'History'` to `SHEET_TABS` in `src/client/features/characters/CharacterSheetPage.tsx` and render a new `sections/HistoryPanel.tsx`.
- `HistoryPanel` (props `{ characterId, canRead }`):
  - `useInfiniteQuery` → `GET /characters/:id/history`; runs `groupIntoBatches(summarizeEvent(...))`.
  - Renders a vertical list reusing the row styling from `sections/SkillsPanel.tsx` (grid rows, border-b). Each group is **one line**: timestamp (relative), summary, actor name.
  - **Foldable batches:** groups with >1 child render a disclosure arrow, reusing existing expand patterns already in this file — the `▸`/`▾` toggle in PointsPanel (CharacterSheetPage.tsx:1062) and the `<details>` pattern in WarningsPanel (~:1303); expanding fetches `?detail=1` for that `batchId` and shows each child's `old → new` per field.
  - **Local filter & search:** a search box + filter chips (by entity type: Attributes/Skills/Spells/Inventory/Combat; by op: added/changed/removed; optional date range) that filter the already-loaded list **in memory** (no server round-trip), matching against the summary line and field names. "Load older" button triggers the next page.

### Campaign History view
- Add a `History` section/tab to `src/client/features/campaigns/CampaignDetailPage.tsx` rendering a new `CampaignHistoryPanel.tsx`.
- Same component shell as `HistoryPanel`, but hits `GET /campaigns/:id/history` (scope `campaign` only — **no character changes**). For the campaign **owner**, optionally include a sub-toggle "Character changes" that switches to `?scope=character` (the GM roll-up). Reuses the same `summarizeEvent`/`groupIntoBatches`/filter/search code.

Both panels are read-only and share a `useHistoryQuery` hook + a `HistoryList`/`HistoryGroupRow` presentational component in `src/client/features/history/` to avoid duplication.

---

## Required-baseline enforcement

A trigger fires regardless, but it only records a useful actor/batch if the write path set the GUC. So enforcement needs **two** guards, not one — covering both "table has the trigger" and "write path sets the actor".

1. **Single source of truth list:** the `entityClass` enum in `src/shared/schemas/sync.ts` already enumerates every syncable entity. Add a small `SYNCABLE_TABLES` map (entityClass → physical table name + family `character`/`campaign`) in one shared module; a test asserts the map covers every enum member, so adding an enum value without a mapping fails.
2. **Guard 1 — trigger coverage** (`src/server/db/historyTriggers.test.ts`, Bun, real PG like `sync.test.ts`): query `pg_trigger`/`information_schema.triggers` and assert **every** `SYNCABLE_TABLES` table has a `record_history_trg`. A new table without the trigger fails CI.
3. **Guard 2 — write paths set the actor**: (a) a behavioral test runs a representative mutation through `dispatchOperation` and through each REST campaign handler, then asserts the resulting `entity_history` row has a **non-null `actor_user_id`** (and shared `batch_id` for a batch); a forgotten `withAudit` wrapper yields a null actor and fails. (b) a cheap source-guard test greps the mutating route files (`syncDispatch.ts`, `campaigns.ts`, `invitations.ts`, `campaignLibrary.ts`, `adventureLog.ts`) and fails if any `getDb().insert/update/delete` write occurs outside a `withAudit(` scope.
4. **Convention doc:** add a "History tracking is required for new entities" section to `AGENTS.md`/`README` pointing at this spec, the migration template, and the guards. New entity classes must: add to the enum + `SYNCABLE_TABLES`, add the three triggers in their migration, wrap writes in `withAudit`, and extend `summarizeEvent`.

---

## Files to create / modify (summary)

Create:
- `src/server/db/migrations/0013_entity_history.sql` — table, indexes, `record_history()` + family wrappers, triggers on all 12 syncable tables.
- `src/server/db/auditContext.ts` — `withAudit()` transaction-local GUC helper.
- `src/shared/schemas/history.ts` — `historyEventOut`, query params.
- `src/shared/history/summarize.ts` (+ `summarize.test.ts`) — summary/diff/batch-grouping.
- `src/server/routes/history.ts` (or extend `characters.ts`/`campaigns.ts`) — the two read endpoints (+ GM roll-up).
- `src/client/features/history/{useHistoryQuery.ts, HistoryList.tsx, HistoryGroupRow.tsx}` — shared UI.
- `src/client/features/characters/sections/HistoryPanel.tsx`.
- `src/client/features/campaigns/CampaignHistoryPanel.tsx`.
- `src/server/db/historyTriggers.test.ts` (Guard 1, trigger coverage) + `src/server/db/auditContext.test.ts` (Guard 2, actor-non-null + source guard).

Modify:
- `src/server/db/schema.ts` — add `entityHistory` Drizzle table.
- `src/shared/schemas/sync.ts` — add `batchId` to `operationEnvelope`; add `SYNCABLE_TABLES`.
- `src/client/db/dexie.ts` — add `batchId` to `OutboxEntry`.
- `src/client/sync/outbox.ts` — thread `batchId`; add `runBatch()`.
- `src/server/services/syncDispatch.ts` — wrap dispatchers in `withAudit` and thread the `tx` into `patchEntity`/each `dispatch*` (replacing bare `getDb()` writes); carry `batchId` in the dispatch context. `src/server/routes/sync.ts` — read `op.batchId` into the context.
- `src/server/routes/{campaigns,invitations,campaignLibrary,adventureLog}.ts` — set `app.actor_id` on mutating handlers.
- `src/client/features/characters/CharacterSheetPage.tsx` — add `History` tab.
- `src/client/features/characters/sections/InventoryPanel.tsx` — wrap bulk moves in `runBatch`.
- `src/client/features/campaigns/CampaignDetailPage.tsx` — add History view.
- `AGENTS.md` / `README` — baseline convention.

---

## Risks & edge cases
- **Minimal-view leakage:** a non-GM member of a `shareCharacterSheets=false` campaign must NOT read another player's character history. The character endpoint applies the same `decideCharacterAccess` gate the sync cursor uses (export/share it from `sync.ts`); **deny history entirely (403/empty) for `minimal` access** — a member who can't see the sheet shouldn't see its change log. Owner + GM are always `full`.
- **`old_row`/`new_row` may contain private columns.** Never ship them by default — the list returns only the server-computed `summary`. Detail (`?detail=1`) is gated to `full` viewers and redacts the same private fields blanked by `projectCharacterRow` in `sync.ts`. Redact at read time, not at write time, so the rule can evolve without a backfill.
- **Combat `entity_id` caveat:** sync emits combat keyed by `characterId`, but the history trigger records `entity_id = combat_states.id`. Harmless — history is keyed/filtered by `character_id`, never by combat's own id. Don't try to correlate history `entity_id` with the sync `entityId` for combat. Combat upserts (`onConflictDoUpdate`) fire as INSERT or UPDATE; the `AFTER INSERT OR UPDATE` trigger captures both with no special handling.
- **Create-then-delete in one batch:** both rows recorded; grouping shows them folded. Summarizer should net them sensibly (or just list both) — keep it honest rather than clever.
- **Cascade deletes** (delete character → children): each child fires its own history row with parent lookup possibly null; resolve owner/campaign from `OLD` where possible, mirror tombstone defensive path. The parent-character delete row carries the campaign id for the campaign GM roll-up.
- **Write volume:** every write now also inserts a history row (one extra insert per mutation). Acceptable given current scale; the shared sequence + indexes keep reads cheap. Retention is indefinite per decision; revisit pruning if `entity_history` grows large. High-frequency combat tweaks (HP/FP/posture) could be noisy — consider (future) a per-entity-class "include in history" flag; out of scope now.
- **Migration ordering:** `0013` depends on `revisions_seq` (from `0004`) and the existing syncable tables — fine, it's the latest migration. Hand-write the trigger SQL like prior trigger migrations (they are not auto-generated by `drizzle-kit`).

---

## Verification
1. **Migration:** `npm run db:migrate` on a fresh DB; confirm `entity_history` + triggers exist (`\d entity_history`, `pg_trigger`).
2. **Unit:** `bun test src/shared/history` (summarizer over crafted old/new rows incl. temp-boost, add/remove/move, campaign settings, membership). `bun test src/server` for endpoint authz (extend `sync.test.ts` style) and the enforcement guards.
3. **Server integration:** with `app.actor_id` set, run a character field patch + a 3-item inventory batch through `dispatchOperation`; assert 1 + 3 `entity_history` rows, correct `actor_user_id`, shared `batch_id` for the three, correct `scope`/`character_id`/`campaign_id`. Run a campaign settings PATCH → one `scope='campaign'` row.
4. **Client:** Vitest for `HistoryPanel` (mock the query): renders one-liners, folds a batch, local search/filter narrows the list without refetch. `runBatch` tags ops with one id.
5. **Access:** assert `GET /characters/:id/history` 403s for a minimal-view member and 200s for owner + GM; `GET /campaigns/:id/history` returns only `scope='campaign'` rows.
6. **E2E (Playwright):** GM opens campaign → History shows campaign changes but no character edits; GM opens a member character → History tab shows that character's edits; a multi-item inventory move appears as one foldable entry.
7. **Lint/types:** `npm run lint && npm run typecheck`.
