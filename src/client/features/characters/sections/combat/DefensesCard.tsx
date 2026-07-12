import {
  blockFromSkill,
  effectiveDodge,
  matchSkillForWeapon,
  parryFromSkill,
  parseParryString,
} from '../../../../../shared/domain/defenseCalc.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { RollableRow } from '../RollableRow.tsx';
import type { RollRequest } from '../rollTypes.ts';

export interface DefensesCardProps {
  character: CharacterDetail;
  openRoll: (req: RollRequest) => void;
}

interface ParryRow {
  readonly key: string;
  readonly name: string;
  /** Computed parry score, or null when only the raw library string is available. */
  readonly value: number | null;
  readonly caption: string | undefined;
  readonly raw: string;
}

export function DefensesCard({ character, openRoll }: DefensesCardProps) {
  const dodge = effectiveDodge(character.derived.dodge, character.encumbrance.dodgePenalty);
  const dodgeCaption =
    character.encumbrance.dodgePenalty !== 0
      ? `${character.derived.dodge} base − ${-character.encumbrance.dodgePenalty} ${character.encumbrance.label} encumbrance`
      : undefined;

  const e = character.encumbrance;
  const d = character.derived;
  const overCarryCap = e.ratio > 10;
  const moveFloor = d.basicMove > 0 ? 1 : 0;
  const moveNet = overCarryCap
    ? 0
    : Math.max(moveFloor, Math.floor(d.basicMove * e.moveMultiplier));
  const movePenalty = d.basicMove - moveNet;
  const moveCaption =
    character.encumbrance.moveMultiplier !== 1
      ? `${d.basicMove} base − ${movePenalty} ${e.label} encumbrance`
      : undefined;

  // effectiveLevel folds in trait/skill effect bonuses (skillBonusFor) —
  // Parry/Block derive from the same final skill level SkillsPanel shows.
  const skillCandidates = character.skills.map((s) => ({
    name: s.name,
    level: s.effectiveLevel ?? s.level,
  }));

  const equippedItems = character.inventory.filter((i) => i.equipped);
  const weapons = equippedItems.filter((i) => i.weaponData != null);

  const parryRows: ParryRow[] = weapons
    .filter((i) => i.weaponData?.parry != null && i.weaponData.parry.trim() !== '')
    .map((i) => {
      const raw = (i.weaponData?.parry ?? '').trim();
      const parsed = parseParryString(raw);
      const matched = parsed ? matchSkillForWeapon(i.name, skillCandidates) : null;
      if (parsed && matched) {
        return {
          key: i.id,
          name: i.name,
          value: parryFromSkill(matched.level, parsed.mod),
          caption: `via ${matched.name}–${matched.level}`,
          raw,
        };
      }
      return { key: i.id, name: i.name, value: null, caption: undefined, raw };
    });

  const shieldSkill = skillCandidates
    .filter((s): s is { name: string; level: number } => s.level !== null && /shield/i.test(s.name))
    .reduce<{ name: string; level: number } | null>(
      (best, s) => (best === null || s.level > best.level ? s : best),
      null,
    );
  // Block requires a skill level to compute (B375) — an equipped item
  // named "shield" with no matching skill level has nothing to roll, so
  // the practical gate collapses to "a shield-ish skill is known."
  const showBlock = shieldSkill != null;

  return (
    <section className="card space-y-2 p-5">
      <p className="label-eyebrow">Defenses</p>

      {/* GURPS defenses share the 3d6-vs-target shape with skill rolls but
          use a different "critical" table (auto success on 3-4, auto
          failure on 17-18, independent of score). We route them through
          the same evaluateRoll as skills anyway — an accepted
          simplification for this pass rather than a second rules table. */}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-base-300/60 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium">Move</span>
        <span className="num shrink-0 text-sm text-base-content">
          {moveNet}
          {moveCaption && (
            <span className="block text-[11px] text-base-content/60">{moveCaption}</span>
          )}
        </span>
      </div>

      <RollableRow
        label="Dodge"
        baseTarget={dodge}
        openRoll={openRoll}
        sublabel={
          dodgeCaption ? (
            <span className="block text-[11px] text-base-content/60">{dodgeCaption}</span>
          ) : undefined
        }
      />

      {parryRows.map((row) =>
        row.value != null ? (
          <RollableRow
            key={row.key}
            label={`Parry (${row.name})`}
            baseTarget={row.value}
            openRoll={openRoll}
            sublabel={<span className="block text-[11px] text-base-content/60">{row.caption}</span>}
          />
        ) : (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 rounded-lg border border-base-300/60 px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm font-medium">Parry ({row.name})</span>
            <span className="num shrink-0 text-sm text-base-content/70">{row.raw}</span>
          </div>
        ),
      )}

      {showBlock && shieldSkill && (
        <RollableRow
          label="Block"
          baseTarget={blockFromSkill(shieldSkill.level)}
          openRoll={openRoll}
          sublabel={
            <span className="block text-[11px] text-base-content/60">
              via {shieldSkill.name}–{shieldSkill.level}
            </span>
          }
        />
      )}

      {parryRows.length === 0 && !showBlock && (
        <p className="text-xs text-base-content/60">
          No parryable weapons or shield equipped — Dodge is always available.
        </p>
      )}

      <p className="text-[11px] text-base-content/50">
        Trait bonuses (Combat Reflexes, Enhanced Defenses) and shield DB are not included — add them
        as a modifier when rolling.
      </p>
    </section>
  );
}
