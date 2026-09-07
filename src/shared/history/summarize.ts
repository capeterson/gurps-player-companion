/**
 * Pure, DB/UI-free formatter for entity_history rows.
 * Used server-side (to compute the `summary` field before serving) and
 * client-side (for detail expansion).  No imports from server or client code.
 */

import { formatSigned } from '../format/number.ts';
import { MANUAL_TEMP_EFFECT_ID } from '../schemas/character.ts';
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

/**
 * Labels for the ten scalar `temp*` columns that `characters` used to
 * carry before migration 0017 replaced them with the single
 * `temp_effects` jsonb list. Those columns are gone from the live
 * schema, but `entity_history` rows written before the migration are
 * append-only jsonb snapshots that still have `temp_dx` (etc.) keys
 * forever -- this map keeps old history entries readable rather than
 * falling through to the generic "N attributes updated" message. Do
 * NOT delete this even though no current write path produces these
 * keys.
 */
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

/** Axis key -> display label for `temp_effects` mods (see TempStatAxis). */
const TEMP_EFFECT_AXIS_LABELS: Record<string, string> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hp: 'HP',
  will: 'Will',
  per: 'Per',
  fp: 'FP',
  speedQuarter: 'Speed',
  move: 'Move',
};

const CAMPAIGN_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  pointTarget: 'Point target',
  disadvantageCap: 'Disadvantage cap',
  quirkCap: 'Quirk cap',
  shareCharacterSheets: 'Sheet sharing',
  allowGmCharacterEditing: 'GM character editing',
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

/**
 * History triggers snapshot rows with `to_jsonb(NEW)`, so the keys are raw
 * Postgres column names (`temp_dx`, `current_hp`, `parent_id`,
 * `share_character_sheets`). The per-entity summarizers branch on the
 * camelCase field names the rest of the app uses, so we normalize snake_case
 * → camelCase once before summarizing. Already-camelCase keys (e.g. from the
 * unit tests or any future JS-side caller) pass through unchanged.
 */
function camelizeKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelizeRow(
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camelizeKey(k)] = v;
  return out;
}

/** Diff two jsonb snapshots, ignoring noise columns. */
const IGNORE_KEYS = new Set(['revision', 'updatedAt', 'createdAt', 'updated_at', 'created_at']);

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

/**
 * Fallback for a change that doesn't have a dedicated player-friendly
 * phrasing: names which field(s) changed (using their humanized label,
 * never the raw camelCase key) instead of a bare "X updated".
 */
function describeFieldChanges(subject: string, changes: FieldChange[]): string {
  if (changes.length === 0) return `${subject} updated`;
  return `${subject}: ${changes.map((c) => c.label).join(', ')} updated`;
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------- temp_effects diffing ----------

interface TempEffectRow {
  id: string;
  name: string;
  mods: Record<string, unknown>;
}

function asTempEffectList(v: unknown): TempEffectRow[] {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const row = (e ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? 'effect'),
      mods: (row.mods ?? {}) as Record<string, unknown>,
    };
  });
}

function formatEffectMods(mods: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [axis, label] of Object.entries(TEMP_EFFECT_AXIS_LABELS)) {
    const v = mods[axis];
    if (typeof v === 'number' && v !== 0) parts.push(`${label} ${formatSigned(v)}`);
  }
  return parts.join(', ');
}

/**
 * Summarize a `temp_effects` array diff. Cases, in priority order:
 *   1. new list empty, old list non-empty -> "Temporary effects cleared"
 *   2. the only id that changed is the 'manual' sentinel -> a delta-style
 *      "Temporary adjustment: ..." line (mirrors the old scalar
 *      temp-boost summary the ✦ popovers used to produce)
 *   3. exactly one NAMED (non-manual) effect added, nothing else changed
 *      -> "Temporary effect added: Name (mods)"
 *   4. exactly one named effect removed, nothing else changed ->
 *      "Temporary effect removed: Name"
 *   5. anything else (multiple adds/removes, a named effect's mods
 *      edited in place, etc.) -> generic "Temporary effects updated"
 */
function summarizeTempEffects(oldValue: unknown, newValue: unknown): string {
  const oldList = asTempEffectList(oldValue);
  const newList = asTempEffectList(newValue);
  if (newList.length === 0 && oldList.length > 0) return 'Temporary effects cleared';

  const oldById = new Map(oldList.map((e) => [e.id, e]));
  const newById = new Map(newList.map((e) => [e.id, e]));
  const allIds = new Set([...oldById.keys(), ...newById.keys()]);
  const changedIds = [...allIds].filter(
    (id) => JSON.stringify(oldById.get(id)) !== JSON.stringify(newById.get(id)),
  );

  if (changedIds.length === 1) {
    const id = changedIds[0] as string;
    const before = oldById.get(id);
    const after = newById.get(id);
    if (id === MANUAL_TEMP_EFFECT_ID) {
      const modsText = after ? formatEffectMods(after.mods) : '';
      return modsText ? `Temporary adjustment: ${modsText}` : 'Temporary adjustment cleared';
    }
    if (after && !before) {
      const modsText = formatEffectMods(after.mods);
      return modsText
        ? `Temporary effect added: ${after.name} (${modsText})`
        : `Temporary effect added: ${after.name}`;
    }
    if (before && !after) {
      return `Temporary effect removed: ${before.name}`;
    }
  }
  return 'Temporary effects updated';
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
  const c = changes[0] as FieldChange;
  if (c.field === 'tempEffects') return summarizeTempEffects(c.oldValue, c.newValue);
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
  return describeFieldChanges('Character', changes);
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
  const c = changes[0] as FieldChange;
  if (c.field === 'points') return `${name} points ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'level') return `${name} level ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'name') return `Renamed trait to ${c.newValue}`;
  return describeFieldChanges(String(name), changes);
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
  const c = changes[0] as FieldChange;
  if (c.field === 'points') return `${fullName} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'name') return `Renamed skill to ${c.newValue}`;
  return describeFieldChanges(String(fullName), changes);
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
  const c = changes[0] as FieldChange;
  if (c.field === 'points') return `${name} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'college') return `${name} college updated`;
  return describeFieldChanges(String(name), changes);
}

function summarizeCharacterLanguage(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'language';
  if (op === 'insert') return `Added language ${name}`;
  if (op === 'delete') return `Removed language ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Language ${name} updated`;
  const c = changes[0] as FieldChange;
  if (c.field === 'spokenFluency') return `${name} spoken ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'writtenFluency') return `${name} written ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'points') return `${name} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'name') return `Renamed language to ${c.newValue}`;
  return `${name} updated`;
}

function summarizeCharacterTechnique(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'technique';
  const defaultSkill = next?.defaultSkillName ?? old?.defaultSkillName;
  if (op === 'insert') {
    return defaultSkill ? `Added technique ${name} (${defaultSkill})` : `Added technique ${name}`;
  }
  if (op === 'delete') return `Removed technique ${old?.name ?? ''}`;
  const changes = diffRows(old, next);
  if (changes.length === 0) return `Technique ${name} updated`;
  const c = changes[0] as FieldChange;
  if (c.field === 'points') return `${name} ${c.oldValue} → ${c.newValue} pts`;
  if (c.field === 'difficulty') return `${name} difficulty ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'defaultSkillName') return `${name} now defaults from ${c.newValue}`;
  if (c.field === 'maxLevel') return `${name} max level ${displayValue(c.newValue)}`;
  if (c.field === 'name') return `Renamed technique to ${c.newValue}`;
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
  const c = changes[0] as FieldChange;
  if (c.field === 'parentId') {
    if (c.newValue === null) return `Moved ${name} out of container`;
    return `Moved ${name} into container`;
  }
  if (c.field === 'quantity') return `${name} qty ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'worn') return c.newValue ? `Wearing ${name}` : `Removed ${name} (worn)`;
  if (c.field === 'equipped') return c.newValue ? `Equipped ${name}` : `Unequipped ${name}`;
  if (c.field === 'isArmor') return `${name}: ${c.newValue ? 'set' : 'unset'} as armor`;
  if (c.field === 'isContainer') return `${name}: ${c.newValue ? 'set' : 'unset'} as container`;
  if (c.field === 'name') return `Renamed ${old?.name ?? name} to ${c.newValue}`;
  return describeFieldChanges(String(name), changes);
}

function summarizeCombat(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  if (op === 'insert') return 'Combat tracker initialized';
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Combat state updated';
  const c = changes[0] as FieldChange;
  if (c.field === 'currentHp') return `HP ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'currentFp') return `FP ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'posture') return `Posture ${c.oldValue} → ${c.newValue}`;
  if (c.field === 'maneuver') return `Maneuver: ${c.newValue ?? 'none'}`;
  if (c.field === 'conditions') return 'Conditions updated';
  return describeFieldChanges('Combat state', changes);
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
    } else if (c.field === 'allowGmCharacterEditing') {
      msgs.push(`GM character editing ${c.newValue ? 'enabled' : 'disabled'}`);
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
    return 'Member removed';
  }
  const changes = diffRows(old, next);
  if (changes.length === 0) return 'Membership updated';
  const c = changes[0] as FieldChange;
  if (c.field === 'role') {
    const from = MEMBERSHIP_ROLE_LABELS[String(c.oldValue)] ?? c.oldValue;
    const to = MEMBERSHIP_ROLE_LABELS[String(c.newValue)] ?? c.newValue;
    return `Member role ${from} → ${to}`;
  }
  return describeFieldChanges('Membership', changes);
}

function summarizeLibraryTrait(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'trait';
  if (op === 'insert') return `Added library trait ${name}`;
  if (op === 'delete') return `Removed library trait ${old?.name ?? ''}`;
  return describeFieldChanges(`Library trait ${name}`, diffRows(old, next));
}

function summarizeLibrarySkill(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'skill';
  if (op === 'insert') return `Added library skill ${name}`;
  if (op === 'delete') return `Removed library skill ${old?.name ?? ''}`;
  return describeFieldChanges(`Library skill ${name}`, diffRows(old, next));
}

function summarizeLibrarySpell(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'spell';
  if (op === 'insert') return `Added library spell ${name}`;
  if (op === 'delete') return `Removed library spell ${old?.name ?? ''}`;
  return describeFieldChanges(`Library spell ${name}`, diffRows(old, next));
}

function summarizeLibraryLanguage(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'language';
  if (op === 'insert') return `Added library language ${name}`;
  if (op === 'delete') return `Removed library language ${old?.name ?? ''}`;
  return `Library language ${name} updated`;
}

function summarizeLibraryTechnique(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'technique';
  if (op === 'insert') return `Added library technique ${name}`;
  if (op === 'delete') return `Removed library technique ${old?.name ?? ''}`;
  return `Library technique ${name} updated`;
}

function summarizeLibraryStyle(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'style';
  if (op === 'insert') return `Added style ${name}`;
  if (op === 'delete') return `Removed style ${old?.name ?? ''}`;
  return `Style ${name} updated`;
}

function summarizeLibraryItem(
  op: string,
  old: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): string {
  const name = next?.name ?? old?.name ?? 'item';
  if (op === 'insert') return `Added library item ${name}`;
  if (op === 'delete') return `Removed library item ${old?.name ?? ''}`;
  return describeFieldChanges(`Library item ${name}`, diffRows(old, next));
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
  if (changes.length === 0) return 'Log entry updated';
  const c = changes[0] as FieldChange;
  if (c.field === 'title') return `Log renamed to: ${c.newValue}`;
  if (c.field === 'body') return `Log ${title} content updated`;
  if (c.field === 'visibility') return `Log ${title} visibility → ${c.newValue}`;
  return describeFieldChanges(`Log ${title}`, changes);
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
  const { entityClass, op } = event;
  // Normalize snake_case column names from the jsonb snapshot to the
  // camelCase the summarizers expect (see camelizeRow).
  const oldRow = camelizeRow(event.oldRow);
  const newRow = camelizeRow(event.newRow);
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
    case 'character_language':
      summary = summarizeCharacterLanguage(op, oldRow, newRow);
      break;
    case 'character_technique':
      summary = summarizeCharacterTechnique(op, oldRow, newRow);
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
    case 'campaign_library_spell':
      summary = summarizeLibrarySpell(op, oldRow, newRow);
      break;
    case 'campaign_library_item':
      summary = summarizeLibraryItem(op, oldRow, newRow);
      break;
    case 'campaign_library_language':
      summary = summarizeLibraryLanguage(op, oldRow, newRow);
      break;
    case 'campaign_library_technique':
      summary = summarizeLibraryTechnique(op, oldRow, newRow);
      break;
    case 'campaign_library_style':
      summary = summarizeLibraryStyle(op, oldRow, newRow);
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
