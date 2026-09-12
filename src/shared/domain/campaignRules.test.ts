import { describe, expect, it } from 'vitest';
import { campaignHouseRules } from '../schemas/campaign.ts';
import {
  HOUSE_RULE_DEFINITIONS,
  HOUSE_RULE_SET_VALUES,
  applyHouseRuleSet,
  customizeHouseRule,
} from './campaignRules.ts';

describe('campaign house-rule sets', () => {
  it('loads every J Talisar option without affecting the separate attribute-cap rule', () => {
    const selected = applyHouseRuleSet(campaignHouseRules.parse({}), 'j_talisar');
    expect(selected.ruleSet).toBe('j_talisar');
    for (const { key } of HOUSE_RULE_DEFINITIONS) expect(selected[key]).toBe(true);
    expect('enforceAttributeCaps' in selected).toBe(false);
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
