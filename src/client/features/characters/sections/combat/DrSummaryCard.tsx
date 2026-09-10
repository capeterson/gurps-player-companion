/**
 * DrSummaryCard — shows effective armor + innate DR per hit location for the
 * combat tab's left column. Complements the AttacksCard's hit-location
 * aim presets: the player can see what DR protects each location while
 * choosing where to aim.
 *
 * When armor has typed DR overrides (cut/imp/pi/burn/etc.), the summary
 * shows the base DR and annotates any types that differ from it.
 */

import { useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import {
  type DrByLocation,
  type DrByLocationMap,
  effectiveDrByLocation,
} from '../../../../../shared/domain/armorDr.ts';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import { IncomingDamageDialog } from './IncomingDamageDialog.tsx';

interface DrEntry extends DrByLocation {
  readonly loc: string;
}

/** Short labels for typed DR overrides that differ from base DR. */
const TYPED_DR_LABELS: Record<string, string> = {
  cut: 'cut',
  imp: 'imp',
  pi: 'pi',
  pi_minus: 'pi−',
  pi_plus: 'pi+',
  pi_pp: 'pi++',
  burn: 'burn',
  corr: 'cor',
  fat: 'fat',
  tox: 'tox',
};

function typedDrAnnotations(entry: DrEntry): string[] {
  const annotations: string[] = [];
  for (const [key, label] of Object.entries(TYPED_DR_LABELS)) {
    const val = entry.typedDr[key as keyof typeof entry.typedDr];
    if (val != null && val !== entry.dr) {
      annotations.push(`${val} vs ${label}`);
    }
  }
  return annotations;
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
  const effectsKnown = character.libraryEffectsKnown !== false;
  const map: DrByLocationMap = effectsKnown
    ? effectiveDrByLocation(character.inventory, character.effects)
    : new Map();
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
        <p className="label-eyebrow">Effective DR</p>
        {damageButton}
      </div>
      <p className="text-xs text-base-content/60">
        Armor + active innate DR; skull includes natural DR 2. Unscoped innate DR excludes eyes
        (B46).
      </p>
      {!effectsKnown && (
        <output className="text-xs text-warning">
          DR unavailable: linked library effects have not loaded.
        </output>
      )}
      <ul className="space-y-0.5 text-sm">
        {wellKnown.map((entry) => (
          <li key={entry.loc} className="flex items-baseline justify-between gap-2">
            <span className="text-base-content/80">{locationLabel(entry.loc)}</span>
            <span className="num text-base-content">
              {entry.dr}
              {entry.drCrushing != null && entry.drCrushing !== entry.dr && (
                <span className="text-base-content/50 text-xs ml-1">{entry.drCrushing} vs cr</span>
              )}
              {typedDrAnnotations(entry).map((a) => (
                <span key={a} className="text-base-content/50 text-xs ml-1">
                  {a}
                </span>
              ))}
            </span>
          </li>
        ))}
        {custom.map((entry) => (
          <li key={entry.loc} className="flex items-baseline justify-between gap-2">
            <span className="text-base-content/80">{locationLabel(entry.loc)}</span>
            <span className="num text-base-content">
              {entry.dr}
              {entry.drCrushing != null && entry.drCrushing !== entry.dr && (
                <span className="text-base-content/50 text-xs ml-1">{entry.drCrushing} vs cr</span>
              )}
              {typedDrAnnotations(entry).map((a) => (
                <span key={a} className="text-base-content/50 text-xs ml-1">
                  {a}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {damageDialog}
    </section>
  );
}
