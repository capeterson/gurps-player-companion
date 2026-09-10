import { describe, expect, it } from 'bun:test';
import { type CombatAdjustmentInput, combatAdjustments } from './combatAdjustments.ts';

const base: CombatAdjustmentInput = {
  hp: 12,
  maxHp: 12,
  fp: 12,
  maxFp: 12,
  posture: 'standing',
  conditions: [],
  maneuver: null,
};
describe('live combat adjustments', () => {
  it.each([
    ['hp', 5, 9],
    ['hp', 4, 9],
    ['hp', 3, 5],
    ['fp', 5, 9],
    ['fp', 4, 9],
    ['fp', 3, 5],
  ] as const)('%s at %s uses a strict one-third boundary', (pool, value, dodge) => {
    const state = combatAdjustments({ ...base, [pool]: value });
    expect(state.defense('dodge', 9)).toBe(dodge);
    expect(state.movement(5)).toBe(dodge === 9 ? 5 : 3);
  });
  it('stacks both pool reductions, rounding up, with DB after the reduction', () => {
    const state = combatAdjustments({ ...base, hp: 3, fp: 3 });
    expect(state.defense('dodge', 9, null, 2)).toBe(5); // ceil(9/4) + DB2
    expect(state.defense('parry', 10, null, 2)).toBe(12);
    expect(state.movement(5)).toBe(2);
    expect(state.strength(11)).toBe(6);
  });
  it('does not double-count manually tracked Reeling or Shock', () => {
    const state = combatAdjustments({ ...base, conditions: ['Reeling', 'Shock'] });
    expect(state.defense('dodge', 9)).toBe(9);
    expect(state.movement(5)).toBe(5);
  });
  it('does not invent a minimum Dodge under pool reductions', () => {
    const state = combatAdjustments({ ...base, hp: 3 });
    expect(state.defense('dodge', 0)).toBe(0);
    expect(state.defense('dodge', -4)).toBe(-2);
  });
  it('allows a step for Evaluate but no movement before a Wait triggers (B364, B366)', () => {
    expect(combatAdjustments({ ...base, maneuver: 'evaluate' }).movement(6)).toBe(1);
    expect(combatAdjustments({ ...base, maneuver: 'wait' }).movement(6)).toBe(0);
  });
  it('applies stun and prone penalties to every defense and prevents movement', () => {
    const state = combatAdjustments({ ...base, posture: 'prone', conditions: ['Stunned'] });
    for (const kind of ['dodge', 'parry', 'block'] as const)
      expect(state.defense(kind, 10)).toBe(3);
    expect(state.movement(5)).toBe(0);
  });
  it.each([
    ['prone', 1, 7],
    ['lying', 1, 7],
    ['kneeling', 2, 8],
    ['crawling', 2, 7],
    ['sitting', 0, 8],
    ['crouching', 4, 10],
  ] as const)('%s applies posture movement and defense limits', (posture, move, defense) => {
    const state = combatAdjustments({ ...base, posture });
    expect(state.movement(6)).toBe(move);
    expect(state.defense('parry', 10)).toBe(defense);
  });
  it('All-Out Attack has no defenses and half forward movement', () => {
    const state = combatAdjustments({ ...base, maneuver: 'All-Out Attack' });
    for (const kind of ['dodge', 'parry', 'block'] as const)
      expect(state.defense(kind, 10)).toBeNull();
    expect(state.movement(6)).toBe(3);
  });
  it('All-Out Defense only improves the chosen defense, with option-dependent movement', () => {
    const state = combatAdjustments({ ...base, maneuver: 'all_out_defense' });
    expect(state.defense('dodge', 10, 'dodge')).toBe(12);
    expect(state.defense('parry', 10, 'dodge')).toBe(10);
    expect(state.defense('block', 10, 'block')).toBe(12);
    expect(state.defense('parry', 10, 'double')).toBe(10);
    expect(state.movement(6, 'dodge')).toBe(3);
    expect(state.movement(6, 'double')).toBe(1);
    expect(state.movement(6, 'parry')).toBe(1);
    expect(state.movement(6, 'block')).toBe(1);
  });
  it.each(['all_out_attack', 'all_out_defense'])(
    'rounds half movement up for %s (B386)',
    (maneuver) => {
      const state = combatAdjustments({ ...base, maneuver });
      expect(state.movement(5, 'dodge')).toBe(3);
      expect(state.movement(1, 'dodge')).toBe(1);
      expect(state.movement(0, 'dodge')).toBe(0);
      expect(combatAdjustments({ ...base, hp: 3, fp: 3, maneuver }).movement(4, 'dodge')).toBe(1);
    },
  );
  it('Move and Attack blocks parry only, and immobility never gains a minimum move', () => {
    const state = combatAdjustments({ ...base, hp: 3, maneuver: 'Move and Attack' });
    expect(state.defense('parry', 10)).toBeNull();
    expect(state.defense('block', 10)).toBe(10);
    expect(state.movement(0)).toBe(0);
  });
  it.each([{ conditions: ['Unconscious'] }, { conditions: ['sleeping'] }, { fp: -12 }])(
    'has no usable defense while incapacitated %j',
    (patch) => {
      const state = combatAdjustments({ ...base, ...patch });
      expect(state.defense('dodge', 10)).toBeNull();
      expect(state.movement(6)).toBe(0);
    },
  );
});
