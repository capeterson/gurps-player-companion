import { describe, expect, it } from 'bun:test';
import { type InventoryItemRow, computeEncumbrance, computeWeights } from './encumbrance.ts';

function row(
  overrides: Partial<InventoryItemRow> & Pick<InventoryItemRow, 'id'>,
): InventoryItemRow {
  return {
    parentId: null,
    weightLbs: 0,
    quantity: 1,
    worn: false,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    ...overrides,
  };
}

describe('computeWeights', () => {
  it('non-worn items contribute zero to player weight but show their raw weight in perItem', () => {
    const items: InventoryItemRow[] = [row({ id: 'a', weightLbs: 5, worn: false })];
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(0);
    expect(result.perItem.get('a')).toBe(5);
  });

  it('worn item with no children contributes its raw weight', () => {
    const items: InventoryItemRow[] = [row({ id: 'a', weightLbs: 5, worn: true })];
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(5);
    expect(result.perItem.get('a')).toBe(5);
  });

  it('worn container with hideaway eats up to hideaway capacity', () => {
    const items: InventoryItemRow[] = [
      row({
        id: 'pack',
        weightLbs: 2,
        worn: true,
        isContainer: true,
        hideawayCapacityLbs: 10,
      }),
      row({ id: 'rope', parentId: 'pack', weightLbs: 8 }),
    ];
    // raw subtree = 2 + 8 = 10; hideaway = 10 → effective subtree = 0
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(0);
    expect(result.perItem.get('pack')).toBe(0);
    expect(result.perItem.get('rope')).toBe(0);
  });

  it('worn container applies weight reduction to remaining content', () => {
    const items: InventoryItemRow[] = [
      row({
        id: 'pack',
        weightLbs: 2,
        worn: true,
        isContainer: true,
        weightReductionPercent: 50,
      }),
      row({ id: 'rocks', parentId: 'pack', weightLbs: 8 }),
    ];
    // raw = 10, hideaway = 0 → 10, * 0.5 = 5
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(5);
    // perItem distributes proportionally: pack=2/10*5=1, rocks=8/10*5=4
    expect(result.perItem.get('pack')).toBeCloseTo(1, 6);
    expect(result.perItem.get('rocks')).toBeCloseTo(4, 6);
  });

  it('only outermost worn root applies enchantments', () => {
    const items: InventoryItemRow[] = [
      row({
        id: 'outer',
        weightLbs: 1,
        worn: true,
        isContainer: true,
        weightReductionPercent: 50,
      }),
      row({
        id: 'inner',
        parentId: 'outer',
        weightLbs: 1,
        isContainer: true,
        weightReductionPercent: 50, // ignored because nested in worn root
      }),
      row({ id: 'goods', parentId: 'inner', weightLbs: 8 }),
    ];
    const result = computeWeights(items);
    // raw subtree = 1+1+8 = 10; hideaway 0 → 10; *0.5 from outer = 5
    expect(result.playerWeightLbs).toBe(5);
  });
});

describe('computeEncumbrance', () => {
  it('level 0 (None) when ratio ≤ 1', () => {
    const r = computeEncumbrance(20, 20);
    expect(r.level).toBe(0);
    expect(r.label).toBe('None');
    expect(r.dodgePenalty).toBe(0);
    expect(r.speedDivisor).toBe(1);
  });
  it('level 1 (Light) when 1 < ratio ≤ 2', () => {
    const r = computeEncumbrance(30, 20);
    expect(r.level).toBe(1);
    expect(r.label).toBe('Light');
  });
  it('level 2 (Medium) when 2 < ratio ≤ 3', () => {
    const r = computeEncumbrance(50, 20);
    expect(r.level).toBe(2);
  });
  it('level 3 (Heavy) when 3 < ratio ≤ 6', () => {
    const r = computeEncumbrance(100, 20);
    expect(r.level).toBe(3);
    expect(r.dodgePenalty).toBe(-3);
  });
  it('level 4 (X-Heavy) when ratio > 6', () => {
    const r = computeEncumbrance(200, 20);
    expect(r.level).toBe(4);
    expect(r.dodgePenalty).toBe(-4);
    expect(r.speedDivisor).toBe(3);
  });
  it('treats zero basic lift as infinite ratio', () => {
    const r = computeEncumbrance(5, 0);
    expect(r.level).toBe(4);
  });
});
