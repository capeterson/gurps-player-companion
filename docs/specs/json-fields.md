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
| `campaign_library_{traits,skills,spells,items,languages,techniques,styles,enchantments,active_effects,modifiers,races}.extraction` | Nullable `extractionRecord` (libraryMetadata.ts): preserved rawText/reviewNotes/locator | Shared library create/update schemas at REST, sync, YAML and client validation; typed Drizzle columns |
| `campaign_library_traits.calculation`, `campaign_library_items.calculation`, `campaign_library_modifiers.calculation` | Nullable `calculationDefinition` (calculation.ts), bounded CalculationDefinitionV1 graph | Create/update/YAML schema plus final reference-graph validation; typed Drizzle columns |
| `campaign_library_modifiers.applicability` | `modifierApplicability` (libraryMetadata.ts): universal/kinds/tags/exact references/advisory | All shared definition write boundaries and final graph validation |
| `campaign_library_modifiers.tags` | `libraryModifierCreate.shape.tags`: max 100 strings, 1–40 characters | Shared schemas at all write boundaries |
| `character_traits.pricing_resolution`, `inventory_items.pricing_resolution` | Nullable `pricingResolution` (calculation.ts), full rule/input/output/dependency snapshot; optional localModifier for embedded rules | Trait/inventory REST and sync schemas; authoritative shared library resolution on linked purchase/re-resolution; typed Drizzle columns |
| `character_traits.library_mechanics`, `character_skills.library_mechanics` | `libraryMechanics` (libraryMechanics.ts), nullable: source UUID, campaign UUID/null, source revision/null, effect declarations/null, optional detached flag; skill copies additionally carry validated `ownedSkillRules` (TL policy, prerequisite tree, defaults, groups, tags, and durable GM-permission grants scoped to their approved specialization) | Read-only owned copy; `captureLibraryMechanics`, `refreshOwnedLibraryMechanics`, and transfer helper validate every application write through Zod in the audited transaction. REST and sync use the same helpers; caller-supplied snapshots are not writable. Migration 0036 backfills from existing validated source fields only within the character campaign; legacy trait kind mismatches preserve effects as detached copies. |
| `campaigns.house_rules` | `campaignHouseRules` (campaign.ts): strict preset identity (`none`, `j_talisar`, or `custom`) plus the complete option bundle (booleans and the integer `limitationCapPercent`, 0–100); omitted legacy keys normalize through per-key defaults | Campaign REST create/update and opt-in YAML settings import share the Zod schema. `applyHouseRuleSet` replaces values for named presets but preserves them when selecting Custom. Drizzle `$type<CampaignHouseRules>`, campaign cursor/Dexie mirror, and character detail carry the normalized setting. |
| `characters.dismissed_warnings` | `dismissedWarningsField` (character.ts) — `string[]` of warning codes | REST `/characters/{id}/warnings/dismiss` (`dismissWarningRequest`, one code at a time); sync patch `fieldPath: 'dismissedWarnings'` via `characterSyncPatch` |
| `characters.temp_effects` | `tempEffectsField` (character.ts) — `TempEffect[]`, max 40, `{ id, name, mods }` with `mods` a strict per-axis object (`TEMP_STAT_AXES`); `superRefine` enforces unique ids and a per-axis SUM across all effects within [-50, 50]. The `id: 'manual'` sentinel (`MANUAL_TEMP_EFFECT_ID`) is the entry the ✦ modifier popovers write to; other ids are client uuids for named effects. | REST character create/update (`characterCreate` / `characterUpdate`, via `characterAttributesShape`); sync patch `fieldPath: 'tempEffects'` (whole-array replace) via `characterSyncPatch`. Share-gate masked to `[]` for minimal-view characters (`projectCharacterRow` in `routes/sync.ts`). |
| `character_traits.modifiers` | `traitModifier[]` (trait.ts) | REST trait create/update (`traitCreate` / `traitUpdate`); sync per-field validator |
| `character_traits.custom_effects` | `traitEffect[]` (effects.ts), max 50; unlike portable library declarations this may use an exact `inventory_item` selector | REST trait create/update and the local-first sync patch path; the character trait effect editor validates the full array before enqueueing it. Migration 0043 defaults existing rows to `[]`. |
| `character_skills.defaults` | `skillDefaults` (skill.ts): null = unknown legacy declaration, [] = no default, otherwise up to 20 strict attribute/skill plus modifier records; skill references may use a legacy exact-specialization string or structured `exact`, `same`, or `any` matching | REST skill create/update, sync create/per-field/whole-body validators; copied by the library picker and mirrored in Dexie |
| `campaign_library_skills.defaults` | `skillDefaults` (skill.ts), nullable list of attribute, skill, skill-group, or skill-tag candidates with specialization matching and explicit three-valued applicability conditions | Library REST CRUD and YAML v10 import/export; owned snapshots drive offline calculation |
| `campaign_library_skills.tech_level_policy` | `skillTechLevelPolicy` (skill.ts): `not_applicable`, required `/TL` with suggestion source, or fixed TL | Library REST/MCP CRUD and YAML v10; shared reference handler validates character REST/sync creates |
| `campaign_library_skills.prerequisite_rules` | recursive `skillPrerequisite` (skill.ts): nested all/any groups and typed skill, trait, attribute, TL, campaign-rule, or GM-permission leaves | Library REST/MCP CRUD and YAML v10; authoritative add/point-increase enforcement and offline warnings |
| `campaign_library_skills.groups`, `campaign_library_skills.tags` | `tagList` (campaignLibrary.ts), natural-name selector metadata | Library REST/MCP CRUD and YAML v10; snapshotted onto learned skills |
| `campaign_library_skills.specialization_policy` | `librarySkillSpecializationPolicy` (campaignLibrary.ts): `none`, required/optional free-form, or required/optional catalog; catalog options have unique normalized names and optional description, prerequisites, and `skillDefaults` overrides | Library REST CRUD + YAML v10 import/export; character REST/sync reference validation; library editor and character picker |
| `inventory_items.armor` | `armorData` (inventory.ts), nullable; nests `typedDr` (`typedArmorDr` — per-damage-type DR overrides for cut/imp/pi/pi−/pi+/pi++/burn/corr/fat/tox, defaults to `{}`; `aggregateDrByLocation` builds the per-location type total from each layer's override when present, else that layer's base `dr`, so a base-DR 4 jacket plus a DR 2 coif with `cut: 5` resolves cut DR 9 — the override replaces the affected layer's contribution, never the whole stack; `resolveDr` falls back to `drCrushing` for `cr` then `dr`; torso coverage also protects vitals, with repeated or explicit torso/vitals entries counted once per layer) plus optional `concealable` for legal flexible inner layers (B286) and `db` (legacy manual Deflect; highest available equipped value applies to all defenses, M67) | REST inventory create/update (`inventoryItemCreate` / `inventoryItemUpdate`); sync per-field validator |
| `inventory_items.weapon_data` | `weaponData` (inventory.ts), nullable; nests `rangedData` (`ranged`, null = melee-only) with `rangedRange` (`fixed` yards, `st_multiplier` of wielder/weapon ST, or `legacy` unconverted notation for repair) plus `weaponSt` (purchased ST), `strengthKind` (ordinary/bow/crossbow/natural), and `skill` (governing-skill name), `db` (shield Defense Bonus, non-null = shield), optional `wieldedSide` (`left`/`right`) for facing-aware shield DB, and authoritative `modes` (1–20 independent keyed `weaponMode` entries). Primary fields and `alternateModes` (max 20) remain compatibility inputs/projections; normalization resolves legacy inheritance once | same as `armor` |
| `inventory_items.powerstone_data` | `powerstoneData` (inventory.ts), nullable; refinement: `currentEnergy <= maxEnergy` | same as `armor` |
| `inventory_items.magic_item_data` | `magicItemData` (inventory.ts), nullable; refinement: `chargesCurrent <= chargesMax` | same as `armor` |
| `inventory_items.enchantments` | `enchantmentRef[]` (inventory.ts), max 50. The legacy `{ spellName, spellLevel?, category?, notes? }` shape remains non-mechanical. `spellLevel` records per-spell Item Power; typed effects require sufficient Power under campaign mana, and unknown Power is explicitly inactive. A typed instance may add selected `level`, nullable definition UUID/revision/source, and `enchantmentMechanics`: applicability, flat effects, optional level effects, and stack/highest policy. | REST and sync inventory writes share authoritative same-campaign definition hydration; local-only definitions are validated by `inventoryItemUpdate`. `itemEnchantments.ts` consumes owned snapshots in both detail builders. |
| `combat_states.conditions` | `combatStateUpdate.conditions` (combat.ts) — `string[]`, each 1–80 chars, max 64 | REST combat patch; sync per-field validator |
| `adventure_log_entries.xp_awards` | `xpAwardsField` (adventureLog.ts) — `{ characterId, amount }[]`, max 500, unique recipient IDs for new awards; legacy duplicate arrays remain readable and unchanged on text-only edits | REST/MCP log create/update and server roster expansion (`resolveLogAwards`); recipients and authority checked under locks before crediting `characters.earned_points` |
| `campaign_library_traits.available_modifiers` | `libraryTraitModifier[]` (trait.ts), requiring a fixed cost or calculationDefinition; purchased snapshots are not library definitions | REST library CRUD + YAML import (`libraryTraitCreate`) |
| `campaign_library_traits.tags` | `tagList` (campaignLibrary.ts) — `string[]`, each 1–40 chars | REST library CRUD + YAML import |
| `campaign_library_traits.variants` | `traitVariant[]` (trait.ts) | REST library CRUD + YAML import (`libraryTraitCreate`) |
| `campaign_library_traits.effects` | `libraryTraitEffect[]` (effects.ts); global/stat/skill effects plus weapon attack/Parry/Block/damage/Accuracy targets. Weapon targets require a deterministic portable selector (governing skill + optional specialty, exact normalized weapon name, or library-item provenance); attack/damage/Accuracy may narrow to a stable `modeKey`; legacy `modeName` remains supported. Governing-skill selectors apply only to matching independent modes. Character-local `inventory_item` selectors exist only in the broader owned `traitEffect` schema and are rejected here. Active `dr` effects retain optional `hitLocation`. | REST library CRUD + YAML v10 import (`libraryTraitCreate`) |
| `campaign_library_skills.situational_modifiers` | `situationalModifier[]` (skill.ts) | REST library CRUD + YAML import (`librarySkillCreate`) |
| `campaign_library_skills.effects` | `libraryTraitEffect[]` (effects.ts); same target-aware validation and portable weapon-selector rules as trait effects. Skill-definition authoring exposes flat effects because skills have no purchased trait level. | REST library CRUD + YAML v10 import (`librarySkillCreate`) |
| `campaign_library_styles.techniques` | `styleTechniqueRef[]` (campaignLibrary.ts) — `{ name, defaultSkillName, difficulty, maxLevel? }`, max 100. Denormalized (no technique id) so a style survives a YAML round trip into a campaign whose technique rows don't exist yet | REST library CRUD + YAML import (`libraryStyleCreate`) |
| `campaign_library_styles.perks` / `.skills` | `styleNameList` (campaignLibrary.ts) — `string[]`, each 1–160 chars, max 100 | REST library CRUD + YAML import (`libraryStyleCreate`) |
| `campaign_library_items.armor` | `armorData` (inventory.ts), nullable — same shape as `inventory_items.armor` incl. `typedDr` / `db` | REST library CRUD + YAML import (`libraryItemCreate`) |
| `campaign_library_items.weapon_data` | `weaponData` (inventory.ts), nullable — same shape as `inventory_items.weapon_data` including structured `rangedRange`, independent keyed `modes`, compatibility primary/alternate projection, `db` and `wieldedSide` | REST library CRUD + YAML import |
| `encounter_combatants.conditions` | `combatantConditionsField` (encounter.ts) — `string[]`, each 1–80 chars, max 64 | Encounter combatant create defaults to `[]`; REST combatant patch (`combatantUpdate`) |
| `encounter_effects.duration` | `effectDuration` (encounter.ts) — discriminated `{ unit, amount? }` round/minute/hour/indefinite duration | Encounter effect create/update (`effectCreate` / `effectUpdate`) |
| `campaign_library_items.powerstone_data` | `powerstoneData` (inventory.ts), nullable; refinement: `currentEnergy <= maxEnergy` — same shape as `inventory_items.powerstone_data` | REST library CRUD + YAML import |
| `campaign_library_items.magic_item_data` | `magicItemData` (inventory.ts), nullable; refinement: `chargesCurrent <= chargesMax` — same shape as `inventory_items.magic_item_data` | REST library CRUD + YAML import |
| `campaign_library_items.enchantments` | `enchantmentRef[]` (inventory.ts), max 50, defaults to `[]` — same shape as `inventory_items.enchantments`; carried onto inventory copies via the InventoryPanel library pick | REST library CRUD + YAML import (`libraryItemCreate`) |
| `campaign_library_enchantments.tags` | `tagList` (campaignLibrary.ts), max 100 normalized authoring/search labels | Owner-only library REST/MCP CRUD and YAML v10 import/export |
| `campaign_library_enchantments.effects` | `enchantmentEffect[]` (inventory.ts): typed attack/damage/Accuracy/Parry/Block/armor-divisor/DR/DB/weight-reduction/skill flat contributions; skill target requires `skillName` | Owner-only library REST/MCP CRUD and YAML v10 import/export; snapshotted onto linked items |
| `campaign_library_enchantments.levels` | `enchantmentLevel[]` (inventory.ts): unique selectable integer levels, optional label, and typed effect arrays | Same definition boundaries; the selected item instance level activates its matching row in addition to base effects |
| `campaign_library_enchantments.stacking_policy` | `enchantmentStackingPolicy` (inventory.ts): strict `stack` or `highest` plus a non-empty combination key | Same definition boundaries; the shared resolver chooses the highest aggregate contribution per instance/target/key |
| `notifications.payload` | Per-type: `campaignInvitationNotificationPayload` for invitations; `eventNotificationPayload` for `type='event'` (notification.ts) | Invitation route, validated invitation-response route helper and notification event worker; bell/desktop consumers safe-parse per type |
| `users.notification_preferences` | `notificationPreferences` (notificationPreferences.ts) | Settings GET/PATCH and event/email delivery parse; SQL default is the same validated field set |
| `entity_history.old_row` / `new_row` | *Intentionally schemaless* — raw `to_jsonb(OLD/NEW)` row snapshots written by DB triggers | Read-only; exposed as `z.record(z.unknown())` in `historyEventOut` and only with `?detail=1` + full access (see history-tracking.md) |

Notes on the exceptions:

- **`notifications.payload`** is a discriminated-by-`type` envelope; the
  column stays `Record<string, unknown>` at the DB layer because rows of many
  types share it. Each type gets its own payload schema in
  `src/shared/schemas/notification.ts`; both the emitting router and the
  consuming component must go through it. Existing invitation payload keys are
  **snake_case** (rows predate the schema); do not rename them without a migration.
  New generic event payloads use their schema's camelCase fields.
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
| `characterTraits.libraryMechanics`, `characterSkills.libraryMechanics` | `libraryMechanics` (libraryMechanics.ts): mirrors the owned Postgres declarations and optional detached flag. Null effects mean unavailable, an empty array means known empty. Validated during cursor emission/application, local derivation, and speculative creation from a selected definition. Speculative metadata is stored atomically with the outbox but excluded from its wire payload. Typed as `LibraryMechanics` in Dexie. |
| `campaignLibrary*` stores (v12) | Each row is the library entity's REST `…Out` projection plus `revision`, exactly as `/sync/cursor` emits it, so its JSON fields (`effects`, `availableModifiers`, `specializationPolicy`, `techLevelPolicy`, `procedures`, `stackingPolicy`, `duration`, …) keep the schemas catalogued above. Typed as `LocalLibrary*` in dexie.ts; the page validates drafts with the same shared create/update schemas before writing. |
| `outbox.attemptedValue` / `prevValue` | The **bare field value** for per-field `patch` ops (rule S2), the full create payload for `create`, the deleted row snapshot for `delete`. A whole-entry library or character-pricing `patch` (no `fieldPath`, rule S13) carries the entity's update body and the full pre-edit row. Never a wrapper object. |
| `outbox.localInventoryPromotionUndo` | `localInventoryPromotionUndo` (inventory.ts): strict child UUID plus before/after parent, carried flag and external label; validated at atomic deletion capture and recovery, typed by the schema in Dexie, excluded from wire envelopes. |
| `outbox.localCampaignTransferUndo` | Client-only child reference preimages and detached postimages for campaign assignment rollback; typed as `LocalCampaignTransferUndo[]`. Any new declaration postimage is validated with `libraryMechanics`. Stored atomically with the parent edit; excluded from the sync wire envelope. |
| `syncMeta.value` | Per-key blobs (e.g. `bootstrap:<userId>` → `{ bootstrappedAt }`). Owned by the orchestrator. |
| `rejectionToasts` rows | `RejectionRecord` interface in dexie.ts. |
| `syncLog.previousValue`, `.newValue`, `.request`, `.details` / gzip body envelope | Device-local bounded arbitrary diagnostic values, validated as `syncLogPayload` (`syncLog.ts`) when packing/decoding. Small and legacy payloads remain inline; larger new payloads are UTF-8 JSON gzip bytes in the binary `syncLogBodies.bytes` field (Dexie v15), never base64 or a server column. |
| `syncLog.payloadMetadata` | `syncLogPayloadMetadata` (`syncLog.ts`), parsed at compression writes: snapshot-presence flag, optional acknowledgement/cursor revision, request-presence flag, applied-field names, and optional finite numeric before/after values for continuity checks, so grouping does not decode bodies. Access redaction clears this metadata with the payload. |

The remaining sync bookkeeping rows are client-internal (never sent verbatim to the server — `outbox`
entries are re-validated server-side per field) so TypeScript interfaces in
`dexie.ts` are their schema documents.

Migration 0042 adds OAuth and mutation-idempotency tables using PostgreSQL
arrays and scalar/text columns. It adds no JSON/JSONB field: idempotent response
bodies are serialized text and returned only after the current actor/grant is
validated.

For both library effect arrays, `damage_thrust` / `damage_swing` values are
signed flat adds to the corresponding final ST-based damage dice. Scaling
and active conditions apply before summation; temporary ST changes the base
table lookup first. Weapon adds then apply once; explicit weapon dice do not
receive these ST-based bonuses.

Weapon-scoped declarations are copied into the same owned mechanics snapshots.
Resolved character-detail effects add `matchedInventoryItemIds` and a
`weaponMatchStatus` (`zero`, `one`, or `multiple`) for presentation only; those
diagnostic fields are derived, not persisted. Runtime `library_item` matching
uses its UUID when present. YAML export removes that local UUID and retains the
name fallback, which still requires non-null `inventory_items.library_item_id`.

## Checklist for adding a new JSON field

1. Define the Zod schema in `src/shared/schemas/*.ts` next to its entity.
2. Reference it from every write boundary (REST body schema, and — if the
   entity is sync-backed — make sure the field is reachable through the
   `xxxUpdate` schema the sync dispatcher derives per-field validators from).
3. Add `$type<YourType>()` to the Drizzle column with a doc comment naming
   the schema.
4. Mirror the type on the Dexie interface if the entity is sync-backed.
5. Add a row to the table above.

## Active effects and skill procedures

| Field | Zod schema and write boundaries |
|---|---|
| `characters.active_effects` | `activeEffectsField` (`activeEffects.ts`), typed `ActiveEffectInstance[]`; character create/update/sync schemas, authoritative source hydration, library refresh, and transactional client writes. Cursor application validates too. |
| `campaign_library_active_effects.tags`, `.effects`, `.capabilities`, `.duration`, `.stacking` | Corresponding fields of `activeEffectDefinitionCreate`; Drizzle types derive from `ActiveEffectDefinition`. Library CRUD/YAML validate, and refresh reparses `activeEffectsField`. |
| `campaign_library_skills.procedures` | `skillProcedures` (`skillProcedures.ts`), typed `SkillProcedures`; library CRUD/YAML and owned-snapshot parsing. |
| `character_skills.library_mechanics.skillRules.procedures` | Optional `skillProcedures` within `ownedSkillRules`; captured, refreshed and retained with existing owned mechanics. |
| Dexie `campaigns.activeEffectDefinitions` | Read-only `activeEffectDefinitionOut[]` cursor projection; validated at emission/application, retained by campaign mirrors, purged with campaigns. No additional server JSON column. |

Race source snapshots, calculation rule references, modifier applicability and pricing-resolution
snapshots qualify editions with nullable `sourceId` UUIDs. Migration 0068 converts
legacy nested `sourceKey` labels without recalculating paid values; only portable
YAML translates these references back to labels. Append-only history snapshots
retain their original recorded shape.

## Race ownership and definitions

| JSONB field | Schema and boundaries |
| --- | --- |
| `characters.race` | `characterRace` in `race.ts`, typed `CharacterRace`; create/update/sync and client cursor/outbox validate shape. Shared `prepareRace` authoritatively resolves selection or retained forms at REST/sync writes. |
| `campaign_library_races.attribute_modifiers` | `raceAttributeModifiers`; `libraryRaceCreate`/update, whole-row validation, YAML, and client outbox. Drizzle `LibraryRaceCreate['attributeModifiers']`. |
| `campaign_library_races.traits`, `.skills` | Arrays of `racialTrait` / `racialSkill`; same library boundaries, unique component-key domain checks; Drizzle indexed `LibraryRaceCreate` types. |
| `campaign_library_races.features`, `.effects` | Bounded descriptive strings / portable `libraryTraitEffect` array; same library boundaries and typed columns. |
| `campaign_library_races.variants`, `.forms` | `raceOption` arrays (complete profiles); same library boundaries plus unique-key/domain validation; typed indexed fields. |
| `campaign_library_races.compatible_race_keys`, `.removes_traits`, `.removes_skills`, `.tags` | Bounded string-key/tag arrays from `libraryRaceCreate`; same boundaries and indexed Drizzle types. |
| `campaign_library_races.extraction` | Nullable `extractionRecord` via library metadata; same REST/sync/YAML/client boundaries and `$type<LibraryMetadata['extraction']>`. |

Client-only container deletion undo uses `OutboxEntry.localInventoryPromotionUndo`,
validated by `localInventoryPromotionUndo` (inventory.ts) at capture and recovery.
Each entry records a child UUID and before/after parent, root-carried and external
location values. It is excluded from operation envelopes and server payloads.
