import { totalPowerstoneEnergy } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type {
  InventoryItemOut,
  MagicItemData,
  PowerstoneData,
} from '../../../../shared/schemas/inventory.ts';
import { Table, TableBody, TableHeader } from '../../../components/ui/Table.tsx';
import { InventoryAnchorLink } from '../InventoryAnchorLink.tsx';
import { useClampedJsonbBumper } from './useClampedJsonbBumper.ts';

interface PowerstoneRowProps {
  item: InventoryItemOut;
  characterId: string;
  canWrite: boolean;
}

function PowerstoneRow({ item, characterId, canWrite }: PowerstoneRowProps) {
  const data = item.powerstoneData;

  // Powerstone charge is editable nested JSON; we patch the whole
  // `powerstoneData` field as a single unit to keep the orchestrator's
  // per-field validation happy (the field validator parses the full
  // shape, and we always send a fresh, valid copy).
  const { setTo: setEnergyTo, bump: bumpEnergy } = useClampedJsonbBumper<PowerstoneData>({
    characterId,
    entityId: item.id,
    fieldPath: 'powerstoneData',
    humanName: `${item.name} charge`,
    current: data?.currentEnergy ?? 0,
    max: data?.maxEnergy ?? 0,
    canWrite,
    buildValue: (clamped) => ({
      maxEnergy: data?.maxEnergy ?? 0,
      currentEnergy: clamped,
      ...(data?.notes != null ? { notes: data.notes } : {}),
    }),
  });

  if (!data) return null;

  const actions = canWrite ? (
    <span className="flex flex-wrap justify-end">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
        onClick={() => bumpEnergy(-1)}
        disabled={data.currentEnergy <= 0}
        aria-label={`Drain 1 from ${item.name}`}
      >
        −
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
        onClick={() => bumpEnergy(1)}
        disabled={data.currentEnergy >= data.maxEnergy}
        aria-label={`Recharge 1 to ${item.name}`}
      >
        +
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
        onClick={() => setEnergyTo(data.maxEnergy)}
        disabled={data.currentEnergy >= data.maxEnergy}
        aria-label={`Recharge ${item.name} to full`}
        title="Set to max"
      >
        Max
      </button>
    </span>
  ) : null;

  return (
    <TableBody filterValues={{ name: item.name, energy: data.currentEnergy }}>
      <tr>
        <td className="min-w-0 [overflow-wrap:anywhere]">
          <InventoryAnchorLink itemId={item.id}>{item.name}</InventoryAnchorLink>
          {data.notes ? (
            <span className="block text-xs text-base-content/60 [overflow-wrap:anywhere]">
              {data.notes}
            </span>
          ) : null}
        </td>
        <td className="num text-right tabular-nums" aria-label={`${item.name} energy`}>
          {data.currentEnergy} / {data.maxEnergy}
        </td>
        <td className="hidden sm:table-cell">{actions}</td>
      </tr>
      {canWrite && (
        <tr className="sm:hidden">
          <td colSpan={3} className="pt-0">
            {actions}
          </td>
        </tr>
      )}
    </TableBody>
  );
}

export function PowerstonesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const stones = character.inventory.filter((i) => i.powerstoneData != null);
  const total = totalPowerstoneEnergy(stones);

  return (
    <section className="min-w-0 space-y-3" aria-label="Powerstones">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">Powerstones</h2>
        <p className="num text-xs text-base-content/60">{total} stored energy</p>
      </header>
      {stones.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No powerstones carried. Add one in Inventory to track its energy here.
        </p>
      ) : (
        <Table
          preferenceKey={`${character.id}:powerstones`}
          className="table table-sm w-full table-auto"
          aria-label="Powerstones"
        >
          <thead>
            <tr>
              <TableHeader column="name" label="Item" />
              <TableHeader column="energy" label="Energy" className="w-16 text-right" />
              <th
                scope="col"
                className={`hidden sm:table-cell ${canWrite ? 'w-36 text-right' : 'w-0 p-0'}`}
              >
                <span className="sr-only">Adjust energy</span>
              </th>
            </tr>
          </thead>
          {stones.map((item) => (
            <PowerstoneRow
              key={item.id}
              item={item}
              characterId={character.id}
              canWrite={canWrite}
            />
          ))}
        </Table>
      )}
    </section>
  );
}

export function MagicItemsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const items = character.inventory.filter((i) => i.magicItemData != null);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="min-w-0 space-y-3" aria-label="Magic items">
      <h2 className="text-base font-medium">Magic items</h2>
      <Table
        preferenceKey={`${character.id}:magic-items`}
        className="table table-sm w-full table-auto"
        aria-label="Magic items"
      >
        <thead>
          <tr>
            <TableHeader column="name" label="Item" />
            <TableHeader column="charges" label="Charges" className="w-20 text-right" />
            <th
              scope="col"
              className={`hidden sm:table-cell ${canWrite ? 'w-28 text-right' : 'w-0 p-0'}`}
            >
              <span className="sr-only">Charge actions</span>
            </th>
          </tr>
        </thead>
        {items.map((item) => (
          <MagicItemRow key={item.id} item={item} characterId={character.id} canWrite={canWrite} />
        ))}
      </Table>
    </section>
  );
}

interface MagicItemRowProps {
  item: InventoryItemOut;
  characterId: string;
  canWrite: boolean;
}

function MagicItemRow({ item, characterId, canWrite }: MagicItemRowProps) {
  const data = item.magicItemData;
  const charged = data?.mode === 'charged';

  // For "charged" items only, we expose -/+ controls on chargesCurrent.
  // Same patch-the-whole-jsonb pattern as powerstone, since the field
  // validator parses the entire object shape.
  const { setTo: setChargesTo, bump: bumpCharges } = useClampedJsonbBumper<MagicItemData>({
    characterId,
    entityId: item.id,
    fieldPath: 'magicItemData',
    humanName: `${item.name} charges`,
    current: data?.chargesCurrent ?? 0,
    max: data?.chargesMax ?? 0,
    canWrite: canWrite && charged,
    buildValue: (clamped) => ({ ...(data as MagicItemData), chargesCurrent: clamped }),
  });

  if (!data) return null;

  const actions =
    charged && canWrite ? (
      <span className="flex flex-wrap justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
          onClick={() => bumpCharges(-1)}
          disabled={(data.chargesCurrent ?? 0) <= 0}
          aria-label={`Use one charge from ${item.name}`}
        >
          Use
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-11 min-w-11 px-2"
          onClick={() => setChargesTo(data.chargesMax ?? 0)}
          disabled={(data.chargesCurrent ?? 0) >= (data.chargesMax ?? 0)}
          aria-label={`Recharge ${item.name} to full`}
          title="Refill charges"
        >
          Refill
        </button>
      </span>
    ) : null;

  return (
    <TableBody
      filterValues={{ name: item.name, charges: charged ? (data.chargesCurrent ?? 0) : data.mode }}
    >
      <tr>
        <td className="min-w-0 [overflow-wrap:anywhere]">
          <InventoryAnchorLink itemId={item.id}>{item.name}</InventoryAnchorLink>
          <span className="block text-xs text-base-content/60 [overflow-wrap:anywhere]">
            casts <em>{data.spellName}</em> at skill {data.spellSkillLevel}
            {' · '}
            {data.mode}
            {data.energyCost != null && data.mode === 'powered' ? `, ${data.energyCost} FP` : ''}
          </span>
        </td>
        <td className="text-right">
          {charged ? (
            <span className="num text-right tabular-nums">
              {data.chargesCurrent ?? 0} / {data.chargesMax ?? 0}
            </span>
          ) : (
            <span className="text-xs text-base-content/60">
              {data.mode === 'continuous' ? 'always-on' : 'powered by user'}
            </span>
          )}
        </td>
        <td className="hidden sm:table-cell">{actions}</td>
      </tr>
      {charged && canWrite && (
        <tr className="sm:hidden">
          <td colSpan={3} className="pt-0">
            {actions}
          </td>
        </tr>
      )}
    </TableBody>
  );
}
