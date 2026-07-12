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
character_inventory  character_combat
```

Everything else is either read-only in the local store or fully online:

- **Campaigns** are pulled **READ-ONLY** through `/sync/cursor` (rows land in
  Dexie so the minimal-view sweep can evaluate `shareCharacterSheets` and
  `useCharacterDetail` can resolve campaign names offline) but have **no outbox
  path** — campaign *mutations* go through REST.
- **Online-only** (HTTP + React Query, no offline support): the campaign
  library, adventure log, invitations, notifications, settings, admin.

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
| Sync log UI | `src/client/components/SyncStatusIndicator.tsx`, `SyncLogView.tsx` | Clicking the toolbar status opens pending changes and the latest 1,000 push/pull events. Operations failing at least four consecutive attempts are promoted in red with folded raw diagnostics and an explicit local revert action. |
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
2. **Drain.** The orchestrator batches pending outbox ops (up to
   `DRAIN_BATCH_SIZE`) into `POST /sync/operations`. A `navigator.locks` lease
   serializes the drain across tabs (lock order is always DRAIN → CURSOR).
3. **Dispatch.** The server processes each op **independently** — one bad op
   never poisons the batch. HTTP status is always 200; per-op outcomes live in
   `outcomes[].status`. Optimistic concurrency uses `baseRevision`; a mismatch
   returns `stale_base` plus the latest entity.
4. **Apply outcome.** The orchestrator stamps the new revision on `applied`,
   reverts + toasts + flashes on rejection, and adopts `latestEntity` on
   conflict/stale (then flashes).
5. **Pull.** `POST /sync/cursor` returns rows + tombstones since each class's
   cursor position, plus the authoritative `accessible` id sets. The
   orchestrator merges rows into Dexie — but **never overwrites a field with a
   pending/in-flight outbox op** (`applyServerRow`, `AGENTS.md` S4). Periodic
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

### Outcome → local effect

| Outcome | Local effect |
|---|---|
| `applied` | Stamp `newRevision` onto the row, drop the outbox op. |
| `rejected` | Revert the field/row; persistent toast + input flash. |
| `unauthorized` | Same as rejected; toast names the permission failure. |
| `conflict` | Server returns `latestEntity`; client adopts it, then flashes. |
| `stale_base` | Same as conflict — `baseRevision` was behind the server. |
| `transient` | Backoff with jitter, retry **forever** — capped at 60s while fresh, relaxing to a ~5-min cadence after `MAX_ATTEMPTS` (8). Never gives up. |
| `suspended` | Permanent fail; toast surfaces the reason. |
| network error | Whole batch reverts to `transient_retry`; loop retries. |

## Local sync log and recovery

The `syncLog` Dexie store is a device-local operational journal, separate from
the server-side entity history. Successful outbox outcomes are recorded as
`push`, cursor changes as `pull`, and explicit user rollbacks as `local`. It is
pruned to the newest 1,000 records. Pull entries retain metadata and revision
only, never cursor row payloads, so later access downgrades cannot leave private
sheet data in the journal. Journal writes are best-effort: quota or IndexedDB
failures never block outbox settlement. Pending state is never copied into the
log; the sync view reads the authoritative outbox directly, including attempt
count, backoff timing, and the raw operation outcome or HTTP/network error.

After four consecutive attempts, a pending operation is promoted as a repeated
failure. The user may explicitly revert it under the same cross-tab drain lock:
patches restore `prevValue`, speculative creates are removed, and optimistic
deletes are reinserted. Reverting a speculative character also removes its
dependent child rows and operations. If a newer same-field edit supersedes the
failed attempt, that newer value remains queued and visible while its rollback
anchor is repaired to the last server value. The rollback produces a toast and
field flash. The confirmed “Abandon local changes and re-sync from server”
recovery wipes every local store, including this journal, and bootstraps again
from revision zero.

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
  input pulses. **Toast + flash are both required.**
- **Speculative creates** (S7) use a client-generated UUID and `revision: -1`;
  the same id is posted to `/sync/operations` and the server adopts it. The UI
  renders the new row immediately; the sentinel revision is overwritten on
  `applied`.
- **WebSockets are acceleration, not correctness** (S8). WS frames carry no row
  data — they only invalidate. A client that loses WS forever still converges
  via the periodic cursor pull.
- **Bootstrap before UI** (tenet 7). First login pulls the full snapshot into
  Dexie before first paint; a `bootstrap:<userId>` flag in `syncMeta`
  short-circuits it thereafter.
- **Logout purges** (S9). `orchestrator.purge` wipes every Dexie store on
  logout so account switching never leaks rows into a `useLiveQuery`. New
  tables and new `syncMeta` keys **must** be added to the purge.

## Self-healing & pruning

The orchestrator recovers from partial/interrupted states rather than assuming
a clean world (see `orchestrator.recovery.test.ts`,
`orchestrator.selfheal.test.ts`, `orchestrator.prune.test.ts`):

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
