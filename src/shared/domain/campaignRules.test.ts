import { describe, expect, it } from 'vitest';
import { campaignHouseRules } from '../schemas/campaign.ts';
import {
  HOUSE_RULE_DEFINITIONS,
  HOUSE_RULE_SET_VALUES,
  applyHouseRuleSet,
  convertsDamageAddsToDice,
  customizeHouseRule,
  isNumberHouseRule,
  normalizeHouseRuleSettings,
  projectCampaignRulesForEvaluation,
} from './campaignRules.ts';
import { evaluateSkillDefaultConditions, evaluateSkillPrerequisite } from './skillRules.ts';

describe('campaign house-rule sets', () => {
  it('loads every J Talisar option without affecting the separate attribute-cap rule', () => {
    const selected = applyHouseRuleSet(campaignHouseRules.parse({}), 'j_talisar');
    expect(selected.ruleSet).toBe('j_talisar');
    expect(selected).toEqual(HOUSE_RULE_SET_VALUES.j_talisar);
    for (const rule of HOUSE_RULE_DEFINITIONS)
      if (!isNumberHouseRule(rule) && rule.jTalisar === undefined)
        expect(selected[rule.key]).toBe(true);
    expect(selected.armorLayeringLimits).toBe(false);
    expect(selected.armorLayeringDxPenalty).toBe(false);
    expect(selected.limitationCapPercent).toBe(80);
    expect('enforceAttributeCaps' in selected).toBe(false);
  });

  it('keeps the published armor layering and limitation rules in the None set', () => {
    const selected = applyHouseRuleSet(HOUSE_RULE_SET_VALUES.j_talisar, 'none');
    expect(selected.armorLayeringLimits).toBe(true);
    expect(selected.armorLayeringDxPenalty).toBe(true);
    expect(selected.limitationCapPercent).toBe(80);
    expect(selected.protectNaturalDr).toBe(false);
    expect(selected.forbidAcidMagic).toBe(false);
    const legacy = campaignHouseRules.parse({});
    expect(legacy.armorLayeringLimits).toBe(true);
    expect(legacy.armorLayeringDxPenalty).toBe(true);
    expect(legacy.limitationCapPercent).toBe(80);
  });

  it('accepts limitation caps from 0% to 100% only', () => {
    expect(campaignHouseRules.parse({ limitationCapPercent: 0 }).limitationCapPercent).toBe(0);
    expect(campaignHouseRules.parse({ limitationCapPercent: 100 }).limitationCapPercent).toBe(100);
    expect(campaignHouseRules.safeParse({ limitationCapPercent: -1 }).success).toBe(false);
    expect(campaignHouseRules.safeParse({ limitationCapPercent: 101 }).success).toBe(false);
    expect(campaignHouseRules.safeParse({ limitationCapPercent: 50.5 }).success).toBe(false);
    const custom = customizeHouseRule(HOUSE_RULE_SET_VALUES.none, 'limitationCapPercent', 50);
    expect(custom).toEqual({
      ...HOUSE_RULE_SET_VALUES.none,
      ruleSet: 'custom',
      limitationCapPercent: 50,
    });
  });

  it('switches a named set to Custom without clearing any selected options', () => {
    const selected = HOUSE_RULE_SET_VALUES.j_talisar;
    const custom = applyHouseRuleSet(selected, 'custom');
    expect(custom).toEqual({ ...selected, ruleSet: 'custom' });
  });

  it('customizing one option preserves every sibling option', () => {
    const selected = HOUSE_RULE_SET_VALUES.j_talisar;
    const custom = customizeHouseRule(selected, 'forbidAcidMagic', false);
    expect(custom.ruleSet).toBe('custom');
    expect(custom.forbidAcidMagic).toBe(false);
    expect(custom.forbidDistantBlow).toBe(true);
    expect(custom.eyeMissHitsFace).toBe(true);
  });
});

describe('optional damage-adds policy', () => {
  it.each(['none', 'custom', 'j_talisar'] as const)(
    'defaults legacy %s records by ruleset',
    (ruleSet) => {
      const rules = campaignHouseRules.parse({ ruleSet });
      expect(rules.convertDamageAddsToDice).toBeUndefined();
      expect(convertsDamageAddsToDice(rules)).toBe(ruleSet === 'j_talisar');
      for (const value of [false, true]) {
        const explicit = campaignHouseRules.parse({ ruleSet, convertDamageAddsToDice: value });
        expect(convertsDamageAddsToDice(explicit)).toBe(value);
        expect(convertsDamageAddsToDice(normalizeHouseRuleSettings(explicit))).toBe(value);
      }
    },
  );
  it('defaults campaignless and empty legacy settings off', () => {
    expect(convertsDamageAddsToDice()).toBe(false);
    expect(convertsDamageAddsToDice(campaignHouseRules.parse({}))).toBe(false);
  });
  it('keeps an inherited J Talisar value when customizing another option', () => {
    const legacy = campaignHouseRules.parse({ ruleSet: 'j_talisar' });
    expect(convertsDamageAddsToDice(applyHouseRuleSet(legacy, 'custom'))).toBe(true);
    expect(convertsDamageAddsToDice(customizeHouseRule(legacy, 'forbidAcidMagic', false))).toBe(
      true,
    );
  });
});

describe('known campaign evaluation projection', () => {
  it('parses sparse rules without expanding presets, preserving explicit values', () => {
    expect(
      projectCampaignRulesForEvaluation({ ruleSet: 'j_talisar', limitationCapPercent: 0 }),
    ).toMatchObject({
      ruleSet: 'j_talisar',
      limitationCapPercent: 0,
      forbidAcidMagic: false,
      protectNaturalDr: true,
      convertDamageAddsToDice: true,
    });
    expect(
      projectCampaignRulesForEvaluation({
        ruleSet: 'j_talisar',
        convertDamageAddsToDice: false,
        forbidAcidMagic: true,
      }),
    ).toMatchObject({
      convertDamageAddsToDice: false,
      forbidAcidMagic: true,
    });
    const sparse = projectCampaignRulesForEvaluation({});
    expect(sparse).toMatchObject({
      ruleSet: 'custom',
      forbidAcidMagic: false,
      protectNaturalDr: true,
      convertDamageAddsToDice: false,
    });
    expect(
      evaluateSkillPrerequisite(
        { kind: 'campaign_rule', ruleKey: 'missing', expectedValue: false },
        { skills: [], traits: [], attributes: {}, techLevel: null, campaignRules: sparse },
      ).truth,
    ).toBe('unknown');
    expect(
      evaluateSkillDefaultConditions(
        [{ kind: 'campaign_rule', rule: 'forbidAcidMagic', value: false }],
        { campaignRules: sparse },
      )[0]?.truth,
    ).toBe('met');
    expect(
      evaluateSkillDefaultConditions([{ kind: 'campaign_rule', rule: 'missing', value: false }], {
        campaignRules: sparse,
      })[0]?.truth,
    ).toBe('unknown');
    expect('unknownRule' in projectCampaignRulesForEvaluation({})).toBe(false);
    expect(() => projectCampaignRulesForEvaluation({ forbidAcidMagic: 'false' })).toThrow();
    expect(() => projectCampaignRulesForEvaluation({ unknownRule: true })).toThrow();
    expect(() => projectCampaignRulesForEvaluation(null)).toThrow();
  });
});
