import { describe, expect, it } from 'bun:test';
import {
  conditionLabel,
  conditionsInclude,
  normalizeCondition,
  toggleCondition,
} from './conditions.ts';

describe('normalizeCondition', () => {
  it('lowercases, trims, and replaces spaces with underscores', () => {
    expect(normalizeCondition('On Fire')).toBe('on_fire');
    expect(normalizeCondition('  Stunned  ')).toBe('stunned');
    expect(normalizeCondition('Mortally Wounded')).toBe('mortally_wounded');
  });

  it('is idempotent on already-canonical ids', () => {
    expect(normalizeCondition('on_fire')).toBe('on_fire');
  });
});

describe('conditionLabel', () => {
  it('renders snake_case as Title Case with spaces', () => {
    expect(conditionLabel('on_fire')).toBe('On Fire');
    expect(conditionLabel('stunned')).toBe('Stunned');
    expect(conditionLabel('mortally_wounded')).toBe('Mortally Wounded');
  });

  it('title-cases unknown/legacy strings sensibly', () => {
    expect(conditionLabel('Shock')).toBe('Shock');
    expect(conditionLabel('some new condition')).toBe('Some New Condition');
  });

  it('round-trips with normalizeCondition', () => {
    for (const id of ['on_fire', 'stunned', 'mortally_wounded', 'grappled']) {
      expect(normalizeCondition(conditionLabel(id))).toBe(id);
    }
  });
});

describe('conditionsInclude', () => {
  it('matches a legacy Capitalized entry against a canonical id', () => {
    expect(conditionsInclude(['Stunned'], 'stunned')).toBe(true);
  });

  it('matches canonical entries against canonical ids', () => {
    expect(conditionsInclude(['on_fire', 'bleeding'], 'on_fire')).toBe(true);
  });

  it('returns false when absent', () => {
    expect(conditionsInclude(['Stunned'], 'on_fire')).toBe(false);
    expect(conditionsInclude([], 'stunned')).toBe(false);
  });
});

describe('toggleCondition', () => {
  it('appends the canonical id when not present', () => {
    expect(toggleCondition([], 'stunned')).toEqual(['stunned']);
    expect(toggleCondition(['on_fire'], 'bleeding')).toEqual(['on_fire', 'bleeding']);
  });

  it('appends the canonical form even if the caller passes a display string', () => {
    expect(toggleCondition([], 'On Fire')).toEqual(['on_fire']);
  });

  it('strips all case/legacy variants on toggle-off, including duplicates', () => {
    expect(toggleCondition(['Stunned', 'stunned', 'bleeding'], 'stunned')).toEqual(['bleeding']);
  });

  it('toggling twice returns to the original (modulo legacy normalization)', () => {
    const once = toggleCondition([], 'stunned');
    const twice = toggleCondition(once, 'stunned');
    expect(twice).toEqual([]);
  });
});
