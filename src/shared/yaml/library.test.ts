import { describe, expect, it } from 'bun:test';
import { LibraryYamlError, emitLibraryYaml, parseLibraryYaml } from './library.ts';

const SAMPLE = `version: 1
campaign:
  name: Sample
  description: A sample campaign for tests.
library:
  traits:
    - name: Combat Reflexes
      kind: advantage
      basePoints: 15
      source: B-43
    - name: Bad Temper
      kind: disadvantage
      basePoints: -10
      availableModifiers:
        - name: Mitigator (-50%)
          category: limitation
          costType: percent
          costValue: -50
  skills:
    - name: Stealth
      attribute: DX
      difficulty: A
    - name: Acrobatics
      attribute: DX
      difficulty: H
  items:
    - name: Mail Hauberk
      category: armor
      weightLbs: 25
      cost: 230
      isArmor: true
      armor:
        locations: [torso]
        dr: 4
        flexible: true
    - name: Backpack
      category: general
      weightLbs: 3
      cost: 60
`;

describe('parseLibraryYaml', () => {
  it('parses a valid sample document', () => {
    const doc = parseLibraryYaml(SAMPLE);
    expect(doc.version).toBe(1);
    expect(doc.campaign?.name).toBe('Sample');
    expect(doc.library.traits).toHaveLength(2);
    expect(doc.library.skills).toHaveLength(2);
    expect(doc.library.items).toHaveLength(2);
  });

  it('rejects a wrong version', () => {
    expect(() =>
      parseLibraryYaml('version: 999\nlibrary:\n  traits: []\n  skills: []\n  items: []\n'),
    ).toThrow(LibraryYamlError);
  });

  it('rejects duplicate trait keys', () => {
    const dup = `version: 1
library:
  traits:
    - name: Sense of Duty
      kind: disadvantage
      basePoints: -5
    - name: Sense of Duty
      kind: disadvantage
      basePoints: -10
  skills: []
  items: []
`;
    expect(() => parseLibraryYaml(dup)).toThrow(/duplicate trait/);
  });

  it('rejects duplicate skill names regardless of case', () => {
    const dup = `version: 1
library:
  traits: []
  skills:
    - name: Stealth
      attribute: DX
      difficulty: A
    - name: stealth
      attribute: DX
      difficulty: A
  items: []
`;
    expect(() => parseLibraryYaml(dup)).toThrow(/duplicate skill/);
  });

  it('rejects unparseable YAML', () => {
    expect(() => parseLibraryYaml(': : : :')).toThrow(LibraryYamlError);
  });
});

describe('emitLibraryYaml', () => {
  it('round-trips without losing content', () => {
    const doc = parseLibraryYaml(SAMPLE);
    const reemit = emitLibraryYaml({
      campaign: doc.campaign,
      traits: doc.library.traits,
      skills: doc.library.skills,
      items: doc.library.items,
    });
    const reparsed = parseLibraryYaml(reemit);
    expect(reparsed.library.traits).toEqual(
      [...doc.library.traits].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.name.localeCompare(b.name);
      }),
    );
  });

  it('produces byte-stable output (idempotent re-export)', () => {
    const doc = parseLibraryYaml(SAMPLE);
    const first = emitLibraryYaml({
      campaign: doc.campaign,
      traits: doc.library.traits,
      skills: doc.library.skills,
      items: doc.library.items,
    });
    const docB = parseLibraryYaml(first);
    const second = emitLibraryYaml({
      campaign: docB.campaign,
      traits: docB.library.traits,
      skills: docB.library.skills,
      items: docB.library.items,
    });
    expect(second).toBe(first);
  });

  it('drops empty arrays and null fields from compact output', () => {
    const out = emitLibraryYaml({
      traits: [
        {
          name: 'Hard to Kill',
          kind: 'advantage',
          basePoints: 2,
          availableModifiers: [],
          tags: [],
        },
      ],
      skills: [],
      items: [],
    });
    expect(out).not.toMatch(/tags:/);
    expect(out).toMatch(/Hard to Kill/);
  });
});
