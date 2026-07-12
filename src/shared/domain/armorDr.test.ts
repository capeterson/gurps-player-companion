import { describe, expect, it } from 'bun:test';
import { aggregateDrByLocation } from './armorDr.ts';
import type { ArmorItemRow } from './armorDr.ts';

function item(
  dr: number,
  locations: string[],
  opts: Partial<ArmorItemRow['armor']> = {},
): ArmorItemRow {
  return {
    equipped: true,
    isArmor: true,
    armor: {
      locations,
      dr,
      drCrushing: null,
      flexible: false,
      frontOnly: false,
      backOnly: false,
      notes: null,
      ...opts,
    },
  };
}

describe('aggregateDrByLocation', () => {
  it('sums DR across equipped armor covering the same location', () => {
    const result = aggregateDrByLocation([item(2, ['torso']), item(3, ['torso', 'arm_left'])]);
    expect(result.get('torso')?.dr).toBe(5);
    expect(result.get('arm_left')?.dr).toBe(3);
  });

  it('skips unequipped or non-armor items', () => {
    const result = aggregateDrByLocation([
      item(4, ['torso']),
      { equipped: false, isArmor: true, armor: item(10, ['torso']).armor },
      { equipped: true, isArmor: false, armor: null },
    ]);
    expect(result.get('torso')?.dr).toBe(4);
  });

  it('tracks crushing DR overrides separately', () => {
    const result = aggregateDrByLocation([
      item(3, ['torso'], { drCrushing: 5 }),
      item(2, ['torso'], { drCrushing: null }),
    ]);
    expect(result.get('torso')?.dr).toBe(5);
    expect(result.get('torso')?.drCrushing).toBe(5);
  });

  it('returns null crushing DR when no item overrides it', () => {
    const result = aggregateDrByLocation([item(3, ['torso'])]);
    expect(result.get('torso')?.drCrushing).toBeNull();
  });

  it('returns an empty map when no equipped armor exists', () => {
    expect(aggregateDrByLocation([]).size).toBe(0);
    expect(aggregateDrByLocation([{ equipped: true, isArmor: false, armor: null }]).size).toBe(0);
  });
});
