import { describe, expect, it } from 'bun:test';
import {
  blockFromSkill,
  effectiveDodge,
  matchSkillForWeapon,
  parryFromSkill,
  parseParryString,
} from './defenseCalc.ts';

describe('effectiveDodge', () => {
  it('adds the (non-positive) encumbrance penalty', () => {
    expect(effectiveDodge(9, -2)).toBe(7);
    expect(effectiveDodge(9, 0)).toBe(9);
  });

  it('does not floor at 1 — RAW has no min-1 rule for encumbered Dodge', () => {
    expect(effectiveDodge(2, -4)).toBe(-2);
    expect(effectiveDodge(1, -1)).toBe(0);
    expect(effectiveDodge(3, -3)).toBe(0);
  });
});

describe('parryFromSkill', () => {
  it('computes floor(skill/2) + 3 + weapon mod', () => {
    expect(parryFromSkill(14, 0)).toBe(10);
    expect(parryFromSkill(15, 1)).toBe(11);
  });

  it('floors an odd skill level', () => {
    expect(parryFromSkill(13, 0)).toBe(9);
  });

  it('applies a negative weapon parry modifier', () => {
    expect(parryFromSkill(16, -1)).toBe(10);
  });
});

describe('blockFromSkill', () => {
  it('computes floor(skill/2) + 3', () => {
    expect(blockFromSkill(12)).toBe(9);
    expect(blockFromSkill(13)).toBe(9);
    expect(blockFromSkill(14)).toBe(10);
  });
});

describe('parseParryString', () => {
  it('parses a bare zero', () => {
    expect(parseParryString('0')).toEqual({ mod: 0 });
  });

  it('parses signed modifiers', () => {
    expect(parseParryString('-1')).toEqual({ mod: -1 });
    expect(parseParryString('+2')).toEqual({ mod: 2 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseParryString('  3 ')).toEqual({ mod: 3 });
  });

  it('returns null for "No" (cannot parry)', () => {
    expect(parseParryString('No')).toBeNull();
    expect(parseParryString('no')).toBeNull();
  });

  it('returns null for "U" (unbalanced-only notation)', () => {
    expect(parseParryString('U')).toBeNull();
  });

  it('returns null for trailing-letter forms like "0F" / "0U"', () => {
    expect(parseParryString('0F')).toBeNull();
    expect(parseParryString('0U')).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(parseParryString('')).toBeNull();
    expect(parseParryString(null)).toBeNull();
    expect(parseParryString(undefined)).toBeNull();
  });
});

describe('matchSkillForWeapon', () => {
  it('matches an exact (case-insensitive) skill name', () => {
    const skills = [{ name: 'Broadsword', level: 14 }];
    expect(matchSkillForWeapon('broadsword', skills)).toEqual({ name: 'Broadsword', level: 14 });
  });

  it('matches by substring when the weapon name contains the skill name', () => {
    const skills = [{ name: 'Broadsword', level: 12 }];
    expect(matchSkillForWeapon('Fine Broadsword', skills)).toEqual({
      name: 'Broadsword',
      level: 12,
    });
  });

  it('matches by substring when the skill name contains the weapon name', () => {
    const skills = [{ name: 'Two-Handed Sword', level: 10 }];
    expect(matchSkillForWeapon('Sword', skills)).toEqual({
      name: 'Two-Handed Sword',
      level: 10,
    });
  });

  it('skips skills with a null level', () => {
    // A null-level "Rapier" (unusable/no default) must not shadow a usable
    // one of the same name.
    const skills = [
      { name: 'Rapier', level: null },
      { name: 'Rapier', level: 9 },
    ];
    expect(matchSkillForWeapon('Rapier', skills)).toEqual({ name: 'Rapier', level: 9 });
  });

  it('breaks ties by highest level among multiple substring matches', () => {
    const skills = [
      { name: 'Sword', level: 12 },
      { name: 'Sword Fighting', level: 15 },
    ];
    expect(matchSkillForWeapon('Big Sword Fighting', skills)).toEqual({
      name: 'Sword Fighting',
      level: 15,
    });
  });

  it('breaks equal-level ties alphabetically for a deterministic result', () => {
    // Both "Long" and "Sword" substring-match "Long Sword" at the same level;
    // the alphabetically-first name must win consistently.
    const skills = [
      { name: 'Sword', level: 10 },
      { name: 'Long', level: 10 },
    ];
    expect(matchSkillForWeapon('Long Sword', skills)).toEqual({ name: 'Long', level: 10 });
  });

  it("returns null for 'Katana' against only 'Broadsword'", () => {
    const skills = [{ name: 'Broadsword', level: 14 }];
    expect(matchSkillForWeapon('Katana', skills)).toBeNull();
  });

  it('returns null when no skills are provided', () => {
    expect(matchSkillForWeapon('Broadsword', [])).toBeNull();
  });
});
