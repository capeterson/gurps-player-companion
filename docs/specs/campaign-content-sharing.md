# Design Spec: Campaign Content Sharing

Campaigns are how content is shared between players and a GM. This document
describes the three sharing mechanisms as they exist today:

1. **Membership & roles** — who is in a campaign and what they can do.
2. **The character-sheet share gate** — how much of a player's sheet other
   members can see, enforced on both server and client.
3. **The campaign library** — a per-campaign catalog of traits/skills/spells/
   items/languages/techniques/styles, editable by the owner and portable as
   versioned YAML.

Plus the **adventure log** (per-entry visibility) and **invitations**
(how people join). Memberships, settings, invitations, and adventure-log entries
are online-only REST + React Query surfaces. Campaigns are pulled read-only into
Dexie for the share gate, campaign names, mana, and house rules, while the
campaign library is fully local-first and flows through the offline outbox. See
[offline-sync.md](offline-sync.md) S0.

Campaign pages share one workspace header and sibling navigation: Overview,
Adventure log, Library, History, optional Encounters, and the staff-only GM
dashboard. The app header retains the clickable campaign breadcrumb and labels
the current destination. The shared header reads from the local campaign mirror
when REST is unavailable so navigating and browsing the library do not acquire
an online dependency.

The same player-domain operations are available to delegated MCP clients.
OAuth scope is an additional ceiling; it never replaces current campaign role,
membership, private-log, hidden-encounter, GM-edit, or character-share checks.
MCP results pass through the same list/detail/history projections. Membership
revocation takes effect on the next tool call.

## House rules

Campaign settings include a House rule set selector, editable by the owner and
readable by managers. Its choices are **None**, **J Talisar**, and **Custom**.
Selecting None or J Talisar deliberately loads that named bundle. Selecting
Custom changes only `houseRules.ruleSet`: every currently loaded option remains
unchanged so a GM can start with J Talisar and alter one or two rulings instead
of rebuilding the set. Changing an individual option also records the set as
Custom without changing any sibling option. The preset identity is persisted
alongside the values rather than inferred from value equality, so an unchanged
copy of J Talisar can still remain explicitly Custom.

The J Talisar bundle enables every option documented in the E'arles campaign
house-rules source: enchanted-item pricing; the eye-miss location; advancement
rites for magical advantages; Medium and material spirits; shield damage;
Bravery; layered Deflect and Fortify; prohibited Distant Blow and acid magic;
spell ingredients; Hide Thoughts and Sunbolt interpretations; Path casting,
curse, dispel, Mystic Symbol, and charm rulings; shield-ready timing; and the
supplemental perks. Each control carries a concise explanation in the settings
dialog. None disables every option. The default-on `enforceAttributeCaps`
campaign rule is stored separately and is therefore enabled regardless of
which house-rule set is selected.

`houseRules.protectNaturalDr` remains on in the legacy/default Custom state. It
exempts innate DR (all active `dr` effects, including tough skin) and natural
skull DR from armor-piercing divisors and Ignore DR. Worn armor still divides,
rounded down. Turning it off restores standard B378/M63 penetration of the full
DR total. Fractional divisors below 1 still increase all protection, with final
DR 1 for unprotected targets.

This is an explicit house rule, not an inferred trait-name mechanic. The
setting saves with the rest of the settings form through owner-only REST,
with the ordinary campaign audit trigger and cursor revision. A background
campaign refetch does not overwrite an open settings draft; failed saves
retain it for retry. Migration 0037 advances existing campaign revisions once
so pre-upgrade offline mirrors receive the new settings. Character details
expose the policy and whether it is known; offline combat pauses damage
application when the campaign or its house rules have not yet been received.
Campaignless characters use the default-on policy.

## Membership & roles

A campaign (`campaigns` table) has one **owner** and a set of
**memberships** (`campaign_memberships`) with a `role`:

| Role | Capabilities |
|---|---|
| `owner` (GM) | Everything: edit settings, manage all members and roles, transfer ownership, delete the campaign, edit the library, always sees every member character in full. May edit player-owned characters when `allowGmCharacterEditing` is enabled. |
| `manager` | Invite at the `member` tier, cancel pending invitations, remove members (`requireCampaignAdmin`), use the GM dashboard/change feed, and edit player-owned characters when `allowGmCharacterEditing` is enabled. Cannot add members directly, change roles, promote to manager, transfer ownership, or edit campaign settings / the library — those are owner-only. |
| `member` | Belongs to the campaign; can read shared content and their own character. |

Authorization is centralized in `src/server/auth/permissions.ts`:
`loadCampaignOr403`, `requireCampaignOwner`, `requireCampaignAdmin`
(owner **or** manager), `requireCampaignMember`. The owner short-circuits every
check — an owner is treated as having every role.

Removing a member detaches the live library references on that member's characters
in the campaign while retaining their saved rules and campaign association. Later
library edits no longer change those copies. New links require current library access.

Endpoints (`src/server/routes/campaigns.ts`):
`POST/GET /campaigns`, `GET/PATCH/DELETE /campaigns/{id}`,
`POST /campaigns/{id}/members`, `PATCH/DELETE /campaigns/{id}/members/{userId}`,
`POST /campaigns/{id}/transfer` (transfer ownership).
Direct adds, invitation acceptance, role changes, removals, and ownership
transfer all advance the parent campaign revision in the same transaction.
Because campaign rows are the read-only sync projection, that revision bump is
what invalidates cached membership-derived permissions even when no campaign
setting changed.

Campaign settings that shape shared play: `pointTarget`, `disadvantageCap`,
`quirkCap`, `manaLevel` (the campaign's ambient mana, which shapes
spellcasting for member characters: very high mana keeps up-front energy
costs, grants mages next-turn recovery of personal FP spent casting on their own turn, and makes failures
critical), `techLevel` (the campaign's tech
level, resolved onto every member character's `CharacterDetail.techLevel`
the same way `manaLevel` is — characters no longer set their own),
the default-on `enforceAttributeCaps` rule, `shareCharacterSheets`, and the
default-off `allowGmCharacterEditing`
switch. The latter grants owners/managers normal sheet editing through
the character outbox and server `assertWrite` path; it does not create a
dashboard-specific mutation path.

`enforceAttributeCaps` applies the Basic Set's purchased-stat ceilings on both
character write doors (REST and `/sync/operations`): DX, IQ, and HT may not
exceed 20; purchased Will and Per (`IQ + permanent modifier`) may not exceed
20. ST is deliberately exempt because B14 explicitly allows it well beyond
20, and temporary/trait effects are not purchases. The switch defaults true
for new campaigns and migration `0041_campaign_attribute_caps.sql` enables it
for every existing campaign. Campaignless characters have no campaign rule.
The client mirrors the switch into Dexie and tightens the existing draft input
bounds immediately; the server remains authoritative and an asynchronous sync
rejection still uses the standard toast + rollback flash path.

### Experimental turn tracking

`experimentalTurnTracker` is an owner-controlled campaign setting, default false
for both existing and new campaigns (migration 0046). It appears under
**Experimental features → Enable turn tracker**. Enabling exposes campaign
encounters and local character turn scratchpads. Disabling hides those surfaces,
including bookmarked encounter pages, while preserving stored data. It is a UI
feature switch, not an additional encounter API authorization boundary.
The read-only campaign cursor and REST mirror carry it into Dexie so character
sheets honor the saved preference offline; absent settings and campaignless
characters keep tracking hidden. Campaign PATCH remains online-only and audited.

### Invitations

Joining is invite-based (`src/server/routes/invitations.ts`):

- An **owner or manager** creates a pending invitation
  (`POST /campaigns/{id}/invitations`). Managers may only invite at the
  `member` tier; inviting a `manager` requires the owner.
- Invitees are resolved by **handle** via `findUserByHandle` — exact email
  match wins, then exact display-name match, both case-insensitive.
- A **notification** (`notifications` table + the header bell) tells the invitee
  unless their invitation inbox topic is disabled. Invitation email and acceptance
  email to the original sender are independently toggleable, both default on.
  Declines notify the original sender in-app only. Reading an invitation does
  not remove Accept/Decline while it remains pending. See [notifications.md](notifications.md).
- The invitee lists their pending invites (`GET /invitations`) and
  **accepts** (`POST /invitations/{id}/accept`, which creates the membership)
  or **rejects** (`.../reject`). Owner/manager can cancel a pending invite.

Client surfaces: `CampaignInvitePanel`, `CampaignMembersPanel`,
`InvitationsInbox`, `TransferOwnershipDialog`, `NotificationsBell`.

## The character-sheet share gate

The core privacy control. Each campaign has a boolean **`shareCharacterSheets`**.
It decides, for every viewer, whether they get a **`full`** or **`minimal`** view
of each character in the campaign, and **where** the viewer is allowed to
discover that character at all.

```
full     — owner of the character, the campaign GM (owner), any member
           of a campaign with shareCharacterSheets = true, OR a manager when
           allowGmCharacterEditing = true.
minimal  — a non-GM member of a campaign with shareCharacterSheets = false.
           Identity only — no stats, no temp effects, no HP/FP, no
           traits/skills/spells/inventory/combat, no dismissed warnings,
           no history.
```

Owner and GM checks **short-circuit** the share flag, so flipping it never
restricts the GM's own visibility, nor a player's view of their own sheet.
An enabled manager editor also receives a full view because edit permission
cannot safely operate on a minimal projection.

### Discovery: where minimal characters appear

A character the viewer may only see in `minimal` form is **never listed on the
top-level `/characters` page** (the "your characters" surface). Minimal
characters are discoverable only from the **campaign detail page**
(`/campaigns/:id`), which renders a "Characters" section listing every member
character in that campaign. Clicking a row opens the existing
`/characters/:id` route which renders `CharacterMinimalView` for minimal
viewers. This keeps the player's "your characters" page uncluttered with
other players' sheets while still letting a campaign member browse the party
roster from the campaign itself. Roster cards use the same `CharacterCard` as
Home and the Characters listing, with portrait/name and campaign links. A full
viewer also sees ST/DX/IQ/HT. The roster checks the local share decision before
rendering that line, even before cached values are masked by the sweep; masked
rows awaiting rehydration continue to hide attributes.

The local-first character row stays in IndexedDB so the minimal-view detail
page can render offline; the Characters page filters it with the same local
access decision as the privacy sweep (see `useCharactersList`).

### Enforced in three places — keep them in lockstep

This gate is defence-in-depth. Changing one side without the other reopens a
data-leak hole (this is exactly what Codex review on PR #22 caught, and the
identity-only tightening closed a second leak where stale cached private
fields on the character row itself — `st`, `hpMod`, `tempEffects`, etc. —
remained readable in IndexedDB after access was downgraded to `minimal`).

1. **Server — what leaves the database.**
   `decideCharacterAccess()` in `src/server/routes/sync.ts` is the pure
   decision (`full` vs `minimal`) and is unit-tested without Postgres. On
   `POST /sync/cursor`:
   - `character` upserts are emitted for every accessible character, but
     `minimal` rows are run through `projectCharacterRow` first — this drops
     every private column's **real value** (stats, mods, `tempEffects`,
     `dismissedWarnings`, `activeConditionGroups`) and ships only the public identity fields plus the
     insured-safe defaults the NOT NULL columns still need (`st=10`, etc.). The
     client's `applyServerRow` merge uses the masked payload to overwrite the
     local row, purging any stale real values that were cached before access
     was downgraded (the projection keeps the default-valued keys present
     precisely because `applyServerRow` is a merge — omitting them would leave
     the stale real values in place).
   - Child classes (traits / skills / spells / inventory / combat) are scoped
     to `fullAccessCharacterIds` only — a `minimal` viewer never pulls another
     player's private rows at all.
   - The response also carries authoritative `accessible.characterIds` /
     `campaignIds` so the client can prune rows that fell out of access
     (tombstones can't reach ex-members). The client persists the last set per
     user; when either set expands it clears all class cursors and performs one
     from-zero pull, so newly granted access back old rows that predate the
     viewer's high-water marks.
   - `GET /characters/{id}` and `GET /characters/{id}/history` apply the
     same gate via `resolveCharacterView()` in
     `src/server/services/characterAccess.ts`, which owns the membership
     check and then delegates the full/minimal choice to
     `decideCharacterAccess()`.
   - `GET /characters` (the list) **excludes** rows the viewer may only see
     in `minimal` form — those rows are discoverable from the campaign
     detail page only. Owner rows and full-view member rows are listed as
     before.

2. **Client — what stays in IndexedDB.**
   `characterIdsToMinimize()` in `src/client/sync/minimalViewSweep.ts` mirrors
   the server decision and computes which characters' **already-cached**
   private data must be purged from Dexie. The orchestrator runs the sweep after
   **every** `/sync/cursor` pull and on **bootstrap**, so a fresh
   `shareCharacterSheets = false` flip lands by the next sync tick at latest.
   The sweep now:
   - deletes child rows (traits / skills / spells / inventory / combat), AND
   - **rewrites each minimal character's row down to identity-only fields**,
     blanking `st`/`dx`/`iq`/`ht`/`hpMod`/`willMod`/`perMod`/`fpMod`/
      `speedQuarterMod`/`moveMod`/`tempEffects`/`dismissedWarnings`/
      `activeConditionGroups` to safe
      defaults. Masked rows carry a local-only marker; when access returns to
      `full`, the orchestrator resets the character-family cursors and pulls
      from revision zero once to restore the real parent and child rows.
      Without this rewrite the row keeps whatever real values were
     synced before access was downgraded, and `useCharacterDetail`/`buildCharacterDetail`
     would keep deriving real HP/FP/derived from those stale cached fields
     even when the UI falls through to the full sheet (e.g. while the local
     campaign row hasn't resolved yet, or for an account that doesn't have
     the campaign row at all).

3. **Client — what the UI surfaces.**
    - The `/characters` page reads Dexie and applies
      `characterIdsToMinimize`, so minimal characters stay hidden while
      full-share and editable manager rows remain listed. (The local-first row
      stays in Dexie so `CharacterMinimalView` can render the share-gated
      detail page offline.)
   - The `/campaigns/:id` page renders a "Characters" section that reads
     Dexie rows where `campaignId === campaignId` and deep-links each row
     to `/characters/:id`, which renders `CharacterMinimalView` for
     minimal viewers.

**Rule:** any change to the sharing decision must update **all three**
surfaces together: `decideCharacterAccess` + `projectCharacterRow` (server
sync emission), `characterIdsToMinimize` + the orchestrator's character-row
rewrite (local purge), and the list-filter / campaign-browse UI (discovery).
History delivery follows the same gate — `minimal` viewers get no character
events, including summaries, details and batch counts through campaign roll-up.
The roll-up retains the event's recorded campaign/owner context for deleted
characters and departure mirrors (see history-tracking.md).

Both `/sync/cursor` campaign rows and the authenticated `/campaigns` response
are mirrored into Dexie with the current viewer's role. This lets
`useCharacterAccessLocal` and the minimal-view sweep make the same
manager-editing decision during bootstrap and while offline. Missing legacy
`allowGmCharacterEditing` values default to `false`.

## GM campaign dashboard

`/campaigns/{id}/gm` is an authenticated PWA route for owners and managers. It
builds compact character summaries from the existing Dexie character-family
stores via `buildCharacterDetail`; there is no bespoke dashboard character
payload and no WebSocket row streaming. The activity rail polls the existing
campaign character-history endpoint every five seconds and visually fades newly
observed events over 30 seconds. GM summaries extend the shared `CharacterCard`
shell with pools, secondary stats, conditions and lookup results. The common
attribute line uses effective values, the campaign name links to its overview,
and the character name opens the sheet in a new tab.

Player sheets and GM cards share `joinCharacterMechanics`, reading the validated
source/version declarations on synced trait/skill rows. The GM dashboard uses its
local campaign mirror when HTTP is unavailable, while an explicit authorization
failure still blocks it. Missing definitions show an unavailable notice instead
of baseline stats or skill-lookup numbers. No authenticated service-worker cache
is involved; closing the app offline retains the same local derivation.

## Encounter tracker

The online-only encounter REST aggregate lives in
`src/server/routes/encounters.ts` at `/campaigns/{id}/encounters`. Campaign
members may read it; owners and managers may create, update, advance, and
delete encounters, combatants, and effects. Every mutation uses `withAudit`
and fans out an `encounter_invalidate` WebSocket nudge without row data.

The member projection omits NPC combatants marked `hiddenFromPlayers` and
returns `basicSpeed` and `dx` as null for PCs not owned by that member. Effects
whose target is hidden are omitted; an effect from a hidden caster keeps its
visible target but masks `casterCombatantId`. The active-combatant id remains
an opaque turn-state token even when its combatant is hidden, without including
the hidden combatant or its targeted effects. Owners and managers receive the
full projection. Turn advance requires an expected round and active combatant,
returning 409 rather than overwriting stale state.

The encounter page lets campaign admins add PCs from the locally mirrored
campaign roster, fully edit NPC combat data, and patch `orderKey` for
move-up/down and Wait reslots. Ended encounters remain available in the
campaign's past-encounter list with an on-page final-round summary.

## The campaign library

A per-campaign catalog of reusable content, backed by eleven tables:
`campaign_library_traits`, `campaign_library_skills`,
`campaign_library_spells`, `campaign_library_items`,
`campaign_library_languages`, `campaign_library_techniques`,
`campaign_library_styles`, `campaign_library_enchantments`,
`campaign_library_active_effects`, `campaign_library_sources`, and
`campaign_library_modifiers`. It's what lets a GM define campaign-specific
advantages, skills, spells, gear, languages, and martial-arts content
once and have players pull them onto their sheets.

Creating a campaign inserts the owner membership and 17 common GURPS Fourth
Edition source records in the same audited transaction. The books are Basic Set:
Characters and Campaigns, Magic, Martial Arts, Powers, Fantasy, Space, Low-Tech,
High-Tech, Ultra-Tech, Bio-Tech, Thaumatology, Social Engineering, Horror,
Supers, Psionic Powers, and Mass Combat. Their abbreviations follow the
[GURPS Character Sheet page-reference list](https://gurpscharactersheet.com/page_references)
(`B`, `BX`, `M`, `MA`, `P`, `F`, `S`, `LT`, `HT`, `UT`, `BT`, `T`, `SE`, `H`, `SU`,
`PSI`, `MC`). They are ordinary campaign-owned sources: the owner may edit or
delete them to control the campaign's allowed books. Creation does not add
entries to existing campaigns.

Library languages carry only the book definition — `name`, `description`,
`source`, and `isSignLanguage`. Fluency and point cost are per-character and
live on `character_languages`; picking a sign language from the autocomplete
seeds the character row's written fluency to `n/a`.

- **Read**: any campaign **member**, through `GET /campaigns/{id}/library`
  (REST/MCP) and, in the PWA, the `campaign_library_*` sync cursor classes. The
  app reads the library only from Dexie, so browsing works offline. Entries
  marked **Restricted** are GM-only: member REST and YAML reads exclude them,
  cursor reads deliver removal events instead of their data, and the client
  purges cached restricted rows after an owner loses ownership. Campaign history
  excludes restricted entries from member feeds. Already owned character
  snapshots remain usable; new member links to a restricted definition are denied.
- **Write** (per-entity CRUD): campaign **owner** only, through REST
  (`POST/PATCH/DELETE /campaigns/{id}/library/{sources|modifiers|traits|skills|spells|items|enchantments|active-effects|languages|techniques|styles}[/{id}]`
  in `src/server/routes/campaignLibrary.ts`) or `/sync/operations`. Both
  doors share one service layer (`createLibraryEntry` / `updateLibraryEntry` /
  `deleteLibraryEntry`). The PWA editor always uses the outbox, with whole-entry
  patches, so the owner can edit offline; see offline-sync.md "Campaign
  library". All eleven categories have dedicated editor forms. Languages and
  techniques are consumed on the character sheet; styles describe their component
  skills, perks and techniques without creating a separate character style row.
- Client surfaces: `CampaignLibraryPage` (the `/campaigns/:id/library` editor),
  `CampaignLibraryTransferPage` (the campaign's **Import & export** tab),
  and the top-nav `LibraryPage` (`/library`, a campaign-switching editor), plus
  `LibraryAutocomplete` / `LibraryModifierPicker` on the
  character sheet, which let a player search the campaign library when adding a
  trait/skill/spell/item/enchantment/language/technique. All of them read the
  synced Dexie stores.

Library enchantments declare `weapon`, `armor`, `shield`, or `any` applicability;
typed flat effects; optional level-specific effects; and either additive stacking
or a highest-only stacking key. Library items and character inventory items can
attach definitions. The server verifies same-campaign scope and applicability and
requires current library membership before hydrating a linked definition, then
stores an authoritative name/source/revision/mechanics snapshot. Character-local
typed instances omit the definition ID. Weapon/armor/shield combat effects require
`equipped`; weight effects require a worn root; legacy
spell-name/category/note entries remain valid and non-mechanical. Definition edits
refresh every live snapshot in the audited transaction. Deletes and campaign
transfers detach live IDs but preserve the last owned snapshot. Persisted armor and
weapon blocks always remain the editable base layer; detail payloads expose their
derived base-plus-effect values separately, without applying persistence caps to
the derived totals. A DB effect can enhance an existing shield or armor DB but
does not turn an ordinary weapon into a shield.

Library skills declare a first-class `specializationPolicy`: `none`, required or
optional free-form, or required or optional catalog. Catalog options carry a
canonical name plus optional description, prerequisites, and defaults overrides.
The editor exposes policy and catalog authoring. Picking a library skill requires
the appropriate free-form/catalog choice and copies its base name, attribute,
difficulty, resolved specialization and learned TL into the character row, with
the resolved description, source and prerequisites in notes. The shared server
reference handler canonicalizes the specialty and applies its defaults/notes when
REST, sync, or MCP creates a linked skill, so non-UI clients get the same snapshot.
Definitions may additionally declare `techLevelPolicy`, structured
`prerequisiteRules`, natural-name `groups`/`tags`, and conditional group/tag
defaults. The reference handler is authoritative for REST, sync, and MCP: it
rejects unresolved required `/TL` values and, under the campaign's `block`
policy, unmet/unknown prerequisites on adds or point increases. `warn` accepts
the edit and the shared detail builder exposes the failed clauses. Selected
specialization rules and durable campaign-owner GM-permission grants are retained
in `character_skills.library_mechanics`; refresh and detach operations preserve
the selected specialization's overrides rather than replacing them with base rules.
This snapshot is queued durably through the character
outbox. Changing the campaign TL does not rewrite learned skill TL. Editing the
add form's name detaches its selected definition; a pending save cannot clear a
newer selection, even one with the same base name. Sheet rows, rolls, roll history and
GM lookup identify specialized skills by `skillDisplayName` in the compact
`Name/Specialization` form; legacy parenthesized weapon and technique references
remain resolvable. The GM lookup keeps
each specialty selectable and reports its effective level.

Trait/skill effect declarations are materialized on the owned character rows,
live-linked and versioned while their source exists. Library CRUD
and YAML import advance referencing child revisions in the same transaction, so
other devices refresh calculations through their normal HTTP cursor even if a WS
nudge is dropped. Library rows have their own cursor classes and tombstones, so
the editor and autocompletes update from any committed pull, including definitions
with no owned copies. Post-commit campaign-scoped nudges only accelerate the pull. Character share
gates still apply to every emitted child row; nudges carry no definitions.

Changing a source trait's kind detaches owned traits that retain
the previous kind; their last saved rules and paid choices remain unchanged by
that edit or later source updates. Changing an owned trait's kind through REST
or sync also detaches an incompatible existing link while retaining its saved
rules. Trait/skill add forms reject picks from a previous campaign with a toast
and form flash, preserving the draft until the user chooses a current definition.
Provisional mechanics retain the picked definition's actual campaign provenance.
Deletion detaches owned copies and retains
their last effects and source
version. YAML replacement with a renamed natural key follows the same path;
recreating the old name cannot reconnect a different UUID. The character assignment UI confirms any move/removal from an existing campaign before
queueing it, warning that a later rejoin cannot restore detached links. First assignment
from no campaign does not prompt. Campaign transfers
detach all six live library reference types and preserve owned trait/skill rules,
paid points, levels, variants, modifiers and skill specialties. Retained source
IDs/campaigns are provenance only. Missing legacy copies remain visibly unresolved.
Copy capture holds a parent character lock until the write commits, so a concurrent
transfer includes that copy when detaching references. Campaign deletion locks the
campaign before enumerating characters, excluding incoming assignments during cleanup.
Migration 0036 backfills only sources matching the character's campaign. Legacy
traits whose mutable kind no longer matches their source retain those declarations
as detached copies; no foreign library lookup is used for calculations.

Character links to all six library definition types pass through
`services/libraryReferences.ts` on REST create/patch and sync create/field/whole-body
patch. The definition must exist in the character's current campaign, the actor
must still be a member or owner, and a trait's kind must match. Foreign, missing,
wrong-kind and campaignless references return the same generic forbidden error;
no private definition is looked up for calculations. Campaign and character locks
serialize reference assignment with transfers and membership removal. Cleanup
rechecks the original campaign under the character lock before detaching a copy.
Every child create/patch rechecks write access under the campaign, character and
membership locks, including edits without a source reference. The locked decision
uses the same owner/staff rules as ordinary authorization: revoking staff editing
or demoting a manager while a write waits prevents that write from committing.
Sync child patches perform this locked check before evaluating stale revisions,
so a revoked writer receives an unauthorized outcome without a latest-row payload.

### YAML import/export (cross-campaign sharing)

The library is portable as a **versioned, round-trippable YAML document** — the
mechanism for sharing content between campaigns or seeding a new one.

- **Codec:** `src/shared/yaml/library.ts` (pure, shared). `parseLibraryYaml`
  validates against strict `campaignLibrary` Zod schemas and rejects duplicate
  or unknown keys at the document, library, entity, and nested JSON-object
  levels; `emitLibraryYaml` produces **byte-stable** output via canonical
  sorting, key ordering, and field compaction, so import → export → diff yields
  the same bytes. `LIBRARY_YAML_VERSION = 14`; max payload 20 MB. v1
  (pre-effects), v2 (effects on traits/skills), v3 (container/powerstone/
  magic-item item fields + `campaign.manaLevel`), and v4 (languages +
  techniques/styles sections) documents still parse — the
  v5 (item enchantments), v6 (explicit skill defaults), and v7
  (weapon-scoped effects) also parse. v8 adds skill specialization policies,
  catalog option overrides, and structured `exact`/`same`/`any` specialization
  matching for skill defaults. v9 adds TL policies, structured prerequisites,
  conditional group/tag defaults, and the campaign prerequisite policy. v10 adds
  portable mechanical enchantment definitions and structured owned item snapshots;
  campaign-local definition UUIDs are removed on export while source revision and
  mechanics remain. v11 retains portable skill specialization policies and
  per-catalog-option rule overrides. The
  parser unions on the literal `version` field and newer fields default/absent
  on older docs. v14 adds per-entry `restricted` and optional explicit
  `scope: { kind: sources, sourceKeys: [...] }` for sourcebook packages.
- **Item fields (v3):** library items carry the same container/powerstone/
  magic-item shape as character inventory rows (`src/shared/schemas/inventory.ts`):
  `isContainer`, `hideawayCapacityLbs`, `weightReductionPercent`,
  `powerstoneData` (nullable; `maxEnergy`/`currentEnergy`/`notes`), and
  `magicItemData` (nullable; `spellName`/`spellSkillLevel`/`mode`/`chargesMax`/
  `chargesCurrent`/`energyCost`/`notes`). These pass through the library →
  character copy path (`InventoryPanel.onPickLibraryItem`/`onCreate`) verbatim,
  the same way `armor`/`weaponData` already did — a picked powerstone or magic
  item arrives on the character's inventory row with its template charge state.
- **Languages (v4):** the `library.languages` section carries
  `{ name, description?, source?, isSignLanguage }`. Like `spells`, the key is
  **optional rather than defaulted**, so a `replace` import of a pre-v4
  document (which has no `languages:` key at all) leaves the campaign's
  language library alone; an explicit `languages: []` still deletes.
- **Techniques and styles (v4):** `library.techniques` carries
  `{ name, defaultSkillName, difficulty, maxLevel?, defaultModifier?, description?, source?,
  prereq? }`; `library.styles` carries
  `{ name, description?, source?, techniques[], perks[], skills[] }` where
  each `techniques[]` entry is a denormalized
  `{ name, defaultSkillName, difficulty, maxLevel?, defaultModifier? }` rather than an id, so a
  style survives a round trip into a campaign that has no matching technique
  rows yet. Both sections follow the same optional-section rule as
  `languages`.
- **Item enchantments (v5/v10):** `library.items` entries carry an optional
  `enchantments: []` list (`enchantmentRef[]`: spellName, spellLevel?, category?,
  notes?) which copies onto character inventory items upon add. v10 extends an
  entry with optional definition revision/source, selected level, and a complete
  typed mechanics snapshot while preserving the v5 note-only shape.
- **Skill defaults (v6):** `library.skills[].defaults` stores attribute/skill
  plus offset candidates, including an optional skill specialization. `[]`
  explicitly means no default and is retained on export; null/absent means
  unknown and is the migration policy for older rows. Picks copy declarations
  onto the character; later library changes do not silently rewrite that copy.
- **Weapon effects (v7):** adds weapon-scoped effects. Library-item selectors export their stable
  normalized name but omit the campaign-local UUID; after import they match only
  inventory rows with library provenance, never unrelated same-name custom items.
  Older YAML versions still parse; omitted defaults remain unknown.
- **Campaign block `manaLevel`/`techLevel` (v3):** export always includes the
  campaign's ambient `manaLevel` (Basic Set p. 235) and `techLevel` (Basic Set
  p. 513) alongside `description`/`pointTarget`/`disadvantageCap`/`quirkCap`.
  Explicit `null` means “clear this setting” and survives emission/import;
  only `undefined` means omitted/leave unchanged.
- **House rules:** optional `campaign.houseRules` shares the campaign schema.
  Export includes it; opt-in settings import applies it when present. Older
  files that omit it leave the destination rules unchanged.
- **Campaign block `enforceAttributeCaps` (v6):** export always includes the
  default-on B14-B16 purchased-attribute rule. Older documents omit it and
  therefore leave the target campaign's current setting unchanged on import.
- **Export** (`GET /campaigns/{id}/library/export`): any member; streams a YAML
  attachment (`<slug>-library.yaml`) including campaign settings. Authorization,
  campaign settings, and all eleven library sections are read on one read-only
  `REPEATABLE READ` transaction, so concurrent edits cannot produce a torn
  document assembled from different database moments. `?sourceKeys=` accepts a
  URL-encoded JSON array of source keys and selects
  one or more first-class source keys and exports only their source records and
  matching entries across all categories, with no campaign settings. Legacy
  source-less entries are excluded. A member's export omits Restricted entries.
- **Import** (`POST /campaigns/{id}/library/import`): owner only. The UI parses
  and validates a selected file locally, then shows a confirmation preview with
  incoming section counts and available deletion counts. Selecting a file alone
  never submits it. The chosen mode and settings option are captured with the
  file, so changing those controls later cannot alter the pending operation.
  Two modes:
  - `merge` (default) — upsert incoming rows by section/canonical key/source edition (plus trait kind), leave others.
  - `replace` — additionally delete existing rows not present in the document.
    **Careful edge case, encoded in the importer:** a `replace` import only
    prunes spells when the document actually carried a `spells:` section, so a
    pre-spell-library export (which omits it) doesn't wipe the current spell
    library. An explicit `spells: []` still deletes. The `languages` section
    (v4) follows the same optional-section rule.
  - Returns per-section `{ created, updated, deleted }` counts.
  - A scoped v14 file or explicit `sourceKeys` selection from a full file
    imports only those sourcebooks. Replace prunes only matching source-key
    entries in included sections; other sources and unsourced entries remain.
    Source records are upserted, never pruned by a scoped import. Scoped imports
    cannot apply campaign settings. The final graph is validated under the
    campaign lock, so missing cross-book references reject the entire import.
    When older YAML omits `restricted`, an existing row keeps its GM restriction.
  - **`applyCampaignSettings`** (boolean, default `false`): opt-in. When
    true and the document carries a `campaign` block, `description`,
    `pointTarget`, `disadvantageCap`, `quirkCap`, `manaLevel`,
    `techLevel`, optional `houseRules`, and `enforceAttributeCaps` are copied
    onto the campaigns row — only the fields
    actually present in the
    document (an omitted field leaves the current value alone); `name` is
    never touched by import. The response's `campaignSettingsApplied`
    reports whether anything was actually written (false when the flag was
    off, the document had no `campaign` block, or the block had no
    recognized fields).
- **Seed:** `db:seed` imports `bootstrap/sample_library.yaml` into Sample and
  creates The Lantern Coast from the synthetic `bootstrap/lantern_coast.yaml`
  plus six populated character fixtures. Its owner, manager, and member accounts, private/shared
  logs, and hidden-NPC encounter exercise the same permissions as normal API
  writes. Its eleven library categories use four fictional sourcebooks (`LCGV`,
  `LCST`, `LCTR`, `LCQO`) and current calculation/pricing snapshots, weapon modes,
  structured Range, prerequisites and procedures. The reusable shared recipe
  also runs through MCP with one existing owner; integration coverage compares
  its complete content graph against the multi-user REST seed. Existing Lantern
  play state is preserved on repeat runs. See the
  [seed guide](../../bootstrap/README.md).

Keys used for upsert matching are section + canonical portable key + source key,
with trait kind additionally included. Source-less rows remain legacy editions.
Names are display labels and duplicate names can coexist under distinct canonical
keys or editions. Sources use their own canonical key. The final source/reference
graph is validated before import writes, including entries retained by omitted
sections. Source and modifier sections follow the omission-versus-empty replace
rule. Export is canonical YAML v14; v1–v13 remain valid compatibility inputs. Older weapon Range strings convert on import; v13 and later require structured Range objects.

See [library-calculation-rules.md](library-calculation-rules.md) for standalone
modifiers, completeness/adoption gates, calculation rules, explicit character
pricing snapshots/re-resolution, source preference and independent weapon modes.


## Library search and description editing

The campaign **Import & export** tab contains every YAML transfer control. Its
sourcebook picker selects registered source keys rather than legacy citation
text. The editor's category search and source filter do not affect transfers.

The library management UI filters the current category as the user types in
**Search library**. Matching is case-insensitive:
every query word must appear in the human-readable fields (name, description,
source, kind, attribute/difficulty, college, prerequisites or specialization
policy). Category totals and the matching count remain visible, with an explicit
empty result and Clear search. Search changes never affect exports or imports.
An entry being edited stays visible even when it does not match; category changes
hide rather than unmount editors, preserving unsaved drafts and save failures.
Group jump targets remain distinct for Unicode and punctuation-only labels.
Collapsed description excerpts retain source punctuation rather than stripping
comparison symbols or literal Markdown characters; expanded descriptions render
the Markdown. Excerpt truncation does not split a UTF-16 surrogate pair.

Trait, skill and spell descriptions render through the existing sanitized
`Markdown` component. Add/edit descriptions and skill specialization description
overrides use `RichTextEditor`, with formatting toolbar and raw markdown mode.
The stored/API/YAML value remains a markdown string; no new schema or HTML field
is introduced. Pending description submissions disable editor interaction.
Copied descriptions on character sheets render with the same sanitizer.
Only rendered anchors with a permitted `href` receive link styling; text whose
unsafe link target was removed appears as ordinary text.

## Adventure log

Per-campaign session notes (`adventure_log_entries`, exposed via
`src/server/routes/adventureLog.ts`):

- **Attachment:** the **Attached to** dropdown defaults to **Campaign** (shared).
  It also lists every character owned by the current user, including characters outside
  this campaign. Selecting one persists `characterId` and makes the entry private;
  selecting Campaign clears the attachment and shares the entry. The tooltip explains
  visibility and that point recipients remain separate. Only authors may attach entries
  to their own characters; forged foreign/missing attachments are rejected server-side.
  Existing unattached private notes remain private until explicitly reassigned. Deleting
  a character clears the foreign key without publishing its private notes.
- **Read:** campaign members, **but private entries are hidden from non-authors**
  (including campaign owners and detailed campaign history).
- **Write:** the entry's **author or the campaign owner**. The author or owner
  may also **edit** (`PATCH`) and **delete** (`DELETE`) entries; the client
  `LogPage` exposes Edit/Delete controls on entries the viewer may modify. Edit
  replaces that entry in its existing list position with the form; Save changes
  and Cancel live in the form. Filters are disabled during editing so the draft
  remains visible. New entries still open above the list. Private badges include
  the attached character name, with an unavailable fallback for missing local names.
- Entries carry nullable `characterId`, `sessionDate`, `title`, `body`, `visibility`, optional `pointsGained`, and `xpAwards`.
  `pointsGained` is a nullable integer from 0 to 1000. Creating an award snapshots all current
  campaign characters unless `awardCharacterIds` selects a subset (including an empty list).
  The form defaults to all for campaign owners, and to owned characters for other members;
  **Choose characters** opens a bounded checkbox dialog for missed sessions and other exceptions.
  `xpAwards` stores the concrete recipients/amounts; later joins do not retroactively earn points.
  Cards show the per-recipient amount for uniform awards, or the total points for
  varied legacy awards. The character-count tooltip lists saved recipients and
  their individual amounts, deduplicating repeated legacy recipients and summing
  their credit. Names resolve from the local character list and campaign roster;
  unavailable names remain explicitly labeled. The tooltip wraps long names,
  scrolls long lists, and stays within the visual viewport.
  An amount-only API edit retains recipients, and a body-only edit leaves awards unchanged.
  Legacy API callers may still send individual `xpAwards` (unique character IDs, at most 500).
  Owners may credit any character in their campaign; members may credit only their own.
  New/changed recipients must belong to the campaign. Unchanged historical recipients may have
  left; clearing/deleting an award reverses their earlier credit. Missing/deleted recipients are
  retained in historical snapshots and skipped when reversing credit.
  Log writes and `characters.earned_points` deltas share one audited transaction, campaign lock,
  sorted character locks, normal revision/history triggers, and post-commit invalidation nudges.
  Editing, removing recipients, clearing points, or deleting an entry adjusts the previous award
  instead of granting credit twice. Migration 0057 applies preexisting stored XP awards once.
  The shared detail builder and local-first sheet calculate the cap and warnings from campaign
  starting `pointTarget + earnedPoints`; a null campaign target remains uncapped. Earned points
  survive character transfers. This is a read-only character field, carried by full cursor rows
  and masked to zero on every minimal projection/sweep; arbitrary REST/sync patches cannot set it.
  Their optional integer `sessionNumber` starts at zero. Opening the create form
  suggests zero for the first numbered entry, then one above the greatest
  visible posted number; authors may freely edit or clear that suggestion.
- **Body is markdown** (CommonMark + GFM), stored verbatim in the `body` text
  column. Rendering is sanitized at render time only:
  `src/client/components/markdown/markdownProcessor.ts` runs
  `remark-parse → remark-gfm → remark-rehype(allowDangerousHtml) →
  rehypeEscapeRaw → rehypeNormalizeUrlScheme → rehype-sanitize → rehype-stringify`.
  URL normalization lowercases only the scheme token, preserving path/query case
  and leaving the sanitizer's protocol allowlist unchanged. Raw HTML/scripts in
  the source are **never interpreted** — `<script>` becomes escaped literal
  text (`&#x3C;script&gt;…`) and `rehype-sanitize` runs as defense-in-depth.
  There is no server-side HTML stripping; the contract is enforced at the
  single render site (`<Markdown>`).
- **Editor:** the create/edit form uses a Tiptap + `tiptap-markdown` WYSIWYG
  (`src/client/components/markdown/RichTextEditor.tsx`) with a "Rich text" /
  "Markdown" tab toggle. The stored source of truth is always the markdown
  string — the editor never produces or persists HTML. Strict CommonMark line
  breaks (single newlines do not become `<br>`).
- Client surface: `LogPage` (single-column `max-w-3xl` layout), mounted at the
  campaign-scoped `/campaigns/:id/log` route. Scoped mode is fixed to the parent
  campaign and therefore does not render the legacy standalone page's campaign
  selector.

## Auditing

Every campaign-family write (settings, membership, library, adventure log) runs
inside `withAudit(...)` so the DB history triggers attribute it — the campaign
**History view** (`CampaignHistoryPanel`) reads
`GET /campaigns/{id}/history` (`scope='campaign'`), plus an owner-only
`?scope=character` roll-up across member characters. Library events expand to
field-level before/after details and a nested raw old/new JSON view for structured
definition changes. See
[history-tracking.md](history-tracking.md); campaign-family REST files that add
a new mutating route must be added to the guard test's `MUTATING_ROUTE_FILES`.

## Active-effect library and skill procedures (YAML v11)

Library owners can create, search, edit and delete active-effect definitions at
`/library/active-effects`; members read them in the aggregate library. YAML v11 adds
optional `library.activeEffects` and skill `procedures` (modifiers/actions/benefits).
Omitting the new library section during replace import preserves existing definitions.
Applied character effects keep owned mechanics on source deletion or campaign
transfer, while edits refresh live links transactionally. Their private instances
are excluded from minimal detail/list/cursor/history surfaces. Campaign cursor rows
carry only reusable definitions, which are visible to campaign members.
See [active-effects-skill-procedures.md](active-effects-skill-procedures.md).

### In-app authoring help

`/help/campaign-library` is an authenticated, bundled Markdown guide linked from
the library toolbar in a new tab so existing drafts remain open. Its table of
contents links to focusable headings with the live header scroll offset. It covers
source identity, completeness, basic authoring and adoption, bounded calculations,
advanced mechanical rules, import/prune and deliberate updates. The article uses
original examples rather than distributing rulebook content. Optional editor
sections retain mounted drafts while folded; invalid advanced fields reopen their
section. Source metadata validates in place and keeps its correction visible until
repaired. Source forms present named validation errors, required labels and first-error
focus. Skill prerequisites/defaults offer common guided rules and preserve nested or
conditional definitions in their advanced JSON editor.

Item armor authoring offers guided base/crushing/typed DR, DB, flexibility, coverage
(including removable custom locations), facing and notes. Advanced YAML round-trips
the complete schema; invalid input stays editable and opens its section. Facing
controls prevent simultaneous front-only/back-only selection and explain conflicting
imported data; saving contradictory facing YAML is blocked until repaired.
Language/technique/style editors use the same whole-entry outbox
validation as the other categories, disable edits while a submit is pending, and
preserve commas inside newline-separated style component names. Styles remain
reference packages: players learn constituent entries individually.

## Image visibility

A character portrait is part of the minimal campaign-member projection, including
list and cursor reads when full-sheet sharing is disabled. Cover manifests are
available to campaign readers. Portrait changes require character write permission;
cover changes require campaign ownership. These checks control discovery and
editing: published image URLs themselves grant public access and use long-lived
public caching. Leaving a campaign does not revoke a previously learned image
URL or cached copy. See [media-uploads.md](media-uploads.md).
