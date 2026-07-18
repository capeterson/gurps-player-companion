/**
 * DrSummaryCard — aggregates equipped armor DR per hit location for the
 * combat tab's left column. Complements the AttacksCard's hit-location
 * aim presets: the player can see what DR protects each location while
 * choosing where to aim.
 */

import { useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import {
  type DrByLocation,
  type DrByLocationMap,
  aggregateDrByLocation,
} from '../../../../../shared/domain/armorDr.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { IncomingDamageDialog } from './IncomingDamageDialog.tsx';

interface DrEntry extends DrByLocation {
  readonly loc: string;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

function locationLabel(loc: string): string {
  const parts = loc.split('_');
  const words =
    parts.length === 2 && (parts[1] === 'left' || parts[1] === 'right')
      ? [capitalize(parts[1] as string), capitalize(parts[0] as string)]
      : parts.map(capitalize);
  return words.join(' ');
}

export interface DrSummaryCardProps {
  character: CharacterDetail;
  canWrite?: boolean;
  hpMax?: number;
  bumpHp?: (delta: number) => void;
}

export function DrSummaryCard({ character, canWrite, hpMax, bumpHp }: DrSummaryCardProps) {
  const map: DrByLocationMap = aggregateDrByLocation(character.inventory);
  const [damageOpen, setDamageOpen] = useState(false);

  // The incoming-damage helper only makes sense when it can actually
  // mutate HP — no bumper (e.g. a read-only viewer), no button.
  const damageButton =
    canWrite && bumpHp && hpMax != null ? (
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDamageOpen(true)}>
        Incoming damage…
      </button>
    ) : null;

  const damageDialog =
    canWrite && bumpHp && hpMax != null ? (
      <IncomingDamageDialog
        open={damageOpen}
        character={character}
        canWrite={canWrite}
        hpMax={hpMax}
        bumpHp={bumpHp}
        onClose={() => setDamageOpen(false)}
      />
    ) : null;

  if (map.size === 0) {
    return (
      <section className="card space-y-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="label-eyebrow">Armor DR</p>
          {damageButton}
        </div>
        <p className="text-sm text-base-content/60">
          No equipped armor — add armor in the Inventory tab.
        </p>
        {damageDialog}
      </section>
    );
  }

  const wellKnown: DrEntry[] = HIT_LOCATIONS.flatMap((loc) => {
    const entry = map.get(loc);
    return entry ? [{ loc, ...entry }] : [];
  });
  const custom: DrEntry[] = [...map.entries()]
    .filter(([loc]) => !HIT_LOCATIONS.includes(loc as never))
    .map(([loc, entry]) => ({ loc, ...entry }));

  return (
    <section className="card space-y-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="label-eyebrow">Armor DR</p>
        {damageButton}
      </div>
      <ul className="space-y-0.5 text-sm">
        {wellKnown.map((entry) => (
          <li key={entry.loc} className="flex items-baseline justify-between gap-2">
            <span className="text-base-content/80">{locationLabel(entry.loc)}</span>
            <span className="num text-base-content">
              {entry.dr}
              {entry.drCrushing != null && entry.drCrushing !== entry.dr && (
                <span className="text-base-content/50 text-xs ml-1">{entry.drCrushing} vs cr</span>
              )}
            </span>
          </li>
        ))}
        {custom.map((entry) => (
          <li key={entry.loc} className="flex items-baseline justify-between gap-2">
            <span className="text-base-content/80">{locationLabel(entry.loc)}</span>
            <span className="num text-base-content">{entry.dr}</span>
          </li>
        ))}
      </ul>
      {damageDialog}
    </section>
  );
}
