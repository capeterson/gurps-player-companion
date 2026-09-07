import { describe, expect, it } from 'bun:test';
import {
  type TechniqueSkillCandidate,
  computeTechniqueLevel,
  resolveDefaultSkillLevel,
  techniqueBonus,
} from './techniqueCalc.ts';

describe('techniqueBonus', () => {
  it('Average: every point buys +1', () => {
    expect(techniqueBonus(0, 'A', null)).toBe(0);
    expect(techniqueBonus(1, 'A', null)).toBe(1);
    expect(techniqueBonus(4, 'A', null)).toBe(4);
  });

  it('Hard: the first point buys nothing, then +1 per point', () => {
    expect(techniqueBonus(0, 'H', null)).toBe(0);
    expect(techniqueBonus(1, 'H', null)).toBe(0);
    expect(techniqueBonus(2, 'H', null)).toBe(1);
    expect(techniqueBonus(5, 'H', null)).toBe(4);
  });

  it('never goes negative', () => {
    expect(techniqueBonus(0, 'H', null)).toBeGreaterThanOrEqual(0);
  });

  it('clamps at maxLevel', () => {
    expect(techniqueBonus(10, 'A', 4)).toBe(4);
    expect(techniqueBonus(10, 'H', 4)).toBe(4);
    expect(techniqueBonus(2, 'A', 4)).toBe(2);
  });

  it('treats maxLevel 0 as "no bonus allowed"', () => {
    expect(techniqueBonus(6, 'A', 0)).toBe(0);
  });

  it('treats undefined maxLevel the same as null (uncapped)', () => {
    expect(techniqueBonus(6, 'A', undefined)).toBe(6);
  });
});

describe('computeTechniqueLevel', () => {
  it('is the default skill level plus the bonus', () => {
    expect(computeTechniqueLevel(3, 14, 'A')).toBe(17);
    expect(computeTechniqueLevel(3, 14, 'H')).toBe(16);
  });

  it('a 0-point technique sits exactly at its default', () => {
    expect(computeTechniqueLevel(0, 14, 'A')).toBe(14);
    expect(computeTechniqueLevel(0, 14, 'H')).toBe(14);
  });

  it('respects the max-level cap', () => {
    expect(computeTechniqueLevel(9, 12, 'A', 2)).toBe(14);
  });

  it('applies the default-line penalty before the purchased bonus', () => {
    // Combat Riding on the veteran sheet: Riding 23, default line -7,
    // 0 points -> 16 (was 23 before the penalty was modeled).
    expect(computeTechniqueLevel(0, 23, 'H', null, -7)).toBe(16);
    // Points buy up from the default line: 1 pt (Hard) = still 16, 2 pts = 17.
    expect(computeTechniqueLevel(1, 23, 'H', null, -7)).toBe(16);
    expect(computeTechniqueLevel(2, 23, 'H', null, -7)).toBe(17);
    // Average: every point improves from the default line.
    expect(computeTechniqueLevel(1, 23, 'A', null, -7)).toBe(17);
  });

  it('treats a missing default modifier as 0 (full-skill default)', () => {
    expect(computeTechniqueLevel(0, 14, 'A', null, undefined)).toBe(14);
    expect(computeTechniqueLevel(0, 14, 'A', null, null)).toBe(14);
  });

  it('caps the improvement from the default line, not the raw level', () => {
    // Default -6, cap +4, Hard 5 pts -> 4 pt bonus -> 14 + (-6) + 4 = 12.
    expect(computeTechniqueLevel(5, 14, 'H', 4, -6)).toBe(12);
  });

  it('is null when the default skill is not on the sheet', () => {
    expect(computeTechniqueLevel(4, null, 'A')).toBeNull();
    expect(computeTechniqueLevel(0, null, 'H', 3)).toBeNull();
    expect(computeTechniqueLevel(0, null, 'A', null, -7)).toBeNull();
  });
});

describe('resolveDefaultSkillLevel', () => {
  const skills: TechniqueSkillCandidate[] = [
    { name: 'Broadsword', specialization: null, level: 14 },
    { name: 'Savoir-Faire', specialization: 'Dojo', level: 11 },
    { name: 'Thaumatology', specialization: null, level: null },
    { name: 'Knife', specialization: null, level: 12 },
    { name: 'Knife', specialization: 'Thrown', level: 13 },
  ];

  it('matches a bare skill name case-insensitively', () => {
    expect(resolveDefaultSkillLevel('broadsword', skills)).toBe(14);
    expect(resolveDefaultSkillLevel('  Broadsword  ', skills)).toBe(14);
  });

  it('matches the "Name (Specialization)" display form', () => {
    expect(resolveDefaultSkillLevel('Savoir-Faire (Dojo)', skills)).toBe(11);
  });

  it('picks the highest level when several rows share the bare name', () => {
    expect(resolveDefaultSkillLevel('Knife', skills)).toBe(13);
  });

  it('still targets one specialization exactly when named', () => {
    expect(resolveDefaultSkillLevel('Knife (Thrown)', skills)).toBe(13);
  });

  it('skips skills with no usable level (0-point Very Hard)', () => {
    expect(resolveDefaultSkillLevel('Thaumatology', skills)).toBeNull();
  });

  it('returns null when the skill is not on the sheet', () => {
    expect(resolveDefaultSkillLevel('Karate', skills)).toBeNull();
  });

  it('returns null for an empty/whitespace default name', () => {
    expect(resolveDefaultSkillLevel('   ', skills)).toBeNull();
  });
});
