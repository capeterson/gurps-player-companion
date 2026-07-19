import { describe, expect, it } from 'bun:test';
import { effectCreate, effectUpdate } from './encounter.ts';

const id = '00000000-0000-4000-8000-000000000001';

describe('encounter effect schemas', () => {
  it('rejects negative maintenance costs on create and update', () => {
    expect(
      effectCreate.safeParse({
        targetCombatantId: id,
        name: 'Haste',
        duration: { unit: 'rounds', amount: 1 },
        maintenanceCost: -1,
      }).success,
    ).toBe(false);
    expect(effectUpdate.safeParse({ maintenanceCost: -1 }).success).toBe(false);
  });

  it('applies create name bounds to updates', () => {
    expect(effectUpdate.safeParse({ name: '' }).success).toBe(false);
    expect(effectUpdate.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(effectUpdate.safeParse({ name: 'Haste' }).success).toBe(true);
  });
});
