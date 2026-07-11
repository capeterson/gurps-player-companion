# Design Spec: JSON / JSONB Field Catalog

> Every JSON-typed field the app persists — Postgres `jsonb` columns and the
> client-side IndexedDB (Dexie) mirrors of them — mapped to the Zod schema
> that defines its shape and the boundary where that schema is enforced.
> If you add a JSON-typed field anywhere, add it here **and** give it a Zod
> schema in `src/shared/schemas/` in the same change.

## Why this exists

`jsonb` columns are the one place the database can't enforce shape. The
project convention is therefore:

1. **Every jsonb column has a Zod schema** in `src/shared/schemas/` that is
   the single source of truth for its shape.
2. **Every write path validates through that schema** — REST bodies via
   `@hono/zod-openapi` request schemas, sync ops via the per-field validators
   in `src/server/services/syncDispatch.ts` (which carve `.shape[field]` out
   of the same update schemas, so REST and sync can't diverge).
3. **The Drizzle column is typed with `$type<...>`** against the Zod-inferred
   type (type-only import in `src/server/db/schema.ts`), so server code that
   reads or writes the column gets the same shape the wire contract promises.

The two deliberate exceptions (`notifications.payload`,
`entity_history.old_row/new_row`) are documented below.

## Postgres `jsonb` columns

| Table.column | Shape schema (`src/shared/schemas/`) | Validated at |
|---|---|---|
| `characters.dismissed_warnings` | `dismissedWarningsField` (character.ts) — `string[]` of warning codes | REST `/characters/{id}/warnings/dismiss` (`dismissWarningRequest`, one code at a time); sync patch `fieldPath: 'dismissedWarnings'` via `characterSyncPatch` |
| `characters.temp_effects` | `tempEffectsField` (character.ts) — `TempEffect[]`, max 40, `{ id, name, mods }` with `mods` a strict per-axis object (`TEMP_STAT_AXES`); `superRefine` enforces unique ids and a per-axis SUM across all effects within [-50, 50]. The `id: 'manual'` sentinel (`MANUAL_TEMP_EFFECT_ID`) is the entry the ✦ modifier popovers write to; other ids are client uuids for named effects. | REST character create/update (`characterCreate` / `characterUpdate`, via `characterAttributesShape`); sync patch `fieldPath: 'tempEffects'` (whole-array replace) via `characterSyncPatch`. Share-gate masked to `[]` for minimal-view characters (`projectCharacterRow` in `routes/sync.ts`). |
| `character_traits.modifiers` | `traitModifier[]` (trait.ts) | REST trait create/update (`traitCreate` / `traitUpdate`); sync per-field validator |
| `inventory_items.armor` | `armorData` (inventory.ts), nullable | REST inventory create/update (`inventoryItemCreate` / `inventoryItemUpdate`); sync per-field validator |
| `inventory_items.weapon_data` | `weaponData` (inventory.ts), nullable | same as `armor` |
| `inventory_items.powerstone_data` | `powerstoneData` (inventory.ts), nullable; refinement: `currentEnergy <= maxEnergy` | same as `armor` |
| `inventory_items.magic_item_data` | `magicItemData` (inventory.ts), nullable; refinement: `chargesCurrent <= chargesMax` | same as `armor` |
| `combat_states.conditions` | `combatStateUpdate.conditions` (combat.ts) — `string[]`, each 1–80 chars, max 64 | REST combat patch; sync per-field validator |
| `adventure_log_entries.xp_awards` | `xpAward[]` (adventureLog.ts) — `{ characterId, amount }`, max 50 | REST log create/update (`adventureLogCreate` / `adventureLogUpdate`) |
| `campaign_library_traits.available_modifiers` | `traitModifier[]` (trait.ts) | REST library CRUD + YAML import (`libraryTraitCreate`) |
| `campaign_library_traits.tags` | `tagList` (campaignLibrary.ts) — `string[]`, each 1–40 chars | REST library CRUD + YAML import |
| `campaign_library_skills.situational_modifiers` | `situationalModifier[]` (skill.ts) | REST library CRUD + YAML import (`librarySkillCreate`) |
| `campaign_library_items.armor` | `armorData` (inventory.ts), nullable | REST library CRUD + YAML import (`libraryItemCreate`) |
| `campaign_library_items.weapon_data` | `weaponData` (inventory.ts), nullable | REST library CRUD + YAML import |
| `notifications.payload` | Per-type: `campaignInvitationNotificationPayload` (notification.ts) for `type='campaign_invitation'` | Emit site (`invitations.ts` parses before insert); consume site (`NotificationsBell` `safeParse`s) |
| `entity_history.old_row` / `new_row` | *Intentionally schemaless* — raw `to_jsonb(OLD/NEW)` row snapshots written by DB triggers | Read-only; exposed as `z.record(z.unknown())` in `historyEventOut` and only with `?detail=1` + full access (see history-tracking.md) |

Notes on the exceptions:

- **`notifications.payload`** is a discriminated-by-`type` envelope; the
  column stays `Record<string, unknown>` at the DB layer because rows of many
  types share it. Each type gets its own payload schema in
  `src/shared/schemas/notification.ts`; both the emitting router and the
  consuming component must go through it. Payload keys are **snake_case**
  (rows predate the schema); do not rename keys without a data migration.
- **`entity_history.old_row` / `new_row`** are trigger-written snapshots of
  whole rows across all syncable tables — their shape is "whatever the table
  looked like at write time", which is exactly what an audit log wants.
  Column names inside the snapshots are the **Postgres snake_case names**,
  not the camelCase API names (e.g. `author_id`, `share_character_sheets`).

## Client-side JSON persistence (Dexie / IndexedDB)

Dexie rows mirror the server row shapes 1:1 (`src/client/db/dexie.ts`); the
jsonb-backed fields above appear there as the same shapes
(`LocalCharacterInventory.armor` etc.). Additionally the sync machinery
persists JSON of its own:

| Store.field | Shape |
|---|---|
| `outbox.attemptedValue` / `prevValue` | The **bare field value** for `patch` ops (rule S2), the full create payload for `create`, the deleted row snapshot for `delete`. Never a wrapper object. |
| `syncMeta.value` | Per-key blobs (e.g. `bootstrap:<userId>` → `{ bootstrappedAt }`). Owned by the orchestrator. |
| `rejectionToasts` rows | `RejectionRecord` interface in dexie.ts. |

These are client-internal (never sent verbatim to the server — `outbox`
entries are re-validated server-side per field) so TypeScript interfaces in
`dexie.ts` are their schema documents.

## Checklist for adding a new JSON field

1. Define the Zod schema in `src/shared/schemas/*.ts` next to its entity.
2. Reference it from every write boundary (REST body schema, and — if the
   entity is sync-backed — make sure the field is reachable through the
   `xxxUpdate` schema the sync dispatcher derives per-field validators from).
3. Add `$type<YourType>()` to the Drizzle column with a doc comment naming
   the schema.
4. Mirror the type on the Dexie interface if the entity is sync-backed.
5. Add a row to the table above.
