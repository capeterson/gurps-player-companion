import { describe, expect, it } from 'bun:test';
import { type LibraryRaceOut, libraryRaceOut } from '../schemas/race.ts';
import {
  raceName,
  racialProfile,
  resolveRaceSelection,
  switchOwnedRaceForm,
  validateRaceDefinition,
} from './race.ts';

const campaignId = '00000000-0000-4000-8000-000000000001';
const createdAt = '2026-10-01T12:00:00.000Z';

function race(overrides: Record<string, unknown> = {}): LibraryRaceOut {
  return libraryRaceOut.parse({
    id: '00000000-0000-4000-8000-000000000010',
    campaignId,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    key: 'stonekin',
    sourceKey: 'fantasy',
    sourceLocator: 'p. 42',
    status: 'complete',
    role: 'definition',
    name: 'Stonekin',
    description: 'A synthetic test race.',
    source: 'Synthetic rules',
    kind: 'race',
    points: 25,
    attributeModifiers: { st: 2 },
    traits: [{ key: 'stone-skin', name: 'Stone Skin', points: 5 }],
    skills: [{ key: 'masonry', name: 'Masonry', points: 2 }],
    features: ['Can sense worked stone.'],
    effects: [],
    variants: [],
    forms: [],
    compatibleRaceKeys: [],
    removesTraits: [],
    removesSkills: [],
    tags: [],
    ...overrides,
  });
}

function lens(overrides: Record<string, unknown> = {}): LibraryRaceOut {
  return libraryRaceOut.parse({
    ...race({
      id: '00000000-0000-4000-8000-000000000020',
      key: 'deep-delver',
      name: 'Deep Delver',
      kind: 'lens',
      points: 10,
      attributeModifiers: { st: -1, dx: 1 },
      traits: [{ key: 'night-vision', name: 'Night Vision', points: 3 }],
      skills: [{ key: 'mining', name: 'Mining', points: 1 }],
      features: ['Sees in dim tunnels.'],
      compatibleRaceKeys: ['stonekin'],
      sourceLocator: 'p. 43',
    }),
    ...overrides,
  });
}

const selection = (overrides: Record<string, unknown> = {}) => ({
  raceId: race().id,
  variantKey: null,
  lensIds: [],
  formKey: null,
  ...overrides,
});

describe('race composition', () => {
  it('adds lens adjustments and components to the base race', () => {
    const base = race();
    const addedLens = lens();
    const result = resolveRaceSelection(selection({ lensIds: [addedLens.id] }), [base, addedLens]);

    expect(result.snapshot?.points).toBe(35);
    expect(result.snapshot?.attributeModifiers).toEqual({ st: 1, dx: 1 });
    expect(result.snapshot?.traits.map((entry) => entry.key)).toEqual([
      'stone-skin',
      'night-vision',
    ]);
    expect(result.snapshot?.skills.map((entry) => entry.key)).toEqual(['masonry', 'mining']);
    expect(result.snapshot?.features).toEqual(['Can sense worked stone.', 'Sees in dim tunnels.']);
    expect(result.snapshot?.sources.map((source) => [source.key, source.sourceKey])).toEqual([
      ['stonekin', 'fantasy'],
      ['deep-delver', 'fantasy'],
    ]);
  });

  it('uses a complete variant as a replacement profile, not an addition', () => {
    const base = race({
      variants: [
        {
          key: 'granite',
          name: 'Granite',
          points: 40,
          attributeModifiers: { ht: 1 },
          traits: [{ key: 'granite-body', name: 'Granite Body', points: 8 }],
          skills: [],
          features: ['Made of granite.'],
          effects: [],
        },
      ],
    });
    const result = resolveRaceSelection(selection({ variantKey: 'granite' }), [base]);

    expect(result.snapshot?.points).toBe(40);
    expect(result.snapshot?.attributeModifiers).toEqual({ ht: 1 });
    expect(result.snapshot?.traits.map((entry) => entry.key)).toEqual(['granite-body']);
    expect(result.snapshot?.skills).toEqual([]);
    expect(result.snapshot?.features).toEqual(['Made of granite.']);
    expect(result.snapshot?.name).toBe('Granite');
  });

  it('replaces a lens component only when its key is explicitly removed', () => {
    const base = race();
    const replacement = lens({
      removesTraits: ['STONE-SKIN'],
      traits: [
        { key: 'stone-skin', name: 'Stone Skin (Deep)', points: 8 },
        { key: 'night-vision', name: 'Night Vision', points: 3 },
      ],
    });
    const result = resolveRaceSelection(selection({ lensIds: [replacement.id] }), [
      base,
      replacement,
    ]);

    expect(result.snapshot?.traits).toEqual([
      {
        key: 'stone-skin',
        name: 'Stone Skin (Deep)',
        kind: 'advantage',
        points: 8,
        level: null,
        description: null,
        effects: [],
      },
      {
        key: 'night-vision',
        name: 'Night Vision',
        kind: 'advantage',
        points: 3,
        level: null,
        description: null,
        effects: [],
      },
    ]);
    expect(() =>
      resolveRaceSelection(selection({ lensIds: [lens().id] }), [
        base,
        lens({ traits: [base.traits[0]] }),
      ]),
    ).toThrow('must explicitly replace duplicate components');
  });

  it('treats Human as a zero-point profile', () => {
    const result = resolveRaceSelection(
      { raceId: null, variantKey: null, lensIds: [], formKey: null },
      [],
    );

    expect(result.snapshot).toBeNull();
    expect(raceName(result)).toBe('Human');
    expect(racialProfile(result)).toEqual({
      points: 0,
      attributeModifiers: {},
      traits: [],
      skills: [],
      features: [],
      effects: [],
    });
  });

  it('uses an alternate form profile without charging its point value again', () => {
    const base = race({
      forms: [
        {
          key: 'stone-gargoyle',
          name: 'Stone Gargoyle',
          description: null,
          points: 50,
          attributeModifiers: { st: 5 },
          traits: [],
          skills: [],
          features: ['Can fly.'],
          effects: [],
        },
      ],
    });
    const result = resolveRaceSelection(selection({ formKey: 'stone-gargoyle' }), [base]);

    expect(result.snapshot?.points).toBe(25);
    expect(result.snapshot?.attributeModifiers).toEqual({ st: 5 });
    expect(result.snapshot?.features).toEqual(['Can fly.']);
    expect(result.snapshot?.forms).toHaveLength(1);
    expect(result.selection.formKey).toBe('stone-gargoyle');
    expect(result.snapshot?.name).toContain('Stone Gargoyle');
  });

  it('rejects repeated lens IDs, incompatible races, and duplicate component keys', () => {
    const base = race();
    const addedLens = lens();
    expect(() =>
      resolveRaceSelection(selection({ lensIds: [addedLens.id, addedLens.id] }), [base, addedLens]),
    ).toThrow('may be selected only once');
    expect(() =>
      resolveRaceSelection(selection({ lensIds: [addedLens.id] }), [
        race({ key: 'elf' }),
        addedLens,
      ]),
    ).toThrow('incompatible');
    expect(() =>
      validateRaceDefinition(
        race({
          traits: [
            { key: ' STONE-SKIN ', name: 'One', points: 1 },
            { key: 'stone-skin', name: 'Two', points: 1 },
          ],
        }),
      ),
    ).toThrow('trait keys must be unique');
  });

  it('rejects a selected definition that is missing or not adoptable', () => {
    expect(() => resolveRaceSelection(selection(), [])).toThrow('unavailable');
    expect(() => resolveRaceSelection(selection(), [race({ status: 'reference_only' })])).toThrow(
      'unavailable',
    );
  });
});

describe('owned form snapshots', () => {
  it('switches both ways without consulting changed or deleted definitions, retaining lens mechanics and cost', () => {
    const base = race({
      forms: [
        {
          key: 'winged',
          name: 'Winged',
          points: 50,
          attributeModifiers: { st: 5 },
          traits: [],
          skills: [],
          features: ['Wings'],
          effects: [],
        },
      ],
    });
    const addedLens = lens();
    const owned = resolveRaceSelection(selection({ lensIds: [addedLens.id] }), [base, addedLens]);
    const transformed = switchOwnedRaceForm(owned, 'winged');
    expect(transformed.snapshot?.points).toBe(35);
    expect(transformed.snapshot?.attributeModifiers).toEqual({ st: 4, dx: 1 });
    expect(transformed.snapshot?.traits.map((t) => t.key)).toEqual(['night-vision']);
    expect(transformed.snapshot?.name).toBe('Winged · Deep Delver');
    expect(transformed.snapshot?.sources).toEqual(owned.snapshot?.sources);
    expect(switchOwnedRaceForm(transformed, null)).toEqual(owned);
    expect(() => switchOwnedRaceForm(owned, 'missing')).toThrow('unavailable');
  });
});

it('retains complete composite names when long race and lens names are combined', () => {
  const base = race({ name: 'A'.repeat(150) });
  const addedLens = lens({ name: 'B'.repeat(150) });
  const result = resolveRaceSelection(selection({ lensIds: [addedLens.id] }), [base, addedLens]);
  expect(result.snapshot?.name).toBe(`${base.name} · ${addedLens.name}`);
});
