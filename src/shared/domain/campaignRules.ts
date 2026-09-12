import {
  type CampaignHouseRules,
  type HouseRuleSet,
  campaignHouseRules,
} from '../schemas/campaign.ts';

export type HouseRuleKey = Exclude<keyof CampaignHouseRules, 'ruleSet'>;

export interface HouseRuleDefinition {
  key: HouseRuleKey;
  label: string;
  description: string;
  group: 'General' | 'Combat' | 'Magic' | 'Path magic' | 'Campaign content';
}

export const HOUSE_RULE_DEFINITIONS: readonly HouseRuleDefinition[] = [
  {
    key: 'protectNaturalDr',
    label: 'Armor penetration leaves natural DR intact',
    description:
      'Armor-piercing divisors and Ignore DR reduce worn armor only; innate and skull DR remain intact. Fractional divisors below 1 still increase all DR.',
    group: 'Combat',
  },
  {
    key: 'enchantedItemPricing',
    label: 'J Talisar enchanted-item pricing',
    description:
      'Estimate enchanted-item cost with Quick and Dirty Enchantment using TL4 powerstones, normally adding about 20% markup (sometimes as little as 10%).',
    group: 'General',
  },
  {
    key: 'eyeMissHitsFace',
    label: 'Eye misses by 1 hit the face',
    description:
      'A targeted eye attack that misses by exactly 1 strikes the face instead of the torso.',
    group: 'Combat',
  },
  {
    key: 'requireMagicAdvancementRites',
    label: 'Magic advantages require advancement rites',
    description:
      'Increasing Magery or Path Adept requires an appropriate skill roll and rite; Power Investiture advances only at the deity’s discretion.',
    group: 'Magic',
  },
  {
    key: 'mediumMaterialSpiritLimits',
    label: 'Medium senses only incorporeal spirits directly',
    description:
      'Medium detects incorporeal or possessing spirits normally, but recognizes a material spirit only after perceiving it normally and succeeding at an IQ roll.',
    group: 'General',
  },
  {
    key: 'shieldDamageOnDbBlock',
    label: 'Shields take damage only on a DB-assisted Block',
    description:
      'A Block made by skill protects the shield; the shield takes damage when its Defense Bonus is needed for success.',
    group: 'Combat',
  },
  {
    key: 'braverySpellRewrite',
    label: 'Use the J Talisar Bravery spell',
    description:
      'Bravery grants Unfazeable, imposes or worsens Overconfidence, interacts mutually with Fear and Panic, lasts one hour, costs 2, and cannot be maintained.',
    group: 'Magic',
  },
  {
    key: 'highestDeflectOnly',
    label: 'Only the highest layered Deflect applies',
    description: 'When several armor layers have Deflect, apply only the largest defense bonus.',
    group: 'Magic',
  },
  {
    key: 'highestFortifyOnly',
    label: 'Only the highest layered Fortify applies',
    description: 'When several armor layers have Fortify, add only the largest Fortify DR bonus.',
    group: 'Magic',
  },
  {
    key: 'forbidDistantBlow',
    label: 'Distant Blow is forbidden',
    description: 'The Distant Blow spell does not exist and may not be learned in the campaign.',
    group: 'Magic',
  },
  {
    key: 'forbidAcidMagic',
    label: 'Acid magic is forbidden',
    description:
      'Acid spells do not exist and may not be learned; nonmagical acid attacks remain possible.',
    group: 'Magic',
  },
  {
    key: 'requireSpellIngredients',
    label: 'Spells at skill 18 or less require ingredients',
    description:
      'Require one ingredient per prerequisite; each missing ingredient gives −1 to casting skill. Ingredients need not be unique unless specified.',
    group: 'Magic',
  },
  {
    key: 'hideThoughtsInterpretation',
    label: 'Use the J Talisar Hide Thoughts interpretation',
    description:
      'Hide Thoughts counters mind-reading and the campaign’s enumerated thought-control effects, but not general emotional or bodily control.',
    group: 'Magic',
  },
  {
    key: 'sunboltBurningDamage',
    label: 'Sunbolt deals burning damage',
    description:
      'Apply the published Magic erratum: Sunbolt deals burning rather than impaling damage.',
    group: 'Magic',
  },
  {
    key: 'pathAdeptLocksSubject',
    label: 'Fast Path casting locks its declared subject',
    description:
      'Once a Path Adept begins a reduced-time casting, its declared subject cannot be changed without starting over.',
    group: 'Path magic',
  },
  {
    key: 'curseRitualExpandedTargets',
    label: 'Curse Sanctum and Curse Mirror affect spell curses',
    description:
      'Use the campaign’s expanded list of Magery and clerical transformations, curses, possessions, shapeshifts, and hostile Wishes.',
    group: 'Path magic',
  },
  {
    key: 'dispelRitualCrossTradition',
    label: 'Dispel Ritual crosses magical traditions',
    description:
      'Dispel Ritual can target Magery, clerical, and Path magic; each distinct effect counts as a separate target.',
    group: 'Path magic',
  },
  {
    key: 'mysticSymbolsAsAdvantages',
    label: 'Mystic Symbols are personal advantages',
    description:
      'Model a Mystic Symbol as a personal 5-point-per-+1 advantage (maximum +5), normally with Breakable and Can Be Stolen.',
    group: 'Path magic',
  },
  {
    key: 'pathCharmsSingleUse',
    label: 'Path charms are single-use and retain original duration',
    description:
      'A non-Fetish charm is spent after activation; conditional activation does not restart its original duration.',
    group: 'Path magic',
  },
  {
    key: 'shieldReadyTimeByDb',
    label: 'Ready or remove a shield in seconds equal to DB',
    description:
      'Use the Low-Tech timing rule: readying or removing a shield takes seconds equal to its Defense Bonus.',
    group: 'Combat',
  },
  {
    key: 'allowJtSupplementalPerks',
    label: 'Allow the J Talisar supplemental perks',
    description:
      'Allow Blocking Spell Mastery, Combat Casting, Combat Vaulting, Pack Tactics, Quick Reload, Rage Control, and Shape Mastery.',
    group: 'Campaign content',
  },
] as const;

const falseRules = Object.fromEntries(
  HOUSE_RULE_DEFINITIONS.map(({ key }) => [key, false]),
) as Record<HouseRuleKey, boolean>;

export const HOUSE_RULE_SET_VALUES: Readonly<Record<'none' | 'j_talisar', CampaignHouseRules>> = {
  none: campaignHouseRules.parse({ ...falseRules, ruleSet: 'none' }),
  j_talisar: campaignHouseRules.parse(
    Object.fromEntries([
      ['ruleSet', 'j_talisar'],
      ...HOUSE_RULE_DEFINITIONS.map(({ key }) => [key, true]),
    ]),
  ),
};

export function applyHouseRuleSet(
  current: CampaignHouseRules,
  nextSet: HouseRuleSet,
): CampaignHouseRules {
  const normalized = campaignHouseRules.parse(current);
  if (nextSet === 'custom') return { ...normalized, ruleSet: 'custom' };
  return { ...HOUSE_RULE_SET_VALUES[nextSet] };
}

export function customizeHouseRule(
  current: CampaignHouseRules,
  key: HouseRuleKey,
  enabled: boolean,
): CampaignHouseRules {
  return { ...campaignHouseRules.parse(current), ruleSet: 'custom', [key]: enabled };
}
