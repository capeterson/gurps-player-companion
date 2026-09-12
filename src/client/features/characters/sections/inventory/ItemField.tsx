import { useId, useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { useDraftField } from '../../../../hooks/useDraftField.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { readItemPath, readPath, writeItemPath } from './itemMutations.ts';

export interface ItemFieldSpec {
  path: string;
  label: string;
  kind?: 'number' | 'boolean' | 'text';
  optional?: boolean;
  advanced?: boolean;
  choices?: readonly string[];
  suggestions?: readonly string[];
}

export function hasFieldValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && String(value).trim() !== '';
}

/** Optional fields stay mounted in their original position. Promoting a filled
 * field out of a collapsed disclosure must not remount it or steal input focus. */
export function ItemField({
  item,
  spec,
  more,
}: {
  item: InventoryItemOut;
  spec: ItemFieldSpec;
  more: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const draft = useDraftField<unknown>({
    name: `${item.name}: ${spec.label}`,
    serverValue: readPath(item, spec.path),
    format: (value) => (value == null ? '' : String(value)),
    parse: (raw) => {
      if (spec.kind === 'boolean') return raw === 'true';
      if (raw.trim() === '' && spec.optional) return null;
      if (spec.kind !== 'number') return raw.trim();
      if (raw.trim() === '' || !Number.isFinite(Number(raw))) throw new Error('Enter a number');
      return Number(raw);
    },
    onSave: (value) => writeItemPath(item.id, spec.path, value, spec.label),
    enqueueOnCommit: { readCommitted: () => readItemPath(item.id, spec.path) },
    flashKey: makeFlashKey('character_inventory', item.id, spec.path.split('.')[0] as string),
  });
  const filled = hasFieldValue(spec.kind === 'boolean' ? draft.value === 'true' : draft.value);
  const visible = !spec.advanced || more || filled || focused || draft.flashing;
  const className = 'field-rollback-flash input input-sm input-bordered w-full min-w-0';
  const common = {
    ...draft.inputProps,
    id,
    onFocus: () => setFocused(true),
    onBlur: () => {
      draft.commit();
      setFocused(false);
    },
    'aria-invalid': draft.error != null,
    'aria-describedby': draft.error ? `${id}-error` : undefined,
  };

  return (
    <div hidden={!visible} className="min-w-0">
      {spec.kind === 'boolean' ? (
        <label htmlFor={id} className="flex min-h-9 items-center gap-2 text-sm">
          <input
            {...common}
            type="checkbox"
            checked={draft.value === 'true'}
            className="field-rollback-flash checkbox checkbox-sm"
            onChange={(event) => {
              draft.setValue(String(event.target.checked));
              draft.commit();
            }}
          />
          {spec.label}
        </label>
      ) : (
        <label htmlFor={id} className="flex flex-col gap-1 text-sm">
          <span className="label-eyebrow">{spec.label}</span>
          {spec.choices ? (
            <select
              {...common}
              className="field-rollback-flash select select-sm select-bordered w-full"
              onChange={(event) => {
                draft.setValue(event.target.value);
                draft.commit();
              }}
            >
              {spec.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <input
              {...common}
              className={className}
              inputMode={spec.kind === 'number' ? 'decimal' : undefined}
              list={spec.suggestions ? `${id}-suggestions` : undefined}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          )}
        </label>
      )}
      {spec.suggestions && (
        <datalist id={`${id}-suggestions`}>
          {spec.suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      {draft.error && (
        <p id={`${id}-error`} className="text-xs text-error mt-1">
          {draft.error}
        </p>
      )}
    </div>
  );
}
