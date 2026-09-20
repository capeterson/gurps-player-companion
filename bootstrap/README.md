# Development and test seed data

Run the standard seed after migrations:

```sh
docker compose -f docker-compose.dev.yml run --rm migrate bun run db:seed
```

This seeds two campaigns: **Sample**, the small existing library fixture, and
**The Lantern Coast**, a populated campaign based on the fictional characters
used in the root README screenshots. Use these known-credential accounts for
local development and testing, not real player data.

All four accounts initially use the password:

```text
change-me-please-this-is-a-seed-account
```

| Email | Campaign role | Character |
| --- | --- | --- |
| `seed@example.invalid` | Owner / GM of both seeded campaigns | Can inspect the entire Lantern Coast party through GM View |
| `rowan@example.invalid` | Member | Kestrel Vale, coastal scout |
| `mira@example.invalid` | Member | Mira Ashfall, mage and researcher |
| `bram@example.invalid` | Manager | Bram Stonebridge, armored veteran |

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
| Kestrel | Sword swing/thrust modes, ranged bow statistics, shield defenses, location-specific mail/crushing DR, an enchanted sword, two Survival specializations, a zero-point defaulted skill, a skill action with contextual modifiers and an unlocked benefit, a bought-up Feint, sign language, an active six-round ward |
| Mira | Magery, structured Thaumatology prerequisites, learned TL, six spells including maintenance and Very Hard difficulty, discounted casting costs, a partly charged and an empty powerstone, a partly depleted wand, FP below one-third, kneeling, an inactive sense effect |
| Bram | Innate DR combined with enchanted mail and an overlapping mantle with burning-specific protection, an unbalanced weapon, a bought-up Disarming technique, worn containers and heavy stashed salvage, HP below one-third, Reeling, an expired potion effect linked to an inventory item |
| Inventory | Quantities, equipped/worn distinctions, external storage, and three-level nesting: trail pack → oilskin pouch → compass/chart; satchel → medical kit → bandages |
| Campaign library | Traits, skills, spells, items, languages, techniques, styles, mechanical enchantments, and active effects; portable YAML v11 with saved library links and owned mechanics on the sheets |
| Adventure log | Shared sessions 0, 3, and 4, locations, Markdown paragraphs/lists/table/quote examples across notes and logs, XP awards, and one private entry per player |
| Encounter | Three PCs, a wounded raider, a hidden captive, turn order, and a three-round effect with maintenance cost; the encounter effect is a tracker reminder, not a linked sheet bonus |
| History and sync | Real API writes from four actors, audited changes, positive revisions, and owned mechanics for offline character use |

All adventure prose is fictional. Named campaign effects, enchantments, and skill
procedures are illustrative test rules; this is not an authoritative GURPS rules
catalog. Some trait benefits are reminders for manual adjudication. Seeded rounds
and indefinite effects are stable across dates; there are no active wall-clock
expirations that make the fixture decay while it sits unused. HP/FP and conditions
are seeded explicitly, and the UI will not automatically adjudicate the encounter.
Active-effect instances remain fixtures for API, calculation, and sync testing;
the character sheet has no active-effects management section.

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
  clean dev database, `docker compose -f docker-compose.dev.yml down -v` removes
  the development database and dependency volumes; restart and seed afterward.

## Files and verification

- [sample_library.yaml](sample_library.yaml): existing small Sample catalog.
- [lantern_coast.yaml](lantern_coast.yaml): enriched campaign settings and all
  nine library categories; also importable through the in-app YAML workflow.
- [lanternCoastData.ts](../src/server/db/seeds/lanternCoastData.ts): character
  identities, purchases, nested inventory, pool state, and effect selections.
- [lanternCoast.ts](../src/server/db/seeds/lanternCoast.ts): atomic creation through
  the normal API handlers, preserving validation, library snapshots, audit,
  server-generated UUIDs, and revision behavior.
- [lanternCoast.test.ts](../src/server/db/seeds/lanternCoast.test.ts): PostgreSQL
  integration coverage for usable mechanics, library ownership, nested items,
  private logs, hidden NPCs, repeat-run preservation, owner scoping, and rollback
  followed by a successful repair. Test-created campaigns and history roll back.

```sh
docker compose -f docker-compose.dev.yml exec app bun test src/server/db/seeds/lanternCoast.test.ts
```
