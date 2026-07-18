import { describe, expect, it } from 'bun:test';
import { evaluateRoll, roll3d6, rollDamageDice } from './diceRoll.ts';

describe('roll3d6', () => {
  it('sums the three dice from an injected rng', () => {
    // rng values map to dice via floor(rng*6)+1; feed a fixed sequence.
    const values = [0, 0.5, 0.999];
    let i = 0;
    const rng = () => values[i++] as number;
    const r = roll3d6(rng);
    expect(r.dice).toEqual([1, 4, 6]);
    expect(r.total).toBe(11);
  });

  it('stays within 1..6 per die across many samples', () => {
    for (let i = 0; i < 500; i++) {
      const r = roll3d6(Math.random);
      for (const die of r.dice) {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(6);
      }
      expect(r.total).toBe(r.dice[0] + r.dice[1] + r.dice[2]);
    }
  });

  it('defaults to Math.random when no rng is passed', () => {
    const r = roll3d6();
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.total).toBeLessThanOrEqual(18);
  });
});

describe('rollDamageDice', () => {
  const fixedRng = (values: readonly number[]) => {
    let i = 0;
    return () => values[i++] as number;
  };

  it('rolls N dice and folds in the adds', () => {
    // floor(rng*6)+1: 0 -> 1, 0.5 -> 4.
    const r = rollDamageDice({ dice: 2, adds: 1 }, 0, fixedRng([0, 0.5]));
    expect(r.rolls).toEqual([1, 4]);
    expect(r.total).toBe(6);
  });

  it('clamps to the minimum damage (0 for cr, 1 for cut/imp per B378)', () => {
    // 1d-4 rolling a 1: raw total -3.
    expect(rollDamageDice({ dice: 1, adds: -4 }, 0, fixedRng([0])).total).toBe(0);
    expect(rollDamageDice({ dice: 1, adds: -4 }, 1, fixedRng([0])).total).toBe(1);
  });

  it('stays within N..6N + adds across many samples', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDamageDice({ dice: 3, adds: 2 }, 0, Math.random);
      expect(r.rolls).toHaveLength(3);
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(20);
    }
  });
});

describe('evaluateRoll', () => {
  // Matrix: skills x totals, per B556 (crit thresholds) and B345-346 (17 always fails).
  const cases: Array<{
    skill: number;
    total: number;
    success: boolean;
    crit: 'success' | 'failure' | null;
  }> = [
    // skill 3
    { skill: 3, total: 3, success: true, crit: 'success' },
    { skill: 3, total: 4, success: true, crit: 'success' },
    { skill: 3, total: 5, success: false, crit: null },
    { skill: 3, total: 6, success: false, crit: null },
    { skill: 3, total: 7, success: false, crit: null },
    { skill: 3, total: 16, success: false, crit: 'failure' },
    { skill: 3, total: 17, success: false, crit: 'failure' },
    { skill: 3, total: 18, success: false, crit: 'failure' },

    // skill 10
    { skill: 10, total: 3, success: true, crit: 'success' },
    { skill: 10, total: 4, success: true, crit: 'success' },
    { skill: 10, total: 5, success: true, crit: null },
    { skill: 10, total: 6, success: true, crit: null },
    { skill: 10, total: 7, success: true, crit: null },
    { skill: 10, total: 16, success: false, crit: null },
    { skill: 10, total: 17, success: false, crit: 'failure' },
    { skill: 10, total: 18, success: false, crit: 'failure' },

    // skill 14
    { skill: 14, total: 3, success: true, crit: 'success' },
    { skill: 14, total: 4, success: true, crit: 'success' },
    { skill: 14, total: 5, success: true, crit: null },
    { skill: 14, total: 6, success: true, crit: null },
    { skill: 14, total: 7, success: true, crit: null },
    { skill: 14, total: 16, success: false, crit: null },
    { skill: 14, total: 17, success: false, crit: 'failure' },
    { skill: 14, total: 18, success: false, crit: 'failure' },

    // skill 15 (5 becomes crit success at 15+)
    { skill: 15, total: 3, success: true, crit: 'success' },
    { skill: 15, total: 4, success: true, crit: 'success' },
    { skill: 15, total: 5, success: true, crit: 'success' },
    { skill: 15, total: 6, success: true, crit: null },
    { skill: 15, total: 7, success: true, crit: null },
    { skill: 15, total: 16, success: false, crit: null },
    { skill: 15, total: 17, success: false, crit: 'failure' },
    { skill: 15, total: 18, success: false, crit: 'failure' },

    // skill 16 (5 and 6 both crit success; 17 becomes ordinary failure)
    { skill: 16, total: 3, success: true, crit: 'success' },
    { skill: 16, total: 4, success: true, crit: 'success' },
    { skill: 16, total: 5, success: true, crit: 'success' },
    { skill: 16, total: 6, success: true, crit: 'success' },
    { skill: 16, total: 7, success: true, crit: null },
    { skill: 16, total: 16, success: true, crit: null },
    { skill: 16, total: 17, success: false, crit: null },
    { skill: 16, total: 18, success: false, crit: 'failure' },

    // skill 17 (17 is still always a failure, ordinary since skill >= 16)
    { skill: 17, total: 3, success: true, crit: 'success' },
    { skill: 17, total: 4, success: true, crit: 'success' },
    { skill: 17, total: 5, success: true, crit: 'success' },
    { skill: 17, total: 6, success: true, crit: 'success' },
    { skill: 17, total: 7, success: true, crit: null },
    { skill: 17, total: 16, success: true, crit: null },
    { skill: 17, total: 17, success: false, crit: null },
    { skill: 17, total: 18, success: false, crit: 'failure' },

    // skill 24 (very high skill: 17 and 18 still fail)
    { skill: 24, total: 3, success: true, crit: 'success' },
    { skill: 24, total: 4, success: true, crit: 'success' },
    { skill: 24, total: 5, success: true, crit: 'success' },
    { skill: 24, total: 6, success: true, crit: 'success' },
    { skill: 24, total: 7, success: true, crit: null },
    { skill: 24, total: 16, success: true, crit: null },
    { skill: 24, total: 17, success: false, crit: null },
    { skill: 24, total: 18, success: false, crit: 'failure' },
  ];

  for (const c of cases) {
    it(`skill ${c.skill} vs total ${c.total} -> success=${c.success} crit=${c.crit}`, () => {
      const outcome = evaluateRoll(c.skill, c.total);
      expect(outcome.success).toBe(c.success);
      expect(outcome.crit).toBe(c.crit);
      expect(outcome.margin).toBe(c.skill - c.total);
    });
  }

  it('applies the total >= skill+10 critical-failure rule for low skills', () => {
    // skill 6, total 16: 16 >= 6+10 -> critical failure even though 16 != 17/18.
    const outcome = evaluateRoll(6, 16);
    expect(outcome.success).toBe(false);
    expect(outcome.crit).toBe('failure');
    expect(outcome.margin).toBe(-10);
  });

  it('a roll of 4 against skill 3 is a critical success despite failing arithmetically', () => {
    const outcome = evaluateRoll(3, 4);
    expect(outcome.success).toBe(true);
    expect(outcome.crit).toBe('success');
    expect(outcome.margin).toBe(-1);
  });

  it('a roll of 17 against skill 20 is a failure despite beating the skill arithmetically', () => {
    const outcome = evaluateRoll(20, 17);
    expect(outcome.success).toBe(false);
    expect(outcome.crit).toBeNull();
    expect(outcome.margin).toBe(3);
  });

  it('margin is effectiveSkill - total, negative on a failed roll', () => {
    expect(evaluateRoll(10, 12).margin).toBe(-2);
    expect(evaluateRoll(10, 8).margin).toBe(2);
  });
});
