import { describe, expect, it } from 'bun:test';
import type { TraitEffect } from '../schemas/effects.ts';
import { type CharacterAttrs, computeDerived } from './characterCalc.ts';
import {
  type CharacterSkillWithEffects,
  type CharacterTraitWithEffects,
  applyEffectsToAttrs,
  distinctConditionGroups,
  resolveEffects,
  skillBonusFor,
} from './traitEffects.ts';

const baseAttrs: CharacterAttrs = {
  st: 12,
  dx: 12,
  iq: 11,
  ht: 12,
  hpMod: 0,
  willMod: 0,
  perMod: 0,
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

/**
 * Look up the synthesized-trait-effect entry (id="sys:trait-effects")
 * in an `applyEffectsToAttrs` result and return its per-axis mods,
 * defaulting to 0 when the axis is unset.  Lets test cases assert
 * against the fold's output at the axis level instead of the old
 * scalar `tempSt/tempDx/...` fields.
 */
function traitAxis(attrs: CharacterAttrs, axis: string): number {
  const bag = attrs.tempEffects.find((e) => e.id === 'sys:trait-effects');
  return (bag?.mods as Record<string, number> | undefined)?.[axis] ?? 0;
}

function trait(
  id: string,
  name: string,
  level: number | null,
  effects: TraitEffect[],
): CharacterTraitWithEffects {
  return { id, name, level, libraryEffects: effects };
}

describe('resolveEffects', () => {
  it('emits one ResolvedEffect per library effect', () => {
    const traits = [
      trait('t1', 'Combat Reflexes', null, [
        { target: 'dodge', value: 1, scaling: 'flat' },
        { target: 'parry', value: 1, scaling: 'flat' },
      ]),
    ];
    const out = resolveEffects(traits, [], new Set());
    expect(out).toHaveLength(2);
    expect(out[0]?.target).toBe('dodge');
    expect(out[0]?.sourceName).toBe('Combat Reflexes');
    expect(out[0]?.active).toBe(true);
  });

  it('scales per_level effects by trait.level', () => {
    const traits = [
      trait('t1', 'Acute Vision', 3, [
        { target: 'per', value: 1, scaling: 'per_level' },
      ]),
    ];
    const out = resolveEffects(traits, [], new Set());
    expect(out[0]?.value).toBe(3);
  });

  it('treats null/0 level as level 1 for per_level scaling', () => {
    const traits = [
      trait('t1', 'Enhanced Dodge', null, [
        { target: 'dodge', value: 1, scaling: 'per_level' },
      ]),
    ];
    const out = resolveEffects(traits, [], new Set());
    expect(out[0]?.value).toBe(1);
  });

  it('marks conditional effects inactive when their group is OFF', () => {
    const traits = [
      trait('t1', 'High Pain Threshold', null, [
        {
          target: 'fright_check',
          value: 3,
          scaling: 'flat',
          conditionGroup: 'pain',
          conditionLabel: 'Pain-related fright check',
        },
      ]),
    ];
    const out = resolveEffects(traits, [], new Set());
    expect(out[0]?.active).toBe(false);
    const out2 = resolveEffects(traits, [], new Set(['pain']));
    expect(out2[0]?.active).toBe(true);
  });

  it('unconditional effects are always active regardless of group set', () => {
    const traits = [
      trait('t1', 'Combat Reflexes', null, [{ target: 'dodge', value: 1, scaling: 'flat' }]),
    ];
    const out = resolveEffects(traits, [], new Set());
    expect(out[0]?.active).toBe(true);
  });
});

describe('applyEffectsToAttrs', () => {
  it('adds dodge mod, parry mod, block mod via dedicated channels', () => {
    const traits = [
      trait('t1', 'Combat Reflexes', null, [
        { target: 'dodge', value: 1, scaling: 'flat' },
        { target: 'parry', value: 1, scaling: 'flat' },
        { target: 'block', value: 1, scaling: 'flat' },
        { target: 'fright_check', value: 6, scaling: 'flat' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    const out = applyEffectsToAttrs(baseAttrs, eff);
    expect(out.dodgeMod).toBe(1);
    expect(out.parryMod).toBe(1);
    expect(out.blockMod).toBe(1);
    expect(out.frightCheckMod).toBe(6);
  });

  it('routes primary-attr effects through temp* channels so derived stats flow through computeDerived', () => {
    const traits = [
      trait('t1', 'Enhanced ST', 2, [
        { target: 'st', value: 1, scaling: 'per_level' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    const out = applyEffectsToAttrs(baseAttrs, eff);
    expect(traitAxis(out, 'st')).toBe(2);
    // HP is derived from BASE ST + hpMod + per-axis temp mods (B15 canon;
    // temp-ST alone doesn't grow HP), so hp stays 12; effectiveSt still
    // reflects the +2 for lift/damage.
    const d = computeDerived(out);
    expect(d.effectiveSt).toBe(14); // base 12 + 2 from trait
    expect(d.hp).toBe(12); // base ST 12 + 0
    expect(d.basicLift).toBe(Math.round((14 * 14) / 5));
  });

  it('basic_speed effects scale to quarter-increments', () => {
    const traits = [
      trait('t1', 'Increased Speed', 1, [{ target: 'basic_speed', value: 1, scaling: 'flat' }]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    const out = applyEffectsToAttrs(baseAttrs, eff);
    expect(traitAxis(out, 'speedQuarter')).toBe(4); // +1 Speed = +4 quarters
  });

  it('skips inactive (conditional, group OFF) effects', () => {
    const traits = [
      trait('t1', 'Acute Vision', 3, [
        {
          target: 'per',
          value: 1,
          scaling: 'per_level',
          conditionGroup: 'vision',
        },
      ]),
    ];
    const offEff = resolveEffects(traits, [], new Set());
    expect(traitAxis(applyEffectsToAttrs(baseAttrs, offEff), 'per')).toBe(0);
    const onEff = resolveEffects(traits, [], new Set(['vision']));
    expect(traitAxis(applyEffectsToAttrs(baseAttrs, onEff), 'per')).toBe(3);
  });

  it('skill-target effects do NOT touch attrs', () => {
    const traits = [
      trait('t1', 'Magery', 2, [
        { target: 'skill', value: 1, scaling: 'per_level', skillName: '*' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    const out = applyEffectsToAttrs(baseAttrs, eff);
    // Skill-target effects don't add an axis-mods bag at all; every
    // dedicated *Mod stays at baseline too.
    expect(out.tempEffects.some((e) => e.id === 'sys:trait-effects')).toBe(false);
    expect(out.dodgeMod).toBe(0);
  });

  it('end-to-end: Combat Reflexes increases dodge by 1 via computeDerived', () => {
    const traits = [
      trait('t1', 'Combat Reflexes', null, [
        { target: 'dodge', value: 1, scaling: 'flat' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    const attrs = applyEffectsToAttrs(baseAttrs, eff);
    const before = computeDerived(baseAttrs);
    const after = computeDerived(attrs);
    expect(after.dodge - before.dodge).toBe(1);
    expect(after.dodgeBase).toBe(before.dodgeBase + 1);
  });
});

describe('skillBonusFor', () => {
  function skill(id: string, name: string, effects: TraitEffect[]): CharacterSkillWithEffects {
    return { id, name, libraryEffects: effects };
  }

  it('matches by base skill name (case-insensitive, specialty-stripped)', () => {
    const traits = [
      trait('t1', 'Outdoorsman', 2, [
        { target: 'skill', value: 1, scaling: 'flat', skillName: 'Tracking' },
        { target: 'skill', value: 1, scaling: 'flat', skillName: 'Naturalist' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    expect(skillBonusFor('Tracking', eff).total).toBe(1);
    expect(skillBonusFor('tracking', eff).total).toBe(1);
    expect(skillBonusFor('Tracking (Urban)', eff).total).toBe(1);
    expect(skillBonusFor('Stealth', eff).total).toBe(0);
  });

  it('wildcard skillName="*" matches every skill', () => {
    const traits = [
      trait('t1', 'Magery', 3, [
        { target: 'skill', value: 1, scaling: 'flat', skillName: '*' },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    expect(skillBonusFor('Fireball', eff).total).toBe(1);
    expect(skillBonusFor('Light', eff).total).toBe(1);
  });

  it('inactive (conditional) skill bonuses are excluded from total', () => {
    const traits = [
      trait('t1', 'Talent', 1, [
        {
          target: 'skill',
          value: 1,
          scaling: 'flat',
          skillName: 'Stealth',
          conditionGroup: 'urban',
        },
      ]),
    ];
    const offEff = resolveEffects(traits, [], new Set());
    expect(skillBonusFor('Stealth', offEff).total).toBe(0);
    const onEff = resolveEffects(traits, [], new Set(['urban']));
    expect(skillBonusFor('Stealth', onEff).total).toBe(1);
  });
});

describe('distinctConditionGroups', () => {
  it('returns the unique set of group keys with labels and active flags', () => {
    const traits = [
      trait('t1', 'Acute Vision', 3, [
        {
          target: 'per',
          value: 1,
          scaling: 'per_level',
          conditionGroup: 'vision',
          conditionLabel: 'Vision-based Per roll',
        },
      ]),
      trait('t2', 'High Pain Threshold', null, [
        {
          target: 'fright_check',
          value: 3,
          scaling: 'flat',
          conditionGroup: 'pain',
          conditionLabel: 'Pain-related fright check',
        },
      ]),
    ];
    const eff = resolveEffects(traits, [], new Set(['vision']));
    const groups = distinctConditionGroups(eff);
    expect(groups.map((g) => g.group).sort()).toEqual(['pain', 'vision']);
    const vision = groups.find((g) => g.group === 'vision');
    const pain = groups.find((g) => g.group === 'pain');
    expect(vision?.label).toBe('Vision-based Per roll');
    expect(vision?.active).toBe(true);
    expect(pain?.active).toBe(false);
  });

  it('omits unconditional effects', () => {
    const traits = [
      trait('t1', 'Combat Reflexes', null, [{ target: 'dodge', value: 1, scaling: 'flat' }]),
    ];
    const eff = resolveEffects(traits, [], new Set());
    expect(distinctConditionGroups(eff)).toHaveLength(0);
  });
});
