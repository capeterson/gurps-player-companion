import { describe, expect, it } from 'bun:test';
import { PRIMARY_COST_PER_LEVEL } from '../constants/attributes.ts';
import {
  ATTR_INFLUENCE,
  SECONDARY_INFO,
  attrNextCost,
  attrSpent,
  secondarySpent,
} from './attributeTooltips.ts';

describe('attrSpent', () => {
  it('returns 0 at base 10 for every primary attribute', () => {
    expect(attrSpent('ST', 10)).toBe(0);
    expect(attrSpent('DX', 10)).toBe(0);
    expect(attrSpent('IQ', 10)).toBe(0);
    expect(attrSpent('HT', 10)).toBe(0);
  });

  it('matches the per-level cost table for ST/HT (10 pts each)', () => {
    expect(attrSpent('ST', 11)).toBe(10);
    expect(attrSpent('HT', 13)).toBe(30);
  });

  it('matches the per-level cost table for DX/IQ (20 pts each)', () => {
    expect(attrSpent('DX', 11)).toBe(20);
    expect(attrSpent('IQ', 13)).toBe(60);
  });

  it('returns a negative refund when below 10', () => {
    expect(attrSpent('ST', 8)).toBe(-20);
    expect(attrSpent('IQ', 9)).toBe(-20);
  });

  it('cost-per-level matches the constant table for every attribute', () => {
    for (const key of ['ST', 'DX', 'IQ', 'HT'] as const) {
      expect(attrSpent(key, 11) - attrSpent(key, 10)).toBe(PRIMARY_COST_PER_LEVEL[key]);
    }
  });
});

describe('attrNextCost', () => {
  it('returns the per-point cost for each primary attribute', () => {
    expect(attrNextCost('ST')).toBe(10);
    expect(attrNextCost('DX')).toBe(20);
    expect(attrNextCost('IQ')).toBe(20);
    expect(attrNextCost('HT')).toBe(10);
  });
});

describe('ATTR_INFLUENCE', () => {
  it('lists at least one influence for every primary attribute', () => {
    for (const key of ['ST', 'DX', 'IQ', 'HT'] as const) {
      expect(ATTR_INFLUENCE[key].length).toBeGreaterThan(0);
    }
  });
});

describe('secondarySpent', () => {
  it('returns 0 at level 0 for every secondary mod', () => {
    expect(secondarySpent('hp', 0)).toBe(0);
    expect(secondarySpent('will', 0)).toBe(0);
    expect(secondarySpent('per', 0)).toBe(0);
    expect(secondarySpent('fp', 0)).toBe(0);
    expect(secondarySpent('speed', 0)).toBe(0);
    expect(secondarySpent('move', 0)).toBe(0);
  });

  it('charges 2 pts per +1 HP', () => {
    expect(secondarySpent('hp', 5)).toBe(10);
  });

  it('charges 5 pts per +0.25 Basic Speed (i.e. per quarter-step)', () => {
    expect(secondarySpent('speed', 4)).toBe(20); // four quarters = +1 Basic Speed
  });
});

describe('SECONDARY_INFO', () => {
  it('has metadata for every secondary mod', () => {
    for (const key of ['hp', 'will', 'per', 'fp', 'speed', 'move'] as const) {
      expect(SECONDARY_INFO[key].label.length).toBeGreaterThan(0);
      expect(SECONDARY_INFO[key].influences.length).toBeGreaterThan(0);
    }
  });
});
