import { describe, expect, it } from 'bun:test';
import { magicalDefenseBonus } from './inventoryDefenseBonus.ts';

function item(
  id: string,
  value: number,
  stackingKey: string | null,
  overrides: { worn?: boolean; equipped?: boolean } = {},
) {
  return {
    id,
    worn: overrides.worn ?? true,
    equipped: overrides.equipped ?? true,
    enchantmentBreakdown: [
      { target: 'db', active: true, suppressedByStacking: false, stackingKey, value },
    ],
  };
}

describe('magicalDefenseBonus', () => {
  it('keeps negative Deflect contributions and applies highest-only stacking to signed values', () => {
    expect(
      magicalDefenseBonus([item('curse-1', -2, 'deflect'), item('curse-2', -1, 'deflect')]),
    ).toBe(-1);
  });

  it('sums independent item-local penalties and excludes stashed or unequipped items', () => {
    expect(
      magicalDefenseBonus([
        item('curse-1', -2, null),
        item('curse-2', -1, null),
        item('stashed', 4, null, { worn: false }),
        item('inactive', 3, null, { equipped: false }),
      ]),
    ).toBe(-3);
  });
});
