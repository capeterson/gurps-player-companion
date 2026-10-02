import { canonicalLibraryKey } from '../domain/libraryIdentity.ts';
import { validateRaceDefinition } from '../domain/race.ts';
import { upgradeLegacyWeaponRanges } from '../domain/rangedRange.ts';
import type { Portable } from './sourceReferences.ts';
/**
 * Campaign library YAML codec.  Round-trippable: import → export → diff
 * yields the same bytes (canonical sort + ordered keys).
 *
 * The YAML shape is documented in docs/specs/campaign-content-sharing.md.
 * Schema validation is in shared/schemas/campaignLibrary.ts (Zod).
 */

import { Document, parse, stringify } from 'yaml';
import {
  type LibraryEnchantmentCreate,
  type LibraryItemCreate,
  type LibraryLanguageCreate,
  type LibrarySkillCreate,
  type LibrarySpellCreate,
  type LibraryStyleCreate,
  type LibraryTechniqueCreate,
  type LibraryTraitCreate,
  type LibraryYamlDoc,
  libraryYamlDoc,
} from '../schemas/campaignLibrary.ts';

const libraryEntryKey = (entry: {
  name: string;
  key?: string | undefined;
  kind?: string | undefined;
  sourceKey?: string | null | undefined;
}) =>
  JSON.stringify([
    entry.kind ?? '',
    canonicalLibraryKey(entry.key || entry.name),
    canonicalLibraryKey(entry.sourceKey ?? ''),
  ]);

/**
 * Current YAML doc version emitted by `emitLibraryYaml`.  v2 added the
 * `effects` arrays to traits/skills (see schemas/effects.ts).  v3 added
 * container/powerstone/magic-item fields on items and `manaLevel` in the
 * campaign block.  v4 added the `languages`, `techniques`, and `styles`
 * library sections. v5 added item `enchantments`; v6 added explicit skill
 * `defaults` and campaign attribute-cap enforcement. v7 adds item-aware weapon
 * effects. v8 adds library skill specialization policies and structured skill
 * default matchers. v9 adds structured prerequisites, TL policies, conditional
 * family defaults, and campaign enforcement policy. v10 adds reusable
 * enchantment definitions and mechanical item snapshots. The parser still accepts
 * v1-v12 docs (new fields absent). v11 adds active effects; v12 adds source
 * editions, standalone modifiers, calculation rules, and normalized weapon modes.
 * v13 replaces weapon Range text with structured fixed/ST-multiplier values.
 * v14 adds GM restrictions and sourcebook-scoped packages.
 * v15 adds racial templates with complete variants/forms and additive lenses.
 */
export const LIBRARY_YAML_VERSION = 15 as const;
export const LIBRARY_YAML_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export class LibraryYamlError extends Error {
  constructor(
    message: string,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = 'LibraryYamlError';
  }
}

export function parseLibraryYaml(rawText: string): LibraryYamlDoc {
  if (rawText.length > LIBRARY_YAML_MAX_BYTES) {
    throw new LibraryYamlError(`payload exceeds ${LIBRARY_YAML_MAX_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = parse(rawText);
  } catch (e) {
    throw new LibraryYamlError('YAML is not parseable', e);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const doc = parsed as Record<string, unknown>;
    if (typeof doc.version === 'number' && doc.version <= 12) {
      const library = doc.library;
      if (library && typeof library === 'object' && !Array.isArray(library)) {
        const items = (library as Record<string, unknown>).items;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const entry = item as Record<string, unknown>;
              entry.weaponData = upgradeLegacyWeaponRanges(entry.weaponData);
            }
          }
        }
      }
    }
  }
  const result = libraryYamlDoc.safeParse(parsed);
  if (!result.success) {
    throw new LibraryYamlError(
      `YAML failed schema validation: ${result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
      result.error,
    );
  }
  if (result.data.scope && result.data.version < 14)
    throw new LibraryYamlError('Sourcebook scope requires YAML version 14');
  assertNoDuplicateKeys(result.data);
  return result.data;
}

/** Select sourcebook contents by first-class source keys, never legacy citation text. */
export function sourceScopedLibrary(
  library: LibraryYamlDoc['library'],
  requestedKeys: readonly string[],
): LibraryYamlDoc['library'] {
  const keys = new Set(requestedKeys.map(canonicalLibraryKey));
  if (keys.size === 0 || keys.size !== requestedKeys.length)
    throw new LibraryYamlError('Select one or more distinct sourcebooks');
  const sources = (library.sources ?? []).filter((row) => keys.has(canonicalLibraryKey(row.key)));
  if (sources.length !== keys.size)
    throw new LibraryYamlError('A selected sourcebook is missing its source record');
  const selected = (row: { sourceKey?: string | null | undefined }) =>
    !!row.sourceKey && keys.has(canonicalLibraryKey(row.sourceKey));
  return {
    sources,
    modifiers: library.modifiers?.filter(selected),
    traits: library.traits.filter(selected),
    skills: library.skills.filter(selected),
    spells: library.spells?.filter(selected),
    items: library.items.filter(selected),
    languages: library.languages?.filter(selected),
    techniques: library.techniques?.filter(selected),
    styles: library.styles?.filter(selected),
    enchantments: library.enchantments?.filter(selected),
    activeEffects: library.activeEffects?.filter(selected),
    races: library.races?.filter(selected),
  };
}

function assertNoDuplicateKeys(doc: LibraryYamlDoc): void {
  for (const [section, rows] of [
    ['sources', doc.library.sources],
    ['modifiers', doc.library.modifiers],
  ] as const) {
    const keys = rows?.map((row) =>
      section === 'sources' ? row.key?.toLowerCase() : libraryEntryKey(row),
    );
    if (keys && new Set(keys).size !== keys.length)
      throw new LibraryYamlError(`duplicate ${section} key`);
  }
  const traitKeys = new Set<string>();
  for (const t of doc.library.traits) {
    const k = libraryEntryKey(t);
    if (traitKeys.has(k)) throw new LibraryYamlError(`duplicate trait (${t.kind}, ${t.name})`);
    traitKeys.add(k);
  }
  const skillKeys = new Set<string>();
  for (const s of doc.library.skills) {
    const k = libraryEntryKey(s);
    if (skillKeys.has(k)) throw new LibraryYamlError(`duplicate skill (${s.name})`);
    skillKeys.add(k);
  }
  const spellKeys = new Set<string>();
  for (const s of doc.library.spells ?? []) {
    const k = libraryEntryKey(s);
    if (spellKeys.has(k)) throw new LibraryYamlError(`duplicate spell (${s.name})`);
    spellKeys.add(k);
  }
  const itemKeys = new Set<string>();
  for (const i of doc.library.items) {
    const k = libraryEntryKey(i);
    if (itemKeys.has(k)) throw new LibraryYamlError(`duplicate item (${i.name})`);
    itemKeys.add(k);
  }
  const languageKeys = new Set<string>();
  for (const l of doc.library.languages ?? []) {
    const k = libraryEntryKey(l);
    if (languageKeys.has(k)) throw new LibraryYamlError(`duplicate language (${l.name})`);
    languageKeys.add(k);
  }
  const techniqueKeys = new Set<string>();
  for (const t of doc.library.techniques ?? []) {
    const k = libraryEntryKey(t);
    if (techniqueKeys.has(k)) throw new LibraryYamlError(`duplicate technique (${t.name})`);
    techniqueKeys.add(k);
  }
  const styleKeys = new Set<string>();
  for (const st of doc.library.styles ?? []) {
    const k = libraryEntryKey(st);
    if (styleKeys.has(k)) throw new LibraryYamlError(`duplicate style (${st.name})`);
    styleKeys.add(k);
  }
  const raceKeys = new Set<string>();
  for (const entry of doc.library.races ?? []) {
    validateRaceDefinition(entry);
    const key = libraryEntryKey(entry);
    if (raceKeys.has(key)) throw new LibraryYamlError(`duplicate race (${entry.name})`);
    raceKeys.add(key);
  }
  const effectKeys = new Set<string>();
  for (const entry of doc.library.activeEffects ?? []) {
    const key = libraryEntryKey(entry);
    if (effectKeys.has(key)) throw new LibraryYamlError(`duplicate active effect (${entry.name})`);
    effectKeys.add(key);
  }
  const enchantmentKeys = new Set<string>();
  for (const enchantment of doc.library.enchantments ?? []) {
    const key = libraryEntryKey(enchantment);
    if (enchantmentKeys.has(key))
      throw new LibraryYamlError(`duplicate enchantment (${enchantment.name})`);
    enchantmentKeys.add(key);
  }
}

export type LibraryYamlExportInput = {
  readonly scope?: LibraryYamlDoc['scope'];
  readonly campaign?: LibraryYamlDoc['campaign'];
} & { [K in keyof LibraryYamlDoc['library']]?: LibraryYamlDoc['library'][K] } & Pick<
    LibraryYamlDoc['library'],
    'traits' | 'skills' | 'items'
  >;

/** Stable ordering for byte-stable round trip. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function sortedTraits(
  traits: readonly Portable<LibraryTraitCreate>[],
): Portable<LibraryTraitCreate>[] {
  return [...traits].sort(
    (a, b) =>
      compareText(a.kind, b.kind) ||
      compareText(a.name.toLowerCase(), b.name.toLowerCase()) ||
      compareText(a.name, b.name) ||
      compareText(libraryEntryKey(a), libraryEntryKey(b)),
  );
}

function sortedByName<T extends { name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      compareText(a.name.toLowerCase(), b.name.toLowerCase()) ||
      compareText(a.name, b.name) ||
      compareText(libraryEntryKey(a), libraryEntryKey(b)),
  );
}

/** Drop undefined / null fields so resource-entry YAML stays minimal. */
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Campaign nulls are portable instructions to clear a target setting. */
function compactCampaign(input: NonNullable<LibraryYamlDoc['campaign']>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export function emitLibraryYaml(input: LibraryYamlExportInput): string {
  const portableEffects = (effects: Portable<LibraryTraitCreate>['effects']) =>
    effects.map((effect) => {
      if (effect.weaponSelector?.kind !== 'library_item') return effect;
      const { libraryItemId: _libraryItemId, ...weaponSelector } = effect.weaponSelector;
      return { ...effect, weaponSelector };
    });
  const traits = sortedTraits(input.traits).map((t) =>
    compact({ ...t, effects: portableEffects(t.effects) }),
  );
  // An empty defaults list means explicitly no default, unlike missing/unknown.
  const skills = sortedByName(input.skills).map((s) => ({
    ...compact({ ...s, effects: portableEffects(s.effects) }),
    ...(s.defaults != null ? { defaults: s.defaults } : {}),
  }));
  const spells = sortedByName(input.spells ?? []).map((s) => compact(s));
  const items = sortedByName(input.items).map((item) =>
    compact({
      ...item,
      enchantments: item.enchantments.map(({ definitionId: _definitionId, ...entry }) =>
        compact(entry),
      ),
    }),
  );
  const languages = sortedByName(input.languages ?? []).map((l) => compact(l));
  const techniques = sortedByName(input.techniques ?? []).map((t) => compact(t));
  const styles = sortedByName(input.styles ?? []).map((st) => compact(st));
  const enchantments = sortedByName(input.enchantments ?? []).map((entry) => compact(entry));

  const payload: Record<string, unknown> = { version: LIBRARY_YAML_VERSION };
  if (input.scope) payload.scope = input.scope;
  if (input.campaign) payload.campaign = compactCampaign(input.campaign);
  payload.library = {
    sources: sortedByName(input.sources ?? []).map((entry) => compact(entry)),
    modifiers: sortedByName(input.modifiers ?? []).map((entry) => compact(entry)),
    traits,
    skills,
    spells,
    items,
    languages,
    techniques,
    styles,
    enchantments,
    activeEffects: sortedByName(input.activeEffects ?? []).map((entry) => compact(entry)),
    races: sortedByName(input.races ?? []).map((entry) => compact(entry)),
  };

  const doc = new Document(payload);
  return stringify(doc, {
    indent: 2,
    lineWidth: 100,
    minContentWidth: 20,
    sortMapEntries: false,
  });
}
