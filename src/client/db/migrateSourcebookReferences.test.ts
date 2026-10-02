import { describe, expect, test } from 'vitest';
import { migrateSourcebookValue } from './migrateSourcebookReferences.ts';

const campaignA = '0193b3c0-f1f0-7000-8000-00000000b101';
const campaignB = '0193b3c0-f1f0-7000-8000-00000000b102';
const sourceA = '0193b3c0-f1f0-7000-8000-00000000b201';

describe('legacy sourcebook reference migration', () => {
  test('maps nested legacy references to the UUID in the same campaign', () => {
    const migrated = migrateSourcebookValue(
      {
        sourceKey: '  Basic   Set ',
        calculation: {
          reference: { section: 'traits', key: 'Acute Vision', sourceKey: 'basic set' },
        },
      },
      campaignA,
      [{ id: sourceA, campaignId: campaignA, key: 'Basic Set', name: 'Basic Set' }],
    );

    expect(migrated).toEqual({
      sourceId: sourceA,
      calculation: {
        reference: { section: 'traits', key: 'Acute Vision', sourceId: sourceA },
      },
    });
  });

  test('does not resolve another campaign book with the same legacy key', () => {
    expect(() =>
      migrateSourcebookValue({ sourceKey: 'basic-set' }, campaignA, [
        { id: sourceA, campaignId: campaignB, key: 'basic-set', name: 'Basic Set' },
      ]),
    ).toThrow(/Choose a sourcebook/);
  });

  test('keeps an unresolved source explicit as null during local row migration', () => {
    expect(migrateSourcebookValue({ sourceKey: 'missing-book' }, campaignA, [], false)).toEqual({
      sourceId: null,
    });
  });

  test('does not guess a transferred snapshot source from the destination campaign', () => {
    const migrated = migrateSourcebookValue(
      {
        definitionId: 'old-definition',
        sourceKey: null,
        mechanics: { reference: { section: 'traits', key: 'Vision', sourceKey: 'basic-set' } },
      },
      campaignB,
      [{ id: sourceA, campaignId: campaignB, key: 'basic-set', name: 'Basic Set' }],
      false,
      new Map([['old-definition', campaignA]]),
    );
    expect(migrated).toEqual({
      definitionId: 'old-definition',
      sourceId: null,
      mechanics: { reference: { section: 'traits', key: 'Vision', sourceId: null } },
    });
  });

  test('does not infer origin from a missing definition when the destination has the same key', () => {
    const migrated = migrateSourcebookValue(
      {
        definitionId: 'deleted-definition',
        sourceKey: 'basic-set',
      },
      campaignB,
      [{ id: sourceA, campaignId: campaignB, key: 'basic-set', name: 'Basic Set' }],
      false,
    );
    expect(migrated).toEqual({ definitionId: 'deleted-definition', sourceId: null });
  });

  test('resolves each owned race snapshot source from its own campaign after character transfer', () => {
    const migrated = migrateSourcebookValue(
      {
        selection: { raceId: 'race-from-campaign-a', lensIds: ['lens-from-campaign-b'] },
        snapshot: {
          points: 27,
          sources: [
            {
              id: 'race-from-campaign-a',
              campaignId: campaignA,
              sourceKey: 'basic-set',
            },
            {
              id: 'lens-from-campaign-b',
              campaignId: campaignB,
              sourceKey: 'basic-set',
            },
          ],
          forms: [{ key: 'water', points: 27 }],
        },
      },
      campaignB,
      [
        { id: sourceA, campaignId: campaignA, key: 'basic-set', name: 'Basic Set' },
        {
          id: '0193b3c0-f1f0-7000-8000-00000000b202',
          campaignId: campaignB,
          key: 'basic-set',
          name: 'Basic Set',
        },
      ],
      false,
    );

    expect(migrated).toEqual({
      selection: { raceId: 'race-from-campaign-a', lensIds: ['lens-from-campaign-b'] },
      snapshot: {
        points: 27,
        sources: [
          {
            id: 'race-from-campaign-a',
            campaignId: campaignA,
            sourceId: sourceA,
          },
          {
            id: 'lens-from-campaign-b',
            campaignId: campaignB,
            sourceId: '0193b3c0-f1f0-7000-8000-00000000b202',
          },
        ],
        forms: [{ key: 'water', points: 27 }],
      },
    });
  });
});
