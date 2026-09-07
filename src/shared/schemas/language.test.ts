import { describe, expect, it } from 'bun:test';
import {
  SPOKEN_POINTS,
  WRITTEN_POINTS,
  computeLanguagePoints,
  languageCreate,
  languageOut,
  languageUpdate,
} from './language.ts';

const UUID = '0193b3c0-f1f0-7000-8000-0000000000a1';

describe('languageCreate', () => {
  it('defaults both fluencies to none and points to 0', () => {
    const parsed = languageCreate.parse({ name: 'Latin' });
    expect(parsed).toMatchObject({
      name: 'Latin',
      spokenFluency: 'none',
      writtenFluency: 'none',
      points: 0,
    });
  });

  it('trims the name', () => {
    expect(languageCreate.parse({ name: '  Aramaic  ' }).name).toBe('Aramaic');
  });

  it('rejects an empty name', () => {
    expect(languageCreate.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects an unknown fluency level', () => {
    expect(languageCreate.safeParse({ name: 'Latin', spokenFluency: 'fluent' }).success).toBe(
      false,
    );
  });

  it("accepts 'n/a' written fluency for sign languages", () => {
    const parsed = languageCreate.parse({
      name: 'Sign Language (Thieves)',
      spokenFluency: 'accented',
      writtenFluency: 'n/a',
    });
    expect(parsed.writtenFluency).toBe('n/a');
  });

  it('rejects negative points', () => {
    expect(languageCreate.safeParse({ name: 'Latin', points: -1 }).success).toBe(false);
  });

  it('rejects points above the 100 cap', () => {
    expect(languageCreate.safeParse({ name: 'Latin', points: 101 }).success).toBe(false);
  });
});

describe('languageUpdate', () => {
  it('is fully partial so single-field sync patches validate', () => {
    expect(languageUpdate.parse({ spokenFluency: 'broken' })).toEqual({
      spokenFluency: 'broken',
    });
    expect(languageUpdate.parse({})).toEqual({});
  });

  it('exposes every writable field in its shape (sync WRITABLE_FOR_PATCH source)', () => {
    expect(Object.keys(languageUpdate.shape).sort()).toEqual([
      'libraryLanguageId',
      'name',
      'notes',
      'points',
      'spokenFluency',
      'writtenFluency',
    ]);
  });
});

describe('languageOut', () => {
  it('round-trips a full row', () => {
    const row = {
      id: UUID,
      characterId: UUID,
      name: 'Latin',
      spokenFluency: 'accented' as const,
      writtenFluency: 'native' as const,
      points: 5,
      notes: null,
      libraryLanguageId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(languageOut.parse(row)).toEqual(row);
  });
});

describe('computeLanguagePoints', () => {
  it('is the sum of the spoken and written tables', () => {
    expect(computeLanguagePoints('accented', 'native')).toBe(
      SPOKEN_POINTS.accented + WRITTEN_POINTS.native,
    );
  });

  it('costs 0 for a mother tongue written at native fluency', () => {
    // Spoken native is free (B23); the written half is the 3-point part
    // the auto-computation would suggest, but the mother tongue is free
    // overall, so players override `points` to 0 for it.
    expect(SPOKEN_POINTS.native).toBe(0);
    expect(computeLanguagePoints('native', 'none')).toBe(0);
  });

  it('costs 1 for broken spoken only', () => {
    expect(computeLanguagePoints('broken', 'none')).toBe(1);
  });

  it('costs 2 for accented spoken only', () => {
    expect(computeLanguagePoints('accented', 'none')).toBe(2);
  });

  it("treats 'n/a' as free on both axes (sign languages have no written form)", () => {
    expect(computeLanguagePoints('n/a', 'n/a')).toBe(0);
    expect(computeLanguagePoints('accented', 'n/a')).toBe(2);
  });

  it('never returns a negative cost for any fluency pair', () => {
    for (const spoken of Object.keys(SPOKEN_POINTS) as (keyof typeof SPOKEN_POINTS)[]) {
      for (const written of Object.keys(WRITTEN_POINTS) as (keyof typeof WRITTEN_POINTS)[]) {
        expect(computeLanguagePoints(spoken, written)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
