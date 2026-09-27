import { describe, expect, test } from 'bun:test';
import { fixedCalculation } from './calculation.ts';
import {
  type LibraryGraph,
  type LibraryGraphEntry,
  mergeLibraryGraph,
  validateLibraryGraph,
} from './libraryGraph.ts';

const trait = (sourceKey: string, points: number, preferredEdition = false) => ({
  name: 'Acute Vision',
  key: 'acute vision',
  sourceKey,
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
  name: string,
  key: string,
  abbreviation: string,
  priority: number,
): LibraryGraphEntry => ({ name, key, abbreviation, priority });

describe('campaign library graph', () => {
  test('validates source references and enforces one preferred edition for each canonical entry', () => {
    const valid = emptyGraph({
      sources: [
        source('Core Rules', 'core', 'CR', 1),
        source('Alternate Rules', 'alternate', 'AR', 2),
      ],
      traits: [trait('CORE', 4), trait('alternate', 6, true)],
    });
    expect(() => validateLibraryGraph(valid)).not.toThrow();
    expect(() => validateLibraryGraph({ ...valid, sources: [] })).toThrow(/Unknown source/);
    expect(() =>
      validateLibraryGraph({
        ...valid,
        traits: [trait('core', 4, true), trait('alternate', 6, true)],
      }),
    ).toThrow(/Multiple preferred editions/);
  });

  test('rejects duplicate source and edition identities after canonical normalization', () => {
    expect(() =>
      validateLibraryGraph(
        emptyGraph({
          sources: [
            source('Core Rules', 'core', 'CR', 1),
            source('Core Rules 2', ' CORE ', 'CR2', 2),
          ],
        }),
      ),
    ).toThrow(/Duplicate sources edition/);
    expect(() =>
      validateLibraryGraph(
        emptyGraph({
          sources: [source('Core Rules', 'core', 'CR', 1)],
          traits: [trait('core', 4), { ...trait('CORE', 6), name: '  Acute   Vision ' }],
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
        { section: 'traits' as const, key: 'acute vision', sourceKey: 'core', kind: 'advantage' },
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
      sources: [source('Core Rules', 'core', 'CR', 1)],
      traits: [trait('core', 4)],
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
        traits: [{ section: 'items', key: 'acute vision', sourceKey: 'core' }],
      },
    };
    expect(() => validateLibraryGraph({ ...graph, modifiers: [invalidModifier] })).toThrow(
      /Unresolved applicability reference/,
    );
  });

  test('merges incoming edition keys in place, while replace prunes only supplied sections', () => {
    const originalCore = trait('core', 4);
    const originalAlternate = trait('alternate', 6, true);
    const originalSkill = { name: 'Stealth', attribute: 'DX', difficulty: 'A' };
    const current = emptyGraph({
      sources: [
        source('Core Rules', 'core', 'CR', 1),
        source('Alternate Rules', 'alternate', 'AR', 2),
      ],
      traits: [originalCore, originalAlternate],
      skills: [originalSkill],
    });
    const revisedCore = {
      ...originalCore,
      basePoints: 9,
      calculation: fixedCalculation({ points: { value: 9, unit: 'points' } }),
    };
    const incoming: LibraryGraph = {
      sources: [source('Core Rules Revised', 'CORE', 'CR', 0)],
      traits: [revisedCore],
    };
    const merged = mergeLibraryGraph(current, incoming, 'merge');
    expect(merged.sources).toHaveLength(2);
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
