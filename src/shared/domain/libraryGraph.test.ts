import { describe, expect, test } from 'bun:test';
import { fixedCalculation } from './calculation.ts';
import {
  type LibraryGraph,
  type LibraryGraphEntry,
  mergeLibraryGraph,
  validateLibraryGraph,
} from './libraryGraph.ts';

const CORE_ID = '0193b3c0-f1f0-7000-8000-00000000a101';
const ALT_ID = '0193b3c0-f1f0-7000-8000-00000000a102';
const trait = (sourceId: string, points: number, preferredEdition = false) => ({
  name: 'Acute Vision',
  key: 'acute vision',
  sourceId,
  kind: 'advantage',
  preferredEdition,
  basePoints: points,
  calculation: fixedCalculation({ points: { value: points, unit: 'points' } }),
});
const emptyGraph = (overrides: Partial<LibraryGraph> = {}): LibraryGraph => ({
  sources: [],
  traits: [],
  items: [],
  modifiers: [],
  skills: [],
  spells: [],
  languages: [],
  techniques: [],
  styles: [],
  enchantments: [],
  activeEffects: [],
  ...overrides,
});
const source = (
  id: string,
  name: string,
  abbreviation: string,
  priority: number,
  edition = '4th edition',
): LibraryGraphEntry => ({ id, name, abbreviation, priority, edition });

describe('campaign library graph', () => {
  test('validates source references and enforces one preferred edition for each canonical entry', () => {
    const valid = emptyGraph({
      sources: [source(CORE_ID, 'Core Rules', 'CR', 1), source(ALT_ID, 'Alternate Rules', 'AR', 2)],
      traits: [trait(CORE_ID, 4), trait(ALT_ID, 6, true)],
    });
    expect(() => validateLibraryGraph(valid)).not.toThrow();
    expect(() => validateLibraryGraph({ ...valid, sources: [] })).toThrow(/Unknown source/);
    expect(() =>
      validateLibraryGraph({
        ...valid,
        traits: [trait(CORE_ID, 4, true), trait(ALT_ID, 6, true)],
      }),
    ).toThrow(/Multiple preferred editions/);
  });

  test('rejects duplicate source UUIDs but permits matching publication metadata', () => {
    expect(() =>
      validateLibraryGraph(
        emptyGraph({
          sources: [
            source(CORE_ID, 'Core Rules', 'CR', 1),
            source(CORE_ID, 'Core Rules revised', 'CR', 2),
          ],
        }),
      ),
    ).toThrow(/Duplicate sources edition/);
    expect(() =>
      validateLibraryGraph(
        emptyGraph({
          sources: [
            source(CORE_ID, 'Core Rules', 'CR', 1),
            source('0193b3c0-f1f0-7000-8000-00000000a103', ' core rules ', ' cr ', 2),
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateLibraryGraph(
        emptyGraph({
          sources: [source(CORE_ID, 'Core Rules', 'CR', 1)],
          traits: [trait(CORE_ID, 4), { ...trait(CORE_ID, 6), name: '  Acute   Vision ' }],
        }),
      ),
    ).toThrow(/Duplicate traits edition/);
  });

  test('validates modifier applicability references against campaign trait identities', () => {
    const applicability = {
      universal: false,
      traitKinds: [],
      traitTags: [],
      traits: [
        { section: 'traits' as const, key: 'acute vision', sourceId: CORE_ID, kind: 'advantage' },
      ],
    };
    const modifier: LibraryGraphEntry = {
      name: 'Reliable',
      key: 'reliable',
      category: 'enhancement',
      costType: 'percent',
      calculation: fixedCalculation({ modifier: { value: 10, unit: 'percentage' } }),
      applicability,
    };
    const graph = emptyGraph({
      sources: [source(CORE_ID, 'Core Rules', 'CR', 1)],
      traits: [trait(CORE_ID, 4)],
      modifiers: [modifier],
    });
    expect(() => validateLibraryGraph(graph)).not.toThrow();
    expect(() => validateLibraryGraph({ ...graph, traits: [] })).toThrow(
      /Unresolved applicability reference/,
    );
    const invalidModifier: LibraryGraphEntry = {
      ...modifier,
      applicability: {
        ...applicability,
        traits: [{ section: 'items', key: 'acute vision', sourceId: CORE_ID }],
      },
    };
    expect(() => validateLibraryGraph({ ...graph, modifiers: [invalidModifier] })).toThrow(
      /Unresolved applicability reference/,
    );
  });

  test('keeps UUID links through sourcebook renames and replaces only supplied sections', () => {
    const originalCore = trait(CORE_ID, 4);
    const originalAlternate = trait(ALT_ID, 6, true);
    const originalSkill = { name: 'Stealth', attribute: 'DX', difficulty: 'A' };
    const current = emptyGraph({
      sources: [source(CORE_ID, 'Core Rules', 'CR', 1), source(ALT_ID, 'Alternate Rules', 'AR', 2)],
      traits: [originalCore, originalAlternate],
      skills: [originalSkill],
    });
    const revisedCore = {
      ...originalCore,
      basePoints: 9,
      calculation: fixedCalculation({ points: { value: 9, unit: 'points' } }),
    };
    const incoming: LibraryGraph = {
      sources: [source(CORE_ID, 'Core Rules Revised', 'CR', 0)],
      traits: [revisedCore],
    };
    const merged = mergeLibraryGraph(current, incoming, 'merge');
    expect(merged.sources).toHaveLength(2);
    expect(merged.sources?.find((row) => row.id === CORE_ID)).toMatchObject({
      id: CORE_ID,
      name: 'Core Rules Revised',
    });
    expect(merged.traits?.find((row) => row.sourceId === CORE_ID)).toBeDefined();
    expect(merged.traits).toHaveLength(2);
    expect(merged.traits).toContainEqual(revisedCore);
    expect(merged.traits).toContainEqual(originalAlternate);
    expect(merged.skills).toEqual([originalSkill]);
    const replaced = mergeLibraryGraph(current, incoming, 'replace');
    expect(replaced.sources).toEqual(incoming.sources);
    expect(replaced.traits).toEqual([revisedCore]);
    // Omitted sections have no merge/prune instruction, even in replace mode.
    expect(replaced.skills).toEqual([originalSkill]);
  });
});
