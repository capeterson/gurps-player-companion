import { describe, expect, it } from 'bun:test';
import {
  LIBRARY_YAML_MAX_BYTES,
  LibraryYamlError,
  emitLibraryYaml,
  parseLibraryYaml,
} from './library.ts';

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
  spells:
    - name: Light
      college: Light & Darkness
      difficulty: H
      baseEnergyCost: 1
      maintenanceCost: 1
    - name: Major Healing
      college: Healing
      difficulty: VH
      baseEnergyCost: 2
      prerequisites: Magery 1, Minor Healing
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
    expect(doc.library.spells).toHaveLength(2);
    expect(doc.library.items).toHaveLength(2);
  });

  it('defaults spell difficulty to H and accepts VH', () => {
    const doc = parseLibraryYaml(SAMPLE);
    const light = doc.library.spells?.find((s) => s.name === 'Light');
    const major = doc.library.spells?.find((s) => s.name === 'Major Healing');
    expect(light?.difficulty).toBe('H');
    expect(major?.difficulty).toBe('VH');
  });

  it('leaves the spells section undefined when absent (pre-spell-library exports)', () => {
    // Undefined (not []) so replace-mode imports can distinguish "old
    // file with no spells section" from an explicit empty spell list.
    const doc = parseLibraryYaml('version: 1\nlibrary:\n  traits: []\n  skills: []\n  items: []\n');
    expect(doc.library.spells).toBeUndefined();
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

  it('rejects duplicate spell names regardless of case', () => {
    const dup = `version: 1
library:
  traits: []
  skills: []
  spells:
    - name: Light
    - name: light
  items: []
`;
    expect(() => parseLibraryYaml(dup)).toThrow(/duplicate spell/);
  });

  it('rejects unparseable YAML', () => {
    expect(() => parseLibraryYaml(': : : :')).toThrow(LibraryYamlError);
  });

  it('rejects payload exceeding the size limit', () => {
    const huge = 'x'.repeat(LIBRARY_YAML_MAX_BYTES + 1);
    expect(() => parseLibraryYaml(huge)).toThrow(LibraryYamlError);
    expect(() => parseLibraryYaml(huge)).toThrow(/exceeds/);
  });

  it('rejects an invalid trait kind enum value', () => {
    const bad = `version: 1
library:
  traits:
    - name: SuperPower
      kind: superpower
      basePoints: 10
  skills: []
  items: []
`;
    expect(() => parseLibraryYaml(bad)).toThrow(LibraryYamlError);
    expect(() => parseLibraryYaml(bad)).toThrow(/schema validation/);
  });
});

describe('emitLibraryYaml', () => {
  it('round-trips without losing content', () => {
    const doc = parseLibraryYaml(SAMPLE);
    const reemit = emitLibraryYaml({
      campaign: doc.campaign,
      traits: doc.library.traits,
      skills: doc.library.skills,
      spells: doc.library.spells ?? [],
      items: doc.library.items,
    });
    const reparsed = parseLibraryYaml(reemit);
    expect(reparsed.library.spells).toHaveLength(2);
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
      spells: doc.library.spells ?? [],
      items: doc.library.items,
    });
    const docB = parseLibraryYaml(first);
    const second = emitLibraryYaml({
      campaign: docB.campaign,
      traits: docB.library.traits,
      skills: docB.library.skills,
      spells: docB.library.spells ?? [],
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
      spells: [],
      items: [],
    });
    expect(out).not.toMatch(/tags:/);
    expect(out).toMatch(/Hard to Kill/);
  });
});

// GURPS modifier cost formula (B102): percentages sum first, then apply
// once, rounded up.  +50% and −50% cancel to base — NOT base × 1.5 × 0.5.
describe('GURPS modifier cost formula', () => {
  function computeFinal(
    base: number,
    mods: Array<{ costType: 'percent' | 'flat'; costValue: number }>,
  ) {
    const sumPercent = mods
      .filter((m) => m.costType === 'percent')
      .reduce((s, m) => s + m.costValue, 0);
    const sumFlat = mods.filter((m) => m.costType === 'flat').reduce((s, m) => s + m.costValue, 0);
    return Math.ceil(base * (1 + sumPercent / 100)) + sumFlat;
  }

  it('+50% and −50% cancel exactly to base cost', () => {
    const result = computeFinal(10, [
      { costType: 'percent', costValue: 50 },
      { costType: 'percent', costValue: -50 },
    ]);
    expect(result).toBe(10);
  });

  it('+50% on 10 pts yields 15 pts', () => {
    expect(computeFinal(10, [{ costType: 'percent', costValue: 50 }])).toBe(15);
  });

  it('fractional result rounds up (not truncates)', () => {
    // +15% of 10 = 11.5 → rounds up to 12
    expect(computeFinal(10, [{ costType: 'percent', costValue: 15 }])).toBe(12);
  });

  it('flat modifier adds after percent application', () => {
    // +50% of 10 = 15, then +5 flat = 20
    const result = computeFinal(10, [
      { costType: 'percent', costValue: 50 },
      { costType: 'flat', costValue: 5 },
    ]);
    expect(result).toBe(20);
  });
});
