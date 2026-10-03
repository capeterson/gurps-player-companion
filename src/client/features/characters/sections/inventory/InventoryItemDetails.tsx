import { formatRangedRange } from '../../../../../shared/domain/rangedRange.ts';
import { weaponModes } from '../../../../../shared/domain/weaponModes.ts';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { Markdown } from '../../../../components/markdown/Markdown.tsx';

/** Read-only details use the same effective stat blocks as inventory rows. */
export function InventoryItemDetails({ item }: { item: InventoryItemOut }) {
  return (
    <div className="space-y-3 text-sm [overflow-wrap:anywhere]">
      {item.notes && <Markdown source={item.notes} />}
      <p>
        Quantity {item.quantity} · {item.weightLbs} lb each · ${item.cost} each
      </p>
      {item.externalLocation && <p>Location: {item.externalLocation}</p>}
      {item.isContainer && <p>Hideaway capacity {item.hideawayCapacityLbs} lb</p>}
      {(item.isArmor || item.weaponData?.db != null) &&
        (item.effectiveWeightReductionPercent ?? item.weightReductionPercent) > 0 && (
          <p>
            Lighten: {item.effectiveWeightReductionPercent ?? item.weightReductionPercent}% of
            equipped armor or shield weight (M67).
          </p>
        )}
      {item.armor && (
        <div>
          <h3 className="font-semibold">Armor</h3>
          <p>
            DR {item.armor.dr} · Locations: {item.armor.locations.join(', ') || '—'}
            {item.armor.db != null && ` · DB ${item.armor.db}`}
          </p>
          {item.armor.drCrushing != null && <p>Crushing DR: {item.armor.drCrushing}</p>}
          {Object.entries(item.armor.typedDr).map(([type, dr]) =>
            dr == null ? null : (
              <p key={type}>
                {type} DR: {dr}
              </p>
            ),
          )}
          <p>
            {[
              item.armor.flexible && 'Flexible',
              item.armor.concealable && 'Concealable inner layer',
              item.armor.frontOnly && 'Front only',
              item.armor.backOnly && 'Back only',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {item.armor.notes && <Markdown source={item.armor.notes} />}
        </div>
      )}
      {item.weaponData && (
        <div>
          <h3 className="font-semibold">Weapon</h3>
          {weaponModes(item.weaponData).map((mode) => (
            <div key={mode.key} className="mt-2">
              <h4 className="font-medium">{mode.name}</h4>
              <p>
                Damage {mode.damage || '—'} · Reach {mode.reach ?? '—'} · Parry {mode.parry ?? '—'}{' '}
                · ST {mode.stRequired ?? '—'}
              </p>
              {mode.skill && <p>Skill: {mode.skill}</p>}
              {mode.weaponSt != null && <p>Purchased weapon ST: {mode.weaponSt}</p>}
              {mode.strengthKind && <p>Damage strength rule: {mode.strengthKind}</p>}
              {mode.ranged && (
                <p>
                  Range {formatRangedRange(mode.ranged.range) ?? '—'} · Acc {mode.ranged.acc ?? '—'}{' '}
                  · RoF {mode.ranged.rof ?? '—'} · Shots {mode.ranged.shots ?? '—'} · Bulk{' '}
                  {mode.ranged.bulk ?? '—'} · Recoil {mode.ranged.recoil ?? '—'}
                </p>
              )}
              {mode.notes && <Markdown source={mode.notes} />}
            </div>
          ))}
          {item.weaponData.db != null && <p>Shield DB {item.weaponData.db}</p>}
          {item.weaponData.notes && <Markdown source={item.weaponData.notes} />}
        </div>
      )}
      {item.powerstoneData && (
        <p>
          Powerstone: {item.powerstoneData.currentEnergy} / {item.powerstoneData.maxEnergy} energy
        </p>
      )}
      {item.magicItemData && (
        <p>
          Magic item: {item.magicItemData.spellName} · Skill {item.magicItemData.spellSkillLevel} ·{' '}
          {item.magicItemData.mode}
        </p>
      )}
      {item.enchantmentBreakdown?.map((effect, index) => (
        <p key={`${effect.sourceName}-${index}`}>
          {effect.sourceName}: {effect.target.replaceAll('_', ' ')} {effect.value}
          {!effect.active
            ? ` (${effect.inactiveReason ?? 'inactive'})`
            : effect.suppressedByStacking
              ? ' (suppressed)'
              : ''}
        </p>
      ))}
    </div>
  );
}
