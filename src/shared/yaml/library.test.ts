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

// v3: a fully-loaded item (weapon w/ skill/db/ranged, container fields,
// powerstone, magic item), a leveled trait with variants + effects, and a
// campaign block with manaLevel.
const SAMPLE_V3 = `version: 3
campaign:
  name: Sample
  description: A sample campaign for tests.
  pointTarget: 150
  disadvantageCap: 50
  quirkCap: 5
  manaLevel: high
library:
  traits:
    - name: Magery
      kind: advantage
      basePoints: 5
      pointsPerLevel: 10
      maxLevel: 6
      variants:
        - name: Ritual Magic Only
          pointCostMultiplier: 0.5
      effects:
        - target: skill
          skillName: Thaumatology
          value: 1
          scaling: per_level
  skills: []
  spells: []
  items:
    - name: Boarding Cutlass
      category: weapon
      weightLbs: 3
      cost: 300
      isArmor: false
      weaponData:
        damage: sw+1 cut
        reach: '1'
        parry: '0'
        stRequired: 9
        skill: Shortsword
        db: 1
        ranged:
          acc: 0
          range: 10/15
          rof: '1'
          shots: '1'
          bulk: -2
          recoil: 1
    - name: Explorer's Pack
      category: general
      weightLbs: 4
      cost: 80
      isContainer: true
      hideawayCapacityLbs: 30
      weightReductionPercent: 25
    - name: Charged Powerstone
      category: magic
      weightLbs: 1
      cost: 500
      powerstoneData:
        maxEnergy: 20
        currentEnergy: 15
        notes: Attuned to fire.
    - name: Wand of Light
      category: magic
      weightLbs: 1
      cost: 400
      magicItemData:
        spellName: Light
        spellSkillLevel: 18
        mode: charged
        chargesMax: 20
        chargesCurrent: 20
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

  it('parses a v3 document with the full item/trait/campaign shape', () => {
    const doc = parseLibraryYaml(SAMPLE_V3);
    expect(doc.version).toBe(3);
    expect(doc.campaign?.manaLevel).toBe('high');

    const magery = doc.library.traits.find((t) => t.name === 'Magery');
    expect(magery?.pointsPerLevel).toBe(10);
    expect(magery?.maxLevel).toBe(6);
    expect(magery?.variants).toEqual([{ name: 'Ritual Magic Only', pointCostMultiplier: 0.5 }]);
    expect(magery?.effects).toEqual([
      { target: 'skill', skillName: 'Thaumatology', value: 1, scaling: 'per_level' },
    ]);

    const cutlass = doc.library.items.find((i) => i.name === 'Boarding Cutlass');
    expect(cutlass?.weaponData?.skill).toBe('Shortsword');
    expect(cutlass?.weaponData?.db).toBe(1);
    expect(cutlass?.weaponData?.ranged).toEqual({
      acc: 0,
      range: '10/15',
      rof: '1',
      shots: '1',
      bulk: -2,
      recoil: 1,
    });

    const pack = doc.library.items.find((i) => i.name === "Explorer's Pack");
    expect(pack?.isContainer).toBe(true);
    expect(pack?.hideawayCapacityLbs).toBe(30);
    expect(pack?.weightReductionPercent).toBe(25);

    const stone = doc.library.items.find((i) => i.name === 'Charged Powerstone');
    expect(stone?.powerstoneData).toEqual({
      maxEnergy: 20,
      currentEnergy: 15,
      notes: 'Attuned to fire.',
    });

    const wand = doc.library.items.find((i) => i.name === 'Wand of Light');
    expect(wand?.magicItemData).toEqual({
      spellName: 'Light',
      spellSkillLevel: 18,
      mode: 'charged',
      chargesMax: 20,
      chargesCurrent: 20,
    });
  });

  it('still parses v1 and v2 documents (new v3 fields default/absent)', () => {
    const v1 = parseLibraryYaml(SAMPLE);
    expect(v1.version).toBe(1);
    expect(v1.library.items[0]?.isContainer).toBe(false);
    expect(v1.library.items[0]?.powerstoneData).toBeUndefined();
    expect(v1.campaign?.manaLevel).toBeUndefined();

    const v2 = `version: 2
library:
  traits:
    - name: Fearlessness
      kind: advantage
      basePoints: 2
      effects: []
  skills: []
  items: []
`;
    const doc = parseLibraryYaml(v2);
    expect(doc.version).toBe(2);
    expect(doc.library.traits[0]?.pointsPerLevel).toBeUndefined();
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

  it('round-trips a v3 document (full item/trait/campaign shape) byte-stably', () => {
    const doc = parseLibraryYaml(SAMPLE_V3);
    const first = emitLibraryYaml({
      campaign: doc.campaign,
      traits: doc.library.traits,
      skills: doc.library.skills,
      spells: doc.library.spells ?? [],
      items: doc.library.items,
    });
    expect(first).toContain('version: 3');
    expect(first).toContain('manaLevel: high');

    const docB = parseLibraryYaml(first);
    const second = emitLibraryYaml({
      campaign: docB.campaign,
      traits: docB.library.traits,
      skills: docB.library.skills,
      spells: docB.library.spells ?? [],
      items: docB.library.items,
    });
    expect(second).toBe(first);

    const cutlass = docB.library.items.find((i) => i.name === 'Boarding Cutlass');
    expect(cutlass?.weaponData?.ranged?.range).toBe('10/15');
    const stone = docB.library.items.find((i) => i.name === 'Charged Powerstone');
    expect(stone?.powerstoneData?.currentEnergy).toBe(15);
  });

  it('drops empty arrays and null fields from compact output', () => {
    const out = emitLibraryYaml({
      traits: [
        {
          name: 'Hard to Kill',
          kind: 'advantage',
          basePoints: 2,
          availableModifiers: [],
          variants: [],
          effects: [],
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
