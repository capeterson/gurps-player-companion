import { describe, expect, it } from 'bun:test';
import { skillCreate, skillDefaults, skillUpdate } from '../schemas/skill.ts';
import { type CharacterAttrs, computeDerived } from './characterCalc.ts';
import {
  attributeLevelFor,
  computeSkillLevel,
  resolveSkillLevels,
  skillOffset,
} from './skillCalc.ts';

const baseAttrs: CharacterAttrs = {
  st: 10,
  dx: 12,
  iq: 14,
  ht: 11,
  hpMod: 0,
  willMod: 1,
  perMod: -1,
  fpMod: 0,
  speedQuarterMod: 0,
  moveMod: 0,
  tempEffects: [],
  dodgeMod: 0,
  parryMod: 0,
  blockMod: 0,
  drMod: 0,
  frightCheckMod: 0,
};

it('validates declarations identically for create and sync/REST patch', () => {
  for (const defaults of [
    [{ kind: 'attribute', attribute: 'DX', modifier: 1 }],
    [{ kind: 'skill', name: '', modifier: -2 }],
    [{ kind: 'skill', name: 'Guns', modifier: -2, unexpected: true }],
    [{ kind: 'attribute', attribute: 'invalid', modifier: -5 }],
    Array.from({ length: 21 }, () => ({ kind: 'skill', name: 'X', modifier: 0 })),
  ]) {
    expect(skillDefaults.safeParse(defaults).success).toBe(false);
    expect(
      skillCreate.safeParse({ name: 'X', attribute: 'DX', difficulty: 'A', defaults }).success,
    ).toBe(false);
    expect(skillUpdate.safeParse({ defaults }).success).toBe(false);
  }
});

describe('skillOffset', () => {
  it('Easy 1 pt is +0', () => {
    expect(skillOffset('E', 1)).toBe(0);
  });
  it('Easy 2 pts is +1', () => {
    expect(skillOffset('E', 2)).toBe(1);
  });
  it('Easy 4 pts is +2, Easy 8 pts is +3, Easy 12 pts is +4', () => {
    expect(skillOffset('E', 4)).toBe(2);
    expect(skillOffset('E', 8)).toBe(3);
    expect(skillOffset('E', 12)).toBe(4);
  });
  it('Average 1 pt is -1', () => {
    expect(skillOffset('A', 1)).toBe(-1);
  });
  it('Hard 1 pt is -2', () => {
    expect(skillOffset('H', 1)).toBe(-2);
  });
  it('Very Hard 1 pt is -3, VH 4 pts is -1', () => {
    expect(skillOffset('VH', 1)).toBe(-3);
    expect(skillOffset('VH', 4)).toBe(-1);
  });
  it('VH 16 pts is +2', () => {
    // VH ladder: 1pt → -3, 2-3pt → -2, 4pt → -1, 8pt → 0, 12pt → +1, 16pt → +2.
    expect(skillOffset('VH', 16)).toBe(2);
  });
});

describe('attributeLevelFor', () => {
  const derived = computeDerived(baseAttrs);
  it('uses derived Will/Per for Will/Per skills', () => {
    expect(attributeLevelFor('Will', derived)).toBe(derived.will);
    expect(attributeLevelFor('Per', derived)).toBe(derived.per);
    expect(derived.will).toBe(15);
    expect(derived.per).toBe(13);
  });
  it('uses effective primary attributes', () => {
    expect(attributeLevelFor('DX', derived)).toBe(12);
    expect(attributeLevelFor('IQ', derived)).toBe(14);
  });
  it('Other defaults to 10', () => {
    expect(attributeLevelFor('Other', derived)).toBe(10);
  });
});

describe('computeSkillLevel', () => {
  const derived = computeDerived(baseAttrs);
  it('uses the FAQ Shortsword/Broadsword default and point-difference buy-up', () => {
    const defaults = [{ kind: 'skill' as const, name: 'Shortsword', modifier: -2 }];
    const source = (level: number) => [{ name: 'Shortsword', specialization: null, level }];
    // Basic Set B173: a one-point buy-up sticks at 12 when Shortsword rises.
    expect(computeSkillLevel('DX', 'A', 0, derived, defaults, source(13))).toBe(11);
    expect(computeSkillLevel('DX', 'A', 1, derived, defaults, source(13))).toBe(12);
    expect(computeSkillLevel('DX', 'A', 1, derived, defaults, source(14))).toBe(12);
    expect(computeSkillLevel('DX', 'A', 0, derived, defaults, source(14))).toBe(12);
    expect(computeSkillLevel('DX', 'A', 2, derived, defaults, source(14))).toBe(13);
    expect(computeSkillLevel('DX', 'A', 2, derived, defaults, source(15))).toBe(13);
    expect(computeSkillLevel('DX', 'A', 4, derived, defaults, source(15))).toBe(14);
    expect(computeSkillLevel('DX', 'A', 20, derived, defaults, source(15))).toBe(18);
  });
  it('chooses the best available candidate and skips missing or mismatched specialties', () => {
    const defaults = [
      { kind: 'attribute' as const, attribute: 'DX' as const, modifier: -5 },
      { kind: 'skill' as const, name: 'Guns', specialization: 'Pistol', modifier: -2 },
      { kind: 'skill' as const, name: 'Missing', modifier: 0 },
    ];
    expect(
      computeSkillLevel('DX', 'VH', 0, derived, defaults, [
        { name: 'Guns', specialization: 'Rifle', level: 20 },
      ]),
    ).toBe(7);
    expect(
      computeSkillLevel('DX', 'VH', 0, derived, defaults, [
        { name: ' guns ', specialization: ' pistol ', level: 14 },
      ]),
    ).toBe(12);
    expect(
      computeSkillLevel('DX', 'A', 0, derived, [{ kind: 'skill', name: 'Missing', modifier: -2 }]),
    ).toBeNull();
  });
  it('IQ/Average/4 pts for an IQ 14 character is 15', () => {
    expect(computeSkillLevel('IQ', 'A', 4, derived)).toBe(15);
  });
  it('DX/Hard/1 pt for DX 12 is 10', () => {
    expect(computeSkillLevel('DX', 'H', 1, derived)).toBe(10);
  });
  it('Will/Average/2 pts for Will 15 is 15', () => {
    expect(computeSkillLevel('Will', 'A', 2, derived)).toBe(15);
  });
  it('0 points uses the declared attribute default independently of difficulty', () => {
    const defaults = [{ kind: 'attribute' as const, attribute: 'DX' as const, modifier: -4 }];
    expect(computeSkillLevel('DX', 'E', 0, derived, defaults)).toBe(8);
    expect(computeSkillLevel('DX', 'VH', 0, derived, defaults)).toBe(8);
    expect(computeSkillLevel('DX', 'H', 0, derived, [])).toBeNull(); // Karate
    expect(computeSkillLevel('DX', 'A', 0, derived)).toBeNull(); // legacy unknown
  });
  it('0 points on a Very Hard skill has no level at all', () => {
    expect(computeSkillLevel('IQ', 'VH', 0, derived)).toBeNull();
  });
});

describe('learned default dependencies', () => {
  const derived = computeDerived(baseAttrs);
  const skill = (id: string, points: number, source?: string) => ({
    id,
    name: id,
    specialization: null,
    attribute: 'DX' as const,
    difficulty: 'A' as const,
    points,
    defaults: source ? [{ kind: 'skill' as const, name: source, modifier: -2 }] : [],
  });

  it('propagates learned buy-ups but excludes untrained bridges', () => {
    const skills = [
      skill('Shortsword', 8),
      skill('Broadsword', 2, 'Shortsword'),
      skill('Third', 0, 'Broadsword'),
    ] as const;
    expect(Object.fromEntries(resolveSkillLevels(skills, derived))).toEqual({
      Shortsword: 14,
      Broadsword: 13,
      Third: 11,
    });
    expect(
      resolveSkillLevels([skills[0], skill('Broadsword', 0, 'Shortsword'), skills[2]], derived).get(
        'Third',
      ),
    ).toBeNull();
    expect(
      resolveSkillLevels([skill('Shortsword', 16), skills[1], skills[2]], derived).get('Third'),
    ).toBe(12);
  });

  it('does not claim both directions of a reciprocal discount or depend on input ordering', () => {
    const skills = [skill('A', 1, 'B'), skill('B', 1, 'A')].map((s) => ({
      ...s,
      defaults: s.defaults.map((d) => ({ ...d, modifier: 0 })),
    }));
    const levels = resolveSkillLevels(skills, derived);
    expect(Object.fromEntries(levels)).toEqual({ A: 12, B: 11 });
    expect(resolveSkillLevels([...skills].reverse(), derived)).toEqual(levels);
    expect([
      ...resolveSkillLevels(
        skills.map((s) => ({ ...s, points: 0 })),
        derived,
      ).values(),
    ]).toEqual([null, null]);
  });
});
