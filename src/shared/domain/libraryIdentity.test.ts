import { describe, expect, test } from 'bun:test';
import type { LibraryModifierCreate } from '../schemas/libraryMetadata.ts';
import {
  canAdoptLibraryEntry,
  canPlayerSelectLibraryEntry,
  canonicalLibraryKey,
  libraryEntryKey,
  libraryMetadataValues,
  modifierApplies,
  preferredLibraryEditions,
} from './libraryIdentity.ts';

describe('library identity and source selection', () => {
  test('canonicalizes keys and builds identities from kind, entry key, and source', () => {
    expect(canonicalLibraryKey('  Acute   Vision ')).toBe('acute vision');
    const base = { name: 'Acute Vision', key: '  Acute   Vision ', sourceKey: ' Basic Set ' };
    expect(libraryEntryKey(base)).toBe(
      libraryEntryKey({ ...base, key: 'acute vision', sourceKey: 'basic set' }),
    );
    expect(libraryEntryKey({ ...base, kind: 'advantage' })).not.toBe(
      libraryEntryKey({ ...base, kind: 'disadvantage' }),
    );
    expect(libraryEntryKey(base)).not.toBe(libraryEntryKey({ ...base, sourceKey: 'supplement' }));
  });

  test('derives a portable key for legacy persisted rows with an empty key', () => {
    expect(libraryEntryKey({ name: 'Old entry', key: '', sourceKey: null })).toBe(
      libraryEntryKey({ name: 'Old entry', key: 'old entry', sourceKey: null }),
    );
  });

  test('normalizes persisted metadata defaults and adoption eligibility', () => {
    expect(libraryMetadataValues({ name: '  Acute   Vision ' })).toEqual({
      key: 'acute vision',
      sourceKey: null,
      sourceLocator: null,
      status: 'complete',
      role: 'definition',
      preferredEdition: false,
      restricted: false,
      extraction: null,
    });
    expect(canAdoptLibraryEntry({ status: 'complete', role: 'definition' })).toBe(true);
    expect(canAdoptLibraryEntry({ status: 'complete', role: 'template' })).toBe(true);
    expect(canAdoptLibraryEntry({ status: 'complete', restricted: true })).toBe(true);
    expect(canPlayerSelectLibraryEntry({ status: 'complete', restricted: true })).toBe(false);
    expect(canPlayerSelectLibraryEntry({ status: 'complete', restricted: false })).toBe(true);
    expect(canAdoptLibraryEntry({ status: 'needs_review', role: 'definition' })).toBe(false);
    expect(canAdoptLibraryEntry({ status: 'complete', role: 'example' })).toBe(false);
    expect(canAdoptLibraryEntry({ status: 'reference_only', role: 'reference' })).toBe(false);
  });

  test('selects preferred edition first, then configured source priority deterministically', () => {
    const entries = [
      { name: 'Foo', key: 'foo', sourceKey: 'late' },
      { name: 'Foo', key: 'FOO', sourceKey: 'early' },
      { name: 'Foo', key: 'foo', sourceKey: 'preferred', preferredEdition: true },
      { name: 'Bar', key: 'bar', sourceKey: 'late' },
    ];
    const selected = preferredLibraryEditions(entries, [
      { key: 'early', priority: 1 },
      { key: 'late', priority: 20 },
      { key: 'preferred', priority: 100 },
    ]);
    expect(selected.map((entry) => entry.key)).toEqual(['foo', 'bar']);
    expect(
      preferredLibraryEditions(entries.slice(0, 2), [
        { key: 'late', priority: 20 },
        { key: 'early', priority: 1 },
      ]).map((entry) => entry.key),
    ).toEqual(['FOO']);
  });

  test('matches modifiers by universal flag, kind, tag, or source-specific trait reference', () => {
    const modifier = (applicability: LibraryModifierCreate['applicability']) =>
      ({ applicability }) as Pick<LibraryModifierCreate, 'applicability'>;
    const trait = {
      name: 'Acute Vision',
      key: 'acute vision',
      sourceKey: 'core',
      kind: 'advantage',
      tags: ['sensory'],
    };
    expect(
      modifierApplies(
        modifier({ universal: true, traitKinds: [], traitTags: [], traits: [] }),
        trait,
      ),
    ).toBe(true);
    expect(
      modifierApplies(
        modifier({ universal: false, traitKinds: ['advantage'], traitTags: [], traits: [] }),
        trait,
      ),
    ).toBe(true);
    expect(
      modifierApplies(
        modifier({ universal: false, traitKinds: [], traitTags: ['sensory'], traits: [] }),
        trait,
      ),
    ).toBe(true);
    expect(
      modifierApplies(
        modifier({
          universal: false,
          traitKinds: [],
          traitTags: [],
          traits: [{ section: 'traits', key: 'Acute Vision', sourceKey: 'CORE' }],
        }),
        trait,
      ),
    ).toBe(true);
    expect(
      modifierApplies(
        modifier({
          universal: false,
          traitKinds: [],
          traitTags: [],
          traits: [{ section: 'traits', key: 'acute vision', sourceKey: 'core' }],
        }),
        trait,
      ),
    ).toBe(true);
    expect(
      modifierApplies(
        modifier({
          universal: false,
          traitKinds: [],
          traitTags: [],
          traits: [{ section: 'items', key: 'acute vision', sourceKey: 'core' }],
        }),
        trait,
      ),
    ).toBe(false);
  });
});
