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

  it('temp ST/DX boost Basic Lift, effective ST, and Basic Speed, but never HP (B419/M37)', () => {
    const d = computeDerived({ ...baseAttrs, tempSt: 5, tempDx: 1 });
    // Temp ST is exactly what a Might-type boost affects: Basic Lift,
    // thrust/swing damage, and effectiveSt. It must NOT cascade into HP.
    expect(d.hp).toBe(10); // base ST (10), unaffected by tempSt
    expect(d.effectiveSt).toBe(15);
    expect(d.basicLift).toBe(45); // 15*15/5
    expect(d.basicSpeedQuarters).toBe(21); // (10+1)+(10) = 21
    expect(d.basicSpeed).toBe(5.25);
    expect(d.basicMove).toBe(5);
    expect(d.dodge).toBe(8);
  });

  it('temp HT boosts Basic Speed but never FP', () => {
    const d = computeDerived({ ...baseAttrs, tempHt: 4 });
    expect(d.fp).toBe(10); // base HT (10), unaffected by tempHt
    expect(d.effectiveHt).toBe(14);
    expect(d.basicSpeedQuarters).toBe(24); // 10 + (10+4)
  });

  it('tempHpMod/tempFpMod (the dedicated temp-boost fields) do change HP/FP', () => {
    const d = computeDerived({ ...baseAttrs, tempHpMod: 3, tempFpMod: -2 });
    expect(d.hp).toBe(13);
    expect(d.fp).toBe(8);
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

  it('rounds Basic Lift to the nearest whole number when BL >= 10 (B15)', () => {
    // ST 11 → 121/5 = 24.2 → 24
    expect(computeDerived({ ...baseAttrs, st: 11 }).basicLift).toBe(24);
    // ST 13 → 169/5 = 33.8 → 34
    expect(computeDerived({ ...baseAttrs, st: 13 }).basicLift).toBe(34);
    // ST 6 → 36/5 = 7.2 stays fractional (BL < 10 keeps the fraction)
    expect(computeDerived({ ...baseAttrs, st: 6 }).basicLift).toBeCloseTo(7.2);
  });

  it('derives basic thrust/swing damage from ST (B16)', () => {
    const st10 = computeDerived(baseAttrs);
    expect(st10.thrust).toBe('1d-2');
    expect(st10.swing).toBe('1d');
    const st13 = computeDerived({ ...baseAttrs, st: 13 });
    expect(st13.thrust).toBe('1d');
    expect(st13.swing).toBe('2d-1');
    // Temp ST boosts shift damage too.
    const st15 = computeDerived({ ...baseAttrs, tempSt: 5 });
    expect(st15.thrust).toBe('1d+1');
    expect(st15.swing).toBe('2d+1');
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
