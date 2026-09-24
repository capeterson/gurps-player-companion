import { beforeEach, expect, it } from 'vitest';
import {
  clearAllAttackTablePreferences,
  readAttackTablePreferences,
  saveAttackTablePreferences,
} from './combat/attackTablePreferences.ts';
import {
  clearAllDefenseTablePreferences,
  readDefenseTablePreferences,
  saveDefenseTablePreferences,
} from './combat/defenseTablePreferences.ts';
import {
  clearAllSkillTablePreferences,
  readSkillTablePreferences,
  saveSkillTablePreferences,
} from './skillTablePreferences.ts';
import {
  clearAllTraitTablePreferences,
  readTraitTablePreferences,
  saveTraitTablePreferences,
} from './traitTablePreferences.ts';

beforeEach(() => localStorage.clear());

it('keeps table defaults, sanitizes old data, and clears only each table prefix', () => {
  const cases = [
    {
      prefix: 'skill',
      read: readSkillTablePreferences,
      save: saveSkillTablePreferences,
      clear: clearAllSkillTablePreferences,
      fallback: 'name',
    },
    {
      prefix: 'trait',
      read: readTraitTablePreferences,
      save: saveTraitTablePreferences,
      clear: clearAllTraitTablePreferences,
      fallback: 'name',
    },
    {
      prefix: 'attack',
      read: readAttackTablePreferences,
      save: saveAttackTablePreferences,
      clear: clearAllAttackTablePreferences,
      fallback: 'custom',
    },
    {
      prefix: 'defense',
      read: readDefenseTablePreferences,
      save: saveDefenseTablePreferences,
      clear: clearAllDefenseTablePreferences,
      fallback: 'custom',
    },
  ] as const;
  for (const testCase of cases) {
    expect(testCase.read('character')).toEqual({
      order: [],
      sort: testCase.fallback,
      descending: false,
    });
    const key = `gurps:${testCase.prefix}Table:character`;
    localStorage.setItem(key, '{invalid');
    expect(testCase.read('character').sort).toBe(testCase.fallback);
    localStorage.setItem(
      key,
      JSON.stringify({ order: ['a', 'a', 3, 'b'], sort: 'unknown', descending: true }),
    );
    expect(testCase.read('character')).toEqual({
      order: ['a', 'b'],
      sort: testCase.fallback,
      descending: true,
    });
    expect(
      testCase.save('second', {
        order: ['x'],
        sort: testCase.fallback,
        descending: false,
      } as never),
    ).toBe(true);
    testCase.clear();
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(`gurps:${testCase.prefix}Table:second`)).toBeNull();
  }
});

it('returns false when device storage refuses a preference save', () => {
  const storage = window.localStorage;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      setItem: () => {
        throw new Error('quota exceeded');
      },
    },
  });
  try {
    expect(
      saveSkillTablePreferences('character', { order: [], sort: 'name', descending: false }),
    ).toBe(false);
  } finally {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  }
});
