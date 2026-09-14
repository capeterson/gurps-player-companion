import { describe, expect, it } from 'bun:test';
import {
  conditionsProven,
  crossTechLevelPenalty,
  evaluateSkillDefaultConditions,
  evaluateSkillPrerequisite,
  failedPrerequisiteMessages,
  resolvedTechLevel,
} from './skillRules.ts';

const context = {
  skills: [{ name: 'Guns', specialization: 'Pistol', level: 14, relativeLevel: 2, points: 4 }],
  traits: [{ name: 'Magery', level: 2 }],
  attributes: { DX: 12, IQ: 11 },
  techLevel: 8,
  campaignRules: { magic: true, genre: 'urban' },
  gmPermissions: new Set(['Trained by a master']),
  targetSpecialization: 'Pistol',
} as const;

describe('structured skill prerequisites', () => {
  it('evaluates every leaf and nested AND/OR groups with actionable failures', () => {
    const result = evaluateSkillPrerequisite(
      {
        kind: 'all',
        children: [
          {
            kind: 'skill',
            name: 'Guns',
            specialization: { kind: 'same' },
            minimumLevel: 13,
            minimumRelativeLevel: 1,
            minimumPoints: 4,
          },
          { kind: 'trait', name: 'Magery', minimumLevel: 2 },
          { kind: 'attribute', attribute: 'DX', minimum: 12 },
          { kind: 'tech_level', minimum: 7, maximum: 9 },
          { kind: 'campaign_rule', ruleKey: 'magic', expectedValue: true },
          { kind: 'gm_permission', label: 'Trained by a master' },
          {
            kind: 'any',
            children: [
              { kind: 'attribute', attribute: 'IQ', minimum: 15 },
              { kind: 'campaign_rule', ruleKey: 'genre', expectedValue: 'urban' },
            ],
          },
        ],
      },
      context,
    );
    expect(result.truth).toBe('met');
    expect(failedPrerequisiteMessages(result)).toEqual([]);
  });

  it('reports unmet leaves and preserves unknown GM/campaign gates', () => {
    const unmet = evaluateSkillPrerequisite(
      { kind: 'skill', name: 'Physics', minimumPoints: 2 },
      context,
    );
    expect(unmet.truth).toBe('unmet');
    expect(failedPrerequisiteMessages(unmet)).toEqual(['Physics at 2 points']);
    expect(
      evaluateSkillPrerequisite({ kind: 'campaign_rule', ruleKey: 'secret_setting_flag' }, context)
        .truth,
    ).toBe('unknown');
  });
});

describe('conditional defaults', () => {
  const conditions = [
    { kind: 'task' as const, task: 'on foot' },
    { kind: 'campaign_rule' as const, rule: 'magic', value: true },
    { kind: 'same_specialization_dimension' as const, dimension: 'planet' },
    { kind: 'character_fact' as const, fact: 'lived_here' },
  ];

  it('only proves a default when every required input is true', () => {
    expect(
      conditionsProven(conditions, {
        task: 'On Foot',
        campaignRules: { magic: true },
        specializationDimensions: { planet: true },
        characterFacts: new Set(['lived_here']),
      }),
    ).toBe(true);
    expect(conditionsProven(conditions, {})).toBe(false);
    expect(
      evaluateSkillDefaultConditions(conditions, {}).every((item) => item.truth === 'unknown'),
    ).toBe(true);
  });
});

describe('Tech Level skill rules', () => {
  it('resolves fixed and required policies without treating null as ambient TL', () => {
    expect(resolvedTechLevel({ kind: 'fixed', techLevel: 6 }, null)).toBe(6);
    expect(
      resolvedTechLevel({ kind: 'required', suggestedFrom: 'campaign' }, null, { campaign: 8 }),
    ).toBe(8);
    expect(() => resolvedTechLevel({ kind: 'required', suggestedFrom: 'none' }, null)).toThrow(
      'concrete Tech Level',
    );
  });

  it('applies the asymmetric IQ table and -1 per TL for other skills', () => {
    expect(crossTechLevelPenalty('IQ', 8, 9)).toBe(-5);
    expect(crossTechLevelPenalty('IQ', 8, 10)).toBe(-10);
    expect(crossTechLevelPenalty('IQ', 8, 11)).toBe(-15);
    expect(crossTechLevelPenalty('IQ', 8, 12)).toBeNull();
    expect(crossTechLevelPenalty('IQ', 8, 7)).toBe(-1);
    expect(crossTechLevelPenalty('IQ', 8, 6)).toBe(-3);
    expect(crossTechLevelPenalty('IQ', 8, 4)).toBe(-7);
    expect(crossTechLevelPenalty('IQ', 8, 3)).toBe(-9);
    expect(crossTechLevelPenalty('DX', 8, 11)).toBe(-3);
  });
});
