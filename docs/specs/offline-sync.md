# Design Spec: Offline Sync

The offline-sync system is load-bearing for the entire UX promise: **edits
never disappear, the status indicator is honest, and rollbacks are visible.**
This document describes how it works today. The **extension rules** (what you
must keep true when touching it) are `AGENTS.md` S0–S11 and the tenets in the
README — this spec is the descriptive companion; read both.

## Scope — what is actually sync-backed

The outbox + cursor system covers **only the character family**:

```
character  character_trait  character_skill  character_spell
character_language  character_technique  character_inventory
character_combat
```

Everything else is either read-only in the local store or fully online:

- **Campaigns** are pulled **READ-ONLY** through `/sync/cursor` (rows land in
  Dexie so the minimal-view sweep can evaluate `shareCharacterSheets` and
  `useCharacterDetail` can resolve campaign names offline) but have **no outbox
  path** — campaign *mutations* go through REST.
- **Online-only** (HTTP + React Query, no offline support): the campaign
  library, adventure log, invitations, notifications, settings, admin.

Library editing remains online-only, but calculation no longer depends on its
React Query cache. Trait/skill rows persist `libraryMechanics` in Postgres and
Dexie: source ID, source campaign, source revision, raw effect declarations, and
an optional `detached` flag. `effects: []` is known empty; `effects: null` is
unresolved. Server and client derive from the same owned copy; the cursor reads
it after the character share gate without fetching live source data. The field
is read-only and never accepted as an outbox patch or caller-supplied snapshot.

Selecting an already loaded definition also seeds validated local-only declarations
into the speculative create row, in the same Dexie transaction as its outbox entry.
They survive offline reloads and are excluded from the operation envelope; the server
captures its own authoritative source version. A rejected create removes that copy,
persists the rejection notice, and flashes the corresponding add form. Invalid local
metadata aborts the transaction without leaving a row or queued operation.

The declarations live in existing character stores, so normal logout/account
switch purge and minimal-view cleanup remove them with their owning rows. Cursor
application validates them transactionally while preserving pending local fields;
readers also verify the source ID/campaign against current local intent. Dexie v9
clears only trait/skill cursors once so existing installations backfill on their
next online pull. Until then unresolved linked calculations show an unavailable
state. A failed pull retains the last valid declarations. Library definitions use
a live-link policy: `services/ownedLibraryMechanics.ts` validates and updates owned
declarations in the audited library writer's transaction, scoped to characters in
that source campaign. This also advances child revisions and records actual old/new
mechanics in history. CRUD and YAML merge/replace share the same helper. Migration
0036 replaces 0035's revision-only triggers and backfills owned copies while sources
still exist; already dangling/foreign references stay visibly unresolved.
Normal incremental HTTP pulls therefore detect definition changes without WS,
including when a client reconnects after multiple edits. Source revisions travel
with declarations; array length is never used as a freshness signal.

After commit, `services/libraryInvalidation.ts` sends a row-free `sync_invalidate`
nudge to the campaign owner and members. `wsSubscriber.ts` only triggers the ordinary
sync cycle. All library CRUD/import transactions also advance the campaign revision;
after HTTP cursor changes commit locally, a Dexie live query in each tab invalidates
that campaign's React Query library prefix via `features/campaigns/libraryInvalidation.ts`.
This also
retains invalidation when an initial library request is still pending: after that
request settles, active queries refetch and inactive prefetches remain stale.
The observer also
refreshes unowned definitions and works when WS is unavailable. Migration 0035 indexes
library references and advances existing linked children to repair pre-fan-out cursors.
A durable function-comment marker makes this repair idempotent on SQL replay; an
advisory transaction lock serializes concurrent repair attempts. Cursor-only campaign
audit rows remain stored but are filtered out of the user-facing history feed.
Failed nudges do not fail committed
writes. The cursor retains its existing membership/share gates. Existing history
triggers record affected child refreshes under the library writer's audit context;
the campaign library event records the definition edit too. Before a definition is
deleted, owned copies retain its last validated declarations/version and detach the
live ID. Campaign deletion also detaches surviving characters before source rows
cascade away. A renamed replacement or recreation gets a new ID and never rewrites those
copies. Campaign transfers through REST or sync detach all six library reference
types; traits/skills retain their authorized saved declarations and provenance.
Missing snapshots remain explicitly unresolved after transfer. Variant, modifier,
level, skill specialty, and paid-point selections are unchanged. Sheet rows label
live versus retained rules and their version; history names updates and detachment.

The authoritative list of pulled classes is `ALL_ENTITY_CLASSES` in
`src/client/sync/orchestrator.ts`. The `entityClass` enum in
`src/shared/schemas/sync.ts` intentionally lists **more** classes than the
orchestrator pulls — that is migration headroom, not a claim of coverage
(`AGENTS.md` S0). **Always confirm a surface is sync-backed before assuming it
works offline.**

## Components

| Piece | File | Role |
|---|---|---|
| Local DB | `src/client/db/dexie.ts` | IndexedDB stores + the `outbox`, `syncCursors`, `syncMeta`, `tombstones`, `rejectionToasts`, and bounded `syncLog`. The UI's source of truth. |
| Outbox helpers | `src/client/sync/outbox.ts` | `enqueueFieldPatch` / `enqueueCreate` / `enqueueDelete` — write the local row and the queued op in **one Dexie transaction**. Coalescing lives here. |
| Orchestrator | `src/client/sync/orchestrator.ts` | Long-lived singleton: drains the outbox, pulls the cursor, applies outcomes, bootstraps, emits sync state, handles online/offline + backoff + multi-tab locks. The only module that talks to `/sync/*`. |
| Sync state | `src/client/sync/state.ts` | `SyncStateStore` the indicator subscribes to. |
| Flash bus | `src/client/sync/flashBus.ts` | Rollback pulse events keyed `entityClass:entityId:fieldPath`. |
| WS subscriber | `src/client/sync/wsSubscriber.ts` | Consumes `sync_invalidate` nudges → triggers a pull. |
| Minimal-view sweep | `src/client/sync/minimalViewSweep.ts` | Purges private rows from Dexie when share access downgrades (see campaign-content-sharing.md). |
| Draft hook | `src/client/hooks/useDraftField.ts` | Canonical draft-on-blur input; queues same-field edits, syncs per-field when clean, fires toast+flash on rollback. |
| Sync log UI | `src/client/components/SyncStatusIndicator.tsx`, `SyncLogView.tsx` | Clicking the toolbar status opens pending changes and the latest 1,000 push/pull events, each expandable (collapsed by default) to its before/after values and metadata. A red badge shows its reason in a banner here. Operations failing at least four consecutive attempts are promoted in red with folded raw diagnostics and an explicit local revert action. A "Download sync debug log" button (`src/client/sync/debugDump.ts`) exports the outbox, rejection records, sync-log journal, and cursors as a JSON file for bug reports. |
| Server dispatch | `src/server/services/syncDispatch.ts` | `dispatchOperation()` — the single server write chokepoint for character ops. |
| Sync routes | `src/server/routes/sync.ts` | `POST /sync/operations` (drain) and `POST /sync/cursor` (pull). |
| WS route | `src/server/routes/syncWs.ts` + `services/wsBus.ts` | Invalidation push channel. |

## Data flow

```
  ┌──────────┐   write     ┌────────────┐   drain    ┌──────────────┐
  │  React   │────────────▶│   Dexie    │──────────▶│ /sync/       │
  │  + Zod   │   (1 txn:   │  (stores + │           │  operations  │
  │          │   row + op) │   outbox)  │◀──────────│              │
  └──────────┘             └────────────┘   pull    └──────┬───────┘
       ▲                          ▲     /sync/cursor       │
       │ useLiveQuery             │                        │
       │                          └────────────────────────┘
       │                            WS sync_invalidate
       │                                     │
       └─────────────────────── flashBus ◀───┘
                  (rollback toast + flash)
```

1. **Write.** A mutation handler for a sync-backed class calls an `enqueue*`
   helper. Handlers **never** `fetch` directly (`AGENTS.md` S1). The enqueue
   writes the local row and the outbox entry in a single Dexie transaction —
   the edit is either fully applied locally *and* queued, or neither. The UI,
   reading via `useLiveQuery`, re-renders immediately.
   `enqueueFieldPatches` queues a gesture's related field edits in a single
   transaction across their stores and the outbox. HP/FP fatigue updates use
   this path and share a history `batchId`; each op still carries its bare field
   value and settles independently under the existing server protocol.
2. **Drain.** The orchestrator batches pending outbox ops (up to
   `DRAIN_BATCH_SIZE`) into `POST /sync/operations`. A `navigator.locks` lease
   serializes the drain across tabs (lock order is always DRAIN → CURSOR).
3. **Dispatch.** The server processes each op **independently** — one bad op
   never poisons the batch. HTTP status is always 200; per-op outcomes live in
   `outcomes[].status`. Optimistic concurrency uses `baseRevision`; a mismatch
   returns `stale_base` plus the latest entity.

   Rapid same-entity edits (e.g. add an item, then mark it as a weapon, then
   tweak its stats) get enqueued client-side with the **same** `baseRevision`,
   since nothing has been acked yet to advance it. Applying such a burst
   straight through would stale-base every op after the first, one per drain
   round trip. `createBatchRevisionChains()` in `src/server/routes/sync.ts`
   fixes this with a **batch-local revision fast-forward**: it tracks, per
   `${entityClass}|${entityId}`, the `(firstBase, latest)` range produced by
   `patch` ops already applied earlier in the *same request*, and rewrites a
   later op's `baseRevision` to `latest` when its original base falls in
   `[firstBase, latest)`. Those intermediate revisions were produced by this
   same client's own prior op in the burst — not a conflict — because
   per-field coalescing (S3) guarantees no two ops in one burst patch the same
   field, so array order is exactly this client's intended order. `create`
   outcomes never seed or extend a chain (a *replayed* create can return a
   revision that already embeds a foreign write, which would be unsafe to
   fast-forward past); `character_combat` has no `baseRevision` check at all
   (unconditional upsert), so the fast-forward is inert for it. A foreign
   write landing mid-batch still pushes the DB revision above the chain's
   `latest`, so the rewritten base is still stale and `stale_base` fires
   normally — the client's `stale_base` self-heal (below) remains the
   fallback for that case and for bursts spanning more than one 50-op batch.
4. **Apply outcome.** The orchestrator stamps the new revision on `applied`,
   reverts + toasts + flashes on rejection, and adopts `latestEntity` on
   conflict/stale (then flashes).
   A rejected field patch cannot overwrite a newer queued edit. Reconciliation
   preserves that edit, repairs its rollback anchor to the last confirmed value,
   and keeps other pending fields when adopting a returned server row. The
   earlier failure still produces its persistent toast and flash; the local
   journal records an unchanged value when the newer intent is preserved.
5. **Pull.** `POST /sync/cursor` returns rows + tombstones since each class's
   cursor position, plus the authoritative `accessible` id sets. The
   orchestrator merges rows into Dexie — but **never overwrites a field with a
   pending/in-flight outbox op**, and it also **never writes a row at all while
   a pending/in-flight/transient-retry whole-entity delete for that same class
   and id is queued** (`applyServerRow`, `AGENTS.md` S4). This prevents a
   bootstrap/from-zero cursor pull from resurrecting a row the user deleted
   locally before the server acknowledges or rejects that delete. The explicit
   conflict/reconciliation path may bypass this protection when it must adopt
   the server's authoritative row. Periodic
   pull runs every `PERIODIC_PULL_MS` (30s); WS nudges pull sooner.

## The protocol

Defined in `src/shared/schemas/sync.ts`, validated identically on both sides.

- **Entity classes** — the closed enum above.
- **Operation commands** — `create` | `patch` | `delete`.
- **Envelope** (`operationEnvelope`): `clientOpId`, `entityClass`, `entityId`,
  `command`, `fieldPath?`, `attemptedValue`, `prevValue?`, `baseRevision?`,
  `parentId?` (parent character id for child classes — kept top-level so
  `attemptedValue`/`prevValue` stay **raw field values**, `AGENTS.md` S2),
  `validationVersion`, and optional `batchId` (groups one user gesture for the
  history fold).
- **Outcome statuses** — `applied` | `rejected` | `conflict` | `unauthorized` |
  `suspended` | `stale_base` | `transient`.

Whole-body patches validate every supplied field through the same per-field
authorization and cross-entity checks as `fieldPath` patches. Inventory parent
changes additionally share a transaction and character-row lock with the REST
tree mutations, so a crafted envelope or concurrent reparent cannot create a
foreign link or containment cycle.

### Outcome → local effect

| Outcome | Local effect |
|---|---|
| `applied` | Stamp `newRevision` onto the row, drop the outbox op. |
| `rejected` | Revert the field/row; persistent toast + input flash. |
| `unauthorized` | Same as rejected; toast names the permission failure. |
| `conflict` | Server returns `latestEntity`; client adopts it, then flashes. |
| `stale_base` | Same as conflict — `baseRevision` was behind the server. If `latestEntity` shows the field unchanged, the client re-enqueues the op with the fresh revision instead of rolling back (the self-heal below); the server's batch-local fast-forward means a same-client burst now settles in one round trip rather than needing this self-heal per op. |
| `transient` | Backoff with jitter, retry **forever** — capped at 60s while fresh, relaxing to a ~5-min cadence after `MAX_ATTEMPTS` (8). Never gives up. |
| `suspended` | Permanent fail; toast surfaces the reason. |
| network error | Whole batch reverts to `transient_retry`; loop retries, and a `failed` journal entry + a named indicator error record why. |

## The session must survive a server outage

`refreshTokens()` in `src/client/lib/api.ts` clears the token store **only** on
a `401`/`403` from `/auth/refresh` — a definitive rejection of the refresh
token. A `5xx`, a reverse-proxy/tunnel error (Cloudflare `52x`/`530`), or a
transport failure leaves the session intact and reports
`{ kind: 'unavailable' }` so the caller retries later.

It returns a typed `RefreshResult` rather than a boolean so `apiFetch` can
**surface the outage instead of the 401 that triggered the refresh**: for the
`unavailable` case it reconstructs the refresh's own response (or rethrows its
transport error). Collapsing both to the original 401 would have the
orchestrator journal "HTTP 401 — token expired" during a total origin outage,
pointing the user at their account rather than at the server — defeating the
diagnostics above.

The failure is captured as **plain data** (`status` / `bodyText` /
`contentType`), not as the `Response` object. Concurrent 401s all await the one
`refreshInFlight` promise and so share one result; handing them a single
`Response` would let the first `parse()` drain its body and leave every other
caller throwing "body already read" instead of the real status. Each caller
builds its own `Response` from that data.

This is load-bearing, not a nicety. Clearing on any non-OK response means one
badly-timed outage signs the user out permanently, and it does so **invisibly**:
the local-first UI keeps rendering Dexie data, so nothing looks wrong, while
every orchestrator cycle bails at its `!tokenStore.read()` guard without
touching the indicator — freezing the badge on whatever it last showed, with no
toast. (Observed in production during an HTTP 530 origin outage.) The
orchestrator now also reports a session that disappears *after* bootstrap
(`reportSessionLost`, latched so it fires once per loss) as a named indicator
error plus a journal entry.

That report keys off `currentUserId`, which `SyncBootstrapGate` seeds via
`orchestrator.setCurrentUser()` on **every** authenticated mount — not only at
bootstrap. The gate calls `bootstrap()` only when the `bootstrap:<userId>` flag
is absent, so on an ordinary reload (the common path) `currentUserId` would
otherwise stay null for the whole session, silently disabling both the
lost-session report **and** the minimal-view share sweep, which has the same
guard.

`setCurrentUser` also drives **rejection housekeeping** (prune + replay), once
per signed-in session, for the same reason: it used to live only inside
`bootstrap()`, so on an ordinary reload an undismissed rollback toast did not
survive — the exact thing persisting it was for — and `pruneRejectionToasts`
never ran, letting the pile-up it prevents come back. It waits for a notifier:
`SyncProvider` registers one in a mount effect that can land *after* the gate
sets the user, so `setRejectionNotifier` flushes any replay that was waiting
(replaying into a null notifier would silently drop every toast).

## Local sync log and recovery

The `syncLog` Dexie store is a device-local operational journal, separate from
the server-side entity history. Successful outbox outcomes are recorded as
`push` with `result: 'synced'`, cursor changes as `pull`, and explicit user
rollbacks as `local` with `result: 'reverted'`. Four more `result` values are
diagnostics-only, logged by `applyOutcomes` in the orchestrator:

- `requeued` — the `stale_base` self-heal deleted a stale op and re-enqueued it
  with the server's fresh revision (see the batch-local fast-forward above;
  this is the trace of "burst of edits kept stale-basing" for a debug dump).
- `rolled_back` — a `rejected`/`unauthorized`/`conflict`/`suspended` outcome
  reverted the local row; `details` carries the raw server outcome.
- `retrying` — an op transitioned into `transient_retry`. Logged **once per
  failure streak** (on the transition into retry, not on every subsequent
  retry attempt) so a stubbornly-failing op can't flush the 1,000-row journal;
  the live retry state (attempt count, backoff timing) is always visible via
  the outbox rows themselves.
- `failed` — a **whole-cycle** failure: the drain POST or the cursor pull
  itself errored (dropped connection, 5xx, reverse-proxy/tunnel error), so no
  individual operation has an outcome to report. These carry no `entityClass` /
  `entityId` / `command`; `reason` names the failure including its HTTP status
  and `details` carries the raw error. **This class of failure previously
  logged nothing anywhere** — no outbox row, no rejection record, no toast —
  which left the red badge with nothing to point at during a server outage.

It is pruned to the newest 1,000 records. Pull entries retain metadata and
revision only, never cursor row payloads. `push` and `local` entries
additionally carry `previousValue` / `newValue` snapshots (via `snapshotValue`,
which caps **strings as well as objects** at `SYNC_LOG_VALUE_MAX_CHARS` — `notes`
/ `appearance` / trait descriptions accept 20,000 characters, so exempting
strings would let a few edits retain tens of MB) so the log UI can show *what
changed* instead of just "character inventory patch".

**Rollback entries record the direction the local row actually moved.** A
rejected patch moves the row *away* from the refused `attemptedValue` and back
to what `revertLocal` restored — `prevValue`, or the server's `latestEntity`
field when one came back. `rollbackSnapshot()` is the single place that decides
this; recording it the other way round would show the user their rejected edit
as the final value and the restored one as discarded. The user-initiated
`revertFailedOperation` follows the same rule, including its superseding-edit
branch: when a newer same-field op is preserved the row lands on *that* value,
not `prevValue`, and the journal has to say so or it contradicts what the sheet
visibly shows.

**The share gate reaches this journal too.** A GM or manager editing a player's
sheet records that player's values here, and a `conflict`/`stale_base` outcome
can carry a whole `latestEntity` row in `details` — so the journal is one of the
surfaces `AGENTS.md`'s share-gate invariant covers.
`redactSyncLogForCharacters()` clears `previousValue` / `newValue` / `details`
and sets `redacted: true` on every entry whose `entityId` **or `parentId`**
matches a character being minimized or pruned; both
`enforceMinimalViewLocally` and `pruneInaccessibleLocally` call it. `parentId`
is stored on child-class entries precisely so this match can find them. The row
survives with its metadata, and the UI says the values were removed.

**The outbox needs the same gate applied at read time.** Queued ops are
deliberately *not* swept on a downgrade — the op is the user's own unsent intent
and still has to be delivered, and `pruneInaccessibleLocally` explicitly refuses
to prune an entity with unsettled local ops. So every surface that *prints*
outbox values applies the decision itself, through the single shared predicate
`isOutboxAccessRestricted()` in `minimalViewSweep.ts` (it lives beside the sweep
it mirrors because it was briefly duplicated in the dialog and the dump, and
those must not drift). `SyncLogView` and `maskRestrictedOps()` in `debugDump.ts`
both call it.

Build the access snapshot with **`characterAccessFrom()`** — never by hand
(it takes the character rows *and* the revoked ledger below).
A character stops being fully visible two ways, and both must be in `masked`:
`minimalViewMasked` (share gate flipped off) and **`accessRevoked`**. The second
covers a character the cursor's authoritative `accessible` set says is gone but
that `pruneInaccessibleLocally` deliberately *kept*, because an unsettled outbox
op still references it: that row is present and unmasked, so without the marker
the share gate would read it as fully accessible. It is cleared as soon as
access returns (unconditionally, before the prune's early return, or a character
could never recover).

A masked character always restricts. A **missing** character row means different
things depending on the op:

- **child op** (`parentId` set) — the parent going away is access loss, whatever
  the command. `delete` matters most: `enqueueDelete` stores the *entire*
  removed row in `prevValue`, so a GM deleting another player's trait leaves
  that whole row queued.
- **root `character` op** — the row is *expected* to be gone after a local
  delete, and a speculative create may not have landed, so only a `patch`
  implies lost access.

The debug dump matters most here: it is a file the user hands to someone else.

**Written records get a read-time check too**, via `isRecordAccessRestricted()`.
`redactSyncLogForCharacters` only scrubs at rest when a sweep runs, and a sweep
only runs after a successful cursor pull — so a revert performed **offline**
writes a fresh snapshot after the last sweep, with no later pull to clean it up.
Both `SyncLogView` and the debug dump re-check journal entries and rejection
records against the live masked set (the `Raw` details block is gated the same
way; a `conflict` outcome can carry a whole `latestEntity` row). A **child**
record whose parent character is missing is restricted: `pruneInaccessible-
Locally` matches dirty ops by `entityId` only, so a queued *child* op does not
protect its parent row from being pruned, and reverting that child offline then
writes a fresh snapshot naming a character the viewer can no longer see. A root
record's own entity may legitimately be long deleted, so there only an active
mask restricts — *unless* the id is in the revoked ledger.

**The revoked ledger makes the deleted-row case fail closed.**
`rememberRevokedCharacters()` records revoked ids in `syncMeta`
(`REVOKED_CHARACTERS_KEY`, capped at `REVOKED_CHARACTERS_RETENTION`), written
**before** the best-effort redaction at both revocation points. The prune
deletes the character row first, and `redactSyncLogForCharacters` is
deliberately best-effort — diagnostic housekeeping must never break a sync
cycle — so if it fails on quota or an aborted transaction, the row is gone,
nothing is marked, and a read-time check would see "unknown character" and fail
**open**. The ledger outlives the row and closes that path.

**`humanName` is private content too**, on every surface — it reads
`skill "Stealth"` / `item "Hidden Blade"` and it is the row's visible *title*.
Hiding the before/after values while still printing the label defeats the point,
so a restricted outbox op or journal entry falls back to its generic class label
in the dialog and has `humanName` stripped in the export. Rejection records get
`parentId` and the same treatment on both sides: scrubbed at rest by the sweep,
re-checked at export time.

**Rejection replay is account-scoped.** Records carry `userId`, and replay emits
only the current user's. Rows with no `userId` predate the field and are never
replayed.

**And the local database itself is claimed by one account.**
`src/client/sync/activeUser.ts` records which user Dexie belongs to, in
localStorage so `SyncBootstrapGate` can read it **synchronously on first render**
and block before anything paints. On a mismatch the gate purges and re-bootstraps
from zero. Sign-out already purges, so the UI path was safe; the gap is a session
that ends *without* one — a refresh-token rejection just clears the tokens — after
which signing in as a different, **already bootstrapped** account would find its
`bootstrap:<userId>` flag set, render immediately, and show the previous user's
characters, outbox and journal as the new user's own. Worse, the share-gate
snapshot is derived from those same stale character rows, so they read as present
and unmasked, i.e. fully accessible. `purge()` clears the claim.

Journal writes are best-effort:
quota or IndexedDB failures never block outbox settlement. Pending state is
never copied into the log; the sync view reads the authoritative outbox
directly, including attempt count, backoff timing, and the raw operation
outcome or HTTP/network error.

**Every event in the dialog expands.** Queued outbox rows and journal entries
both render as a `<details>` disclosure, **collapsed by default**, holding
field, before/after values, entity class + id, operation, timing, attempt
count, and the failure reason. The summary line stays a scannable one-liner.

**The indicator's `error` state always carries a reason.** `syncStateStore`
holds a `SyncErrorDetail { reason, at }` alongside the state; use
`setError(reason)` rather than `set('error')`. The reason drives the badge
tooltip and a banner at the top of the sync-log dialog, and is cleared
automatically when the store leaves `error` (a successful cycle). The old
tooltip — "see toast for details" — was a lie for every failure that produces
no toast. `setError` refreshes `at` even when the reason repeats, so the
dialog's "Last attempt" time stays true through a sustained outage.

**An outstanding failure outlives an empty outbox.** `refreshIndicator` runs
from the outbox `liveQuery` as well as from the cycle paths, so with no guard
*any* Dexie outbox change — including the delete that settles a successful
upload — would flip the badge to `synced` and drop the banner. The orchestrator
tracks `syncHealthy`, cleared by `markCycleFailed()` and set only by a cursor
pull that completes; `refreshIndicator` returns early while it is false, so
neither an emptied outbox (`synced`) **nor a fresh edit made during the outage**
(`syncing`) can drop the reason without a successful cycle.
(Per-operation rejections deliberately don't set it: those have their own
persistent toast, and the badge should follow the queue.)

**Every cycle-ending `catch` goes through `reportCycleFailure()`** — the cursor
pull, the drain POST, *and* `runLoop`'s outer catch (which covers
`recoverStaleInFlight`, `readDrainableOps`, `applyOutcomes` and Dexie faults).
It writes the journal entry and sets the named error together, and de-dupes via
a `WeakSet` so an error reported by the pull path and rethrown into `runLoop`
isn't logged twice. A bare `syncStateStore.set('error')` anywhere reintroduces
the unexplained red badge this design exists to remove.

**Download sync debug log.** The sync-log dialog's footer has a "Download sync
debug log" button (`buildSyncDebugDump()` in `src/client/sync/debugDump.ts`)
that assembles a JSON file for players to attach to bug reports: a metadata
header (timestamp, user agent, online state, derived userId, sync indicator
state, pending-op counts, per-store row counts), the full `outbox`,
`rejectionToasts`, `syncLog`, and `syncCursors` tables. It deliberately
excludes every entity store (characters, traits, skills, inventory, etc.) and
the access/refresh tokens — a dump attached to a support request must not leak
other players' cached sheets or session credentials. Assembly is pure Dexie
reads with no network calls, so it works offline.

**Rejection records have a lifecycle.** `rejectionToasts` rows back the
persistent rollback toasts and are replayed on bootstrap so a failure survives a
reload. Dismissing the toast now writes `dismissedAt` through the toast API's
`onDismiss` hook (`markRejectionDismissed`) — previously "dismissed" meant only
"removed from React state", so every bootstrap replayed every rejection the user
had ever seen, and the table grew without bound for the life of the install
(observed: 38 open records spanning two months, none dismissed).
`pruneRejectionToasts` runs before each replay: it auto-dismisses records older
than `REJECTION_REPLAY_MAX_AGE_MS` (7 days — a months-old rollback is noise, not
news) and trims the table to `REJECTION_RETENTION`. Auto-dismissed rows are
kept, not deleted; they remain the audit trail and stay in the debug dump.

After four consecutive attempts, a pending operation is promoted as a repeated
failure. The user may explicitly revert it under the same cross-tab drain lock:
patches restore `prevValue`, speculative creates are removed, and optimistic
deletes are reinserted. Reverting a speculative character also removes its
dependent child rows and operations. If a newer same-field edit supersedes the
failed attempt, that newer value remains queued and visible while its rollback
anchor is repaired to the last server value. The rollback produces a toast and
field flash. Reverting a speculative inventory container recursively removes
its locally-created descendants and their queued operations. The confirmed
“Abandon local changes and re-sync from server” recovery is unavailable while
offline; while online it wipes every local store, including this journal, and
bootstraps again from revision zero.

## Invariants that make it correct

These are the reasons the system holds together; each maps to an `AGENTS.md`
rule that has been broken at least once.

- **The local store is the render path** (tenet 1). React reads Dexie; the
  server is a durable mirror. A stale, offline tab keeps editing indefinitely.
- **No edit is silently dropped** (S1, rule 1). Row + op land in one
  transaction; the indicator counts the work.
- **Per-field coalescing, latest wins** (S3). The outbox has a `coalesceKey`
  index of `entityId|fieldPath`; a new pending patch for a key **replaces** the
  existing pending/`transient_retry` op rather than stacking — otherwise an old
  value could replay over a newer one. `create`/`delete` are never coalesced.
  The replacement op's `prevValue` carries forward the OLDEST coalesced op's
  `prevValue`, not a fresh read of the local row — the local row already
  reflects the deleted op's optimistic value, so re-reading it would anchor a
  later rejection's rollback to an unsynced intermediate value instead of the
  true last-synced one (`enqueueFieldPatch` in `outbox.ts`).
- **Server pulls never clobber local intent** (S4). `applyServerRow` skips any
  field with a pending/in-flight op for the same `(entityId, fieldPath)`. Never
  re-sync a whole draft from a server cache on refetch.
- **Rollbacks are visible** (S5, rule 2). A rejection persists a
  `RejectionRecord` (survives reload) *and* emits a `flashBus` event so the
  input pulses. Reconciliation, rejection persistence, and outbox removal
  commit atomically; if storage fails, the optimistic row and operation
  remain recoverable. Notification and flash follow the commit.
  **Toast + flash are both required.**
- **Speculative creates** (S7) use a client-generated UUID and `revision: -1`;
  the same id is posted to `/sync/operations` and the server adopts it. The UI
  renders the new row immediately; the sentinel revision is overwritten on
  `applied`.
- **WebSockets are acceleration, not correctness** (S8). WS frames carry no row
  data — they only invalidate. A client that loses WS forever still converges
  via the periodic cursor pull.
- **`character_combat` has no optimistic-concurrency check.** Its dispatcher is
  an unconditional upsert (last write wins) — it never checks `baseRevision`
  and can never return `stale_base`. This is pre-existing and out of scope for
  the batch-local fast-forward above, which is inert for combat patches.
- **Bootstrap before UI** (tenet 7). First login pulls the full snapshot into
  Dexie before first paint; a `bootstrap:<userId>` flag in `syncMeta`
  short-circuits it thereafter.
- **Logout purges** (S9). `orchestrator.purge` wipes every Dexie store on
  logout so account switching never leaks rows into a `useLiveQuery`. New
  tables and new `syncMeta` keys **must** be added to the purge.

## Self-healing & pruning

Campaign assignment patches detach all six child library references in the same
IndexedDB transaction as the parent edit and outbox operation. Trait and skill
declarations remain available as retained copies while offline, after reload,
and if an acknowledged transfer is followed by a failed cursor pull. Local-only
undo data on the operation restores links when the transfer is rejected or
explicitly discarded, preserves unrelated child edits, and follows coalesced
or queued campaign changes. Cursor pulls protect these child fields while the
parent transfer is pending. The same applies to trait/skill rows first downloaded
during that transfer when their provenance identifies the original campaign: their saved rules
are detached locally and their rollback data joins the durable operation. This
also survives an outcome received from a request sent before the child arrived.
New references without source-campaign evidence stay intact until authoritative
sync reconciliation; they may already belong to the destination campaign.
Resubmitting an already-null source reference does
not erase a retained declaration; new links to missing sources are rejected.

The orchestrator recovers from partial/interrupted states rather than assuming
a clean world (see `orchestrator.recovery.test.ts`,
`orchestrator.selfheal.test.ts`, `orchestrator.prune.test.ts`,
`orchestrator.log.test.ts`):

- **Stale in-flight recovery** — ops stuck `in_flight` (e.g. a tab closed
  mid-drain) are recovered to drainable on the next cycle.
- **Access-loss pruning** — the cursor response's `accessible` id sets let the
  client drop rows it can no longer see. Tombstones alone can't reach
  ex-members (they're scoped to campaigns the viewer currently belongs to), so
  the explicit id sets close that gap. Revoking access fans out WS
  invalidations to all viewers.
- **Minimal-view sweep** — runs after every cursor pull and on bootstrap to
  purge private child rows for characters that dropped to `minimal` access
  (campaign-content-sharing.md).

## Adding a sync-backed entity class

This is a **multi-site change with no safety net** — a class registered in the
schema but missing from any site is a silent data-loss bug. Follow `AGENTS.md`
**S6** (schema enum → Dexie store+interface → orchestrator switches → outbox
switches → server dispatcher + cursor reader → purge list) **and** the history
checklist **H1–H5** (`AGENTS.md`), then add the S11 test suite (success,
rejection, slow same-field follow-up, slow different-field follow-up,
stale-field cursor preservation). The `useDraftField`, `outbox`, and
orchestrator test files are the working references.
