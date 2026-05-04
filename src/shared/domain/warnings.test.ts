import { describe, expect, it } from 'bun:test';
import { evaluateWarnings, listWarningCodes } from './warnings.ts';
import type { CampaignCaps } from './warnings.ts';

const noCaps: CampaignCaps = {
  pointTarget: null,
  disadvantageCap: null,
  quirkCap: null,
};

const okPoints = {
  attributes: 0,
  secondary: 0,
  advantages: 0,
  disadvantages: 0,
  quirks: 0,
  skills: 0,
  total: 0,
} as const;

const okEnc = {
  level: 0 as const,
  label: 'None' as const,
  speedDivisor: 1,
  dodgePenalty: 0,
  playerWeightLbs: 0,
  basicLift: 20,
  ratio: 0,
};

describe('listWarningCodes', () => {
  it('contains stable codes', () => {
    const codes = listWarningCodes();
    expect(codes).toContain('attr.st.below_minimum');
    expect(codes).toContain('attr.dx.very_high');
    expect(codes).toContain('encumbrance.heavy');
    expect(codes).toContain('encumbrance.x-heavy');
    expect(codes).toContain('disadvantages.over_cap');
    expect(codes).toContain('quirks.over_cap');
    expect(codes).toContain('points.over_target');
    expect(codes).toContain('points.under_target');
  });
});

describe('evaluateWarnings', () => {
  it('emits no warnings for a typical character with no campaign caps', () => {
    expect(
      evaluateWarnings({
        attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
        points: okPoints,
        encumbrance: okEnc,
        campaign: noCaps,
      }),
    ).toEqual([]);
  });

  it('warns on ST below 1', () => {
    const ws = evaluateWarnings({
      attrs: { st: 0, dx: 10, iq: 10, ht: 10 },
      points: okPoints,
      encumbrance: okEnc,
      campaign: noCaps,
    });
    expect(ws.find((w) => w.code === 'attr.st.below_minimum')).toBeDefined();
  });

  it('notes IQ above 20', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 21, ht: 10 },
      points: okPoints,
      encumbrance: okEnc,
      campaign: noCaps,
    });
    const warning = ws.find((w) => w.code === 'attr.iq.very_high');
    expect(warning?.severity).toBe('note');
  });

  it('warns when encumbrance level is Heavy', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
      points: okPoints,
      encumbrance: { ...okEnc, level: 3, label: 'Heavy', speedDivisor: 2, dodgePenalty: -3 },
      campaign: noCaps,
    });
    expect(ws.find((w) => w.code === 'encumbrance.heavy')).toBeDefined();
  });

  it('warns when total points exceed campaign target', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
      points: { ...okPoints, total: 175 },
      encumbrance: okEnc,
      campaign: { ...noCaps, pointTarget: 150 },
    });
    expect(ws.find((w) => w.code === 'points.over_target')).toBeDefined();
  });

  it('notes when total points are under target', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
      points: { ...okPoints, total: 120 },
      encumbrance: okEnc,
      campaign: { ...noCaps, pointTarget: 150 },
    });
    expect(ws.find((w) => w.code === 'points.under_target')?.severity).toBe('note');
  });

  it('warns when quirks exceed default cap of 5', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
      points: { ...okPoints, quirks: -6 },
      encumbrance: okEnc,
      campaign: noCaps,
    });
    expect(ws.find((w) => w.code === 'quirks.over_cap')).toBeDefined();
  });

  it('warns when disadvantage cap is exceeded', () => {
    const ws = evaluateWarnings({
      attrs: { st: 10, dx: 10, iq: 10, ht: 10 },
      points: { ...okPoints, disadvantages: -75 },
      encumbrance: okEnc,
      campaign: { ...noCaps, disadvantageCap: 50 },
    });
    expect(ws.find((w) => w.code === 'disadvantages.over_cap')).toBeDefined();
  });

  it('skips dismissed codes', () => {
    const ws = evaluateWarnings(
      {
        attrs: { st: 0, dx: 10, iq: 10, ht: 10 },
        points: okPoints,
        encumbrance: okEnc,
        campaign: noCaps,
      },
      new Set(['attr.st.below_minimum']),
    );
    expect(ws.find((w) => w.code === 'attr.st.below_minimum')).toBeUndefined();
  });
});
