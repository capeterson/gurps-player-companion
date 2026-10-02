import { describe, expect, it } from 'vitest';
import {
  buildLibraryPackage,
  packageEntryBody,
  packageLibraryDraft,
} from './LibraryPackageEditor.tsx';
import type { LocalLibrary } from './useLocalLibrary.ts';

const SOURCE_ID = '0193b3c0-f1f0-7000-8000-000000000001';
const OTHER_SOURCE_ID = '0193b3c0-f1f0-7000-8000-000000000004';
const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-000000000002';
const DEFINITION_ID = '0193b3c0-f1f0-7000-8000-000000000003';
const TIMES = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function library(): LocalLibrary {
  return {
    sources: [
      {
        id: SOURCE_ID,
        campaignId: CAMPAIGN_ID,
        name: 'Basic Set',
        abbreviation: 'B',
        edition: '4e',
        priority: 1,
        revision: 2,
        ...TIMES,
      },
    ],
    traits: [
      {
        id: '0193b3c0-f1f0-7000-8000-000000000010',
        campaignId: CAMPAIGN_ID,
        revision: 1,
        key: 'night-vision',
        sourceId: SOURCE_ID,
        name: 'Night Vision',
        kind: 'advantage',
        basePoints: 2,
        tags: ['senses'],
        ...TIMES,
      },
    ],
    skills: [
      {
        id: '0193b3c0-f1f0-7000-8000-000000000011',
        campaignId: CAMPAIGN_ID,
        revision: 1,
        key: 'bow',
        sourceId: SOURCE_ID,
        name: 'Bow',
        attribute: 'DX',
        difficulty: 'A',
        techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
        tags: ['combat'],
        ...TIMES,
      },
    ],
    items: [
      {
        id: '0193b3c0-f1f0-7000-8000-000000000012',
        campaignId: CAMPAIGN_ID,
        revision: 1,
        key: 'dueling-sword',
        sourceId: SOURCE_ID,
        name: 'Dueling sword',
        enchantments: [
          {
            spellName: 'Fortify',
            definitionId: DEFINITION_ID,
            definitionRevision: 3,
            definitionSource: 'B',
            mechanics: {
              applicability: 'armor',
              effects: [{ target: 'dr', value: 2 }],
              levels: [{ level: 1, effects: [{ target: 'dr', value: 2 }] }],
              stackingPolicy: { kind: 'stack' },
            },
          },
        ],
        ...TIMES,
      },
    ],
    spells: [],
    languages: [],
    techniques: [],
    styles: [],
    enchantments: [],
    activeEffects: [],
    modifiers: [],
    races: [],
  } as unknown as LocalLibrary;
}

describe('LibraryPackageEditor package draft helpers', () => {
  it('keeps excluded required categories from the baseline and omits unselected optional categories', () => {
    const baseline = packageLibraryDraft(library());
    const changed = structuredClone(baseline);
    changed.traits = [];
    changed.skills = [];
    changed.items = [];
    changed.spells = [{ id: 'spell-id', name: 'Draft spell' }];
    const output = buildLibraryPackage({
      draft: changed,
      baseline,
      included: new Set(['sources']),
      selectedSourceIds: null,
    });
    expect(output.library.traits).toHaveLength(1);
    expect(output.library.traits[0]?.name).toBe('Night Vision');
    expect(output.library.skills[0]?.name).toBe('Bow');
    expect(output.library.items[0]?.name).toBe('Dueling sword');
    expect(output.library.spells).toBeUndefined();
  });

  it('allows unchanged out-of-scope rows but rejects edits, additions, and removals there', () => {
    const baseline = packageLibraryDraft(library());
    baseline.sources.push({
      id: OTHER_SOURCE_ID,
      campaignId: CAMPAIGN_ID,
      name: 'Martial Arts',
      abbreviation: 'MA',
      edition: '4e',
      priority: 2,
      revision: 1,
      ...TIMES,
    });
    baseline.traits.push({
      id: '0193b3c0-f1f0-7000-8000-000000000020',
      campaignId: CAMPAIGN_ID,
      revision: 1,
      key: 'combat-reflexes',
      sourceId: OTHER_SOURCE_ID,
      name: 'Combat Reflexes',
      kind: 'advantage',
      basePoints: 15,
      tags: [],
      ...TIMES,
    });
    const included = new Set(['sources', 'traits', 'skills', 'items'] as const);
    const selectedSourceIds = [SOURCE_ID];
    const unchanged = structuredClone(baseline);
    expect(() =>
      buildLibraryPackage({ draft: unchanged, baseline, included, selectedSourceIds }),
    ).not.toThrow();

    const edited = structuredClone(baseline);
    const editedTrait = edited.traits[1];
    if (!editedTrait) throw new Error('Expected Combat Reflexes in the fixture');
    edited.traits[1] = { ...editedTrait, name: 'Renamed Combat Reflexes' };
    expect(() =>
      buildLibraryPackage({ draft: edited, baseline, included, selectedSourceIds }),
    ).toThrow(/changes outside the selected sourcebooks/);

    const added = structuredClone(baseline);
    added.traits.push({
      id: '0193b3c0-f1f0-7000-8000-000000000021',
      sourceId: OTHER_SOURCE_ID,
      name: 'New out-of-scope trait',
      kind: 'advantage',
      basePoints: 1,
      tags: [],
    });
    expect(() =>
      buildLibraryPackage({ draft: added, baseline, included, selectedSourceIds }),
    ).toThrow(/changes outside the selected sourcebooks/);

    const removed = structuredClone(baseline);
    removed.traits = removed.traits.filter((row) => row.id !== baseline.traits[1]?.id);
    expect(() =>
      buildLibraryPackage({ draft: removed, baseline, included, selectedSourceIds }),
    ).toThrow(/changes outside the selected sourcebooks/);

    const excluded = new Set(['sources', 'skills', 'items'] as const);
    const excludedEdit = structuredClone(baseline);
    const excludedTrait = excludedEdit.traits[1];
    if (!excludedTrait) throw new Error('Expected Combat Reflexes in the fixture');
    excludedEdit.traits[1] = { ...excludedTrait, name: 'Hidden edit' };
    const output = buildLibraryPackage({
      draft: excludedEdit,
      baseline,
      included: excluded,
      selectedSourceIds,
    });
    expect(output.library.traits.map((row) => row.name)).toEqual(['Night Vision']);
  });

  it('maps selected source IDs to portable keys and retains campaign nulls and linked item mechanics', () => {
    const baseline = packageLibraryDraft(library());
    const output = buildLibraryPackage({
      draft: baseline,
      baseline,
      included: new Set(['sources', 'traits', 'skills', 'items']),
      campaign: { description: null, pointTarget: null },
      selectedSourceIds: [SOURCE_ID],
    });
    expect(output.scope?.kind).toBe('sources');
    expect(output.scope?.sourceKeys).toEqual(['b: basic set (4e)']);
    expect(output.campaign).toBeUndefined();
    expect(output.library.sources?.[0]).toMatchObject({ key: 'b: basic set (4e)' });
    expect(output.library.skills[0]).toMatchObject({
      sourceKey: 'b: basic set (4e)',
      techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
    });
    expect(output.library.items[0]?.enchantments?.[0]).toMatchObject({
      definitionId: DEFINITION_ID,
      definitionRevision: 3,
      mechanics: { effects: [{ target: 'dr', value: 2 }] },
    });

    const allSources = buildLibraryPackage({
      draft: baseline,
      baseline,
      included: new Set(['sources', 'traits', 'skills', 'items']),
      campaign: { description: null, pointTarget: null },
      selectedSourceIds: null,
    });
    expect(allSources.campaign).toMatchObject({ description: null, pointTarget: null });
  });

  it('strips transport fields from an entry while retaining the complete editable shape', () => {
    const entry = library().skills[0] as unknown as Record<string, unknown>;
    const body = packageEntryBody('skills', entry);
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('campaignId');
    expect(body).not.toHaveProperty('revision');
    expect(body).toMatchObject({
      key: 'bow',
      sourceId: SOURCE_ID,
      techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
      tags: ['combat'],
    });
  });
});
