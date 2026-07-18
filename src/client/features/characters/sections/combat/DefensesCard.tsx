import {
  blockFromSkill,
  effectiveDodge,
  parryFromSkill,
  parseParryString,
  pickShield,
  resolveWeaponSkill,
  skillDisplayName,
  stShortfallPenalty,
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
  const equippedItems = character.inventory.filter((i) => i.equipped);
  const weapons = equippedItems.filter((i) => i.weaponData != null);

  // The equipped shield (weaponData.db != null) adds its Defense Bonus
  // to Dodge, every Parry, and Block (B287).
  const shield = pickShield(equippedItems);
  const db = shield?.db ?? 0;
  const dbCaption = shield && db > 0 ? ` + ${db} DB (${shield.name})` : '';

  const dodge = effectiveDodge(character.derived.dodge, character.encumbrance.dodgePenalty) + db;
  const dodgeParts: string[] = [];
  if (character.encumbrance.dodgePenalty !== 0) {
    dodgeParts.push(
      `${character.derived.dodge} base − ${-character.encumbrance.dodgePenalty} ${character.encumbrance.label} encumbrance`,
    );
  }
  if (db > 0 && shield) dodgeParts.push(`+ ${db} DB (${shield.name})`);
  const dodgeCaption = dodgeParts.length > 0 ? dodgeParts.join(' ') : undefined;

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
    name: skillDisplayName(s.name, s.specialization),
    level: s.effectiveLevel ?? s.level,
  }));

  const parryRows: ParryRow[] = weapons
    .filter((i) => i.weaponData?.parry != null && i.weaponData.parry.trim() !== '')
    .map((i) => {
      const wd = i.weaponData;
      const raw = (wd?.parry ?? '').trim();
      const parsed = parseParryString(raw);
      // 'no' (weapon cannot parry) and unparseable notation both fall
      // back to the raw-string row — for 'no' that display is now a
      // deliberate choice, not a parse failure.
      if (parsed == null || parsed.kind === 'no') {
        return { key: i.id, name: i.name, value: null, caption: undefined, raw };
      }
      const resolution = resolveWeaponSkill(i.name, wd?.skill, skillCandidates);
      if (resolution.kind === 'matched') {
        // The ST-shortfall penalty applies to the weapon skill (B270),
        // so it lands before the halving — Parry drops by half as much.
        const adjusted =
          resolution.level - stShortfallPenalty(wd?.stRequired, character.derived.effectiveSt);
        return {
          key: i.id,
          name: i.name,
          value: parryFromSkill(adjusted, parsed.mod) + db,
          caption: `via ${resolution.name}–${adjusted}${dbCaption}`,
          raw,
        };
      }
      return {
        key: i.id,
        name: i.name,
        value: null,
        caption:
          resolution.kind === 'missing'
            ? `skill '${resolution.skillName}' not on sheet`
            : undefined,
        raw,
      };
    });

  // Block requires an actual equipped shield (B375 — you block with a
  // shield, not with a skill alone) whose governing skill resolves.
  const blockResolution = shield
    ? resolveWeaponSkill(shield.name, shield.weaponData.skill, skillCandidates)
    : null;

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
            <span className="min-w-0 truncate text-sm font-medium">
              Parry ({row.name})
              {row.caption && (
                <span className="block text-[11px] text-base-content/60">{row.caption}</span>
              )}
            </span>
            <span className="num shrink-0 text-sm text-base-content/70">{row.raw}</span>
          </div>
        ),
      )}

      {shield && blockResolution && blockResolution.kind === 'matched' && (
        <RollableRow
          label={`Block (${shield.name})`}
          baseTarget={blockFromSkill(blockResolution.level) + db}
          openRoll={openRoll}
          sublabel={
            <span className="block text-[11px] text-base-content/60">
              via {blockResolution.name}–{blockResolution.level}
              {dbCaption}
            </span>
          }
        />
      )}
      {shield && blockResolution && blockResolution.kind !== 'matched' && (
        <p className="text-xs text-base-content/60">
          {shield.name} is equipped but has no usable Shield skill —{' '}
          {blockResolution.kind === 'missing'
            ? `skill '${blockResolution.skillName}' is not on the sheet.`
            : 'bind its skill in the Inventory tab.'}
        </p>
      )}

      {parryRows.length === 0 && shield == null && (
        <p className="text-xs text-base-content/60">
          No parryable weapons or shield equipped — Dodge is always available.
        </p>
      )}

      <p className="text-[11px] text-base-content/50">
        Trait bonuses (Combat Reflexes, Enhanced Defenses) are not included — add them as a modifier
        when rolling.
      </p>
    </section>
  );
}
