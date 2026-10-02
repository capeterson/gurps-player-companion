import { describe, expect, test } from 'bun:test';
import {
  exportSourceReferences,
  importSourceReferences,
  sourceExportKeys,
  sourceImportIdentity,
} from './sourceReferences.ts';

const campaignSourceId = '0193b3c0-f1f0-7000-8000-00000000d001';
const importedSourceId = '0193b3c0-f1f0-7000-8000-00000000d002';
const book = {
  name: 'GURPS Martial Arts',
  abbreviation: 'MA',
  edition: '4th edition',
};

describe('portable sourcebook references', () => {
  test('matches import aliases by normalized publication metadata', () => {
    expect(sourceImportIdentity(book)).toBe(
      sourceImportIdentity({ ...book, name: ' GURPS   Martial Arts ', abbreviation: ' ma ' }),
    );
    expect(sourceImportIdentity(book)).not.toBe(
      sourceImportIdentity({ ...book, edition: '3rd edition' }),
    );
  });

  test('uses a readable, derived YAML alias without storing it as book identity', () => {
    expect(sourceExportKeys([{ ...book, id: campaignSourceId }]).get(campaignSourceId)).toBe(
      'ma: gurps martial arts (4th edition)',
    );
  });

  test('translates nested YAML aliases to the target campaign UUID and back', () => {
    const incoming = {
      sources: [{ ...book, key: 'MA: GURPS Martial Arts (4th edition)' }],
      traits: [
        {
          name: 'Weapon Master',
          sourceKey: 'MA: GURPS Martial Arts (4th edition)',
          calculation: {
            nodes: [
              {
                op: 'call',
                reference: {
                  section: 'traits',
                  key: 'Combat Reflexes',
                  sourceKey: 'ma: gurps martial arts (4th edition)',
                },
              },
            ],
          },
        },
      ],
    };
    const live = importSourceReferences(incoming, [{ ...book, id: importedSourceId }]) as {
      sources: Array<{ id: string; key?: string }>;
      traits: Array<{
        sourceId: string;
        calculation: { nodes: Array<{ reference: { sourceId: string } }> };
      }>;
    };
    expect(live.sources).toEqual([{ ...book, id: importedSourceId }]);
    expect(live.traits[0]).toMatchObject({
      sourceId: importedSourceId,
      calculation: { nodes: [{ reference: { sourceId: importedSourceId } }] },
    });
    expect(live.sources[0]).not.toHaveProperty('key');

    expect(
      exportSourceReferences(
        {
          traits: [
            {
              sourceId: importedSourceId,
              calculation: { reference: { sourceId: importedSourceId } },
            },
          ],
        },
        [{ ...book, id: importedSourceId }],
      ),
    ).toEqual({
      traits: [
        {
          sourceKey: 'ma: gurps martial arts (4th edition)',
          calculation: { reference: { sourceKey: 'ma: gurps martial arts (4th edition)' } },
        },
      ],
    });
    expect(campaignSourceId).not.toBe(importedSourceId);
  });
});
