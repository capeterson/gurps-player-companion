import { describe, expect, it } from 'bun:test';
import { applyFatigueLoss } from './fatigue.ts';

describe('fatigue injury (B426)', () => {
  it.each([
    [2, 3, -1, 1],
    [0, 1, -1, 1],
    [-9, 3, -10, 3],
    [-10, 3, -10, 3],
    [5, 5, 0, 0],
    [5, 2, 3, 0],
    [-3, 0, -3, 0],
    [-3, -2, -3, 0],
  ])('FP %i losing %i becomes %i with HP cost %i', (fp, loss, result, hpCost) => {
    expect(applyFatigueLoss(fp, loss, 10)).toEqual({ fp: result, hpCost });
  });
});
