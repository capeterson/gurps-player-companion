import { describe, expect, it } from 'bun:test';
import {
  blockFromSkill,
  effectiveDodge,
  matchSkillForWeapon,
  parryFromSkill,
  parseParryString,
  pickShield,
  resolveWeaponSkill,
  skillDisplayName,
  stShortfallPenalty,
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
  const plain = (mod: number) =>
    ({ kind: 'parry', mod, fencing: false, unbalanced: false }) as const;

  it('parses a bare zero', () => {
    expect(parseParryString('0')).toEqual(plain(0));
  });

  it('parses signed modifiers', () => {
    expect(parseParryString('-1')).toEqual(plain(-1));
    expect(parseParryString('+2')).toEqual(plain(2));
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseParryString('  3 ')).toEqual(plain(3));
  });

  it('parses "No" as kind:no (cannot parry)', () => {
    expect(parseParryString('No')).toEqual({ kind: 'no' });
    expect(parseParryString('no')).toEqual({ kind: 'no' });
  });

  it('parses a bare "U" as an unbalanced parry with mod 0', () => {
    expect(parseParryString('U')).toEqual({
      kind: 'parry',
      mod: 0,
      fencing: false,
      unbalanced: true,
    });
  });

  it('parses fencing forms like "0F" / "-1F"', () => {
    expect(parseParryString('0F')).toEqual({
      kind: 'parry',
      mod: 0,
      fencing: true,
      unbalanced: false,
    });
    expect(parseParryString('-1F')).toEqual({
      kind: 'parry',
      mod: -1,
      fencing: true,
      unbalanced: false,
    });
  });

  it('parses unbalanced forms like "0U"', () => {
    expect(parseParryString('0U')).toEqual({
      kind: 'parry',
      mod: 0,
      fencing: false,
      unbalanced: true,
    });
  });

  it('is case-insensitive on the suffix', () => {
    expect(parseParryString('0f')).toEqual({
      kind: 'parry',
      mod: 0,
      fencing: true,
      unbalanced: false,
    });
    expect(parseParryString('u')).toEqual({
      kind: 'parry',
      mod: 0,
      fencing: false,
      unbalanced: true,
    });
  });

  it('returns null for empty, missing, or unparseable input', () => {
    expect(parseParryString('')).toBeNull();
    expect(parseParryString(null)).toBeNull();
    expect(parseParryString(undefined)).toBeNull();
    expect(parseParryString('special')).toBeNull();
    expect(parseParryString('0X')).toBeNull();
  });
});

describe('skillDisplayName', () => {
  it('appends the specialization in parens when present', () => {
    expect(skillDisplayName('Guns', 'Pistol')).toBe('Guns (Pistol)');
  });

  it('trims whitespace-only or blank specialization down to the bare name', () => {
    expect(skillDisplayName('Guns', '')).toBe('Guns');
    expect(skillDisplayName('Guns', '   ')).toBe('Guns');
    expect(skillDisplayName('Guns', null)).toBe('Guns');
    expect(skillDisplayName('Guns', undefined)).toBe('Guns');
  });
});

describe('resolveWeaponSkill', () => {
  const skills = [
    { name: 'Broadsword', level: 14 },
    { name: 'Shortsword', level: 12 },
    { name: 'Katana Drawing', level: 16 },
  ];

  it('binds to a specialization-disambiguated candidate built via skillDisplayName', () => {
    // Two "Guns" rows with different specializations would be indistinguishable
    // if callers fed resolveWeaponSkill the bare skill.name for each — the
    // caller is expected to build candidates with skillDisplayName so the
    // rifle can bind specifically to "Guns (Rifle)" and not the pistol row.
    const gunSkills = [
      { name: skillDisplayName('Guns', 'Pistol'), level: 12 },
      { name: skillDisplayName('Guns', 'Rifle'), level: 15 },
    ];
    expect(resolveWeaponSkill('Hunting Rifle', 'Guns (Rifle)', gunSkills)).toEqual({
      kind: 'matched',
      name: 'Guns (Rifle)',
      level: 15,
      explicit: true,
    });
    expect(resolveWeaponSkill('Derringer', 'Guns (Pistol)', gunSkills)).toEqual({
      kind: 'matched',
      name: 'Guns (Pistol)',
      level: 12,
      explicit: true,
    });
  });

  it('resolves an explicit binding by exact case-insensitive name', () => {
    expect(resolveWeaponSkill('Excalibur', 'broadsword', skills)).toEqual({
      kind: 'matched',
      name: 'Broadsword',
      level: 14,
      explicit: true,
    });
  });

  it('reports missing for an explicit skill not on the sheet — no fuzzy fallback', () => {
    // 'Katana' would substring-match 'Katana Drawing' via the fuzzy path;
    // an explicit binding must NOT take that route.
    expect(resolveWeaponSkill('Katana', 'Katana', skills)).toEqual({
      kind: 'missing',
      skillName: 'Katana',
    });
  });

  it('reports missing when the explicitly bound skill has a null level', () => {
    expect(resolveWeaponSkill('Rapier', 'Rapier', [{ name: 'Rapier', level: null }])).toEqual({
      kind: 'missing',
      skillName: 'Rapier',
    });
  });

  it('falls back to fuzzy matching when no explicit skill is set', () => {
    expect(resolveWeaponSkill('Fine Broadsword', null, skills)).toEqual({
      kind: 'matched',
      name: 'Broadsword',
      level: 14,
      explicit: false,
    });
    expect(resolveWeaponSkill('Fine Broadsword', undefined, skills)).toMatchObject({
      kind: 'matched',
      explicit: false,
    });
  });

  it('treats a whitespace-only explicit skill as unset', () => {
    expect(resolveWeaponSkill('Fine Broadsword', '   ', skills)).toMatchObject({
      kind: 'matched',
      explicit: false,
    });
  });

  it('returns none when unset and fuzzy finds nothing', () => {
    expect(resolveWeaponSkill('Blowpipe', null, skills)).toEqual({ kind: 'none' });
  });

  it('breaks exact-name duplicates by highest level', () => {
    const dupes = [
      { name: 'Brawling', level: 10 },
      { name: 'Brawling', level: 13 },
    ];
    expect(resolveWeaponSkill('Fists', 'Brawling', dupes)).toMatchObject({ level: 13 });
  });
});

describe('stShortfallPenalty', () => {
  it('is 0 when no ST requirement or requirement met', () => {
    expect(stShortfallPenalty(null, 10)).toBe(0);
    expect(stShortfallPenalty(undefined, 10)).toBe(0);
    expect(stShortfallPenalty(10, 10)).toBe(0);
    expect(stShortfallPenalty(9, 12)).toBe(0);
  });

  it('is 1 per point of ST shortfall (B270)', () => {
    expect(stShortfallPenalty(12, 10)).toBe(2);
    expect(stShortfallPenalty(11, 10)).toBe(1);
  });
});

describe('pickShield', () => {
  const shield = (name: string, db: number | null, equipped = true) => ({
    equipped,
    name,
    weaponData: { db },
  });

  it('picks the equipped item with a non-null db', () => {
    const items = [
      { equipped: true, name: 'Broadsword', weaponData: {} },
      shield('Medium Shield', 2),
    ];
    expect(pickShield(items)).toMatchObject({ name: 'Medium Shield', db: 2 });
  });

  it('treats db 0 as a shield (presence, not magnitude)', () => {
    expect(pickShield([shield('Improvised Lid', 0)])).toMatchObject({ db: 0 });
  });

  it('ignores unequipped shields and non-weapons', () => {
    expect(pickShield([shield('Large Shield', 3, false)])).toBeNull();
    expect(pickShield([{ equipped: true, name: 'Rock', weaponData: null }])).toBeNull();
  });

  it('prefers the highest DB, ties broken by name', () => {
    expect(pickShield([shield('Buckler', 1), shield('Large Shield', 3)])).toMatchObject({
      name: 'Large Shield',
      db: 3,
    });
    expect(pickShield([shield('Zeta Shield', 2), shield('Alpha Shield', 2)])).toMatchObject({
      name: 'Alpha Shield',
    });
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
