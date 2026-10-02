# Races and racial templates

A character has one race purchase, defaulting to Human (zero points, no modifiers,
traits, skills, forms, or special behavior). Overview's Identity panel contains one
Race control. Its centered dialog previews the selected race, complete variant,
compatible lenses, and active alternate form before Apply. Cancel preserves the
owned choice. Read-only sheets show the same purchase details; minimal shared sheets
expose only the public race name, never mechanics or source snapshots.

## Campaign definitions

The Races library category uses `libraryRaceCreate` / `libraryRaceUpdate` in
`src/shared/schemas/race.ts`. Owners author name, sourcebook and page,
completeness/restriction metadata, printed total cost, primary and secondary
attribute deltas, Size Modifier, included trait components, racial skill purchases,
features, and supported declarative effects. Components have stable local keys.
Traits retain kind, printed points, level, description, and effects; skills retain
attribute/difficulty, specialization, TL, printed points, and description. Unknown
skill attributes/difficulties may remain null; the app does not invent a level.

Complete variants replace the base profile (for example distinct sexes or castes).
Alternate forms also replace it and retain the purchased race's cost. A lens adds
attribute/point deltas and components, optionally restricts compatible base keys,
and explicitly removes component keys before replacing them. Duplicate component,
variant, or form keys and implicit conflicting replacements are rejected. Lenses
cannot themselves declare complete variants or forms. This separates the Fantasy
sourcebook's full templates from its additive undead lenses and alternate forms.

The editor provides ordinary form controls for tags, components, attributes,
features, effects, complete variants/forms, and lens rules, alongside the shared
metadata editor. Exact tag values are edited as list entries rather than split on
commas. Component removals and compatible bases retain stable references.
Conditional declarations and library weapon references are available throughout
the base profile, racial traits, variants and forms. Owners can author archived
conditions even when active effects are disabled; the character calculation gate
still ignores those declarations until the campaign enables the experiment.
A subtle Raw YAML disclosure edits the same complete draft, preserving optional,
nullable, and imported values during ordinary field edits.
A definition may retain descriptive rules for physiology, social assumptions,
transformation conditions, or other capabilities outside the existing calculator.
Library race citations appear beside the collapsed row's type/points summary,
matching the other library categories, without repeating in the expanded body.
Printed racial package cost is authoritative; the application does not reconstruct
it by summing components or automatically reprice limitations or Size Modifier.

## Ownership and calculation

`characters.race` is an atomic `characterRace` value with selection IDs and an owned
resolved snapshot. The server's `prepareRace` is shared by REST and sync. New choices
resolve only complete, selectable definitions in the character's campaign, with
membership and restrictions checked inside the audited transaction. Submitted
snapshots are previews; callers cannot inject arbitrary mechanics. An adoption
preview with a saved source revision is rejected if that definition changed,
so an updated source cannot silently change the cost the player reviewed. Existing
form-only changes resolve from the server's owned forms. The natural profile and
all forms already include selected lenses and fixed purchase cost.

Changing race never edits personal attribute inputs or inserts/deletes personal
trait/skill rows. Racial primary/secondary deltas apply before ordinary derived
stats and effects. Primary attribute cells show the effective value when it differs from the personal
base, with the editable personal purchase and total adjustment alongside it.
Its printed total appears once in the Race ledger bucket; component points,
racial disadvantages, and racial training are not billed again
in personal categories or personal disadvantage caps. Racial traits participate
in Magery/prerequisite checks and contribute their declared effects, with stable
component attribution. Racial and personal skill points combine only when name,
attribute, difficulty, specialization, and TL match. Race-only skills are read-only
projections (`raceGranted`, `racialTrainingPoints`) usable by skill defaults,
prerequisites, techniques, and combat calculations. Missing skill metadata yields
an unresolved level. Exact personal/racial trait-name overlap is called out in the
selection preview; both purchases remain and declared effects can add together,
so the player must review duplicate personal traits explicitly. Size Modifier is
retained for display; there is no automatic body-plan/size pricing engine.

Owned rules and provenance survive source edits/deletion, restriction changes,
and campaign moves. Those operations do not refresh or reprice the purchase.
Human is always available, including outside a campaign. Future automatic race
migration or repricing would require an explicit new behavior and confirmation.

## Storage, offline access, history, and MCP

Migration 0067 creates `campaign_library_races`, with normal revision, history,
and tombstone triggers, and adds the Human default to existing characters.
Migration 0068 backfills race sourcebook links and owned provenance to UUIDs,
using each owned source snapshot's original campaign after character transfers.
Owned mechanics, forms, and paid package costs remain intact. Sourcebook links
use campaign-scoped UUID foreign keys; YAML translates portable source labels.
Dexie v16 adds `campaignLibraryRaces`; `campaign_library_race` participates in
all library registries, cursor pulls, outbox validation, whole-entry coalescing,
stale-base handling, rollback toast/flash, access pruning, and logout purge.
Dexie v17 upgrades cached race definitions, owned provenance, and queued edits
to sourcebook UUIDs along with the other library categories.
Race choices use the root character's `race` field patch and `useDraftField`.
Stale race retries, and campaign retries with a later race choice, retain their
original enqueue position rather than reordering context-dependent choices.
Ordinary campaign transfers retain their existing coalescing and reference-undo
behavior. Same-field writes serialize; race and campaign assignment writes retain
their order across one another, while unrelated fields remain parallel. Pending race
choices wait for speculative definition writes through library dependencies.
Cursor hydration validates owned race shape and the minimal-view sweep scrubs
owned mechanics while retaining the public name. Full hydration clears a cached
minimal-view name so a later privacy sweep uses the current owned race.

YAML v15 exports an optional `races` section, with source-scoped portability and
canonical keys. Older imports omitting it preserve existing races even in replace
mode. The shared library graph validates editions and sourcebook UUIDs. Campaign and
character history record definition and selection changes respectively.
`library_race` MCP create/update/delete operations use the same handlers and
schemas as REST, while existing library reads/import/export and character
operations include the new content. OAuth scopes, owner restrictions, audit,
share-gate projections, sync revisions and invalidation remain the same.
