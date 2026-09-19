import { expect, it } from 'bun:test';
import { activeEffectDefinitionCreate, activeEffectsField } from '../schemas/activeEffects.ts';
import { emitLibraryYaml, parseLibraryYaml } from '../yaml/library.ts';
import { effectExpired, instantiateEffect, resolveActiveEffects } from './activeEffects.ts';
const now = '2026-09-18T12:00:00.000Z';
const definition = activeEffectDefinitionCreate.parse({
  name: 'Battle Potion',
  stacking: { kind: 'additive', key: 'battle' },
  duration: { kind: 'minutes', amount: 10 },
  effects: [{ target: 'st', value: 2 }],
  capabilities: [{ kind: 'sense', key: 'true_sight', label: 'True Sight' }],
});
const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
it('has explicit wall-clock and round expiry with no background timer', () => {
  const instance = instantiateEffect(definition, id, now);
  expect(effectExpired(instance, Date.parse(now) + 599999)).toBe(false);
  expect(effectExpired(instance, Date.parse(now) + 600000)).toBe(true);
  expect(resolveActiveEffects([instance], new Set(), Date.parse(now)).effects[0]?.value).toBe(2);
  expect(
    resolveActiveEffects([instance], new Set(), Date.parse(now)).capabilities[0]?.capability.label,
  ).toBe('True Sight');
  expect(
    resolveActiveEffects([{ ...instance, state: 'inactive' }], new Set(), Date.parse(now)).effects,
  ).toEqual([]);
  expect(
    resolveActiveEffects([{ ...instance, remainingRounds: 0 }], new Set(), Date.parse(now)).effects,
  ).toEqual([]);
  expect(
    resolveActiveEffects([instance], new Set(), Date.parse(now) + 600000).capabilities,
  ).toEqual([]);
});
it('uses explicit stacking keys, strongest per destination and latest replacement', () => {
  const a = instantiateEffect(definition, id, now);
  const b = {
    ...instantiateEffect(definition, id2, now),
    effects: [{ target: 'st' as const, value: 4, scaling: 'flat' as const }],
  };
  expect(
    resolveActiveEffects([a, b], new Set(), Date.parse(now)).effects.reduce(
      (s, e) => s + e.value,
      0,
    ),
  ).toBe(6);
  for (const kind of ['highest', 'replace'] as const) {
    const entries = [
      { ...a, stacking: { kind, key: 'battle' } },
      { ...b, appliedAt: '2026-09-18T12:00:01.000Z', stacking: { kind, key: 'battle' } },
    ];
    expect(
      resolveActiveEffects(entries, new Set(), Date.parse(now) + 2000).effects.map((e) => e.value),
    ).toEqual([4]);
    expect(
      resolveActiveEffects(entries.reverse(), new Set(), Date.parse(now) + 2000).effects.map(
        (e) => e.value,
      ),
    ).toEqual([4]);
  }
  const separate = { ...b, stacking: { kind: 'highest' as const, key: 'different' } };
  expect(resolveActiveEffects([a, separate], new Set(), Date.parse(now)).effects).toHaveLength(2);
});
it('validates unique instance identities and round-trips definitions in YAML', () => {
  const instance = instantiateEffect(definition, id, now);
  expect(activeEffectsField.safeParse([instance, instance]).success).toBe(false);
  const yaml = emitLibraryYaml({
    traits: [],
    skills: [],
    spells: [],
    items: [],
    languages: [],
    techniques: [],
    styles: [],
    activeEffects: [definition],
  });
  expect(parseLibraryYaml(yaml).library.activeEffects).toEqual([definition]);
});
it('copies library metadata into an instance without leaking transport-only fields', () => {
  const libraryRow = {
    ...definition,
    id: id2,
    campaignId: id,
    revision: 7,
    createdAt: now,
    updatedAt: now,
  };
  expect(activeEffectsField.safeParse([instantiateEffect(libraryRow, id, now)]).success).toBe(true);
});
