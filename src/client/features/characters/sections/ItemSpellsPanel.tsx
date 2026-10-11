import { useState } from 'react';
import { inventoryAvailability } from '../../../../shared/domain/inventoryAvailability.ts';
import { magicItemSkill } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut, MagicItemData } from '../../../../shared/schemas/inventory.ts';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { Table, TableBody, TableHeader } from '../../../components/ui/Table.tsx';
import { InventoryAnchorLink } from '../InventoryAnchorLink.tsx';
import { CastSpellDialog, type ItemSpellSource } from './CastSpellDialog.tsx';
import { RollSheet } from './RollSheet.tsx';
import { MAGIC_CAST_CLASS } from './magicActionStyles.ts';
import type { RollRequest } from './rollTypes.ts';

type MagicItem = InventoryItemOut & { magicItemData: MagicItemData };

const MODE_LABELS: Record<MagicItemData['mode'], string> = {
  powered: 'Uses energy',
  continuous: 'Always on',
};

interface ItemSpellRowProps {
  item: MagicItem;
  canWrite: boolean;
  carried: boolean;
  manaUsable: boolean;
  manaKnown: boolean;
  level: number;
  visible: boolean;
  onCast(source: ItemSpellSource): void;
  onRoll(request: RollRequest): void;
}

function ItemSpellRow({
  item,
  canWrite,
  carried,
  manaUsable,
  manaKnown,
  level,
  visible,
  onCast,
  onRoll,
}: ItemSpellRowProps) {
  const data = item.magicItemData;
  const alwaysOn = data.mode === 'continuous';
  const energy = data.energyCost;
  // Using an item costs the same energy as a normal casting of its spell (M19).
  const castButton =
    canWrite && !alwaysOn ? (
      <button
        type="button"
        className={MAGIC_CAST_CLASS}
        onClick={() => onCast({ item, data })}
        disabled={!carried || !manaUsable}
        aria-label={`Cast ${data.spellName} from ${item.name}`}
        title={energy == null ? 'Energy cost not recorded' : `${energy} energy`}
      >
        <span>Cast</span>
        <span className="num">{energy ?? '—'}</span>
      </button>
    ) : null;
  const cost = alwaysOn ? (
    <span className="text-base-content/70">Always on</span>
  ) : (
    (castButton ?? <span className="num">{energy ?? '—'}</span>)
  );

  return (
    <TableBody
      aria-label={`${data.spellName} from ${item.name}`}
      hidden={!visible}
      filterValues={{
        spell: data.spellName,
        level,
        cost: alwaysOn ? MODE_LABELS.continuous : (energy ?? null),
      }}
    >
      <tr>
        <td className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-medium">{data.spellName}</span>
          <span className="block text-xs text-base-content/70">
            <InventoryAnchorLink itemId={item.id}>{item.name}</InventoryAnchorLink>
            {alwaysOn && <> · {MODE_LABELS.continuous}</>}
            {!carried && <span className="text-warning"> · Not carried</span>}
          </span>
          {data.notes ? (
            <span className="block text-xs text-base-content/60 [overflow-wrap:anywhere]">
              {data.notes}
            </span>
          ) : null}
        </td>
        <td className="text-right">
          <RollLevelChip
            level={manaKnown ? level : null}
            name={`${data.spellName} from ${item.name}`}
            title={manaKnown ? undefined : 'Waiting for campaign mana'}
            onRoll={(rolled) =>
              onRoll({ label: `${data.spellName} (${item.name})`, baseTarget: rolled })
            }
          />
        </td>
        <td className="hidden whitespace-nowrap text-right text-sm sm:table-cell">{cost}</td>
      </tr>
      {castButton && (
        <tr className="sm:hidden">
          <td colSpan={2} className="pt-0">
            <div className="flex flex-wrap items-center justify-end gap-1">{castButton}</div>
          </td>
        </tr>
      )}
    </TableBody>
  );
}

function matchesItemSearch(item: MagicItem, normalizedQuery: string) {
  const data = item.magicItemData;
  return `${data.spellName} ${item.name} ${data.notes ?? ''}`
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

/** Spells granted by owned magic items, cast at the item's Power (M19). */
export function ItemSpellsPanel({
  character,
  canWrite,
  query = '',
}: {
  character: CharacterDetail;
  canWrite: boolean;
  /** The Magic section's shared spell search. */
  query?: string;
}) {
  const [casting, setCasting] = useState<ItemSpellSource | null>(null);
  const [roll, setRoll] = useState<RollRequest | null>(null);
  const items = character.inventory.filter(
    (item): item is MagicItem => item.magicItemData != null && item.quantity > 0,
  );
  if (items.length === 0) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleIds = new Set(
    items
      .filter((item) => !normalizedQuery || matchesItemSearch(item, normalizedQuery))
      .map((item) => item.id),
  );
  const availability = inventoryAvailability(character.inventory);
  const manaKnown = character.manaLevelKnown;
  // Magic items need no Magery, but nothing works in a no-mana zone.
  const manaUsable = manaKnown && character.manaLevel !== 'none';
  return (
    <section className="min-w-0 space-y-3" aria-label="Item spells">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-xl">Item spells</h2>
        <p className="text-xs text-base-content/60">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </p>
      </header>
      <Table
        preferenceKey={`${character.id}:item-spells`}
        className="table table-sm w-full table-auto"
        aria-label="Item spells"
      >
        <caption className="sr-only">
          Spells granted by magic items. Levels are the item&apos;s Power and open rolls. Cost is
          the energy of a normal casting.
        </caption>
        <thead>
          <tr>
            <TableHeader column="spell" label="Spell" className="w-full" />
            <TableHeader column="level" label="Level" className="w-16 text-right" />
            <TableHeader
              column="cost"
              label="Cost"
              className="hidden w-28 text-right sm:table-cell"
            />
          </tr>
        </thead>
        {items.map((item) => (
          <ItemSpellRow
            key={item.id}
            item={item}
            canWrite={canWrite}
            carried={availability.get(item.id)?.carried === true}
            manaUsable={manaUsable}
            manaKnown={manaKnown}
            level={magicItemSkill(item.magicItemData.spellSkillLevel, character.manaLevel)}
            visible={visibleIds.has(item.id)}
            onCast={setCasting}
            onRoll={(request) => setRoll({ ...request, spellManaLevel: character.manaLevel })}
          />
        ))}
        {visibleIds.size === 0 && (
          <TableBody>
            <tr>
              <td colSpan={3} className="py-5 text-center text-base-content/60">
                No item spells match your search.
              </td>
            </tr>
          </TableBody>
        )}
      </Table>
      {casting && (
        <CastSpellDialog
          character={character}
          itemSource={casting}
          onClose={() => setCasting(null)}
        />
      )}
      {roll && manaKnown && (
        <RollSheet request={roll} characterId={character.id} onClose={() => setRoll(null)} />
      )}
    </section>
  );
}
