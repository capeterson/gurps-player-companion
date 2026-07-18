# Design Spec: Campaign Content Sharing

Campaigns are how content is shared between players and a GM. This document
describes the three sharing mechanisms as they exist today:

1. **Membership & roles** — who is in a campaign and what they can do.
2. **The character-sheet share gate** — how much of a player's sheet other
   members can see, enforced on both server and client.
3. **The campaign library** — a per-campaign catalog of traits/skills/spells/
   items, editable by the owner and portable as versioned YAML.

Plus the **adventure log** (per-entry visibility) and **invitations**
(how people join). Sharing is an **online-only, REST + React-Query** surface —
none of it flows through the offline outbox (campaigns are pulled read-only
into Dexie only so the share gate can be evaluated offline). See
[offline-sync.md](offline-sync.md) S0.

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

Endpoints (`src/server/routes/campaigns.ts`):
`POST/GET /campaigns`, `GET/PATCH/DELETE /campaigns/{id}`,
`POST /campaigns/{id}/members`, `PATCH/DELETE /campaigns/{id}/members/{userId}`,
`POST /campaigns/{id}/transfer` (transfer ownership).

Campaign settings that shape shared play: `pointTarget`, `disadvantageCap`,
`quirkCap`, `manaLevel` (the campaign's ambient mana, which shapes
spellcasting for member characters), `shareCharacterSheets`, and the default-off
`allowGmCharacterEditing` switch. The latter grants owners/managers normal sheet
editing through the character outbox and server `assertWrite` path; it does not
create a dashboard-specific mutation path.

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
     (tombstones can't reach ex-members).
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

## The campaign library

A per-campaign catalog of reusable content, backed by four tables:
`campaign_library_traits`, `campaign_library_skills`,
`campaign_library_spells`, `campaign_library_items`. It's what lets a GM define
campaign-specific advantages, skills, spells, and gear once and have players
pull them onto their sheets.

- **Read** (`GET /campaigns/{id}/library`): any campaign **member**.
- **Write** (per-entity CRUD): campaign **owner** only. Endpoints are
  `POST/PATCH/DELETE /campaigns/{id}/library/{traits|skills|spells|items}[/{id}]`
  in `src/server/routes/campaignLibrary.ts`. These back the library editor UI;
  library mutations do **not** go through the sync outbox.
- Client surfaces: `CampaignLibraryPage` (the `/campaigns/:id/library` editor)
  and the top-nav `LibraryPage` (`/library`, the primary home for YAML
  import/export), plus `LibraryAutocomplete` / `LibraryModifierPicker` on the
  character sheet, which let a player search the campaign library when adding a
  trait/skill/spell/item.

### YAML import/export (cross-campaign sharing)

The library is portable as a **versioned, round-trippable YAML document** — the
mechanism for sharing content between campaigns or seeding a new one.

- **Codec:** `src/shared/yaml/library.ts` (pure, shared). `parseLibraryYaml`
  validates against the `campaignLibrary` Zod schemas and rejects duplicate
  keys; `emitLibraryYaml` produces **byte-stable** output via canonical
  sorting, key ordering, and field compaction, so import → export → diff yields
  the same bytes. `LIBRARY_YAML_VERSION = 3`; max payload 20 MB. v1 (pre-effects)
  and v2 (effects on traits/skills) documents still parse — the parser unions
  on the literal `version` field and newer fields default/absent on older docs.
- **Item fields (v3):** library items carry the same container/powerstone/
  magic-item shape as character inventory rows (`src/shared/schemas/inventory.ts`):
  `isContainer`, `hideawayCapacityLbs`, `weightReductionPercent`,
  `powerstoneData` (nullable; `maxEnergy`/`currentEnergy`/`notes`), and
  `magicItemData` (nullable; `spellName`/`spellSkillLevel`/`mode`/`chargesMax`/
  `chargesCurrent`/`energyCost`/`notes`). These pass through the library →
  character copy path (`InventoryPanel.onPickLibraryItem`/`onCreate`) verbatim,
  the same way `armor`/`weaponData` already did — a picked powerstone or magic
  item arrives on the character's inventory row with its template charge state.
- **Campaign block `manaLevel` (v3):** export always includes the campaign's
  ambient `manaLevel` (Basic Set p. 235) alongside `description`/`pointTarget`/
  `disadvantageCap`/`quirkCap`.
- **Export** (`GET /campaigns/{id}/library/export`): any member; streams a YAML
  attachment (`<slug>-library.yaml`) including campaign settings.
- **Import** (`POST /campaigns/{id}/library/import`): owner only. Two modes:
  - `merge` (default) — upsert incoming rows by name/kind key, leave others.
  - `replace` — additionally delete existing rows not present in the document.
    **Careful edge case, encoded in the importer:** a `replace` import only
    prunes spells when the document actually carried a `spells:` section, so a
    pre-spell-library export (which omits it) doesn't wipe the current spell
    library. An explicit `spells: []` still deletes.
  - Returns per-section `{ created, updated, deleted }` counts.
  - **`applyCampaignSettings`** (boolean, default `false`): opt-in. When
    true and the document carries a `campaign` block, `description`,
    `pointTarget`, `disadvantageCap`, `quirkCap`, and `manaLevel` are copied
    onto the campaigns row — only the fields actually present in the
    document (an omitted field leaves the current value alone); `name` is
    never touched by import. The response's `campaignSettingsApplied`
    reports whether anything was actually written (false when the flag was
    off, the document had no `campaign` block, or the block had no
    recognized fields).
- **Seed:** `bootstrap/sample_library.yaml` is imported into the "Sample"
  campaign by `db:seed`.

Keys used for upsert matching: traits by `kind::lower(name)`; skills, spells,
and items by `lower(name)`. The natural-key unique indexes on all four
`campaign_library_*` tables are **case-insensitive** (`UNIQUE (campaign_id,
lower(name))`, traits additionally scoped by `kind`; see migration 0021), so
`POST`/`PATCH` reject a case-insensitive duplicate with `409` and an import's
name match can never be shadowed by a differently-cased row created through
the CRUD editor.

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
