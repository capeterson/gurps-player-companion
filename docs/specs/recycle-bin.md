# Recycle bin

Deleting a character or a campaign moves it to a recycle bin. It stays there,
restorable, for **30 days**, then a nightly sweep deletes it for good. Nothing is
ever hard-deleted early by the sweep; the owner (or any person using the app or
raw API, never a delegated agent) may delete an item from the bin sooner.

## Lifecycle

| State | `deleted_at` | Visible | Reached by |
|---|---|---|---|
| Live | `NULL` | everywhere | create, restore |
| Binned | set (DB clock) | only in the bin | `DELETE /characters/{id}`, `DELETE /campaigns/{id}`, a `/sync/operations` character delete |
| Gone | row removed | nowhere | **Delete now**, or the nightly sweep after 30 days |

Columns (migration `0075_recycle_bin.sql`): `characters.deleted_at`,
`characters.deleted_by`, `characters.recycled_from_campaign_id`,
`campaigns.deleted_at`, `campaigns.deleted_by`, with partial indexes on the
marked rows. `recycled_from_campaign_id` is a soft reference (no foreign key) so
purging a campaign never rewrites its characters.

A binned row stays in place. Its children, library, memberships, log and
encounters are untouched; portrait and cover references stay, so media cleanup
leaves them alone; history is continuous (the bin and restore are `update`
events, summarized as "Moved … to the recycle bin" and "Restored … from the
recycle bin"). On a permanent delete the existing cascade, tombstone, history
and media-orphan machinery runs unchanged, exactly as the old hard delete did.

## Characters and campaigns

- **Binning a character** keeps its campaign link and its attachments (adventure
  log notes, encounter combatants) so a restore is lossless. Those links are
  detached by the existing foreign-key `SET NULL` only when the character is
  permanently deleted.
- **Binning a campaign** behaves like a campaign delete did: members lose
  access, and every character in it (including already-binned ones) is detached
  — library-linked mechanics become owned copies, earned points stay — and
  remembers the campaign in `recycled_from_campaign_id`.
- **Restoring a campaign** re-attaches the characters it released that are still
  campaign-less and whose owner is the campaign owner or still a member. A
  character that joined another campaign, or whose owner left, stays where it is.
  The library is restored whole; characters keep their owned copies (linked
  mechanics are not re-linked).
- Restoring a character whose campaign is binned or gone leaves it campaign-less.

## Retention guarantee

`sweepRecycleBin` (`services/recycleBin.ts`) selects rows with
`deleted_at <= now() - 30 days` using the **database clock**, so an item is never
purged before 30 days. The sweep runs nightly at 03:00 UTC from the shared
nightly scheduler (`services/nightlyMaintenance.ts`, which also runs the account
purge), so an item is removed between 30 and 31 days after deletion. Every
replica may run it: a transaction advisory lock (`gpc:recycle-bin`) admits one
sweeper, each item commits in its own audited transaction (actor empty: system
maintenance, no inbox notifications), the row is re-checked `FOR UPDATE SKIP
LOCKED` so a concurrent restore wins, and a failed item stays queued for the
next night. Campaigns are swept before characters. A stopped server simply
misses the run; overdue items go on the next night after startup.

## Read paths

A binned row does not exist for any ordinary read. `loadCharacterOr403` and
`lookupCampaignRole` (so every `loadCampaignOr403`/`requireCampaign*`) filter
it, as do the character and campaign lists, `/sync/cursor`, invitation lookup
and listing, adventure-log locking and awards, character history and detail
projection, and the idempotency access fingerprint. A few queries deliberately
still see binned rows (admin views, library changes that must reach binned
characters, post-authorization row locks, WebSocket recipient lookups).
`src/server/db/recycleBinReadGuard.test.ts` enforces this: every server query
that reads `characters` or `campaigns` must filter `deletedAt` or carry a
`// recycle-bin: <reason>` comment, so a new query cannot silently expose binned
rows.

## Sync

A bin is an **access contraction**, a restore an **access expansion**; there is
no new client protocol.

- Binned rows leave the `accessible` sets and the cursor's row queries. Every
  device (owner and members) prunes them with `pruneInaccessibleLocally`,
  children and library rows included. No tombstone is written, so no device is
  told the row was "deleted".
- A restore puts the row back in `accessible`; `resetCursorsForAccessExpansion`
  clears the cursors and the next pull backfills it with its children.
- The recycle-bin columns are server-only and stripped from emitted rows.
- Character deletion from the PWA still goes through the outbox
  (`enqueueDelete`); the dispatcher calls the same `binCharacter`.
- **Restore and Delete now are online-only REST calls** followed by a sync pull
  (the bin's contents are not local data), like the YAML library import.

## Authorization

- Bin a character: as before (`loadCharacterOr403` + `assertWrite`: the owner, or
  an owner/manager of its campaign when GM character editing is on).
- Bin a campaign: its owner.
- List, restore or permanently delete a character: its owner, or the person who
  binned it while they still have write access through its live campaign.
- List, restore or permanently delete a campaign: its owner.
- **Delete now is refused to delegated agents.** `DELETE /recycle-bin/characters/{id}`
  and `/campaigns/{id}` return 403 when the call arrives through the MCP
  executor (or an OAuth identity), and both operations are explicit
  `excluded()` entries in the MCP operation manifest. Agents may list the bin
  (`list_recycle_bin`) and restore (`character`/`campaign` action `restore`).
- Guests: nothing is added to `GUEST_ALLOWED_OPERATIONS`; the bin is neither
  reachable nor linked for them.

## API

| Route | Purpose |
|---|---|
| `DELETE /characters/{id}` | Bin a character (204). |
| `DELETE /campaigns/{id}` | Bin a campaign (204). |
| `GET /recycle-bin` | `{characters:[{id,name,deletedAt,purgeAfter}], campaigns:[{…, characterCount}]}`. |
| `POST /characters/{id}/restore`, `POST /campaigns/{id}/restore` | Restore (204). |
| `DELETE /recycle-bin/characters/{id}`, `DELETE /recycle-bin/campaigns/{id}` | Delete now (204); 404 unless the item is binned. Not available to agents. |

## Interface

- Characters page: owners get a `⋯` actions menu on each card with **Delete…**
  (a confirmation that states the 30 days; the toast offers **Undo**). The menu
  uses the shared viewport-bounded overlay. Campaign settings → Danger zone →
  **Delete campaign…** uses the same confirmation wording and Undo.
- A muted **Recycle bin** link sits under the Characters and Campaigns lists and
  opens `/recycle-bin` (hidden for guests, who are redirected away).
- `/recycle-bin` lists characters and campaigns with "Deleted {date} · removed
  after {date}", **Restore** and **Delete now**. Deleting a character asks for a
  confirmation; deleting a campaign asks the owner to retype its name.

## Code map

`services/recycleBin.ts` (bin/restore/purge, listing, sweep),
`services/nightlyMaintenance.ts` (scheduler), `routes/recycleBin.ts`,
`shared/schemas/recycleBin.ts`, `client/features/recycleBin/RecycleBinPage.tsx`,
`client/features/characters/{CharacterCardMenu,useDeleteCharacter}`.
