import { useId } from 'react';
import type { RangedRange } from '../../../../../shared/schemas/inventory.ts';
import { rangedRange } from '../../../../../shared/schemas/inventory.ts';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { useDraftField } from '../../../../hooks/useDraftField.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { readItemPath, readPath, writeItemPath } from './itemMutations.ts';

const fixed: RangedRange = { kind: 'fixed', halfDamageYards: null, maxYards: 100 };
const multiplier: RangedRange = {
  kind: 'st_multiplier',
  halfDamageFactor: null,
  maxFactor: 10,
  strengthSource: 'wielder',
};

export function RangedRangeInputs({
  value,
  onChange,
  onBlur,
  disabled = false,
}: {
  value: RangedRange | null | undefined;
  onChange: (value: RangedRange | null) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const kind = value?.kind ?? 'none';
  const numberField = (
    label: string,
    current: number | null | undefined,
    change: (n: number | null) => void,
    required = false,
  ) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs" key={label}>
      {label}
      <input
        className="input input-sm input-bordered w-full min-w-0"
        type="number"
        min="1"
        step="any"
        value={current ?? ''}
        disabled={disabled}
        required={required}
        onChange={(event) => change(event.target.value === '' ? null : Number(event.target.value))}
        onBlur={onBlur}
      />
    </label>
  );
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="label-eyebrow">
        Range
      </label>
      <select
        id={id}
        className="select select-sm select-bordered w-full"
        value={kind}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === 'fixed'
              ? fixed
              : event.target.value === 'st_multiplier'
                ? multiplier
                : null,
          )
        }
        onBlur={onBlur}
      >
        <option value="none">No range</option>
        <option value="fixed">Fixed distance (yards)</option>
        <option value="st_multiplier">Based on ST</option>
        {kind === 'legacy' && <option value="legacy">Unrecognized range — choose a type</option>}
      </select>
      {value?.kind === 'legacy' && (
        <p className="text-xs text-warning">
          Could not convert “{value.notation}”. Choose a range type and enter the values.
        </p>
      )}
      {value?.kind === 'fixed' && (
        <div className="grid grid-cols-3 gap-2">
          {numberField('1/2D (yd)', value.halfDamageYards, (n) =>
            onChange({ ...value, halfDamageYards: n }),
          )}
          {numberField(
            'Max (yd)',
            value.maxYards,
            (n) => onChange({ ...value, maxYards: n ?? 0 }),
            true,
          )}
          {numberField('Min (yd)', value.minimumYards, (n) =>
            onChange({ ...value, minimumYards: n }),
          )}
        </div>
      )}
      {value?.kind === 'st_multiplier' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {numberField('1/2D × ST', value.halfDamageFactor, (n) =>
              onChange({ ...value, halfDamageFactor: n }),
            )}
            {numberField(
              'Max × ST',
              value.maxFactor,
              (n) => onChange({ ...value, maxFactor: n ?? 0 }),
              true,
            )}
            {numberField('Min (yd)', value.minimumYards, (n) =>
              onChange({ ...value, minimumYards: n }),
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs">
            Use ST from
            <select
              className="select select-sm select-bordered w-full"
              value={value.strengthSource}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, strengthSource: event.target.value as 'wielder' | 'weapon' })
              }
              onBlur={onBlur}
            >
              <option value="wielder">Wielder ST</option>
              <option value="weapon">Weapon ST</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}

/** One draft for the whole structured range so a pending save cannot clobber
 * subsequent edits to another part of the same range. */
export function RangedRangeField({
  item,
  path,
  label,
}: { item: InventoryItemOut; path: string; label: string }) {
  const serverValue = readPath(item, path) as RangedRange | null | undefined;
  const draft = useDraftField<RangedRange | null>({
    name: `${item.name}: ${label}`,
    serverValue: serverValue ?? null,
    format: (value) => JSON.stringify(value),
    parse: (raw) => rangedRange.nullable().parse(JSON.parse(raw)) as RangedRange | null,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    onSave: (value) => writeItemPath(item.id, path, value, label),
    enqueueOnCommit: {
      readCommitted: async () =>
        ((await readItemPath(item.id, path)) as RangedRange | null) ?? null,
    },
    flashKey: makeFlashKey('character_inventory', item.id, 'weaponData'),
  });
  let value: RangedRange | null = null;
  try {
    value = JSON.parse(draft.value) as RangedRange | null;
  } catch {
    /* validation will explain */
  }
  return (
    <div
      className="field-rollback-flash min-w-0"
      {...(draft.inputProps && {
        'data-flashing': draft.inputProps['data-flashing'],
        'data-flash-parity': draft.inputProps['data-flash-parity'],
      })}
    >
      <RangedRangeInputs
        value={value}
        onChange={(next) => draft.setValue(JSON.stringify(next))}
        onBlur={draft.commit}
      />
      {draft.error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {draft.error}
        </p>
      )}
    </div>
  );
}
