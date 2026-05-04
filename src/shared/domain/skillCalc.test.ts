import { describe, expect, it } from 'bun:test';
import { computeDerived, type CharacterAttrs } from './characterCalc.ts';
import { attributeLevelFor, computeSkillLevel, skillOffset } from './skillCalc.ts';

const baseAttrs: CharacterAttrs = {
  st: 10,
  dx: 12,
  iq: 14,
  ht: 11,
  hpMod: 0,
  willMod: 1,
  perMod: -1,
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

describe('skillOffset', () => {
  it('Easy default (0 pts) is base-1 = -1', () => {
    expect(skillOffset('E', 0)).toBe(-1);
  });
  it('Easy 1 pt is +0', () => {
    expect(skillOffset('E', 1)).toBe(0);
  });
  it('Easy 2 pts is +1', () => {
    expect(skillOffset('E', 2)).toBe(1);
  });
  it('Easy 4 pts is +2, Easy 8 pts is +3, Easy 12 pts is +4', () => {
    expect(skillOffset('E', 4)).toBe(2);
    expect(skillOffset('E', 8)).toBe(3);
    expect(skillOffset('E', 12)).toBe(4);
  });
  it('Average 1 pt is -1', () => {
    expect(skillOffset('A', 1)).toBe(-1);
  });
  it('Hard 1 pt is -2', () => {
    expect(skillOffset('H', 1)).toBe(-2);
  });
  it('Very Hard 1 pt is -3, VH 4 pts is -1', () => {
    expect(skillOffset('VH', 1)).toBe(-3);
    expect(skillOffset('VH', 4)).toBe(-1);
  });
  it('VH 16 pts is +2', () => {
    // VH ladder: 1pt → -3, 2-3pt → -2, 4pt → -1, 8pt → 0, 12pt → +1, 16pt → +2.
    expect(skillOffset('VH', 16)).toBe(2);
  });
});

describe('attributeLevelFor', () => {
  const derived = computeDerived(baseAttrs);
  it('uses derived Will/Per for Will/Per skills', () => {
    expect(attributeLevelFor('Will', derived)).toBe(derived.will);
    expect(attributeLevelFor('Per', derived)).toBe(derived.per);
    expect(derived.will).toBe(15);
    expect(derived.per).toBe(13);
  });
  it('uses effective primary attributes', () => {
    expect(attributeLevelFor('DX', derived)).toBe(12);
    expect(attributeLevelFor('IQ', derived)).toBe(14);
  });
  it('Other defaults to 10', () => {
    expect(attributeLevelFor('Other', derived)).toBe(10);
  });
});

describe('computeSkillLevel', () => {
  const derived = computeDerived(baseAttrs);
  it('IQ/Average/4 pts for an IQ 14 character is 15', () => {
    expect(computeSkillLevel('IQ', 'A', 4, derived)).toBe(15);
  });
  it('DX/Hard/1 pt for DX 12 is 10', () => {
    expect(computeSkillLevel('DX', 'H', 1, derived)).toBe(10);
  });
  it('Will/Average/2 pts for Will 15 is 15', () => {
    expect(computeSkillLevel('Will', 'A', 2, derived)).toBe(15);
  });
});
