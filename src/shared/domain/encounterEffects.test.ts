import { describe, expect, test } from 'bun:test';
import { effectRemainingLabel, isEffectExpired, needsMaintenance } from './encounterEffects.ts';

describe('encounter effect prompts', () => {
  test('expires a round effect at its first round beyond duration', () => {
    expect(isEffectExpired({ unit: 'rounds', amount: 2 }, 3, 4)).toBe(false);
    expect(isEffectExpired({ unit: 'rounds', amount: 2 }, 3, 5)).toBe(true);
  });

  test('calculates minute and hour durations in encounter rounds', () => {
    expect(isEffectExpired({ unit: 'minutes', amount: 1 }, 3, 62)).toBe(false);
    expect(isEffectExpired({ unit: 'minutes', amount: 1 }, 3, 63)).toBe(true);
    expect(isEffectExpired({ unit: 'hours', amount: 1 }, 3, 3602)).toBe(false);
    expect(isEffectExpired({ unit: 'hours', amount: 1 }, 3, 3603)).toBe(true);
    expect(isEffectExpired({ unit: 'indefinite' }, 3, 99999)).toBe(false);
    expect(effectRemainingLabel({ unit: 'minutes', amount: 2 }, 1, 61)).toBe('~1 min');
  });

  test('requests maintenance once per round', () => {
    expect(needsMaintenance(1, null, 1, 60)).toBe(false);
    expect(needsMaintenance(1, null, 1, 61)).toBe(true);
    expect(needsMaintenance(1, 61, 1, 61)).toBe(false);
    expect(needsMaintenance(null, null, 1, 61)).toBe(false);
  });
});
