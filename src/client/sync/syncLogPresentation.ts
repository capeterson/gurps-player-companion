/** Presentation metadata for every protocol class, including reserved classes. */
import type { EntityClass } from '../../shared/schemas/sync.ts';
import type { SyncLogEntry } from '../db/dexie.ts';
import { type SheetAnchorKind, sheetAnchorHash } from '../features/characters/sheetAnchors.ts';

type EntityPresentation = {
  label: string;
  destination: 'character' | 'characterChild' | 'campaign' | 'library' | 'campaignLog';
  anchor?: SheetAnchorKind;
  section?: string;
};

// A new entity class must make an explicit choice here. Languages, techniques
// and combat have no supported sheet anchor: their link opens the parent sheet.
const ENTITIES: Record<EntityClass, EntityPresentation> = {
  character: { label: 'Character', destination: 'character' },
  character_trait: { label: 'Trait', destination: 'characterChild', anchor: 'trait' },
  character_skill: { label: 'Skill', destination: 'characterChild', anchor: 'skill' },
  character_spell: { label: 'Spell', destination: 'characterChild', anchor: 'spell' },
  character_language: { label: 'Language', destination: 'characterChild' },
  character_technique: { label: 'Technique', destination: 'characterChild' },
  character_inventory: {
    label: 'Inventory item',
    destination: 'characterChild',
    anchor: 'inventory',
  },
  character_combat: { label: 'Combat state', destination: 'characterChild' },
  campaign: { label: 'Campaign', destination: 'campaign' },
  campaign_membership: { label: 'Campaign member', destination: 'campaign' },
  campaign_library_trait: { label: 'Library trait', destination: 'library', section: 'traits' },
  campaign_library_skill: { label: 'Library skill', destination: 'library', section: 'skills' },
  campaign_library_spell: { label: 'Library spell', destination: 'library', section: 'spells' },
  campaign_library_item: { label: 'Library item', destination: 'library', section: 'items' },
  campaign_library_language: {
    label: 'Library language',
    destination: 'library',
    section: 'languages',
  },
  campaign_library_technique: {
    label: 'Library technique',
    destination: 'library',
    section: 'techniques',
  },
  campaign_library_style: { label: 'Library style', destination: 'library', section: 'styles' },
  campaign_library_enchantment: {
    label: 'Library enchantment',
    destination: 'library',
    section: 'enchantments',
  },
  campaign_library_race: { label: 'Library race', destination: 'library', section: 'races' },
  campaign_library_active_effect: {
    label: 'Library active effect',
    destination: 'library',
    section: 'activeEffects',
  },
  campaign_library_source: { label: 'Library source', destination: 'library', section: 'sources' },
  campaign_library_modifier: {
    label: 'Library modifier',
    destination: 'library',
    section: 'modifiers',
  },
  adventure_log: { label: 'Adventure log entry', destination: 'campaignLog' },
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  currentHp: 'Current HP',
  currentFp: 'Current FP',
  hpMod: 'HP modifier',
  fpMod: 'FP modifier',
  willMod: 'Will modifier',
  perMod: 'Perception modifier',
  speedQuarterMod: 'Basic Speed modifier',
  moveMod: 'Basic Move modifier',
  tempEffects: 'Temporary effects',
  activeEffects: 'Active effects',
  activeEffectDefinitions: 'Active effect definitions',
  activeConditionGroups: 'Active conditions',
  portraitAssetId: 'Portrait',
  coverAssetId: 'Campaign cover',
  campaignId: 'Campaign',
  parentId: 'Container',
  libraryId: 'Library entry',
  sourceId: 'Source',
  ownerId: 'Owner',
  houseRules: 'House rules',
  skillPrerequisitePolicy: 'Skill prerequisite policy',
  enforceAttributeCaps: 'Attribute caps',
  shareCharacterSheets: 'Sheet sharing',
  allowGmCharacterEditing: 'GM character editing',
  pointTarget: 'Point target',
  disadvantageCap: 'Disadvantage cap',
  quirkCap: 'Quirk cap',
  manaLevel: 'Mana level',
  techLevel: 'Tech level',
  tl: 'TL',
  dr: 'DR',
  db: 'DB',
  protectNaturalDr: 'Protect natural DR',
  armorLayeringLimits: 'Armor layering limits',
  armorLayeringDxPenalty: 'Layered armor DX penalty',
  limitationCapPercent: 'Limitation cap',
  experimentalTurnTracker: 'Experimental turn tracker',
  experimentalActiveEffects: 'Experimental active effects',
  libraryMechanics: 'Library mechanics',
  calculation: 'Calculation rules',
  weaponData: 'Weapon data',
  weaponModes: 'Weapon modes',
  armor: 'Armor',
  powerstoneData: 'Powerstone',
  magicItemData: 'Magic item',
  dismissedWarnings: 'Dismissed warnings',
  appearance: 'Description',
};

export function syncEntityLabel(entityClass: EntityClass): string {
  return ENTITIES[entityClass].label;
}

/** Shared label treatment for scalar patches and changed object keys. */
export function syncFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Store this compact name outside compressed bodies so a closed list stays cheap. */
export function syncEntityName(row?: Record<string, unknown>): string | undefined {
  const value = text(row?.name) ?? text(row?.title) ?? text(row?.key);
  return value && value.length > 200 ? `${value.slice(0, 199)}…` : value;
}

/** Caller must apply the current access gate before displaying private names. */
export function syncLogTitle(entry: SyncLogEntry, row?: Record<string, unknown>): string {
  if (!entry.entityClass) return entry.reason ?? 'Sync cycle failed';
  const name = entry.entityName ?? syncEntityName(row);
  // Older rows only have the gesture label; keep that established wording.
  if (!name && entry.humanName) return entry.humanName;
  const subject = name
    ? `${syncEntityLabel(entry.entityClass)}: ${name}`
    : syncEntityLabel(entry.entityClass);
  if (entry.fieldPath) {
    const field = syncFieldLabel(entry.fieldPath);
    return subject.toLowerCase() === field.toLowerCase() ? subject : `${subject} · ${field}`;
  }
  if (entry.result !== 'synced') {
    if (entry.source) return `${subject} · ${entry.source}`;
    const intent =
      entry.command === 'create' ? 'Add' : entry.command === 'delete' ? 'Delete' : 'Update';
    return `${subject} · ${intent}`;
  }
  if (entry.source && entry.humanName) return `${subject} · ${entry.humanName}`;
  if (entry.command === 'create') return `${subject} · Added`;
  if (entry.command === 'delete') return `${subject} · Deleted`;
  if (entry.command === 'patch') return `${subject} · Updated`;
  return subject;
}

/**
 * row is the current local entity, not a diagnostic snapshot. Its existence
 * prevents old/deleted entries from offering dead links. Caller gates access.
 * Library links use the page's actual ?section=&open= contract, not fake hashes.
 */
export function syncLogEntityLink(
  entry: Pick<SyncLogEntry, 'entityClass' | 'entityId' | 'parentId' | 'command'>,
  row?: Record<string, unknown>,
): string | undefined {
  if (!row || !entry.entityClass || !entry.entityId) return undefined;
  const config = ENTITIES[entry.entityClass];
  const id = encodeURIComponent(entry.entityId);
  switch (config.destination) {
    case 'character':
      return `/characters/${id}`;
    case 'characterChild': {
      const parent =
        text(row.characterId) ??
        entry.parentId ??
        (entry.entityClass === 'character_combat' ? entry.entityId : undefined);
      if (!parent) return undefined;
      return `/characters/${encodeURIComponent(parent)}${config.anchor ? sheetAnchorHash(config.anchor, id) : ''}`;
    }
    case 'campaign': {
      const campaign =
        entry.entityClass === 'campaign'
          ? entry.entityId
          : (text(row.campaignId) ?? entry.parentId);
      return campaign ? `/campaigns/${encodeURIComponent(campaign)}` : undefined;
    }
    case 'library': {
      const campaign = text(row.campaignId) ?? entry.parentId;
      if (!campaign || !config.section) return undefined;
      return `/campaigns/${encodeURIComponent(campaign)}/library?section=${config.section}&open=${id}`;
    }
    case 'campaignLog': {
      const campaign = text(row.campaignId) ?? entry.parentId;
      return campaign ? `/campaigns/${encodeURIComponent(campaign)}/log` : undefined;
    }
  }
}

const BOOKKEEPING = new Set([
  'id',
  'characterId',
  'revision',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
]);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function truncated(value: unknown): boolean {
  return object(value) && value.truncated === true;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}

/** Arrays are atomic values; never turn their indices into misleading field changes. */
function focusObject(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  patch: boolean,
  topLevel: boolean,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  const keys = patch
    ? Object.keys(after)
    : [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    if ((topLevel && BOOKKEEPING.has(key)) || equal(before[key], after[key])) continue;
    const previousValue = before[key];
    const newValue = after[key];
    if (
      object(previousValue) &&
      object(newValue) &&
      !truncated(previousValue) &&
      !truncated(newValue)
    ) {
      // An updated JSON field replaces that field: absent nested keys ARE removals.
      const focused = focusObject(previousValue, newValue, false, false);
      old[key] = focused.before;
      next[key] = focused.after;
    } else {
      if (Object.hasOwn(before, key)) old[key] = previousValue;
      if (Object.hasOwn(after, key)) next[key] = newValue;
    }
  }
  return { before: old, after: next };
}

export interface FocusedSyncLogValues {
  previousValue: unknown;
  newValue: unknown;
  changedFields: string[];
}

/** Focus whole-entry patches without changing raw Request/Response diagnostics. */
export type SyncValuesSubject = Pick<
  SyncLogEntry,
  'previousValue' | 'newValue' | 'command' | 'fieldPath'
> &
  Partial<Pick<SyncLogEntry, 'direction' | 'entityClass' | 'result'>>;

export function focusedSyncLogValues(entry: SyncValuesSubject): FocusedSyncLogValues {
  const { previousValue, newValue } = entry;
  if (entry.fieldPath) {
    const changedFields = equal(previousValue, newValue) ? [] : [entry.fieldPath];
    if (
      object(previousValue) &&
      object(newValue) &&
      !truncated(previousValue) &&
      !truncated(newValue)
    ) {
      const focused = focusObject(previousValue, newValue, false, false);
      return { previousValue: focused.before, newValue: focused.after, changedFields };
    }
    return { previousValue, newValue, changedFields };
  }
  if (truncated(previousValue) || truncated(newValue))
    return { previousValue, newValue, changedFields: [] };
  if (object(previousValue) && object(newValue)) {
    // Rollback snapshots travel from the submitted body back to a full row.
    // Only keys in that submitted body belong to this rejected change.
    const rollback =
      entry.command === 'patch' && (entry.result === 'rolled_back' || entry.result === 'reverted');
    const focused = rollback
      ? focusObject(newValue, previousValue, true, true)
      : focusObject(
          previousValue,
          newValue,
          (entry.direction === 'push' || entry.direction === undefined) &&
            entry.command === 'patch',
          true,
        );
    return {
      previousValue: rollback ? focused.after : focused.before,
      newValue: rollback ? focused.before : focused.after,
      changedFields: [...new Set([...Object.keys(focused.before), ...Object.keys(focused.after)])],
    };
  }
  // Creates, deletes and legacy snapshots retain their data with bookkeeping removed.
  const clean = (value: unknown) =>
    object(value)
      ? Object.fromEntries(Object.entries(value).filter(([key]) => !BOOKKEEPING.has(key)))
      : value;
  const before = clean(previousValue);
  const after = clean(newValue);
  return {
    previousValue: before,
    newValue: after,
    changedFields: [
      ...new Set([
        ...(object(before) ? Object.keys(before) : []),
        ...(object(after) ? Object.keys(after) : []),
      ]),
    ],
  };
}
