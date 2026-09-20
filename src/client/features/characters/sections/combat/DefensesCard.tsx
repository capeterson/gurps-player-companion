import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
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
import type { RollRequest } from '../rollTypes.ts';
import {
  type DefenseSort,
  readDefenseTablePreferences,
  saveDefenseTablePreferences,
} from './defenseTablePreferences.ts';
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
  /** Shared with armor and incoming damage so DB uses the same selected hit context. */
  hitLocation?: string;
  facing?: ArmorFacing | undefined;
}

interface ParryRow {
  readonly key: string;
  readonly name: string;
  readonly skill: string;
  readonly value: number | null;
  readonly caption: string | undefined;
  readonly raw: string;
  readonly baseValue?: number;
  readonly skillEffects: readonly ResolvedEffectOut[];
  readonly weaponEffects: readonly ResolvedEffectOut[];
}

interface DefenseRow {
  id: string;
  label: string;
  skill: string;
  beforeDb: number | string;
  db: number | null;
  final: number | string;
  rollTarget?: number | undefined;
  reason?: string | null;
  detail?: ReactNode;
}

function modifierCaption(value: number): string {
  return value ? ` ${value > 0 ? '+' : '−'} ${Math.abs(value)} defense modifiers` : '';
}

function signed(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : String(value);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(rows: DefenseRow[], sort: DefenseSort, descending: boolean): DefenseRow[] {
  if (sort === 'custom') return rows;
  const direction = descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    if (sort === 'final') {
      const leftNumber = typeof left.final === 'number' ? left.final : null;
      const rightNumber = typeof right.final === 'number' ? right.final : null;
      if (leftNumber == null || rightNumber == null) {
        if (leftNumber == null && rightNumber == null) return compareText(left.label, right.label);
        return leftNumber == null ? 1 : -1;
      }
      return (leftNumber - rightNumber) * direction;
    }
    const result =
      sort === 'skill'
        ? compareText(left.skill, right.skill) || compareText(left.label, right.label)
        : compareText(left.label, right.label);
    return result * direction;
  });
}

function reorderRows(rows: DefenseRow[], order: readonly string[]): DefenseRow[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...rows].sort((left, right) => {
    const leftPosition = positions.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = positions.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition;
  });
}

export function DefensesCard(props: DefensesCardProps) {
  return <DefenseTable key={props.character.id} {...props} />;
}

function DefenseTable({ character, openRoll, hitLocation = 'torso', facing }: DefensesCardProps) {
  const effects = character.effects ?? [];
  const initialPreferences = readDefenseTablePreferences(character.id);
  const [customOrder, setCustomOrder] = useState(initialPreferences.order);
  const [sort, setSort] = useState<DefenseSort>(initialPreferences.sort);
  const [descending, setDescending] = useState(initialPreferences.descending);
  const [saveFailed, setSaveFailed] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [defenseOption, setDefenseOption] = useState<AllOutDefenseOption>(null);

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
  const equippedItems = character.inventory.filter((item) => item.equipped);
  const weapons = equippedItems.filter((item) => item.weaponData != null);
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

  const dodgeBeforeDb = effectiveDodge(character.derived.dodge, character.encumbrance.dodgePenalty);
  const dodge = state.defense('dodge', dodgeBeforeDb, defenseOption, db);
  const dodgeParts: string[] = [];
  if (character.encumbrance.dodgePenalty !== 0) {
    dodgeParts.push(
      `${character.derived.dodge} base − ${-character.encumbrance.dodgePenalty} ${character.encumbrance.label} encumbrance`,
    );
  }
  if (shield && shieldDb > 0) dodgeParts.push(`+ ${shieldDb} DB (${shield.name})`);
  if (armorDbSource) dodgeParts.push(`+ ${armorDbSource.db} armor DB (${armorDbSource.itemName})`);
  const dodgeCaption = dodgeParts.length > 0 ? dodgeParts.join(' ') : undefined;

  const skillCandidates = character.skills.map((skill) => ({
    name: skillDisplayName(skill.name, skill.specialization),
    level: skill.effectiveLevel ?? skill.level,
  }));

  const parryRows: ParryRow[] = weapons
    .filter((item) => item.weaponData?.parry != null && item.weaponData.parry.trim() !== '')
    .map((item) => {
      const weaponData = item.weaponData;
      const raw = (weaponData?.parry ?? '').trim();
      const parsed = parseParryString(raw);
      if (parsed == null || parsed.kind === 'no') {
        return {
          key: item.id,
          name: item.name,
          skill: weaponData?.skill?.trim() || '—',
          value: null,
          caption: undefined,
          raw,
          skillEffects: [],
          weaponEffects: [],
        };
      }
      const resolution = resolveWeaponSkill(item.name, weaponData?.skill, skillCandidates);
      if (resolution.kind === 'matched') {
        const adjusted =
          resolution.level -
          stShortfallPenalty(weaponData?.stRequired, state.strength(character.derived.effectiveSt));
        const weaponEffects = weaponEffectsForRow(effects, item.id, 'weapon_parry');
        const skillEffects = skillEffectsForRow(effects, resolution.name);
        const baseValue = parryFromSkill(adjusted, parsed.mod);
        return {
          key: item.id,
          name: item.name,
          skill: resolution.name,
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
        key: item.id,
        name: item.name,
        skill: resolution.kind === 'missing' ? resolution.skillName : '—',
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

  const blockResolution = shield
    ? resolveWeaponSkill(shield.name, shield.weaponData.skill, skillCandidates)
    : null;

  const rows: DefenseRow[] = [
    {
      id: 'dodge',
      label: 'Dodge',
      skill: 'Basic Speed',
      beforeDb: dodgeBeforeDb,
      db,
      final: dodge ?? '—',
      rollTarget: dodge ?? undefined,
      reason: state.reason('dodge'),
      detail: dodgeCaption,
    },
    ...parryRows.map((row): DefenseRow => {
      const final =
        row.value == null ? row.raw : (state.defense('parry', row.value, defenseOption, db) ?? '—');
      const reason = row.value == null ? null : state.reason('parry');
      return {
        id: `parry:${row.key}`,
        label: `Parry (${row.name})`,
        skill: row.skill,
        beforeDb: row.value ?? '—',
        db: row.value == null ? null : db,
        final,
        rollTarget: typeof final === 'number' && !reason ? final : undefined,
        reason,
        detail: (
          <>
            {row.caption}
            {row.value != null && (
              <ModifierBreakdownContent
                baseLabel="Weapon Parry"
                baseValue={row.baseValue ?? row.value}
                inputEffects={row.skillEffects}
                globalEffects={effects.filter(
                  (effect) => effect.target === 'parry' && effect.active,
                )}
                weaponEffects={row.weaponEffects}
                finalValue={final}
              />
            )}
          </>
        ),
      };
    }),
  ];

  if (shield && blockResolution?.kind === 'matched') {
    const weaponEffects = weaponEffectsForRow(effects, shield.id ?? '', 'weapon_block');
    const beforeDb = blockFromSkill(
      blockResolution.level,
      (character.derived.blockMod ?? 0) + effectTotal(weaponEffects),
    );
    const final = state.defense('block', beforeDb, defenseOption, db) ?? '—';
    const reason = state.reason('block');
    rows.push({
      id: `block:${shield.id}`,
      label: `Block (${shield.name})`,
      skill: blockResolution.name,
      beforeDb,
      db,
      final,
      rollTarget: typeof final === 'number' && !reason ? final : undefined,
      reason,
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
            finalValue={final}
          />
        </>
      ),
    });
  }

  const orderedRows = reorderRows(rows, customOrder);
  const visibleRows = sortRows(orderedRows, sort, descending);

  function persist(nextOrder = customOrder, nextSort = sort, nextDescending = descending) {
    setSaveFailed(
      !saveDefenseTablePreferences(character.id, {
        order: nextOrder,
        sort: nextSort,
        descending: nextDescending,
      }),
    );
  }

  function toggleSort(nextSort: Exclude<DefenseSort, 'custom'>) {
    const nextDescending = sort === nextSort ? !descending : false;
    setSort(nextSort);
    setDescending(nextDescending);
    persist(customOrder, nextSort, nextDescending);
  }

  function moveRow(rowId: string, offset: number) {
    const current = visibleRows.map((row) => row.id);
    const from = current.indexOf(rowId);
    const to = Math.max(0, Math.min(current.length - 1, from + offset));
    if (from < 0 || from === to) return;
    const [moved] = current.splice(from, 1);
    if (moved == null) return;
    current.splice(to, 0, moved);
    setCustomOrder(current);
    setSort('custom');
    setDescending(false);
    persist(current, 'custom', false);
  }

  function dropBefore(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const current = visibleRows.map((row) => row.id);
    const from = current.indexOf(draggedId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0) return;
    current.splice(from, 1);
    current.splice(from < to ? to - 1 : to, 0, draggedId);
    setCustomOrder(current);
    setSort('custom');
    setDescending(false);
    persist(current, 'custom', false);
    setDraggedId(null);
  }

  function sortButton(label: string, value: Exclude<DefenseSort, 'custom'>, className?: string) {
    return (
      <button
        type="button"
        className={`btn btn-ghost btn-xs h-auto min-h-0 justify-start px-0 py-1 font-semibold${className ? ` ${className}` : ''}`}
        onClick={() => toggleSort(value)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort === value ? (descending ? ' ↓' : ' ↑') : ''}
      </button>
    );
  }

  return (
    <div className="space-y-3" aria-label="Active defenses">
      <div>
        <div>
          <h3 className="label-eyebrow">Active defenses</h3>
          <p className="mt-1 text-xs text-muted">
            Uses the hit location and facing selected for armor.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-base-300">
        <table className="table table-sm w-full" aria-label="Defenses">
          <thead>
            <tr>
              <th className="w-8" aria-label="Custom order" />
              <th
                aria-sort={sort === 'defense' ? (descending ? 'descending' : 'ascending') : 'none'}
              >
                {sortButton('Defense', 'defense')}
              </th>
              <th aria-sort={sort === 'skill' ? (descending ? 'descending' : 'ascending') : 'none'}>
                {sortButton('Governing skill', 'skill')}
              </th>
              <th className="text-right whitespace-nowrap">Before DB</th>
              <th className="text-right">DB</th>
              <th
                className="text-right"
                aria-sort={sort === 'final' ? (descending ? 'descending' : 'ascending') : 'none'}
              >
                {sortButton('Final', 'final', 'w-full justify-end')}
              </th>
            </tr>
          </thead>
          {visibleRows.map((row) => {
            const customIndex = orderedRows.findIndex((candidate) => candidate.id === row.id);
            return (
              <tbody
                key={row.id}
                aria-label={row.label}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={() => dropBefore(row.id)}
                className={draggedId === row.id ? 'opacity-50' : undefined}
              >
                <tr>
                  <td className="px-2">
                    <button
                      type="button"
                      draggable
                      className="btn btn-ghost btn-xs cursor-grab px-1"
                      aria-label={`Reorder row ${customIndex + 1}`}
                      title="Drag or use arrow keys to reorder"
                      data-position={customIndex}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', row.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDraggedId(row.id);
                      }}
                      onDragEnd={() => setDraggedId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          moveRow(row.id, -1);
                        } else if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          moveRow(row.id, 1);
                        }
                      }}
                    >
                      <span aria-hidden="true">↕</span>
                    </button>
                  </td>
                  <th scope="row" className="min-w-44 align-top">
                    <span className="font-medium">{row.label}</span>
                    {row.detail && (
                      <details className="mt-1 font-normal text-[11px] text-base-content/60">
                        <summary className="cursor-pointer select-none">Breakdown</summary>
                        <div className="mt-1 max-w-xs whitespace-normal">{row.detail}</div>
                      </details>
                    )}
                  </th>
                  <td className="min-w-32 align-top text-xs">{row.skill}</td>
                  <td className="num text-right align-top">{row.beforeDb}</td>
                  <td className="num text-right align-top">
                    {row.db == null ? '—' : signed(row.db)}
                  </td>
                  <td className="text-right align-top">
                    {row.reason ? (
                      <span className="inline-block text-left text-xs">
                        <span>{row.label} — unavailable</span>
                        <span className="block text-muted">{row.reason}</span>
                      </span>
                    ) : row.rollTarget != null ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm num min-h-8 text-lg font-bold text-primary"
                        aria-label={`${row.label} ${row.rollTarget}`}
                        onClick={() => {
                          if (row.rollTarget != null) {
                            openRoll({ label: row.label, baseTarget: row.rollTarget });
                          }
                        }}
                      >
                        {row.final}
                      </button>
                    ) : (
                      <span className="num font-semibold">{row.final}</span>
                    )}
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>

      {saveFailed && (
        <output className="block text-xs text-warning">
          This device could not save the defense table order.
        </output>
      )}
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
        </div>
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
      <WeaponEffectDiagnostics
        effects={effects.filter((effect) =>
          ['weapon_parry', 'weapon_block'].includes(effect.target),
        )}
        inventory={character.inventory}
      />
      <p className="text-[11px] text-base-content/50">
        Active trait bonuses and recorded combat restrictions are included. Add situational
        modifiers when rolling; shield DB assumes a covered attack. Double defense grants a second,
        different defense after the first fails; it adds no numerical bonus.
      </p>
    </div>
  );
}
