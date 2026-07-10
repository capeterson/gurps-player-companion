import { describe, expect, it } from 'bun:test';
import type { DamageDice } from '../constants/damage.ts';
import {
  type DamageMode,
  formatDamageDice,
  parseDamageSpec,
  resolveDamage,
} from './damageParse.ts';

/** Render a resolved damage result the way a UI would display it, e.g. "1d-1 cr". */
function displayString(mode: DamageMode, thrust: DamageDice, swing: DamageDice): string {
  const resolved = resolveDamage(mode, thrust, swing);
  if (!resolved) return '';
  const parts = [formatDamageDice(resolved.dice)];
  if (resolved.armorDivisor) parts[0] += `(${resolved.armorDivisor})`;
  if (resolved.type) parts.push(resolved.type);
  return parts.join(' ');
}

describe('parseDamageSpec', () => {
  it('parses "sw+1 cut / thr+1 cr" into two modes', () => {
    const modes = parseDamageSpec('sw+1 cut / thr+1 cr');
    expect(modes).toHaveLength(2);
    expect(modes[0]).toMatchObject({ base: 'sw', adds: 1, type: 'cut', armorDivisor: null });
    expect(modes[1]).toMatchObject({ base: 'thr', adds: 1, type: 'cr', armorDivisor: null });
  });

  it('parses "1d+2 cut" as explicit dice', () => {
    const modes = parseDamageSpec('1d+2 cut');
    expect(modes).toHaveLength(1);
    expect(modes[0]).toMatchObject({
      base: { dice: 1, adds: 2 },
      adds: 0,
      type: 'cut',
      armorDivisor: null,
    });
  });

  it('parses "thr imp" with no add', () => {
    const modes = parseDamageSpec('thr imp');
    expect(modes).toHaveLength(1);
    expect(modes[0]).toMatchObject({ base: 'thr', adds: 0, type: 'imp', armorDivisor: null });
  });

  it('parses "2d(2) pi" with an armor divisor', () => {
    const modes = parseDamageSpec('2d(2) pi');
    expect(modes).toHaveLength(1);
    expect(modes[0]).toMatchObject({
      base: { dice: 2, adds: 0 },
      adds: 0,
      type: 'pi',
      armorDivisor: '2',
    });
  });

  it('parses "sw+2 cut / thr+1 imp"', () => {
    const modes = parseDamageSpec('sw+2 cut / thr+1 imp');
    expect(modes).toHaveLength(2);
    expect(modes[0]).toMatchObject({ base: 'sw', adds: 2, type: 'cut' });
    expect(modes[1]).toMatchObject({ base: 'thr', adds: 1, type: 'imp' });
  });

  it('handles a fractional armor divisor like (0.5)', () => {
    const modes = parseDamageSpec('thr-1 pi-(0.5)');
    expect(modes).toHaveLength(1);
    expect(modes[0]).toMatchObject({ base: 'thr', adds: -1, armorDivisor: '0.5' });
    expect(modes[0]?.type).toBe('pi-');
  });

  it('is case-insensitive on the base token', () => {
    const modes = parseDamageSpec('SW+1 cut');
    expect(modes[0]).toMatchObject({ base: 'sw', adds: 1, type: 'cut' });
  });

  it('allows a mode with no damage type', () => {
    const modes = parseDamageSpec('thr');
    expect(modes[0]).toMatchObject({ base: 'thr', adds: 0, type: null });
  });

  it.each(['special', '', 'see notes', '   '])('returns [] for garbage input %j', (input) => {
    expect(parseDamageSpec(input)).toEqual([]);
  });

  it('drops unparseable modes but keeps parseable siblings', () => {
    const modes = parseDamageSpec('sw+1 cut / special / thr imp');
    expect(modes).toHaveLength(2);
    expect(modes[0]?.base).toBe('sw');
    expect(modes[1]?.base).toBe('thr');
  });

  it('never throws on arbitrary text', () => {
    for (const input of ['???', '1d1d1d', '((()))', 'thr-thr-thr', '/ / /']) {
      expect(() => parseDamageSpec(input)).not.toThrow();
    }
  });
});

describe('resolveDamage + formatDamageDice round trip', () => {
  const thrust: DamageDice = { dice: 1, adds: -2 }; // e.g. ST 9 thrust (B16)
  const swing: DamageDice = { dice: 1, adds: 1 }; // e.g. ST 11 swing (B16)

  it('round-trips "sw+1 cut / thr+1 cr"', () => {
    const modes = parseDamageSpec('sw+1 cut / thr+1 cr');
    expect(displayString(modes[0] as DamageMode, thrust, swing)).toBe('1d+2 cut');
    expect(displayString(modes[1] as DamageMode, thrust, swing)).toBe('1d-1 cr');
  });

  it('round-trips "1d+2 cut" unchanged (explicit dice ignore character stats)', () => {
    const modes = parseDamageSpec('1d+2 cut');
    expect(displayString(modes[0] as DamageMode, thrust, swing)).toBe('1d+2 cut');
  });

  it('round-trips "thr imp"', () => {
    const modes = parseDamageSpec('thr imp');
    expect(displayString(modes[0] as DamageMode, thrust, swing)).toBe('1d-2 imp');
  });

  it('round-trips "2d(2) pi" carrying the armor divisor through', () => {
    const modes = parseDamageSpec('2d(2) pi');
    expect(displayString(modes[0] as DamageMode, thrust, swing)).toBe('2d(2) pi');
  });

  it('round-trips "sw+2 cut / thr+1 imp"', () => {
    const modes = parseDamageSpec('sw+2 cut / thr+1 imp');
    expect(displayString(modes[0] as DamageMode, thrust, swing)).toBe('1d+3 cut');
    expect(displayString(modes[1] as DamageMode, thrust, swing)).toBe('1d-1 imp');
  });

  it('returns null only for a base that cannot resolve', () => {
    // Cast to simulate a corrupt/unexpected base; every mode parseDamageSpec
    // produces is always resolvable.
    const badMode = {
      base: null as unknown as 'thr',
      adds: 0,
      type: null,
      armorDivisor: null,
      raw: 'bad',
    };
    expect(resolveDamage(badMode, thrust, swing)).toBeNull();
  });
});
