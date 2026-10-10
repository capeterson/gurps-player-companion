import { describe, expect, it } from 'vitest';
import { campaignHouseRules } from '../schemas/campaign.ts';
import {
  HOUSE_RULE_DEFINITIONS,
  HOUSE_RULE_SET_VALUES,
  applyHouseRuleSet,
  customizeHouseRule,
  isNumberHouseRule,
} from './campaignRules.ts';

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
