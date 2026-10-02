import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { characterRace } from '../../../shared/schemas/race.ts';
import { RaceSummary } from './RaceSummary.tsx';

describe('Race effect preview', () => {
  it('shows package effects and leveled trait contributions including conditional labels', () => {
    const race = characterRace.parse({
      selection: {},
      snapshot: {
        name: 'Forestkin',
        description: null,
        sources: [],
        effects: [{ target: 'skill', skillName: 'Bow', value: 1, scaling: 'flat' }],
        traits: [
          {
            key: 'forest-sense',
            name: 'Forest Sense',
            points: 10,
            level: 2,
            effects: [
              {
                target: 'per',
                value: 2,
                scaling: 'per_level',
                conditionGroup: 'forest',
                conditionLabel: 'in a forest',
              },
            ],
          },
        ],
      },
    });
    render(<RaceSummary race={race} />);
    expect(screen.getByRole('heading', { name: 'Effects' })).toBeVisible();
    expect(screen.getByText('Race: +1 to Bow')).toBeVisible();
    expect(
      screen.getByText('Forest Sense: +2/level to Per while in a forest (level 2: +4 total)'),
    ).toBeVisible();
  });
});

it('shows the multiplicity of repeated effects without dropping contributions', () => {
  const effect = { target: 'skill', skillName: 'Bow', value: 1, scaling: 'flat' };
  const race = characterRace.parse({
    selection: {},
    snapshot: {
      name: 'Forestkin',
      description: null,
      sources: [],
      effects: [effect, effect],
    },
  });
  render(<RaceSummary race={race} />);
  expect(screen.getByText('2 × Race: +1 to Bow')).toBeVisible();
});
