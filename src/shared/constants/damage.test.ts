import { describe, expect, it } from 'bun:test';
import { damageForSt, formatDamageDice } from './damage.ts';

const fmt = (st: number) => {
  const d = damageForSt(st);
  return `${formatDamageDice(d.thrust)}/${formatDamageDice(d.swing)}`;
};

describe('damageForSt', () => {
  it('matches the B16 table at the canonical anchor rows', () => {
    expect(fmt(1)).toBe('1d-6/1d-5');
    expect(fmt(5)).toBe('1d-4/1d-3');
    expect(fmt(9)).toBe('1d-2/1d-1');
    expect(fmt(10)).toBe('1d-2/1d');
    expect(fmt(11)).toBe('1d-1/1d+1');
    expect(fmt(13)).toBe('1d/2d-1');
    expect(fmt(14)).toBe('1d/2d');
    expect(fmt(17)).toBe('1d+2/3d-1');
    expect(fmt(20)).toBe('2d-1/3d+2');
    expect(fmt(27)).toBe('3d-1/5d+1');
    expect(fmt(40)).toBe('4d+1/7d-1');
  });

  it('uses the published 5-point steps above ST 40', () => {
    expect(fmt(45)).toBe('5d/7d+1');
    expect(fmt(50)).toBe('5d+2/8d-1');
    expect(fmt(70)).toBe('8d/10d');
    expect(fmt(100)).toBe('11d/13d');
    // Between steps, the next lower row applies.
    expect(fmt(44)).toBe('4d+1/7d-1'); // ST 40 row
    expect(fmt(47)).toBe('5d/7d+1'); // ST 45 row
  });

  it('adds 1d per full 10 ST above 100 (B16)', () => {
    expect(fmt(110)).toBe('12d/14d');
    expect(fmt(125)).toBe('13d/15d');
  });

  it('clamps ST below 1 to the ST 1 row', () => {
    expect(fmt(0)).toBe('1d-6/1d-5');
    expect(fmt(-3)).toBe('1d-6/1d-5');
  });
});
