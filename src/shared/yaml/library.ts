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
  type LibrarySkillCreate,
  type LibrarySpellCreate,
  type LibraryTraitCreate,
  type LibraryYamlDoc,
  libraryYamlDoc,
} from '../schemas/campaignLibrary.ts';

/**
 * Current YAML doc version emitted by `emitLibraryYaml`.  v2 added the
 * `effects` arrays to traits/skills (see schemas/effects.ts).  v3 added
 * container/powerstone/magic-item fields on items and `manaLevel` in the
 * campaign block.  The parser still accepts v1/v2 docs (new fields
 * default/absent).
 */
export const LIBRARY_YAML_VERSION = 3 as const;
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
}

export interface LibraryYamlExportInput {
  readonly campaign?: LibraryYamlDoc['campaign'];
  readonly traits: readonly LibraryTraitCreate[];
  readonly skills: readonly LibrarySkillCreate[];
  readonly spells: readonly LibrarySpellCreate[];
  readonly items: readonly LibraryItemCreate[];
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

/** Drop undefined / null fields so the YAML output is minimal. */
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function emitLibraryYaml(input: LibraryYamlExportInput): string {
  const traits = sortedTraits(input.traits).map((t) => compact(t));
  const skills = sortedByName(input.skills).map((s) => compact(s));
  const spells = sortedByName(input.spells).map((s) => compact(s));
  const items = sortedByName(input.items).map((i) => compact(i));

  const payload: Record<string, unknown> = { version: LIBRARY_YAML_VERSION };
  if (input.campaign) payload.campaign = compact(input.campaign);
  payload.library = { traits, skills, spells, items };

  const doc = new Document(payload);
  return stringify(doc, {
    indent: 2,
    lineWidth: 100,
    minContentWidth: 20,
    sortMapEntries: false,
  });
}
