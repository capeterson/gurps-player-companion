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

const CORE_ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const ALT_ID = '0193b3c0-f1f0-7000-8000-00000000a002';
const LATE_ID = '0193b3c0-f1f0-7000-8000-00000000a003';

describe('library identity and source selection', () => {
  test('canonicalizes keys and builds identities from kind, entry key, and source', () => {
    expect(canonicalLibraryKey('  Acute   Vision ')).toBe('acute vision');
    const base = { name: 'Acute Vision', key: '  Acute   Vision ', sourceId: CORE_ID };
    expect(libraryEntryKey(base)).toBe(libraryEntryKey({ ...base, key: 'acute vision' }));
    expect(libraryEntryKey({ ...base, kind: 'advantage' })).not.toBe(
      libraryEntryKey({ ...base, kind: 'disadvantage' }),
    );
    expect(libraryEntryKey(base)).not.toBe(libraryEntryKey({ ...base, sourceId: ALT_ID }));
  });

  test('derives a portable key for legacy persisted rows with an empty key', () => {
    expect(libraryEntryKey({ name: 'Old entry', key: '', sourceId: null })).toBe(
      libraryEntryKey({ name: 'Old entry', key: 'old entry', sourceId: null }),
    );
  });

  test('normalizes persisted metadata defaults and adoption eligibility', () => {
    expect(libraryMetadataValues({ name: '  Acute   Vision ' })).toEqual({
      key: 'acute vision',
      sourceId: null,
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
      { name: 'Foo', key: 'foo', sourceId: LATE_ID },
      { name: 'Foo', key: 'FOO', sourceId: CORE_ID },
      { name: 'Foo', key: 'foo', sourceId: ALT_ID, preferredEdition: true },
      { name: 'Bar', key: 'bar', sourceId: LATE_ID },
    ];
    const selected = preferredLibraryEditions(entries, [
      { id: CORE_ID, priority: 1 },
      { id: LATE_ID, priority: 20 },
      { id: ALT_ID, priority: 100 },
    ]);
    expect(selected.map((entry) => entry.key)).toEqual(['foo', 'bar']);
    expect(
      preferredLibraryEditions(entries.slice(0, 2), [
        { id: LATE_ID, priority: 20 },
        { id: CORE_ID, priority: 1 },
      ]).map((entry) => entry.key),
    ).toEqual(['FOO']);
  });

  test('matches modifiers by universal flag, kind, tag, or source-specific trait reference', () => {
    const modifier = (applicability: LibraryModifierCreate['applicability']) =>
      ({ applicability }) as Pick<LibraryModifierCreate, 'applicability'>;
    const trait = {
      name: 'Acute Vision',
      key: 'acute vision',
      sourceId: CORE_ID,
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
          traits: [{ section: 'traits', key: 'Acute Vision', sourceId: CORE_ID }],
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
          traits: [{ section: 'traits', key: 'acute vision', sourceId: CORE_ID }],
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
          traits: [{ section: 'items', key: 'acute vision', sourceId: CORE_ID }],
        }),
        trait,
      ),
    ).toBe(false);
  });
});
