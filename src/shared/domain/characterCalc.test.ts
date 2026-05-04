import { describe, expect, it } from 'bun:test';
import {
  type CharacterAttrs,
  computeAttributePoints,
  computeDerived,
  computePointBreakdown,
  computeSecondaryPoints,
} from './characterCalc.ts';

const baseAttrs: CharacterAttrs = {
  st: 10,
  dx: 10,
  iq: 10,
  ht: 10,
  hpMod: 0,
  willMod: 0,
  perMod: 0,
  fpMod: 0,
  speedQuarterMod: 0,
  moveMod: 0,
  tempSt: 0,
  tempDx: 0,
  tempIq: 0,
  tempHt: 0,
  tempHpMod: 0,
  tempWillMod: 0,
  tempPerMod: 0,
  tempFpMod: 0,
  tempSpeedQuarterMod: 0,
  tempMoveMod: 0,
};

describe('computeDerived', () => {
  it('produces canonical values for an unmodified ST10/DX10/IQ10/HT10 character', () => {
    const d = computeDerived(baseAttrs);
    expect(d.hp).toBe(10);
    expect(d.will).toBe(10);
    expect(d.per).toBe(10);
    expect(d.fp).toBe(10);
    expect(d.basicSpeedQuarters).toBe(20); // (10+10)
    expect(d.basicSpeed).toBe(5);
    expect(d.basicMove).toBe(5);
    expect(d.dodge).toBe(8); // floor(5) + 3
    expect(d.basicLift).toBe(20); // 10*10/5
  });

  it('applies temporary boosts to derived stats only', () => {
    const d = computeDerived({ ...baseAttrs, tempSt: 5, tempDx: 1 });
    expect(d.hp).toBe(15);
    expect(d.basicLift).toBe(45); // 15*15/5
    expect(d.basicSpeedQuarters).toBe(21); // (10+1)+(10) = 21
    expect(d.basicSpeed).toBe(5.25);
    expect(d.basicMove).toBe(5);
    expect(d.dodge).toBe(8);
  });

  it('handles ST=20 / DX=12 / IQ=14 / HT=12 with various mods', () => {
    const d = computeDerived({
      ...baseAttrs,
      st: 20,
      dx: 12,
      iq: 14,
      ht: 12,
      hpMod: 2,
      willMod: 1,
      perMod: -1,
      fpMod: 3,
      speedQuarterMod: 1,
      moveMod: 1,
    });
    expect(d.hp).toBe(22);
    expect(d.will).toBe(15);
    expect(d.per).toBe(13);
    expect(d.fp).toBe(15);
    expect(d.basicSpeedQuarters).toBe(25); // 12+12+1
    expect(d.basicSpeed).toBe(6.25);
    expect(d.basicMove).toBe(7); // floor(6.25)+1
    expect(d.dodge).toBe(9);
    expect(d.basicLift).toBe(80); // 20*20/5
  });

  it('temporary speed mods stack with persistent speed mods', () => {
    const d = computeDerived({
      ...baseAttrs,
      speedQuarterMod: 2,
      tempSpeedQuarterMod: 1,
    });
    expect(d.basicSpeedQuarters).toBe(23);
    expect(d.basicSpeed).toBe(5.75);
  });
});

describe('computeAttributePoints', () => {
  it('charges 0 for default 10/10/10/10', () => {
    expect(computeAttributePoints(baseAttrs)).toBe(0);
  });

  it('ST 12 = 20 pts, DX 12 = 40 pts', () => {
    expect(computeAttributePoints({ ...baseAttrs, st: 12 })).toBe(20);
    expect(computeAttributePoints({ ...baseAttrs, dx: 12 })).toBe(40);
  });

  it('IQ 8 = -40 pts (refund), HT 7 = -30 pts', () => {
    expect(computeAttributePoints({ ...baseAttrs, iq: 8 })).toBe(-40);
    expect(computeAttributePoints({ ...baseAttrs, ht: 7 })).toBe(-30);
  });
});

describe('computeSecondaryPoints', () => {
  it('HP +2 = 4 pts, Will +3 = 15 pts, FP +1 = 3 pts', () => {
    expect(computeSecondaryPoints({ ...baseAttrs, hpMod: 2 })).toBe(4);
    expect(computeSecondaryPoints({ ...baseAttrs, willMod: 3 })).toBe(15);
    expect(computeSecondaryPoints({ ...baseAttrs, fpMod: 1 })).toBe(3);
  });

  it('Speed +0.25 (1 quarter) = 5 pts', () => {
    expect(computeSecondaryPoints({ ...baseAttrs, speedQuarterMod: 1 })).toBe(5);
  });

  it('Move +1 = 5 pts', () => {
    expect(computeSecondaryPoints({ ...baseAttrs, moveMod: 1 })).toBe(5);
  });
});

describe('computePointBreakdown', () => {
  it('aggregates traits and skills into the right buckets', () => {
    const result = computePointBreakdown(
      { ...baseAttrs, st: 12, hpMod: 1 },
      [
        { kind: 'advantage', points: 25 },
        { kind: 'disadvantage', points: -15 },
        { kind: 'quirk', points: -1 },
        { kind: 'quirk', points: -1 },
        { kind: 'perk', points: 1 },
        { kind: 'language', points: 3 },
      ],
      [{ points: 1 }, { points: 4 }, { points: 2 }],
    );
    expect(result.attributes).toBe(20);
    expect(result.secondary).toBe(2);
    expect(result.advantages).toBe(29); // 25 + 1 + 3
    expect(result.disadvantages).toBe(-15);
    expect(result.quirks).toBe(-2);
    expect(result.skills).toBe(7);
    expect(result.total).toBe(20 + 2 + 29 - 15 - 2 + 7);
  });
});
