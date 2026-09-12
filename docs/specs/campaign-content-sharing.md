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
(how people join). Sharing is an **online-only, REST + React-Query** surface —
none of it flows through the offline outbox (campaigns are pulled read-only
into Dexie for the share gate, campaign names, mana, and house rules). See
[offline-sync.md](offline-sync.md) S0.

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

### Invitations

Joining is invite-based (`src/server/routes/invitations.ts`):

- An **owner or manager** creates a pending invitation
  (`POST /campaigns/{id}/invitations`). Managers may only invite at the
  `member` tier; inviting a `manager` requires the owner.
- Invitees are resolved by **handle** via `findUserByHandle` — exact email
  match wins, then exact display-name match, both case-insensitive.
- A **notification** (`notifications` table + the header bell) tells the invitee.
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
roster from the campaign itself.

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
History-detail redaction follows the same gate — `minimal` viewers get no
character-history detail (see history-tracking.md Risks).

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
observed events over 30 seconds.

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

A per-campaign catalog of reusable content, backed by seven tables:
`campaign_library_traits`, `campaign_library_skills`,
`campaign_library_spells`, `campaign_library_items`,
`campaign_library_languages`, `campaign_library_techniques`, and
`campaign_library_styles`. It's what lets a GM define campaign-specific
advantages, skills, spells, gear, languages, and martial-arts content
once and have players pull them onto their sheets.

Library languages carry only the book definition — `name`, `description`,
`source`, and `isSignLanguage`. Fluency and point cost are per-character and
live on `character_languages`; picking a sign language from the autocomplete
seeds the character row's written fluency to `n/a`.

- **Read** (`GET /campaigns/{id}/library`): any campaign **member**.
- **Write** (per-entity CRUD): campaign **owner** only. Endpoints are
  `POST/PATCH/DELETE /campaigns/{id}/library/{traits|skills|spells|items|languages|techniques|styles}[/{id}]`
  in `src/server/routes/campaignLibrary.ts`. These back the library editor UI
  (traits/skills/spells/items have dedicated editor forms; the
  languages/techniques/styles routes are primarily exercised via the YAML
  import flow and consumed on the character sheet — the editor's own tabs
  do not yet render those kinds); library mutations do **not** go through
  the sync outbox.
- Client surfaces: `CampaignLibraryPage` (the `/campaigns/:id/library` editor)
  and the top-nav `LibraryPage` (`/library`, the primary home for YAML
  import/export), plus `LibraryAutocomplete` / `LibraryModifierPicker` on the
  character sheet, which let a player search the campaign library when adding a
  trait/skill/spell/item/language/technique.

Picking a library skill copies its base name, attribute, difficulty, default
specialization and learned TL into the character row, with description, source
and prerequisites in notes. This snapshot is queued durably through the character
outbox. Changing the campaign TL does not rewrite learned skill TL. Editing the
add form's name detaches its selected definition; a pending save cannot clear a
newer selection, even one with the same base name. Sheet rows, rolls, roll history and
GM lookup identify specialized skills by `skillDisplayName`; the GM lookup keeps
each specialty selectable and reports its effective level.

Trait/skill effect declarations are materialized on the owned character rows,
live-linked and versioned while their source exists. Library CRUD
and YAML import advance referencing child revisions in the same transaction, so
other devices refresh calculations through their normal HTTP cursor even if a WS
nudge is dropped. Library writes also advance the campaign revision so committed
HTTP pulls invalidate its library editor/autocomplete query, including definitions
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
recreating the old name cannot reconnect a different UUID. Campaign transfers
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
  the same bytes. `LIBRARY_YAML_VERSION = 7`; max payload 20 MB. v1
  (pre-effects), v2 (effects on traits/skills), v3 (container/powerstone/
  magic-item item fields + `campaign.manaLevel`), and v4 (languages +
  techniques/styles sections) documents still parse — the
  parser unions on the literal `version` field and newer fields
  default/absent on older docs.
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
- **Item enchantments (v5):** `library.items` entries carry an optional
  `enchantments: []` list (`enchantmentRef[]`: spellName, spellLevel?, category?,
  notes?) which copies onto character inventory items upon add.
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
  campaign settings, and all seven library sections are read on one read-only
  `REPEATABLE READ` transaction, so concurrent edits cannot produce a torn
  document assembled from different database moments.
- **Import** (`POST /campaigns/{id}/library/import`): owner only. Two modes:
  - `merge` (default) — upsert incoming rows by name/kind key, leave others.
  - `replace` — additionally delete existing rows not present in the document.
    **Careful edge case, encoded in the importer:** a `replace` import only
    prunes spells when the document actually carried a `spells:` section, so a
    pre-spell-library export (which omits it) doesn't wipe the current spell
    library. An explicit `spells: []` still deletes. The `languages` section
    (v4) follows the same optional-section rule.
  - Returns per-section `{ created, updated, deleted }` counts.
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
- **Seed:** `bootstrap/sample_library.yaml` is imported into the "Sample"
  campaign by `db:seed`.

Keys used for upsert matching: traits by `kind::lower(name)`; skills, spells,
items, languages, techniques, and styles by `lower(name)`. The natural-key
unique indexes on all seven `campaign_library_*` tables are
**case-insensitive** (`UNIQUE (campaign_id,
lower(name))`, traits additionally scoped by `kind`; see migration 0021), so
`POST`/`PATCH` reject a case-insensitive duplicate with `409` and an import's
name match can never be shadowed by a differently-cased row created through
the CRUD editor. A case-insensitive import match updates the existing row in
place (preserving its id) and adopts the incoming `name` spelling/casing along
with its other fields.

## Adventure log

Per-campaign session notes (`adventure_log_entries`, exposed via
`src/server/routes/adventureLog.ts`):

- **Read:** campaign members, **but private entries are hidden from non-authors**
  (`visibility` = campaign-wide vs private GM/player scratch).
- **Write:** the entry's **author or the campaign owner**. The author or owner
  may also **edit** (`PATCH`) and **delete** (`DELETE`) entries; the client
  `LogPage` exposes Edit/Delete controls on entries the viewer may modify.
- Entries carry `sessionDate`, `title`, `body`, `visibility`, and `xpAwards`.
- **Body is markdown** (CommonMark + GFM), stored verbatim in the `body` text
  column. Rendering is sanitized at render time only:
  `src/client/components/markdown/markdownProcessor.ts` runs
  `remark-parse → remark-gfm → remark-rehype(allowDangerousHtml) →
  rehypeEscapeRaw → rehype-sanitize → rehype-stringify`. Raw HTML/scripts in
  the source are **never interpreted** — `<script>` becomes escaped literal
  text (`&#x3C;script&gt;…`) and `rehype-sanitize` runs as defense-in-depth.
  There is no server-side HTML stripping; the contract is enforced at the
  single render site (`<Markdown>`).
- **Editor:** the create/edit form uses a Tiptap + `tiptap-markdown` WYSIWYG
  (`src/client/components/markdown/RichTextEditor.tsx`) with a "Rich text" /
  "Markdown" tab toggle. The stored source of truth is always the markdown
  string — the editor never produces or persists HTML. Strict CommonMark line
  breaks (single newlines do not become `<br>`).
- Client surface: `LogPage` (single-column `max-w-3xl` layout), also embedded
  in `CampaignDetailPage`.

## Auditing

Every campaign-family write (settings, membership, library, adventure log) runs
inside `withAudit(...)` so the DB history triggers attribute it — the campaign
**History view** (`CampaignHistoryPanel`) reads
`GET /campaigns/{id}/history` (`scope='campaign'`), plus an owner-only
`?scope=character` roll-up across member characters. See
[history-tracking.md](history-tracking.md); campaign-family REST files that add
a new mutating route must be added to the guard test's `MUTATING_ROUTE_FILES`.
