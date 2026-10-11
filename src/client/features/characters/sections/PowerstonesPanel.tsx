import { totalPowerstoneEnergy } from '../../../../shared/domain/spellCalc.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut, PowerstoneData } from '../../../../shared/schemas/inventory.ts';
import { Table, TableBody, TableHeader } from '../../../components/ui/Table.tsx';
import { InventoryAnchorLink } from '../InventoryAnchorLink.tsx';
import { MAGIC_ACTION_CLASS } from './magicActionStyles.ts';
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

  const joinClass = `${MAGIC_ACTION_CLASS} join-item btn-outline min-w-10 justify-center px-2`;
  const actions = canWrite ? (
    <span className="join">
      <button
        type="button"
        className={joinClass}
        onClick={() => bumpEnergy(-1)}
        disabled={data.currentEnergy <= 0}
        aria-label={`Drain 1 from ${item.name}`}
      >
        −
      </button>
      <button
        type="button"
        className={joinClass}
        onClick={() => bumpEnergy(1)}
        disabled={data.currentEnergy >= data.maxEnergy}
        aria-label={`Recharge 1 to ${item.name}`}
      >
        +
      </button>
      <button
        type="button"
        className={joinClass}
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
        <td className="text-right">
          <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
            <progress
              className="progress progress-primary hidden w-16 sm:block"
              value={data.currentEnergy}
              max={Math.max(1, data.maxEnergy)}
              aria-hidden="true"
            />
            <span className="num tabular-nums" aria-label={`${item.name} energy`}>
              {data.currentEnergy} / {data.maxEnergy}
            </span>
          </span>
        </td>
        {canWrite && <td className="hidden text-right sm:table-cell">{actions}</td>}
      </tr>
      {canWrite && (
        <tr className="sm:hidden">
          <td colSpan={3} className="pt-0 text-right">
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
  const stones = character.inventory.filter((i) => i.powerstoneData != null && i.quantity > 0);
  const total = totalPowerstoneEnergy(stones);

  return (
    <section className="min-w-0 space-y-3" aria-label="Powerstones">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display text-xl">Powerstones</h2>
        <p className="num text-xs text-base-content/60">{total} stored energy</p>
      </header>
      {stones.length === 0 ? (
        <p className="text-sm text-base-content/60">No powerstones owned.</p>
      ) : (
        <Table
          preferenceKey={`${character.id}:powerstones`}
          className="table table-sm w-full table-auto"
          aria-label="Powerstones"
        >
          <thead>
            <tr>
              <TableHeader column="name" label="Item" className="w-full" />
              <TableHeader column="energy" label="Energy" className="w-24 text-right sm:w-36" />
              {canWrite && (
                <th scope="col" className="hidden w-44 text-right sm:table-cell">
                  <span className="sr-only">Adjust energy</span>
                </th>
              )}
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
