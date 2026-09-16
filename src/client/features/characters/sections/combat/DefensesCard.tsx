import type { ReactNode } from 'react';
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
import type {
  CharacterDetail,
  ResolvedEffectOut,
} from '../../../../../shared/schemas/character.ts';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import type { RollRequest } from '../rollTypes.ts';
import { locationLabel } from './armorViewOptions.ts';
import {
  ModifierBreakdownContent,
  WeaponEffectDiagnostics,
  effectTotal,
  skillEffectsForRow,
  weaponEffectsForRow,
} from './weaponEffectView.tsx';

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
  readonly baseValue?: number;
  readonly skillEffects: readonly ResolvedEffectOut[];
  readonly weaponEffects: readonly ResolvedEffectOut[];
}

function modifierCaption(value: number): string {
  return value ? ` ${value > 0 ? '+' : '−'} ${Math.abs(value)} defense modifiers` : '';
}

export function DefensesCard({ character, openRoll }: DefensesCardProps) {
  const effects = character.effects ?? [];
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
        return {
          key: i.id,
          name: i.name,
          value: null,
          caption: undefined,
          raw,
          skillEffects: [],
          weaponEffects: [],
        };
      }
      const resolution = resolveWeaponSkill(i.name, wd?.skill, skillCandidates);
      if (resolution.kind === 'matched') {
        // The ST-shortfall penalty applies to the weapon skill (B270),
        // so it lands before the halving — Parry drops by half as much.
        const adjusted =
          resolution.level -
          stShortfallPenalty(wd?.stRequired, state.strength(character.derived.effectiveSt));
        const weaponEffects = weaponEffectsForRow(effects, i.id, 'weapon_parry');
        const skillEffects = skillEffectsForRow(effects, resolution.name);
        const baseValue = parryFromSkill(adjusted, parsed.mod);
        return {
          key: i.id,
          name: i.name,
          value: parryFromSkill(
            adjusted,
            parsed.mod,
            (character.derived.parryMod ?? 0) + effectTotal(weaponEffects),
          ),
          caption: `via ${resolution.name}–${adjusted}${modifierCaption(character.derived.parryMod)}${dbCaption}`,
          raw,
          baseValue,
          skillEffects,
          weaponEffects,
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
        skillEffects: [],
        weaponEffects: [],
      };
    });

  // Block requires an actual equipped shield (B375 — you block with a
  // shield, not with a skill alone) whose governing skill resolves.
  const blockResolution = shield
    ? resolveWeaponSkill(shield.name, shield.weaponData.skill, skillCandidates)
    : null;

  const rows: {
    label: string;
    value: number | string;
    reason?: string | null;
    detail?: ReactNode;
  }[] = [
    { label: 'Dodge', value: dodge ?? '—', reason: state.reason('dodge'), detail: dodgeCaption },
    ...parryRows.map((row) => ({
      label: `Parry (${row.name})`,
      value:
        row.value == null ? row.raw : (state.defense('parry', row.value, defenseOption, db) ?? '—'),
      reason: row.value == null ? null : state.reason('parry'),
      detail: (
        <>
          {row.caption}
          {row.value != null && (
            <ModifierBreakdownContent
              baseLabel="Weapon Parry"
              baseValue={row.baseValue ?? row.value}
              inputEffects={row.skillEffects}
              globalEffects={effects.filter((effect) => effect.target === 'parry' && effect.active)}
              weaponEffects={row.weaponEffects}
              finalValue={state.defense('parry', row.value, defenseOption, db) ?? 'unavailable'}
            />
          )}
        </>
      ),
    })),
  ];
  if (shield && blockResolution?.kind === 'matched') {
    const weaponEffects = weaponEffectsForRow(effects, shield.id ?? '', 'weapon_block');
    const final = blockFromSkill(
      blockResolution.level,
      (character.derived.blockMod ?? 0) + effectTotal(weaponEffects),
    );
    rows.push({
      label: `Block (${shield.name})`,
      value: state.defense('block', final, defenseOption, db) ?? '—',
      reason: state.reason('block'),
      detail: (
        <>
          via {blockResolution.name}–{blockResolution.level}
          {modifierCaption(character.derived.blockMod)}
          {dbCaption}
          <ModifierBreakdownContent
            baseLabel="Shield Block"
            baseValue={blockFromSkill(blockResolution.level)}
            inputEffects={skillEffectsForRow(effects, blockResolution.name)}
            globalEffects={effects.filter((effect) => effect.target === 'block' && effect.active)}
            weaponEffects={weaponEffects}
            finalValue={state.defense('block', final, defenseOption, db) ?? 'unavailable'}
          />
        </>
      ),
    });
  }

  return (
    <FoldSection
      preferenceKey={`${character.id}:defenses`}
      title="Move & defenses"
      summary={`Move ${moveNet} · Dodge ${dodge ?? '—'}`}
    >
      <div className="combat-defense-values">
        <div className="rounded-lg border border-base-300 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-sm">Move</span>
          <span className="num text-xl font-bold">{moveNet}</span>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            {typeof row.value === 'number' && !row.reason ? (
              <button
                type="button"
                className="w-full rounded-lg border border-base-300 px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-base-200"
                onClick={() => openRoll({ label: row.label, baseTarget: row.value as number })}
              >
                <span className="text-sm break-words">{row.label}</span>
                <span className="num text-xl font-bold text-primary">{row.value}</span>
              </button>
            ) : (
              <div className="rounded-lg border border-base-300 px-3 py-2 text-sm">
                {row.reason ? (
                  <span>{row.label} — unavailable</span>
                ) : (
                  <>
                    <span>{row.label}</span> — <span>{row.value}</span>
                  </>
                )}
                {row.reason && <span className="block text-xs text-muted">{row.reason}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {state.notes.length > 0 && (
        <p className="mt-2 text-xs text-base-content/70">{state.notes.join(' · ')}</p>
      )}
      {state.allOutDefense && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="All-Out Defense option">
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
        </div>
      )}
      <div className="mt-3">
        <FoldSection
          preferenceKey={`${character.id}:defense-details`}
          title="Defense details"
          defaultOpen={false}
          summary={`${locationLabel(hitLocation)} · ${facing ?? 'unknown facing'}`}
        >
          <div className="grid grid-cols-2 gap-2" aria-label="Incoming hit for defense rolls">
            <label className="min-w-0 text-xs">
              Hit location
              <select
                aria-label="Defense hit location"
                className="select select-sm select-bordered w-full"
                value={hitLocation}
                onChange={(e) => setHitLocation(e.target.value)}
              >
                {[...HIT_LOCATIONS, ...customArmorLocations].map((location) => (
                  <option key={location} value={location}>
                    {locationLabel(location)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-xs">
              Facing
              <select
                aria-label="Defense facing"
                className="select select-sm select-bordered w-full"
                value={facing ?? ''}
                onChange={(e) =>
                  setFacing(e.target.value === '' ? undefined : (e.target.value as ArmorFacing))
                }
              >
                <option value="">Unknown</option>
                <option value="front">Front</option>
                <option value="back">Back</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            Move: {moveNet} · {encumberedMove} before pool, posture, and maneuver limits.{' '}
            {moveCaption}
          </p>
          {rows.map((row) => (
            <div key={row.label} className="mt-3 text-xs text-muted">
              <strong>{row.label} breakdown</strong>
              <div>{row.detail}</div>
            </div>
          ))}
          <WeaponEffectDiagnostics
            effects={effects.filter((effect) =>
              ['weapon_parry', 'weapon_block'].includes(effect.target),
            )}
            inventory={character.inventory}
          />
          {shield && blockResolution && blockResolution.kind !== 'matched' && (
            <p className="mt-2 text-xs text-muted">
              {shield.name} is equipped but has no usable Shield skill —{' '}
              {blockResolution.kind === 'missing'
                ? `skill '${blockResolution.skillName}' is not on the sheet.`
                : 'bind its skill in the Inventory tab.'}
            </p>
          )}
          {parryRows.length === 0 && shield == null && (
            <p className="mt-2 text-xs text-muted">
              Equip a parryable weapon or shield to add those defenses.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Active trait bonuses and recorded combat restrictions are included. Add situational
            modifiers when rolling; shield DB assumes a covered attack. Move includes posture and
            maneuver limits. Double defense grants a second, different defense after the first
            fails; it adds no numerical bonus.
          </p>
        </FoldSection>
      </div>
    </FoldSection>
  );
}
