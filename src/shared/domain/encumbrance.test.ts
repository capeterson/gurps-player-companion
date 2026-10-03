import { describe, expect, it } from 'bun:test';
import {
  type InventoryItemRow,
  computeEncumbrance,
  computeWeights,
  effectiveMove,
} from './encumbrance.ts';

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
    // Hideaway applies to contents only; the container itself still weighs 2 lb.
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(2);
    expect(result.perItem.get('pack')).toBe(2);
    expect(result.perItem.get('rope')).toBe(0);
  });

  it('does not apply Lighten to a container or its contents', () => {
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
    // Lighten applies only to equipped armor or shields, so the pack and its contents weigh 10 lb.
    const result = computeWeights(items);
    expect(result.playerWeightLbs).toBe(10);
    expect(result.perItem.get('pack')).toBe(2);
    expect(result.perItem.get('rocks')).toBe(8);
  });

  it('does not apply container Lighten to a nested carried subtree', () => {
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
    // Container enchantments do not reduce the carried weight.
    expect(result.playerWeightLbs).toBe(10);
  });

  it('ordinary storage capacity does not hide the carried contents or container weight', () => {
    const result = computeWeights([
      row({ id: 'backpack', weightLbs: 3, worn: true, isContainer: true, hideawayCapacityLbs: 0 }),
      row({ id: 'contents', parentId: 'backpack', weightLbs: 20 }),
    ]);
    expect(result.playerWeightLbs).toBe(23);
    expect(result.perItem.get('backpack')).toBeCloseTo(3, 6);
    expect(result.perItem.get('contents')).toBeCloseTo(20, 6);
  });

  it('applies Hideaway capacity to contents while preserving the nested container weights', () => {
    const result = computeWeights([
      row({ id: 'outer', weightLbs: 3, worn: true, isContainer: true, hideawayCapacityLbs: 10 }),
      row({
        id: 'inner',
        parentId: 'outer',
        weightLbs: 2,
        isContainer: true,
        hideawayCapacityLbs: 5,
      }),
      row({ id: 'goods', parentId: 'inner', weightLbs: 12 }),
    ]);
    // Nested Hideaway reduces its own contents to 7 lb. The outer Hideaway
    // then removes those 7 lb from its contents, leaving the 3 lb outer pack.
    expect(result.playerWeightLbs).toBe(3);
  });

  it('applies Lighten only to equipped armor or shields, never containers or stashed gear', () => {
    const result = computeWeights([
      row({
        id: 'armor',
        weightLbs: 10,
        worn: true,
        equipped: true,
        isArmor: true,
        weightReductionPercent: 50,
      }),
      row({
        id: 'container',
        weightLbs: 10,
        worn: true,
        equipped: true,
        isContainer: true,
        weightReductionPercent: 50,
      }),
      row({
        id: 'stashed',
        weightLbs: 10,
        worn: false,
        equipped: true,
        isArmor: true,
        weightReductionPercent: 50,
      }),
    ]);
    expect(result.playerWeightLbs).toBe(15);
    expect(result.perItem.get('armor')).toBe(5);
    expect(result.perItem.get('container')).toBe(10);
    expect(result.perItem.get('stashed')).toBe(10);
  });

  it('excludes a zero-quantity carried root and all of its nested contents', () => {
    const result = computeWeights([
      row({
        id: 'empty-pack',
        weightLbs: 3,
        quantity: 0,
        worn: true,
        isContainer: true,
        hideawayCapacityLbs: 0,
      }),
      row({ id: 'contents', parentId: 'empty-pack', weightLbs: 12, quantity: 1 }),
    ]);
    expect(result.playerWeightLbs).toBe(0);
    expect(result.perItem.get('empty-pack')).toBe(0);
    expect(result.perItem.get('contents')).toBe(0);
  });
});

describe('computeEncumbrance', () => {
  it('level 0 (None) when ratio ≤ 1', () => {
    const r = computeEncumbrance(20, 20);
    expect(r.level).toBe(0);
    expect(r.label).toBe('None');
    expect(r.dodgePenalty).toBe(0);
    expect(r.moveMultiplier).toBe(1);
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
    expect(r.moveMultiplier).toBe(0.2);
  });

  it('keeps X-Heavy Move for an exceptional carried load through 15× Basic Lift', () => {
    const encumbrance = computeEncumbrance(220, 20);
    expect(encumbrance.ratio).toBe(11);
    expect(effectiveMove(5, encumbrance)).toBe(1);
  });

  it('still allows the minimum Move at 15× Basic Lift and rejects loads above it', () => {
    const atLimit = computeEncumbrance(300, 20);
    const overLimit = computeEncumbrance(301, 20);
    expect(effectiveMove(5, atLimit)).toBe(1);
    expect(effectiveMove(5, overLimit)).toBe(0);
  });
  it('treats zero basic lift as infinite ratio', () => {
    const r = computeEncumbrance(5, 0);
    expect(r.level).toBe(4);
  });
});
