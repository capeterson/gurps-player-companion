import { useEffect, useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import { type ArmorFacing, resolveArmorDb } from '../../../../../shared/domain/armorDr.ts';
import {
  type AllOutDefenseOption,
  combatAdjustments,
} from '../../../../../shared/domain/combatAdjustments.ts';
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
import { locationLabel } from './armorViewOptions.ts';

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

function modifierCaption(value: number): string {
  return value ? ` ${value > 0 ? '+' : '−'} ${Math.abs(value)} defense modifiers` : '';
}

export function DefensesCard({ character, openRoll }: DefensesCardProps) {
  const [defenseOption, setDefenseOption] = useState<AllOutDefenseOption>(null);
  const [hitLocation, setHitLocation] = useState('torso');
  const [facing, setFacing] = useState<ArmorFacing | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing character or maneuver ends this local turn option.
  useEffect(() => {
    setDefenseOption(null);
  }, [character.id, character.combat?.maneuver]);
  const state = combatAdjustments({
    hp: character.combat?.currentHp ?? character.derived.hp,
    maxHp: character.derived.hp,
    fp: character.combat?.currentFp ?? character.derived.fp,
    maxFp: character.derived.fp,
    posture: character.combat?.posture ?? 'standing',
    conditions: character.combat?.conditions ?? [],
    maneuver: character.combat?.maneuver ?? null,
  });
  const equippedItems = character.inventory.filter((i) => i.equipped);
  const weapons = equippedItems.filter((i) => i.weaponData != null);
  const customArmorLocations = [
    ...new Set(
      character.inventory.flatMap(
        (item) =>
          item.armor?.locations.filter((location) => !HIT_LOCATIONS.includes(location as never)) ??
          [],
      ),
    ),
  ].sort();

  // Shield DB is its own source. Armor contributes only the highest
  // equipped layer covering this incoming hit; armor DB never stacks.
  const shield = pickShield(equippedItems);
  const shieldDb = shield?.db ?? 0;
  const armorDbSource = resolveArmorDb(character.inventory, hitLocation, facing);
  const armorDb = armorDbSource?.db ?? 0;
  const db = shieldDb + armorDb;

  const shieldDbCaption = shield && shieldDb > 0 ? `+ ${shieldDb} DB (${shield.name})` : '';
  const armorDbCaption = armorDbSource
    ? `+ ${armorDbSource.db} armor DB (${armorDbSource.itemName})`
    : '';
  const dbCaption =
    shieldDbCaption && armorDbCaption
      ? ` ${shieldDbCaption} + ${armorDbCaption}`
      : shieldDbCaption || armorDbCaption
        ? ` ${shieldDbCaption}${armorDbCaption}`
        : '';

  const dodge = state.defense(
    'dodge',
    effectiveDodge(character.derived.dodge, character.encumbrance.dodgePenalty),
    defenseOption,
    db,
  );
  const dodgeParts: string[] = [];
  if (character.encumbrance.dodgePenalty !== 0) {
    dodgeParts.push(
      `${character.derived.dodge} base − ${-character.encumbrance.dodgePenalty} ${character.encumbrance.label} encumbrance`,
    );
  }
  if (shield && shieldDb > 0) dodgeParts.push(`+ ${shieldDb} DB (${shield.name})`);
  if (armorDbSource) dodgeParts.push(`+ ${armorDbSource.db} armor DB (${armorDbSource.itemName})`);
  const dodgeCaption = dodgeParts.length > 0 ? dodgeParts.join(' ') : undefined;

  const e = character.encumbrance;
  const d = character.derived;
  const overCarryCap = e.ratio > 10;
  const moveFloor = d.basicMove > 0 ? 1 : 0;
  const encumberedMove = overCarryCap
    ? 0
    : Math.max(moveFloor, Math.floor(d.basicMove * e.moveMultiplier));
  const moveNet = state.movement(encumberedMove, defenseOption);
  const movePenalty = d.basicMove - encumberedMove;
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
          resolution.level -
          stShortfallPenalty(wd?.stRequired, state.strength(character.derived.effectiveSt));
        return {
          key: i.id,
          name: i.name,
          value: parryFromSkill(adjusted, parsed.mod, character.derived.parryMod),
          caption: `via ${resolution.name}–${adjusted}${modifierCaption(character.derived.parryMod)}${dbCaption}`,
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
      {state.notes.length > 0 && (
        <p className="text-xs text-base-content/70">{state.notes.join(' · ')}</p>
      )}
      {state.allOutDefense && (
        <div className="flex flex-wrap gap-2" aria-label="All-Out Defense option">
          {(['dodge', 'parry', 'block', 'double'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`chip${defenseOption === option ? ' on' : ''}`}
              aria-pressed={defenseOption === option}
              onClick={() => setDefenseOption(option)}
            >
              {option === 'double' ? 'Double defense' : `+2 ${option}`}
            </button>
          ))}
          <p className="w-full text-xs text-base-content/60">
            Choose for these rolls. Double defense grants a second, different defense after the
            first fails; it adds no numerical bonus.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2" aria-label="Incoming hit for defense rolls">
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Hit location</span>
          <select
            aria-label="Defense hit location"
            className="select select-sm select-bordered"
            value={hitLocation}
            onChange={(event) => setHitLocation(event.target.value)}
          >
            {[...HIT_LOCATIONS, ...customArmorLocations].map((location) => (
              <option key={location} value={location}>
                {locationLabel(location)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Facing</span>
          <select
            aria-label="Defense facing"
            className="select select-sm select-bordered"
            value={facing ?? ''}
            onChange={(event) =>
              setFacing(event.target.value === '' ? undefined : (event.target.value as ArmorFacing))
            }
          >
            <option value="">Unknown</option>
            <option value="front">Front</option>
            <option value="back">Back</option>
          </select>
        </label>
      </div>

      {/* GURPS defenses share the 3d6-vs-target shape with skill rolls but
          use a different "critical" table (auto success on 3-4, auto
          failure on 17-18, independent of score). We route them through
          the same evaluateRoll as skills anyway — an accepted
          simplification for this pass rather than a second rules table. */}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-base-300/60 px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium">Move</span>
        <span className="num shrink-0 text-sm text-base-content">
          {moveNet}
          {(moveNet !== encumberedMove || state.maneuver) && (
            <span className="block text-[11px] text-base-content/60">
              {encumberedMove} before pool, posture, and maneuver limits
            </span>
          )}
          {moveCaption && (
            <span className="block text-[11px] text-base-content/60">{moveCaption}</span>
          )}
        </span>
      </div>

      <RollableRow
        label="Dodge"
        baseTarget={dodge ?? 0}
        unavailableReason={state.reason('dodge')}
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
            baseTarget={state.defense('parry', row.value, defenseOption, db) ?? 0}
            unavailableReason={state.reason('parry')}
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
          baseTarget={
            state.defense(
              'block',
              blockFromSkill(blockResolution.level, character.derived.blockMod),
              defenseOption,
              db,
            ) ?? 0
          }
          unavailableReason={state.reason('block')}
          openRoll={openRoll}
          sublabel={
            <span className="block text-[11px] text-base-content/60">
              via {blockResolution.name}–{blockResolution.level}
              {modifierCaption(character.derived.blockMod)}
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
          Equip a parryable weapon or shield to add those defenses.
        </p>
      )}

      <p className="text-[11px] text-base-content/50">
        Active trait bonuses and recorded combat restrictions are included. Add situational
        modifiers when rolling; shield DB assumes a covered attack. Move includes posture and
        maneuver limits.
      </p>
    </section>
  );
}
