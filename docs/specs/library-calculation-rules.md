# Library calculation rules and source editions

This subsystem represents user-supplied material without supplying book content or
extracting PDFs. YAML v14, REST, MCP and local-first authoring share the same
schemas. Extraction, OCR and classification remain external responsibilities.

## Identity, sources and completeness

Every live definition has a canonical `key`, optional sourcebook UUID `sourceId` and
`sourceLocator`, legacy free-form `source`, `status`, `role`,
`preferredEdition`, and optional `extraction` evidence. The latter retains
`rawText`, `reviewNotes` and an optional locator; none is executable.
Keys normalize whitespace and case. A section's natural identity is key plus
sourcebook UUID; traits additionally include kind. Display names are not identities.
Renaming an entry does not change its explicit key.

Sources are campaign-owned, sync-backed records with UUID, publication title
(`name` in the API), abbreviation, edition, priority and notes. Lower priority
numbers win. Preferred editions resolve by explicit entry override, source
priority, then stable source-UUID order. Multiple explicit overrides of the same
concept are rejected. Source-less legacy entries are a single legacy edition:
citations are never guessed or parsed into source identities.
The database uses campaign-scoped foreign keys to the sourcebook UUID. Titles,
abbreviations and editions can be edited without changing links. The sourcebook
form has no key field; entry editors select a book by UUID and show
`<abbreviation>: <publication title>`. A compact **Page** input stays beside the
sourcebook on the same row at every width; its text preserves existing ranges
and section references. The normal metadata editor does not expose the definition
key; edits preserve it, and new entries use the existing automatic key derivation.
Definition keys still participate in edition matching and rule references.
Portable YAML `key`/`sourceKey` labels are
translated only during import/export, including nested calculation calls and
modifier applicability. Import matches declared book metadata to target UUIDs;
export derives distinct labels from the abbreviation/title/edition. Source-scoped
export selects live UUIDs, while an incoming YAML scope selects its portable labels.
Migration 0067 backfills existing links within each campaign before removing
`source_key` columns and the sourcebook's `key` column. Unresolved live links abort
migration. Character pricing snapshots keep rules and paid values, resolving the
original definition's campaign even after a character move. Historical audit rows
remain untouched. Dexie v16 upgrades cached and queued references; unresolved
older queued intent is retained and held for an explicit sourcebook choice.

New campaigns begin with 17 common Fourth Edition source records (all priority
100), listed in [campaign content sharing](campaign-content-sharing.md); owners
can delete any of them. This seed runs only when the campaign is created.

Only `status: complete` with role `definition` or `template` is adoptable.
`needs_review`, `reference_only`, examples and references remain searchable in
the library. Character pickers exclude them, and the server independently enforces
the gate. Promotion is an explicit authoring operation, not an importer heuristic.
Normal pickers show preferred adoptable editions; Other sources exposes alternatives
within the same picker. Source changes never silently change a character's prices.
The separate **Restricted** flag makes a definition GM-only. Player REST,
MCP, YAML and sync reads exclude it; new player character links are rejected.
Existing character snapshots remain usable. Restriction is independent of
completeness, so internal pricing references still resolve.

## Modifiers

`campaign_library_modifier` holds standalone enhancements and limitations.
Applicability is an OR of universal, trait kinds, trait tags and exact portable
trait references. Advisory prose is displayed, not interpreted as code or a
guaranteed machine-checkable prerequisite. Exact references include source edition
and may include trait kind. A modifier declares `costType: percent | flat`.
The calculation resolves its `modifier` output before the existing GURPS
percentage/flat adjustment pipeline runs. Mutually exclusive group selections
are rejected.

Trait-local `availableModifiers` remain supported. Legacy fixed values normalize
to constant rules. Trait-local calculation snapshots identify the parent trait
edition/revision and `localModifier` name. Standalone snapshots identify their own
definition. Purchased modifier name, description, group and resolved cost are
retained with the character.

## CalculationDefinitionV1

The public language is a flat, named expression graph, not source code. Each
definition has `version: 1`, `inputs`, `tables`, `nodes` and `outputs`.
Node IDs and input/output/table keys are local to a rule.

Inputs are bounded numbers (min/max/step and unit), choices (labeled scalar
values), or booleans. Defaults are optional and validated. Units include level,
dice, count, divisor, percentage, points, currency and pounds.

Nodes support:

- `constant` and `input`.
- `add`, `multiply`, `min`, `max` with argument node IDs.
- `subtract`, `divide`, `eq`, `lt`, `lte` with left/right IDs.
- `abs`, `ceil`, `floor`, `round` with one argument ID.
- `if` with condition, then and else IDs; the condition must be boolean.
- `lookup` with table key and an expression selecting an exact scalar row key.
- `call` with a source-qualified trait/item/modifier reference, output key, and
  explicit input-to-expression argument bindings.

Outputs declare a node, unit (points/percentage/currency/pounds), bounds,
increment and rounding (`exact`, `ceil`, `floor`, `nearest`). Nearest ties
round toward positive infinity; exact rejects nonmultiples. Internal arithmetic
uses bounded BigInt rational numbers derived from decimal input text, avoiding
binary-floating-point accumulation. Conversion to JSON numbers happens only
after output rounding and bounds checks. No eval, JavaScript callbacks, network
access, environment access or database access exists in the evaluator.

Limits: 50 inputs, 20 tables with at most 500 rows each, four outputs, 500 nodes
and depth 32. Validation and evaluation also have operation budgets, and rational
magnitude is bounded. Each pricing rule may depend on at most 100 distinct rules,
matching the retained snapshot limit; authoring rejects larger dependency graphs.
Missing inputs/IDs/references, bad bindings, cycles,
divide-by-zero, invalid table keys, nonfinite numbers and output-bound violations
are errors, not zero-valued fallbacks.

Traits require a points-valued `points` output. Items require currency `cost`
and pounds `weightLbs` outputs sharing one input set. Modifiers require
`modifier` with percentage or points according to cost type. Legacy trait
base/per-level inputs normalize to an affine rule; legacy item values normalize
to two constants. Pricing output bounds must also fit the destination character
schemas. Material without a faithful complete rule must remain incomplete.
Even incomplete records must have valid references when a structured rule is supplied;
unfinished formulas belong in extraction evidence until their graph is valid.

The visual editor creates fixed, per-unit, bounded-range, choice and lookup-table
presets. The validated YAML fragment editor preserves arbitrary supported ASTs;
it never attempts to reverse-engineer an advanced rule into an inaccurate preset.
Using a preset explicitly replaces the current rule. No preset contains inferred
book prices.

Trait-local modifiers also have a validated YAML source editor, preserving their
calculation rules and descriptive fields when the simple fixed-value form cannot
represent them.

## Purchase snapshots and explicit re-resolution

Character traits and inventory retain concrete points/cost/weight and optional
`PricingResolution`: reference, definition ID/revision, full definition, effective
input choices, rounded outputs and referenced-rule definitions/revisions. Existing
characters and legacy API calls without an explicit pricing resolution retain their original concrete values and modifier snapshots without
automatic linkage or repricing.

The resolver previews live results and modifiers. The server recalculates through
the same pure engine, authorizes all source access, rejects changed revisions, and
does not trust client-computed totals on resolved purchases. Legacy manual-price API calls without a pricing resolution retain their explicit paid values and remain without a new pricing snapshot; required unresolved inputs still reject adoption. Re-resolve pricing lives in the existing
trait/inventory editor. Definition or dependency changes produce a changed-source
state; prices stay saved until explicit acceptance. A deleted/detached source
leaves a retained snapshot.

Re-resolution uses one whole-entry character outbox patch containing values and
snapshots together. Library authoring uses the same whole-entry outbox path.
Cursor application must preserve every pending patched key. Rejection persists a
toast and flashes the entry. Defaults are captured as effective inputs, not left
implicit in historical snapshots.

Dependent outbox writes wait for source/definition creates and preceding rule
edits to be acknowledged. Locally edited pricing rows use an unresolved revision
in the resolver view; their snapshots bind the exact pending definition instead
of claiming its old server revision. Server resolution checks the saved definition
as well as any known revision, so a delayed library edit cannot silently produce
a different price. Independent library writes remain parallel.

## Equipment modes and facets

`weaponData.modes` is the ordered authoritative list, with unique stable keys.
Each mode independently carries name, skill, damage, reach, parry, minimum ST,
ranged statistics, notes and preserved source-row text. Legacy primary and
alternate fields normalize to primary/alternate-N keys; legacy inheritance is
resolved once during conversion. Modes in the new shape do not inherit omitted
values from each other. A compatibility primary projection remains for old
consumers. Weapon effects select stable `modeKey`; legacy mode names remain
accepted. Item-level Parry/Block effects do not accept an attack-mode restriction.

Weapon, armor, shield, container, powerstone, magic-item and enchantment facets
coexist on one physical item. The library editor offers visual attack modes and a
lossless weapon YAML mode, armor YAML, container fields and existing magical data.
Ambiguous extraction belongs in evidence with incomplete status, not fabricated
damage/skill/reach fields.

## Persistence, import and public access

Migrations 0054–0056 add common metadata, sources/modifiers, typed JSON rules and
snapshots, edition-qualified indexes, history/revision/tombstone triggers and
compatibility backfills. Character paid values are not recalculated.

YAML parsers accept v1–v14; exporters emit only canonical v14. Legacy weapon Range strings convert at import; fixed-yard and ST-multiplier values are typed in storage, API, MCP and visual editors. Sources and
modifiers are optional sections: omission preserves them even in replace mode;
explicit empty arrays prune them. Merge/replace uses canonical edition identity.
The final graph includes retained existing rows. It is validated under the
campaign lock before import writes; failures roll back the entire audited
transaction. CRUD deletion/definition-key changes must also leave the graph valid.

Sources/modifiers use owner-only CRUD under
`/api/v1/campaigns/{id}/library/{sources|modifiers}`; members read them through
the aggregate library and section filters. REST and sync call shared handlers;
OpenAPI and MCP expose the same fields and permissions. Both classes have Dexie
v13 stores, outbox operations, campaign-parent checks, cursor/tombstone delivery,
logout purge and human-readable campaign history.

Implementation: `shared/schemas/{calculation,libraryMetadata}.ts`,
`shared/domain/{calculation,libraryPricing,libraryGraph,libraryIdentity,weaponModes}.ts`,
`server/services/{libraryPricing,libraryReferences}.ts`, and
`client/features/library/{CalculationEditor,PricingResolver,RepriceEntry,WeaponModesEditor}.tsx`.

Item cost and weight use unconstrained PostgreSQL `numeric` storage (API bounds still apply), so a rule's declared rounding is not silently replaced by a two-decimal database scale. Existing paid values are unchanged.

### Editor disclosure and presets

Calculated pricing is optional and folds away for simple fixed-price entries. An
existing calculation starts expanded, while raw YAML has its own disclosure.
Pattern controls are drafts until **Use pattern** explicitly replaces the rule.
Blank/nonfinite amounts, invalid bounds and nonpositive steps are explained before
replacement. Item presets retain the current basic or constant calculated weight
unless the author edits it. Returning to **Use basic price fields** clears the
calculation and restores the basic-value controls. Modifier catalog entries use
the calculation editor directly and do not offer absent basic-price fields.

## Synthetic development catalog

The Lantern Coast bootstrap uses only original fixture definitions. Its four
fictional sourcebooks have distinct non-default abbreviations (`LCGV`, `LCST`,
`LCTR`, `LCQO`), and every imported entry links to a sourcebook UUID, section locator,
completeness status and definition role. Its 30 traits and 48 skills describe
practical coastal tasks, training and personal obligations in original prose.
Structured defaults, prerequisites, conditional task modifiers, timed actions and
selected level benefits use supported declarations. Social access and vows remain
explicitly manual rather than receiving invented universal bonuses; action previews
do not automatically change inventory, injury or recovery. Fixed and leveled trait pricing plus item
cost/weight calculations produce character-owned purchase resolutions through
the shared recipe. Equipment uses current independent weapon modes, structured
Range, directional/typed armor facets, enchantment mechanics and snapshots.
The mage trait retains `Magery` in its original campaign-specific name to use
the existing spell/mana semantics; its price and training benefit are synthetic.
No fictional source is represented as a published rules reference.
Fresh fixtures have six characters with 12–15 skills and 6–8 traits each, five shared
logs and three private journals apiece. The explicit `db:seed:lantern:refresh` command
conservatively updates recognized unchanged older defaults once; edited fields,
deleted older entries and play state are preserved. A completion marker preserves
later deletions on subsequent runs. See the [seed guide](../../bootstrap/README.md).
