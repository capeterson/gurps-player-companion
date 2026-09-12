/**
 * Campaign library YAML codec.  Round-trippable: import → export → diff
 * yields the same bytes (canonical sort + ordered keys).
 *
 * The YAML shape is documented in docs/specs/campaign-content-sharing.md.
 * Schema validation is in shared/schemas/campaignLibrary.ts (Zod).
 */

import { Document, parse, stringify } from 'yaml';
import {
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

/**
 * Current YAML doc version emitted by `emitLibraryYaml`.  v2 added the
 * `effects` arrays to traits/skills (see schemas/effects.ts).  v3 added
 * container/powerstone/magic-item fields on items and `manaLevel` in the
 * campaign block.  v4 added the `languages`, `techniques`, and `styles`
 * library sections. v5 added item `enchantments`; v6 added explicit skill
 * `defaults` and campaign attribute-cap enforcement. v7 adds item-aware weapon
 * effects. The parser still accepts v1-v6 docs (new fields default/absent).
 */
export const LIBRARY_YAML_VERSION = 7 as const;
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
  assertNoDuplicateKeys(result.data);
  return result.data;
}

function assertNoDuplicateKeys(doc: LibraryYamlDoc): void {
  const traitKeys = new Set<string>();
  for (const t of doc.library.traits) {
    const k = `${t.kind}::${t.name.toLowerCase()}`;
    if (traitKeys.has(k)) throw new LibraryYamlError(`duplicate trait (${t.kind}, ${t.name})`);
    traitKeys.add(k);
  }
  const skillKeys = new Set<string>();
  for (const s of doc.library.skills) {
    const k = s.name.toLowerCase();
    if (skillKeys.has(k)) throw new LibraryYamlError(`duplicate skill (${s.name})`);
    skillKeys.add(k);
  }
  const spellKeys = new Set<string>();
  for (const s of doc.library.spells ?? []) {
    const k = s.name.toLowerCase();
    if (spellKeys.has(k)) throw new LibraryYamlError(`duplicate spell (${s.name})`);
    spellKeys.add(k);
  }
  const itemKeys = new Set<string>();
  for (const i of doc.library.items) {
    const k = i.name.toLowerCase();
    if (itemKeys.has(k)) throw new LibraryYamlError(`duplicate item (${i.name})`);
    itemKeys.add(k);
  }
  const languageKeys = new Set<string>();
  for (const l of doc.library.languages ?? []) {
    const k = l.name.toLowerCase();
    if (languageKeys.has(k)) throw new LibraryYamlError(`duplicate language (${l.name})`);
    languageKeys.add(k);
  }
  const techniqueKeys = new Set<string>();
  for (const t of doc.library.techniques ?? []) {
    const k = t.name.toLowerCase();
    if (techniqueKeys.has(k)) throw new LibraryYamlError(`duplicate technique (${t.name})`);
    techniqueKeys.add(k);
  }
  const styleKeys = new Set<string>();
  for (const st of doc.library.styles ?? []) {
    const k = st.name.toLowerCase();
    if (styleKeys.has(k)) throw new LibraryYamlError(`duplicate style (${st.name})`);
    styleKeys.add(k);
  }
}

export interface LibraryYamlExportInput {
  readonly campaign?: LibraryYamlDoc['campaign'];
  readonly traits: readonly LibraryTraitCreate[];
  readonly skills: readonly LibrarySkillCreate[];
  readonly spells: readonly LibrarySpellCreate[];
  readonly items: readonly LibraryItemCreate[];
  readonly languages: readonly LibraryLanguageCreate[];
  readonly techniques: readonly LibraryTechniqueCreate[];
  readonly styles: readonly LibraryStyleCreate[];
}

/** Stable ordering for byte-stable round trip. */
function sortedTraits(traits: readonly LibraryTraitCreate[]): LibraryTraitCreate[] {
  return [...traits].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
      a.name.localeCompare(b.name),
  );
}

function sortedByName<T extends { name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name),
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
  const portableEffects = (effects: LibraryTraitCreate['effects']) =>
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
  const spells = sortedByName(input.spells).map((s) => compact(s));
  const items = sortedByName(input.items).map((i) => compact(i));
  const languages = sortedByName(input.languages).map((l) => compact(l));
  const techniques = sortedByName(input.techniques).map((t) => compact(t));
  const styles = sortedByName(input.styles).map((st) => compact(st));

  const payload: Record<string, unknown> = { version: LIBRARY_YAML_VERSION };
  if (input.campaign) payload.campaign = compactCampaign(input.campaign);
  payload.library = { traits, skills, spells, items, languages, techniques, styles };

  const doc = new Document(payload);
  return stringify(doc, {
    indent: 2,
    lineWidth: 100,
    minContentWidth: 20,
    sortMapEntries: false,
  });
}
