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
| `owner` (GM) | Everything: edit settings, manage all members and roles, transfer ownership, delete the campaign, edit the library, always sees every member character in full. |
| `manager` | Invite at the `member` tier, cancel pending invitations, and remove members (`requireCampaignAdmin`). Cannot add members directly, change roles, promote to manager, transfer ownership, or edit campaign settings / the library — those are owner-only. |
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
spellcasting for member characters), and `shareCharacterSheets`.

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
of each character in the campaign.

```
full     — owner of the character, the campaign GM (owner), OR any member
           of a campaign with shareCharacterSheets = true.
minimal  — a non-GM member of a campaign with shareCharacterSheets = false.
           (public columns only — no traits/skills/spells/inventory/combat.)
```

Owner and GM checks **short-circuit** the share flag, so flipping it never
restricts the GM's own visibility, nor a player's view of their own sheet.

### Enforced in two places — keep them in lockstep

This gate is defence-in-depth. Changing one side without the other reopens a
data-leak hole (this is exactly what Codex review on PR #22 caught).

1. **Server — what leaves the database.**
   `decideCharacterAccess()` in `src/server/routes/sync.ts` is the pure
   decision (`full` vs `minimal`) and is unit-tested without Postgres. On
   `POST /sync/cursor`:
   - `character` upserts are emitted for every accessible character, but
     `minimal` rows are run through `projectCharacterRow` first so only
     public columns ship.
   - Child classes (traits / skills / spells / inventory / combat) are scoped
     to `fullAccessCharacterIds` only — a `minimal` viewer never pulls another
     player's private rows at all.
   - The response also carries authoritative `accessible.characterIds` /
     `campaignIds` so the client can prune rows that fell out of access
     (tombstones can't reach ex-members).
   - `GET /characters/{id}` applies the same gate via `shouldUseMinimalView`.
   - `GET /characters` (the list) masks `st/dx/iq/ht` to the 10/10/10/10
     baseline for rows the viewer may only see in `minimal` form, using the
     same `decideCharacterAccess` decision.

2. **Client — what stays in IndexedDB.**
   `characterIdsToMinimize()` in `src/client/sync/minimalViewSweep.ts` mirrors
   the server decision and computes which characters' **already-cached** private
   child rows must be purged from Dexie. The orchestrator runs the sweep after
   **every** `/sync/cursor` pull and on **bootstrap**, so a fresh
   `shareCharacterSheets = false` flip lands by the next sync tick at latest —
   without it, private rows cached before the flip would remain recoverable in
   IndexedDB.

**Rule:** any change to the sharing decision must update **both**
`decideCharacterAccess` (+ `projectCharacterRow`) and `characterIdsToMinimize`,
and their tests. History-detail redaction follows the same gate — `minimal`
viewers get no character-history detail (see history-tracking.md Risks).

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
  the same bytes. `LIBRARY_YAML_VERSION = 1`; max payload 20 MB.
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
- **Seed:** `bootstrap/sample_library.yaml` is imported into the "Sample"
  campaign by `db:seed`.

Keys used for upsert matching: traits by `kind::lower(name)`; skills, spells,
and items by `lower(name)`.

## Adventure log

Per-campaign session notes (`adventure_log_entries`, exposed via
`src/server/routes/adventureLog.ts`):

- **Read:** campaign members, **but private entries are hidden from non-authors**
  (`visibility` = campaign-wide vs private GM/player scratch).
- **Write:** the entry's **author or the campaign owner**.
- Entries carry `sessionDate`, `title`, `body`, `visibility`, and `xpAwards`.
- Client surface: `LogPage`.

## Auditing

Every campaign-family write (settings, membership, library, adventure log) runs
inside `withAudit(...)` so the DB history triggers attribute it — the campaign
**History view** (`CampaignHistoryPanel`) reads
`GET /campaigns/{id}/history` (`scope='campaign'`), plus an owner-only
`?scope=character` roll-up across member characters. See
[history-tracking.md](history-tracking.md); campaign-family REST files that add
a new mutating route must be added to the guard test's `MUTATING_ROUTE_FILES`.
