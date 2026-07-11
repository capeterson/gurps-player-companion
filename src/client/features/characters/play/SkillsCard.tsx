import { useState } from 'react';
import { canCastInMana, hasMagery } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SpellOut } from '../../../../shared/schemas/spell.ts';
import { CastSpellDialog } from '../sections/CastSpellDialog.tsx';
import { RollableRow } from './RollableRow.tsx';
import type { RollRequest } from './rollTypes.ts';

export interface SkillsCardProps {
  character: CharacterDetail;
  canWrite: boolean;
  openRoll: (req: RollRequest) => void;
}

/**
 * All skills/spells with a non-null computed level, sorted by level
 * desc then name. Levels are already computed identically to
 * SkillsPanel/SpellsPanel — both read `character.skills[].level` /
 * `character.spells[].level`, which `buildCharacterDetail` (shared
 * domain) fills in once for every consumer, client and server alike.
 * 0-point / no-default entries are omitted here; the full sheet
 * handles those.
 */
export function SkillsCard({ character, canWrite, openRoll }: SkillsCardProps) {
  const [castingSpell, setCastingSpell] = useState<SpellOut | null>(null);

  const skills = character.skills
    .filter((s): s is typeof s & { level: number } => s.level != null)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));

  const spells = character.spells
    .filter((s): s is typeof s & { level: number } => s.level != null)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));

  // Mirrors SpellsPanel's `castable` gate exactly (S10-adjacent: don't
  // fork the mana rule). Hold casting entirely until the campaign row
  // (and thus the real mana level) has reached the local store — the
  // 'normal' builder fallback must not let a no-mana campaign, or a
  // sheet that just hasn't synced yet, spend FP/HP/powerstone charges.
  const characterHasMagery = hasMagery(character.traits);
  const castAllowed =
    character.manaLevelKnown && canCastInMana(characterHasMagery, character.manaLevel);

  return (
    <section className="card space-y-3 p-5">
      <p className="label-eyebrow">Skills</p>
      {skills.length === 0 ? (
        <p className="text-xs text-base-content/60">No usable skills yet.</p>
      ) : (
        <div className="space-y-1.5">
          {skills.map((s) => (
            <RollableRow
              key={s.id}
              label={s.name}
              baseTarget={s.level}
              openRoll={openRoll}
              sublabel={
                s.points <= 0 ? (
                  <span className="block text-[11px] text-base-content/60">
                    attribute default (B173) — not all skills may be attempted untrained
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {spells.length > 0 && (
        <>
          <p className="label-eyebrow pt-2">Spells</p>
          {!castAllowed && (
            <p className="text-[11px] text-base-content/60">
              {character.manaLevelKnown
                ? 'This character cannot cast here — ambient mana forbids it.'
                : 'Campaign mana level not synced yet — casting is disabled until it loads.'}
            </p>
          )}
          <div className="space-y-1.5">
            {spells.map((sp) => (
              <div key={sp.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <RollableRow label={sp.name} baseTarget={sp.level} openRoll={openRoll} />
                </div>
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn-sm shrink-0"
                    onClick={() => setCastingSpell(sp)}
                    disabled={!castAllowed}
                    title={castAllowed ? 'Cast this spell' : 'Casting is unavailable here'}
                  >
                    Cast
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {castingSpell && (
        <CastSpellDialog
          character={character}
          spell={castingSpell}
          onClose={() => setCastingSpell(null)}
        />
      )}
    </section>
  );
}
