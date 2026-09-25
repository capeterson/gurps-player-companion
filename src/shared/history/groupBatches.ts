/** Group adjacent history events and name multi-event batches for the feed. */
import type { HistoryEventOut } from '../schemas/history.ts';

// ---------- batch grouping ----------

export interface HistoryGroup {
  batchId: string | null;
  events: HistoryEventOut[];
  /** Pre-computed one-liner for the group header. */
  groupSummary: string;
  /** True when the group has more than one event and should show a fold arrow. */
  foldable: boolean;
}

/**
 * Consecutive events on the same item (same actor, same field-patch op)
 * spaced no more than this far apart get folded together even without an
 * explicit shared batchId (e.g. someone fiddling with a single item's
 * fields one field-patch at a time).
 */
const SAME_ITEM_BURST_WINDOW_MS = 60_000;

/**
 * `batchId` is non-null for effectively every sync-backed write:
 * `dispatchOperation` fills it in from `op.clientOpId` when the client
 * didn't set one (see syncDispatch.ts), so a single un-batched field
 * patch still gets its own distinct, non-null batch_id in entity_history.
 * That id has no sibling — no other event shares it — so it isn't a real
 * "one user gesture" batch the way a multi-item bulk move's shared
 * batchId is. Treat a batchId as a real batch only when >1 event in the
 * loaded page actually carries it; a singleton batchId is eligible for
 * the same-item time-window burst heuristic below, same as a null one.
 */
function countBatchMembers(events: HistoryEventOut[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (!ev.batchId) continue;
    counts.set(ev.batchId, (counts.get(ev.batchId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fold consecutive events into one group when either:
 *   - they share a batchId that >1 loaded event carries (one explicit
 *     user gesture, e.g. a bulk inventory move), or
 *   - they're both plain field-patch updates to the same entity by the
 *     same actor, neither carries a "real" (multi-member) batchId, and
 *     they land within SAME_ITEM_BURST_WINDOW_MS of each other (a burst
 *     of quick edits to one item that weren't explicitly batched).
 * Standalone events become single-item groups without a fold arrow.
 */
export function groupIntoBatches(events: HistoryEventOut[]): HistoryGroup[] {
  const batchMembers = countBatchMembers(events);
  const isRealBatch = (ev: HistoryEventOut) =>
    Boolean(ev.batchId) &&
    Math.max(ev.batchSize ?? 0, batchMembers.get(ev.batchId as string) ?? 0) > 1;

  const groups: HistoryGroup[] = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    const lastEvent = last?.events[last.events.length - 1];
    const sharesBatch = isRealBatch(ev) && last?.batchId === ev.batchId;
    const sameItemBurst =
      !sharesBatch &&
      !isRealBatch(ev) &&
      last &&
      lastEvent &&
      !isRealBatch(lastEvent) &&
      ev.op === 'update' &&
      lastEvent.op === 'update' &&
      lastEvent.entityId === ev.entityId &&
      lastEvent.entityClass === ev.entityClass &&
      lastEvent.actorUserId != null &&
      ev.actorUserId != null &&
      lastEvent.actorUserId === ev.actorUserId &&
      Math.abs(new Date(ev.createdAt).getTime() - new Date(lastEvent.createdAt).getTime()) <=
        SAME_ITEM_BURST_WINDOW_MS;
    if (sharesBatch || sameItemBurst) {
      last.events.push(ev);
    } else {
      groups.push({
        batchId: ev.batchId,
        events: [ev],
        groupSummary: ev.summary,
        foldable: false,
      });
    }
  }
  // Finalize: set foldable flag and synthesize header for multi-event groups.
  for (const g of groups) {
    if (g.events.length > 1) {
      g.foldable = true;
      g.groupSummary = makeBatchSummary(g.events);
    }
  }
  return groups;
}

function makeBatchSummary(events: HistoryEventOut[]): string {
  const n = events.length;
  const first = events[0];
  if (!first) return `${n} changes`;
  // A same-item burst (see SAME_ITEM_BURST_WINDOW_MS) is several quick
  // edits to one thing, not one gesture touching several things — phrase
  // it accordingly rather than reusing the "N items" bulk-gesture wording.
  const sameItem = events.every((e) => e.entityId === first.entityId);
  // If all events share the same entity class and op, describe uniformly.
  const firstClass = first.entityClass;
  const firstOp = first.op;
  const uniform = events.every((e) => e.entityClass === firstClass && e.op === firstOp);
  if (!uniform) return `${n} changes`;
  if (sameItem) {
    switch (firstClass) {
      case 'character_inventory':
        return `${n} updates to this item`;
      case 'character_skill':
        return `${n} updates to this skill`;
      case 'character_spell':
        return `${n} updates to this spell`;
      case 'character_trait':
        return `${n} updates to this trait`;
      case 'character':
        return `${n} attribute changes`;
      default:
        return `${n} updates`;
    }
  }
  switch (firstClass) {
    case 'character_inventory':
      if (firstOp === 'update') return `Moved ${n} items`;
      if (firstOp === 'delete') return `Removed ${n} items`;
      return `${n} inventory changes`;
    case 'character':
      if (firstOp === 'update') return `${n} attribute changes`;
      return `${n} character changes`;
    case 'character_skill':
      return `${n} skill changes`;
    case 'character_spell':
      return `${n} spell changes`;
    case 'character_trait':
      return `${n} trait changes`;
    case 'character_language':
      return `${n} language changes`;
    case 'character_technique':
      return `${n} technique changes`;
    default:
      return `${n} changes`;
  }
}
