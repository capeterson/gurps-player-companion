# Development and test seed data

Run the standard seed after migrations:

```sh
./scripts/dev-worktree.sh run --rm migrate bun run db:seed
```

This seeds two campaigns: **Sample**, the small existing library fixture, and
**The Lantern Coast**, a populated campaign based on the fictional characters
used in the root README screenshots. Use these known-credential accounts for
local development and testing, not real player data.

All seven accounts initially use the password:

```text
change-me-please-this-is-a-seed-account
```

| Email | Campaign role | Character |
| --- | --- | --- |
| `seed@example.invalid` | Owner / GM of both seeded campaigns | Can inspect the entire Lantern Coast party through GM View |
| `rowan@example.invalid` | Member | Kestrel Vale, coastal scout |
| `mira@example.invalid` | Member | Mira Ashfall, mage and researcher |
| `bram@example.invalid` | Manager | Bram Stonebridge, armored veteran |
| `iona@example.invalid` | Member | Iona Reedwake, tide pilot and rescue specialist |
| `sable@example.invalid` | Member | Sable Fenwick, marsh medic and shore mage |
| `orin@example.invalid` | Member | Orin Bellstrand, signaler and jetty mechanic |

Existing accounts retain their passwords, display names, and account state.
Sign in as a player to edit that player's sheet. The GM sees every sheet;
**GM character editing starts disabled** so authorization checks remain useful.

## What the populated campaign exercises

The Lantern Coast uses TL3, normal mana, a 250-point budget, a 50-point
disadvantage cap, a five-quirk cap, attribute-cap enforcement, and the **None**
house-rule set. Character sheets are shared initially; turn tracking is enabled.
The party is deliberately in the middle of an adventure, with unspent points,
partially depleted resources, and manual conditions to inspect.

| Fixture | Useful cases |
| --- | --- |
| Kestrel | Sword swing/thrust modes, ranged bow statistics, shield defenses, location-specific mail/crushing DR, an enchanted sword, two Coastal Foraging specializations, a zero-point defaulted skill, a skill action with contextual modifiers and an unlocked benefit, a bought-up False Lantern Step, sign language, an active six-round ward |
| Mira | Tideglass attunement (the app’s Magery gate), structured Beacon Resonance prerequisites, learned TL, six spells including maintenance and Very Hard difficulty, discounted casting costs, a partly charged and an empty powerstone, a partly depleted wand, FP below one-third, kneeling, an inactive sense effect |
| Bram | Innate DR combined with enchanted mail and an overlapping mantle with burning-specific protection, an unbalanced weapon, a bought-up Hook the Haft technique, worn containers and heavy stashed salvage, HP below one-third, Reeling, an expired potion effect linked to an inventory item |
| Iona | IQ-based tide piloting, a weighted rescue line with fixed Range/minimum, left-hand buckler with a blocking enchantment, tide-flat foraging |
| Sable | TL3 marsh distilling and care, four original spells, enchanted nested distiller roll, an active ward, and a partly charged focus |
| Orin | Signal skill bonuses from trait and equipped beads, TL3 winchcraft, front-only apron with corrosion-specific DR, tools and externally stashed spare parts |
| Inventory | Quantities, equipped/worn distinctions, external storage, and three-level nesting: trail pack → oilskin pouch → compass/chart; satchel → medical kit → bandages |
| Campaign library | Traits, skills, spells, items, languages, techniques, styles, mechanical enchantments, active effects, sourcebooks, and standalone modifiers; portable YAML v13 with saved library links and owned mechanics on the sheets |
| Adventure log | Shared sessions 0, 3, and 4, locations, Markdown paragraphs/lists/table/quote examples across notes and logs, XP awards, and one private entry per player |
| Encounter | Six PCs, a wounded raider, a hidden captive, turn order, and a three-round effect with maintenance cost; the encounter effect is a tracker reminder, not a linked sheet bonus |
| History and sync | Real API writes from seven actors, audited changes, positive revisions, and owned mechanics for offline character use |

All adventure prose, rules descriptions, costs and equipment profiles are original
synthetic fixtures. They draw on broad sourcebook patterns, not published entries
or stat blocks. This is not an authoritative GURPS rules catalog. The mage trait
retains the `Magery` keyword so the existing spell-level/mana gate works, with
original pricing and an original campaign training bonus. Some trait benefits are
reminders for manual adjudication. Seeded rounds
and indefinite effects are stable across dates; there are no active wall-clock
expirations that make the fixture decay while it sits unused. HP/FP and conditions
are seeded explicitly, and the UI will not automatically adjudicate the encounter.
Active-effect instances remain fixtures for API, calculation, and sync testing;
the character sheet has no active-effects management section.

## Fictional sourcebooks

Every synthetic library entry, including languages, techniques, styles, modifiers
and active effects, cites one of these fictional books and a section locator.
These abbreviations are distinct from every default campaign source abbreviation.
The app still creates its normal 17 published-source metadata rows when a campaign
is created; none of this synthetic content cites those rows.

| Fictional title | Key | Abbreviation | Content |
| --- | --- | --- | --- |
| Greyhaven Lives and Vows | `lantern_lives` | `LCGV` | Traits, languages, modifiers |
| The Shoalwatch Training Almanac | `lantern_training` | `LCST` | Skills, techniques, styles |
| Tideglass Rites and Resonances | `lantern_rites` | `LCTR` | Spells, enchantments, active effects |
| The Quaywright’s Outfit Ledger | `lantern_outfits` | `LCQO` | Items |

Definitions carry complete/definition metadata. Purchases capture current pricing
resolutions and owned mechanics. The equipment uses independent keyed attack
modes, fixed and ST-multiplier Range, directional armor and typed DR, plus
mechanical accuracy, block, weight and skill enchantments. These fields use the
same v13/shared schemas as normal API and MCP writes.

## Reusable scripts and MCP acceptance

To create only Lantern Coast (without refreshing Sample):

```sh
./scripts/dev-worktree.sh run --rm migrate bun run db:seed:lantern
```

`seedLanternCoast(ownerId)` can also be imported by other seed scripts. The
transport-neutral `populateLanternCoast` recipe accepts a request function and a
player resolver, so both adapters create identical content from the same data.
The standard script creates six separate demo players and assigns Bram a manager
role. The MCP adapter uses one existing account for all characters, because user
creation is outside MCP's domain surface.

`bun run db:seed:lantern:mcp` is an NDJSON bridge for a connected-tool orchestrator:
it emits `{kind: "call", name, args}` on stdout, consumes the tool's
`{status, body}` structured result on stdin, and ends with
`{kind: "complete", campaignId, characterIds, calls}`. It creates content only
through MCP tool calls and never opens a direct REST connection. The orchestrator
must check for an existing campaign before starting. This bridge creates a fresh
campaign; it does not implement the standard script's database identity lock or
whole-recipe transaction. A fixed `LANTERN_SEED_RUN_KEY` makes individual mutation
retry keys reproducible within a run. Check each result before advancing; keep
failed runs' acknowledged IDs to repair partial remote content.

The real `/mcp` integration test creates the same entire graph under one existing
owner and compares it with the standard multi-user REST seed, including current
pricing, snapshots, nested items, effects, logs, XP and encounter content. It
normalizes generated IDs/revisions/timestamps and the allowed owner/author
change, asserts no additional users, and verifies delegated audit provenance.
It obeys the real MCP rate budget, so this test may take over a minute.

## Repeat runs and isolation

- The whole standard seed runs in one PostgreSQL transaction. Advisory locks
  serialize seed runs. A failure leaves no partial campaign or character graph.
- **Sample** retains its existing merge/upsert behavior: rerunning refreshes its
  bootstrap library entries.
- **The Lantern Coast** is created once per GM account and exact campaign name.
  Subsequent runs skip it completely: no duplicate rows or extra history, and no
  resetting pools, replacing player edits, or recreating deleted child rows.
  Another owner's campaign with the same name is never adopted or changed.
- Keep the seeded campaign name to retain that identity. Renaming it allows a
  fresh **The Lantern Coast** to be created on the next seed run; the renamed
  campaign and its characters remain intact. Seeding does not migrate or adopt
  the original screenshot account's separate campaign.
- Fixture changes take effect on a fresh database/campaign. For a completely
  clean dev database, `./scripts/dev-worktree.sh down -v` removes
  the development database and dependency volumes; restart and seed afterward.

## Files and verification

- [sample_library.yaml](sample_library.yaml): existing small Sample catalog.
- [lantern_coast.yaml](lantern_coast.yaml): enriched campaign settings and all
  eleven library categories; also importable through the in-app YAML workflow.
- [lanternCoastData.ts](../src/server/db/seeds/lanternCoastData.ts): character
  identities, purchases, nested inventory, pool state, and effect selections.
- [lanternCoast.ts](../src/server/db/seeds/lanternCoast.ts): atomic creation through
  the normal API handlers, preserving validation, library snapshots, audit,
  server-generated UUIDs, and revision behavior.
- [lanternCoastContent.ts](../src/server/db/seeds/lanternCoastContent.ts): shared recipe
  used by both adapters.
- [lanternCoastMcp.ts](../src/server/db/seeds/lanternCoastMcp.ts): exact tool mapping
  and acknowledgement adapter.
- [lanternCoastMcp.integration.test.ts](../src/server/db/seeds/lanternCoastMcp.integration.test.ts):
  authenticated MCP acceptance against the complete REST graph.
- [lanternCoast.test.ts](../src/server/db/seeds/lanternCoast.test.ts): PostgreSQL
  integration coverage for usable mechanics, library ownership, nested items,
  private logs, hidden NPCs, repeat-run preservation, owner scoping, and rollback
  followed by a successful repair. Test-created campaigns and history roll back.

```sh
./scripts/dev-worktree.sh exec -T app bun test src/server/db/seeds/lanternCoast.test.ts src/server/db/seeds/lanternCoastMcp.integration.test.ts
```
