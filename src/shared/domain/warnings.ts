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
  readonly attrs: { st: number; dx: number; iq: number; ht: number };
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
  // Quirks are stored as negative.  A character with 6 quirks has
  // points.quirks = -6.  Cap is 5 → over when -points.quirks > cap.
  const quirkCount = -points.quirks;
  if (quirkCount > cap) {
    return {
      code: 'quirks.over_cap',
      severity: 'warn',
      message: `${quirkCount} quirks exceed the campaign cap of ${cap}.`,
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
