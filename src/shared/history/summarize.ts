/**
 * Pure, DB/UI-free formatter for entity_history rows.
 * Used server-side (to compute the `summary` field before serving) and
 * client-side (for detail expansion).  No imports from server or client code.
 */

import type { HistoryEventOut } from '../schemas/history.ts';

// ---------- field-label maps ----------

const ATTR_LABELS: Record<string, string> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hpMod: 'HP mod',
  willMod: 'Will mod',
  perMod: 'Per mod',
  fpMod: 'FP mod',
  speedQuarterMod: 'Speed mod',
  moveMod: 'Move mod',
};

const TEMP_ATTR_LABELS: Record<string, string> = {
  tempSt: 'Temp ST',
  tempDx: 'Temp DX',
  tempIq: 'Temp IQ',
  tempHt: 'Temp HT',
  tempHpMod: 'Temp HP mod',
  tempWillMod: 'Temp Will mod',
  tempPerMod: 'Temp Per mod',
  tempFpMod: 'Temp FP mod',
  tempSpeedQuarterMod: 'Temp Speed mod',
  tempMoveMod: 'Temp Move mod',
};

const CAMPAIGN_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  pointTarget: 'Point target',
  disadvantageCap: 'Disadvantage cap',
  quirkCap: 'Quirk cap',
  shareCharacterSheets: 'Sheet sharing',
  ownerId: 'Owner',
};

const MEMBERSHIP_ROLE_LABELS: Record<string, string> = {
  owner: 'owner',
  manager: 'manager',
  member: 'member',
};

// ---------- helpers ----------

export interface FieldChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

/** Diff two jsonb snapshots, ignoring noise columns. */
const IGNORE_KEYS = new Set([
  'revision',
  'updatedAt',
  'createdAt',
  'updated_at',
  'created_at',
]);

export function diffRows(
  oldRow: Record<string, unknown> | null | undefined,
  newRow: Record<string, unknown> | null | undefined,
  ignoreKeys = IGNORE_KEYS,
): FieldChange[] {
  if (!oldRow || !newRow) return [];
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
  for (const k of allKeys) {
    if (ignoreKeys.has(k)) continue;
    const ov = oldRow[k];
    const nv = newRow[k];
    if (JSON.stringify(ov) !== JSON.stringify(nv)) {
      changes.push({ field: k, label: humanizeFieldKey(k), oldValue: ov, newValue: nv });
    }
  }
  return changes;
}

function humanizeFieldKey(k: string): string {
  // camelCase → Title Case with spaces
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------- per-entity-class summarizers ----------

function summarizeCharacter(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  if (op === 'insert') return `Created character ${next?.name ?? ''}`;
  if (op === 'delete') return `Deleted character ${old?.name ?? ''}`;
  // patch: find first meaningful change
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Character updated';
  const c = changes[0];
  // Temp boost: delta-style label
  if (c.field in TEMP_ATTR_LABELS) {
    const label = TEMP_ATTR_LABELS[c.field];
    const val = Number(c.newValue ?? 0);
    if (val === 0) return `${label} boost cleared`;
    return `${label} ${val > 0 ? '+' : ''}${val}`;
  }
  if (c.field in ATTR_LABELS) {
    return `${ATTR_LABELS[c.field]} ${c.oldValue} → ${c.newValue}`;
  }
  if (c.field === 'name') return `Renamed to ${c.newValue}`;
  if (changes.length === 1) return `${humanizeFieldKey(c.field)} updated`;
  return `${changes.length} attributes updated`;
}

function summarizeCharacterTrait(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'trait';
  if (op === 'insert') return `Added ${old?.kind ?? next?.kind ?? 'trait'} ${name}`;
  if (op === 'delete') return `Removed ${old?.kind ?? 'trait'} ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Trait ${name} updated`;
  const c = changes[0];
  if (c.field === 'points') return `${name} points ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'level') return `${name} level ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'name') return `Renamed trait to ${c.newValue}`;
  return `${name} updated`;
}

function summarizeCharacterSkill(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'skill';
  const attr = next?.attribute ?? old?.attribute ?? '';
  const diff = next?.difficulty ?? old?.difficulty ?? '';
  const spec = next?.specialization ?? old?.specialization;
  const fullName = spec ? `${name} (${spec})` : name;
  if (op === 'insert') return `Added skill ${fullName} (${attr}/${diff})`;
  if (op === 'delete') return `Removed skill ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Skill ${name} updated`;
  const c = changes[0];
  if (c.field === 'points') return `${fullName} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'name') return `Renamed skill to ${c.newValue}`;
  return `${fullName} updated`;
}

function summarizeCharacterSpell(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'spell';
  if (op === 'insert') return `Learned spell ${name}`;
  if (op === 'delete') return `Removed spell ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Spell ${name} updated`;
  const c = changes[0];
  if (c.field === 'points') return `${name} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'college') return `${name} college updated`;
  return `${name} updated`;
}

function summarizeInventory(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'item';
  if (op === 'insert') {
    const qty = Number(next?.quantity ?? 1);
    return qty > 1 ? `Added ${name} ×${qty}` : `Added ${name}`;
  }
  if (op === 'delete') return `Removed ${old?.name ?? 'item'}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `${name} updated`;
  const c = changes[0];
  if (c.field === 'parentId') {
    if (c.newValue === null) return `Moved ${name} out of container`;
    return `Moved ${name} into container`;
  }
  if (c.field === 'quantity') return `${name} qty ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'worn') return c.newValue ? `Wearing ${name}` : `Removed ${name} (worn)`;
  if (c.field === 'equipped')
    return c.newValue ? `Equipped ${name}` : `Unequipped ${name}`;
  if (changes.length === 1) return `${name} ${c.field} updated`;
  return `${name} updated`;
}

function summarizeCombat(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  if (op === 'insert') return 'Combat tracker initialized';
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Combat state updated';
  const c = changes[0];
  if (c.field === 'currentHp') return `HP ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'currentFp') return `FP ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'posture') return `Posture ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'maneuver') return `Maneuver: ${c.newValue ?? 'none'}`;
  if (c.field === 'conditions') return 'Conditions updated';
  return 'Combat state updated';
}

function summarizeCampaign(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  if (op === 'insert') return `Created campaign ${next?.name ?? ''}`;
  if (op === 'delete') return `Deleted campaign ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Campaign updated';
  const msgs: string[] = [];
  for (const c of changes) {
    const label = CAMPAIGN_FIELD_LABELS[c.field] ?? humanizeFieldKey(c.field);
    if (c.field === 'shareCharacterSheets') {
      msgs.push(`Sheet sharing ${c.newValue ? 'enabled' : 'disabled'}`);
    } else {
      msgs.push(`${label} ${displayValue(c.oldValue)} → ${displayValue(c.newValue)}`);
    }
  }
  return msgs.join('; ') || 'Campaign settings updated';
}

function summarizeMembership(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  if (op === 'insert') {
    const role = next?.role ?? 'member';
    return `Member added (${MEMBERSHIP_ROLE_LABELS[String(role)] ?? role})`;
  }
  if (op === 'delete') {
    return `Member removed`;
  }
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Membership updated';
  const c = changes[0];
  if (c.field === 'role') {
    const from = MEMBERSHIP_ROLE_LABELS[String(c.oldValue)] ?? c.oldValue;
    const to = MEMBERSHIP_ROLE_LABELS[String(c.newValue)] ?? c.newValue;
    return `Member role ${from} → ${to}`;
  }
  return 'Membership updated';
}

function summarizeLibraryTrait(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'trait';
  if (op === 'insert') return `Added library trait ${name}`;
  if (op === 'delete') return `Removed library trait ${old?.name ?? ''}`;
  return `Library trait ${name} updated`;
}

function summarizeLibrarySkill(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'skill';
  if (op === 'insert') return `Added library skill ${name}`;
  if (op === 'delete') return `Removed library skill ${old?.name ?? ''}`;
  return `Library skill ${name} updated`;
}

function summarizeLibraryItem(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'item';
  if (op === 'insert') return `Added library item ${name}`;
  if (op === 'delete') return `Removed library item ${old?.name ?? ''}`;
  return `Library item ${name} updated`;
}

function summarizeAdventureLog(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const title = next?.title ?? old?.title ?? 'entry';
  if (op === 'insert') return `Posted session log: ${title}`;
  if (op === 'delete') return `Deleted session log: ${old?.title ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Log entry updated`;
  const c = changes[0];
  if (c.field === 'title') return `Log renamed to: ${c.newValue}`;
  if (c.field === 'body') return `Log ${title} content updated`;
  if (c.field === 'visibility') return `Log ${title} visibility → ${c.newValue}`;
  return `Log ${title} updated`;
}

// ---------- public API ----------

export interface SummarizedEvent {
  summary: string;
  changes: FieldChange[];
}

/** Compute a one-line summary and structured field-level diff from a raw history row. */
export function summarizeEvent(event: {
  entityClass: string;
  op: string;
  oldRow?: Record<string, unknown> | null;
  newRow?: Record<string, unknown> | null;
}): SummarizedEvent {
  const { entityClass, op, oldRow = null, newRow = null } = event;
  const changes = diffRows(oldRow, newRow);
  let summary: string;
  switch (entityClass) {
    case 'character':
      summary = summarizeCharacter(op, oldRow, newRow);
      break;
    case 'character_trait':
      summary = summarizeCharacterTrait(op, oldRow, newRow);
      break;
    case 'character_skill':
      summary = summarizeCharacterSkill(op, oldRow, newRow);
      break;
    case 'character_spell':
      summary = summarizeCharacterSpell(op, oldRow, newRow);
      break;
    case 'character_inventory':
      summary = summarizeInventory(op, oldRow, newRow);
      break;
    case 'character_combat':
      summary = summarizeCombat(op, oldRow, newRow);
      break;
    case 'campaign':
      summary = summarizeCampaign(op, oldRow, newRow);
      break;
    case 'campaign_membership':
      summary = summarizeMembership(op, oldRow, newRow);
      break;
    case 'campaign_library_trait':
      summary = summarizeLibraryTrait(op, oldRow, newRow);
      break;
    case 'campaign_library_skill':
      summary = summarizeLibrarySkill(op, oldRow, newRow);
      break;
    case 'campaign_library_item':
      summary = summarizeLibraryItem(op, oldRow, newRow);
      break;
    case 'adventure_log':
      summary = summarizeAdventureLog(op, oldRow, newRow);
      break;
    default:
      summary = `${entityClass} ${op}`;
  }
  return { summary, changes };
}

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
 * Fold consecutive events that share a non-null batchId into one group.
 * Standalone events (no batchId) become single-item groups without a fold arrow.
 */
export function groupIntoBatches(events: HistoryEventOut[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (ev.batchId && last && last.batchId === ev.batchId) {
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
  // If all events share the same entity class and op, describe uniformly.
  const firstClass = events[0].entityClass;
  const firstOp = events[0].op;
  const uniform = events.every((e) => e.entityClass === firstClass && e.op === firstOp);
  if (!uniform) return `${n} changes`;
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
    default:
      return `${n} changes`;
  }
}
