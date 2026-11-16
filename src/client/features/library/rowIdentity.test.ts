import { describe, expect, it } from 'vitest';
import { raceKeyDependencies, raceProfileDependencies, unusedRowKey } from './rowIdentity.ts';

it('reports race profiles for lens additions and excludes the current lens from peer additions', () => {
  const current = { name: 'Current', traits: [{ key: 'sharp' }], removesTraits: ['sharp'] };
  const peer = { name: 'Peer', referenceLabel: 'Peer · B', traits: [{ key: 'sharp' }] };
  expect(raceKeyDependencies([current, peer], 'traits', 'old', 'sharp', [peer])).toMatchObject({
    proposedRemovals: ['Current'],
    proposedAdditions: ['Peer · B'],
  });
  expect(
    raceProfileDependencies(
      [
        {
          name: 'Race',
          referenceLabel: 'Race · B',
          traits: [{ key: 'sharp' }],
          variants: [{ name: 'Variant', traits: [{ key: 'SHARP' }] }],
          forms: [{ name: 'Form', traits: [{ key: 'sharp' }] }],
        },
      ],
      'traits',
      'sharp',
    ),
  ).toEqual(['Race · B', 'Race · B — Variant', 'Race · B — Form']);
});

it('identifies old removals and proposed removals and additions in the correct component namespace', () => {
  const lenses = [
    { name: 'Old lens', removesTraits: [' Keen '], traits: [] },
    { name: 'Target lens', removesTraits: ['SHARP'], traits: [{ key: 'sharp' }] },
    { name: 'Skill lens', removesSkills: ['sharp'], skills: [{ key: 'sharp' }] },
  ];
  expect(raceKeyDependencies(lenses, 'traits', 'keen', 'sharp')).toEqual({
    oldRemovals: ['Old lens'],
    proposedRemovals: ['Target lens'],
    proposedAdditions: ['Target lens'],
  });
  expect(raceKeyDependencies(lenses, 'skills', 'keen', 'sharp')).toEqual({
    oldRemovals: [],
    proposedRemovals: ['Skill lens'],
    proposedAdditions: ['Skill lens'],
  });
});

describe('unusedRowKey', () => {
  it('normalizes names and chooses an unused suffix without changing existing keys', () => {
    expect(unusedRowKey('Épée / Swing copy', ['epee-swing-copy', 'epee-swing-copy-2'], 40)).toBe(
      'epee-swing-copy-3',
    );
    expect(unusedRowKey('!!!', ['ENTRY'], 40)).toBe('entry-2');
  });
  it('reserves space for numeric suffixes within a domain limit', () => {
    const name = 'A'.repeat(80);
    const first = unusedRowKey(name, [], 40);
    const second = unusedRowKey(name, [first], 40);
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(second.endsWith('-2')).toBe(true);
  });
});
