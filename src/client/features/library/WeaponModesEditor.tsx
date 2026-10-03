import { useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import { normalizeWeaponData } from '../../../shared/domain/weaponModes.ts';
import { type WeaponData, type WeaponMode, weaponData } from '../../../shared/schemas/inventory.ts';
import { RangedRangeInputs } from '../characters/sections/inventory/RangedRangeField.tsx';
import { StructuredFields } from './StructuredFields.tsx';
import { newEditorId } from './editorId.ts';
import { libraryFormError } from './libraryFormErrors.ts';

function readDraft(text: string): unknown {
  try {
    return text.trim() ? parse(text) : null;
  } catch {
    return null;
  }
}

/** Incomplete text belongs to the draft until the schema accepts a number. */
function numberDraft(text: string): number | null {
  if (text.trim() === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : (text as unknown as number);
}

/** Concise attack modes and complete typed fields share one weapon draft. */
export function WeaponModesEditor({
  text,
  onChange,
}: { text: string; onChange: (text: string) => void }) {
  const identities = useRef(new WeakMap<object, string>());
  function identity(mode: object): string {
    const known = identities.current.get(mode);
    if (known) return known;
    const id = newEditorId();
    identities.current.set(mode, id);
    return id;
  }
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<unknown>(() => readDraft(text));
  const [data, setData] = useState<WeaponData | null>(() => {
    const result = weaponData.nullable().safeParse(readDraft(text));
    return result.success ? normalizeWeaponData(result.data) : null;
  });
  function update(next: WeaponData | null) {
    setData(next);
    setDraft(next);
    const result = weaponData.nullable().safeParse(next);
    setError(result.success ? '' : libraryFormError(result.error));
    onChange(next ? stringify(next) : '');
  }
  function toggle() {
    if (advanced) {
      try {
        setData(text.trim() ? normalizeWeaponData(weaponData.parse(parse(text))) : null);
        setError('');
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    } else {
      setDraft(readDraft(text));
    }
    setAdvanced(!advanced);
  }
  return (
    <fieldset className="fieldset min-w-0 rounded-box border border-base-300 p-3">
      <legend className="fieldset-legend">Weapon and shield facets</legend>
      <button type="button" className="btn btn-sm w-fit" onClick={toggle}>
        {advanced ? 'Visual modes' : 'All weapon fields'}
      </button>
      {advanced ? (
        <StructuredFields
          schema={weaponData.nullable()}
          value={draft}
          label="Weapon data"
          path="weaponData"
          onChange={(next) => {
            setDraft(next);
            const result = weaponData.nullable().safeParse(next);
            setError(result.success ? '' : libraryFormError(result.error));
            if (result.success) setData(normalizeWeaponData(result.data));
            onChange(next == null ? '' : stringify(next));
          }}
        />
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={data !== null}
              onChange={(e) =>
                update(
                  e.target.checked
                    ? { alternateModes: [], modes: [{ key: 'primary', name: 'Primary' }] }
                    : null,
                )
              }
            />{' '}
            Weapon or shield
          </label>
          {data && (
            <>
              <label>
                Held side
                <select
                  className="select select-sm min-w-0 w-full"
                  value={data.wieldedSide ?? ''}
                  onChange={(event) =>
                    update({
                      ...data,
                      wieldedSide: event.target.value
                        ? (event.target.value as 'left' | 'right')
                        : undefined,
                    })
                  }
                >
                  <option value="">Not specified</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label>
                Shield defense bonus (blank for no shield)
                <input
                  className="input input-sm w-full"
                  type="text"
                  inputMode="decimal"
                  min={0}
                  max={4}
                  value={data.db ?? ''}
                  onChange={(e) => update({ ...data, db: numberDraft(e.target.value) })}
                />
              </label>
              {(data.modes ?? []).map((mode, index) => {
                const change = (patch: Partial<typeof mode>) =>
                  update({
                    ...data,
                    modes: (data.modes ?? []).map((m, i) => {
                      if (i !== index) return m;
                      const next = { ...m, ...patch };
                      identities.current.set(next, identity(m));
                      return next;
                    }),
                  });
                return (
                  <fieldset
                    key={identity(mode)}
                    className="fieldset min-w-0 border-t border-base-300 pt-3"
                  >
                    <legend className="fieldset-legend">Mode {index + 1}</legend>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      {(['key', 'name', 'skill', 'damage', 'reach', 'parry'] as const).map(
                        (field) => (
                          <label key={field} className="min-w-0">
                            {field === 'key' ? 'Stable mode key' : field}
                            <input
                              className="input input-sm w-full"
                              value={mode[field] ?? ''}
                              onChange={(e) => change({ [field]: e.target.value })}
                            />
                          </label>
                        ),
                      )}
                      <label>
                        Minimum ST
                        <input
                          className="input input-sm w-full"
                          type="text"
                          inputMode="decimal"
                          min={0}
                          max={99}
                          value={mode.stRequired ?? ''}
                          onChange={(e) =>
                            change({
                              stRequired: numberDraft(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Purchased weapon ST
                      <input
                        className="input input-sm w-full"
                        type="text"
                        inputMode="numeric"
                        value={mode.weaponSt ?? ''}
                        onChange={(event) => change({ weaponSt: numberDraft(event.target.value) })}
                      />
                    </label>
                    <label>
                      Damage strength rule
                      <select
                        className="select select-sm w-full"
                        value={mode.strengthKind ?? ''}
                        onChange={(event) =>
                          change({
                            strengthKind: (event.target.value ||
                              null) as WeaponMode['strengthKind'],
                          })
                        }
                      >
                        <option value="">Automatic from governing skill</option>
                        {['ordinary', 'bow', 'crossbow', 'natural'].map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={!!mode.ranged}
                        onChange={(e) => change({ ranged: e.target.checked ? {} : null })}
                      />{' '}
                      Ranged statistics
                    </label>
                    {mode.ranged && (
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                        {(['acc', 'rof', 'shots', 'bulk', 'recoil'] as const).map((field) => (
                          <label key={field}>
                            {field}
                            <input
                              className="input input-sm w-full"
                              value={mode.ranged?.[field] ?? ''}
                              onChange={(e) =>
                                change({
                                  ranged: {
                                    ...mode.ranged,
                                    [field]:
                                      e.target.value === ''
                                        ? null
                                        : ['acc', 'bulk', 'recoil'].includes(field)
                                          ? numberDraft(e.target.value)
                                          : e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                        <div className="sm:col-span-2">
                          <RangedRangeInputs
                            value={mode.ranged.range}
                            onChange={(range) => change({ ranged: { ...mode.ranged, range } })}
                          />
                        </div>
                      </div>
                    )}
                    <label>
                      Mode notes
                      <textarea
                        className="textarea w-full"
                        value={mode.notes ?? ''}
                        onChange={(e) => change({ notes: e.target.value })}
                      />
                    </label>
                    <label>
                      Preserved source row
                      <textarea
                        className="textarea w-full"
                        value={mode.sourceRow ?? ''}
                        onChange={(e) => change({ sourceRow: e.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm w-fit"
                      disabled={(data.modes?.length ?? 0) <= 1}
                      onClick={() =>
                        update({ ...data, modes: (data.modes ?? []).filter((_, i) => i !== index) })
                      }
                    >
                      Remove mode
                    </button>
                  </fieldset>
                );
              })}
              <button
                type="button"
                className="btn btn-sm w-fit"
                disabled={(data.modes?.length ?? 0) >= 20}
                onClick={() =>
                  update({
                    ...data,
                    modes: [...(data.modes ?? []), { key: newEditorId(), name: 'New mode' }],
                  })
                }
              >
                Add attack mode
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-error break-words">
          {error}
        </p>
      )}
    </fieldset>
  );
}
