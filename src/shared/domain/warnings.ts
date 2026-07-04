/**
 * Data-driven warning registry.  Each rule inspects a CharacterSummary and
 * returns zero or more Warning objects.  Rules never block writes — the
 * UI surfaces them as dismissable banners.
 *
 * Warning codes are stable: characters persist a list of dismissed codes,
 * so renaming a code requires a migration.
 */

import type { PointBreakdown } from './characterCalc.ts';
import type { EncumbranceResult } from './encumbrance.ts';

export type WarningSeverity = 'warn' | 'note';

export interface Warning {
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly message: string;
}

export interface CampaignCaps {
  readonly pointTarget: number | null;
  readonly disadvantageCap: number | null;
  readonly quirkCap: number | null;
}

export interface WarningInput {
  readonly attrs: {
    st: number;
    dx: number;
    iq: number;
    ht: number;
    hpMod: number;
    fpMod: number;
  };
  readonly points: PointBreakdown;
  readonly encumbrance: EncumbranceResult;
  readonly campaign: CampaignCaps;
}

interface Rule {
  readonly code: string;
  readonly evaluate: (input: WarningInput) => Warning | null;
}

const RULES: Rule[] = [];

function rule(code: string, evaluate: Rule['evaluate']): void {
  RULES.push({ code, evaluate });
}

function attrRule(attrName: 'st' | 'dx' | 'iq' | 'ht', display: 'ST' | 'DX' | 'IQ' | 'HT'): void {
  rule(`attr.${attrName}.below_minimum`, ({ attrs }) =>
    attrs[attrName] < 1
      ? {
          code: `attr.${attrName}.below_minimum`,
          severity: 'warn',
          message: `${display} is below the published minimum (1).`,
        }
      : null,
  );
  rule(`attr.${attrName}.very_high`, ({ attrs }) =>
    attrs[attrName] > 20
      ? {
          code: `attr.${attrName}.very_high`,
          severity: 'note',
          message: `${display} is unusually high (>20). Confirm this is intended.`,
        }
      : null,
  );
}

attrRule('st', 'ST');
attrRule('dx', 'DX');
attrRule('iq', 'IQ');
attrRule('ht', 'HT');

rule('encumbrance.heavy', ({ encumbrance }) =>
  encumbrance.level === 3
    ? {
        code: 'encumbrance.heavy',
        severity: 'warn',
        message: 'Carrying Heavy encumbrance — Move and Dodge are reduced.',
      }
    : null,
);

rule('encumbrance.x-heavy', ({ encumbrance }) =>
  encumbrance.level === 4
    ? {
        code: 'encumbrance.x-heavy',
        severity: 'warn',
        message: 'Carrying X-Heavy encumbrance — significant Move and Dodge penalties.',
      }
    : null,
);

rule('encumbrance.over_carry_cap', ({ encumbrance }) =>
  encumbrance.ratio > 10
    ? {
        code: 'encumbrance.over_carry_cap',
        severity: 'warn',
        message:
          'Carried weight exceeds 10× Basic Lift — beyond the X-Heavy carry limit, the character cannot move (B17).',
      }
    : null,
);

// HP may be adjusted by no more than ±30% of ST, and FP by no more
// than ±30% of HT (B16-17).  Warn, don't block, per app philosophy.
rule('hp.mod_out_of_range', ({ attrs }) => {
  const cap = Math.floor(attrs.st * 0.3);
  return Math.abs(attrs.hpMod) > cap
    ? {
        code: 'hp.mod_out_of_range',
        severity: 'warn',
        message: `HP modifier of ${attrs.hpMod > 0 ? '+' : ''}${attrs.hpMod} exceeds ±30% of ST (±${cap}) allowed by B16.`,
      }
    : null;
});

rule('fp.mod_out_of_range', ({ attrs }) => {
  const cap = Math.floor(attrs.ht * 0.3);
  return Math.abs(attrs.fpMod) > cap
    ? {
        code: 'fp.mod_out_of_range',
        severity: 'warn',
        message: `FP modifier of ${attrs.fpMod > 0 ? '+' : ''}${attrs.fpMod} exceeds ±30% of HT (±${cap}) allowed by B16.`,
      }
    : null;
});

rule('disadvantages.over_cap', ({ points, campaign }) => {
  const cap = campaign.disadvantageCap;
  if (cap === null) return null;
  // Disadvantage points are stored negative; -150 < cap=-50 means we are over.
  if (points.disadvantages < -cap) {
    return {
      code: 'disadvantages.over_cap',
      severity: 'warn',
      message: `Disadvantages total ${-points.disadvantages} pts, exceeding cap of ${cap}.`,
    };
  }
  return null;
});

rule('quirks.over_cap', ({ points, campaign }) => {
  const cap = campaign.quirkCap ?? 5;
  // Quirks are stored as negative points.  RAW quirks are -1 apiece
  // (B162), so a cap of 5 quirks is a cap of -5 points — comparing
  // points (not row count) stays correct even if someone records a
  // non-standard quirk value.
  const quirkPoints = -points.quirks;
  if (quirkPoints > cap) {
    return {
      code: 'quirks.over_cap',
      severity: 'warn',
      message: `${quirkPoints} points of quirks exceed the campaign cap of ${cap}.`,
    };
  }
  return null;
});

rule('points.over_target', ({ points, campaign }) => {
  if (campaign.pointTarget === null) return null;
  if (points.total > campaign.pointTarget) {
    return {
      code: 'points.over_target',
      severity: 'warn',
      message: `${points.total} pts spent, ${points.total - campaign.pointTarget} over target.`,
    };
  }
  return null;
});

rule('points.under_target', ({ points, campaign }) => {
  if (campaign.pointTarget === null) return null;
  if (points.total < campaign.pointTarget) {
    return {
      code: 'points.under_target',
      severity: 'note',
      message: `${campaign.pointTarget - points.total} pts unspent.`,
    };
  }
  return null;
});

export function evaluateWarnings(
  input: WarningInput,
  dismissed: ReadonlySet<string> = new Set(),
): Warning[] {
  const out: Warning[] = [];
  for (const r of RULES) {
    if (dismissed.has(r.code)) continue;
    const warning = r.evaluate(input);
    if (warning) out.push(warning);
  }
  return out;
}

export function listWarningCodes(): string[] {
  return RULES.map((r) => r.code);
}
