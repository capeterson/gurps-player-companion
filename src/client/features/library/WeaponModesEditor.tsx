import { useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import { normalizeWeaponData } from '../../../shared/domain/weaponModes.ts';
import { type WeaponData, weaponData } from '../../../shared/schemas/inventory.ts';

/** A single editor, with lossless source mode for imported structures. */
export function WeaponModesEditor({
  text,
  onChange,
}: { text: string; onChange: (text: string) => void }) {
  const identities = useRef(new WeakMap<object, string>());
  function identity(mode: object): string {
    const known = identities.current.get(mode);
    if (known) return known;
    const id = crypto.randomUUID();
    identities.current.set(mode, id);
    return id;
  }
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<WeaponData | null>(() =>
    text.trim() ? normalizeWeaponData(weaponData.parse(parse(text))) : null,
  );
  function update(next: WeaponData | null) {
    setData(next);
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
    }
    setAdvanced(!advanced);
  }
  return (
    <fieldset className="fieldset min-w-0 rounded-box border border-base-300 p-3">
      <legend className="fieldset-legend">Weapon and shield facets</legend>
      <button type="button" className="btn btn-sm w-fit" onClick={toggle}>
        {advanced ? 'Visual modes' : 'Edit weapon YAML'}
      </button>
      {advanced ? (
        <label>
          Weapon modes (YAML)
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={10}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
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
                Shield defense bonus (blank for no shield)
                <input
                  className="input input-sm w-full"
                  type="number"
                  min={0}
                  max={4}
                  value={data.db ?? ''}
                  onChange={(e) =>
                    update({ ...data, db: e.target.value === '' ? null : Number(e.target.value) })
                  }
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
                          type="number"
                          min={0}
                          max={99}
                          value={mode.stRequired ?? ''}
                          onChange={(e) =>
                            change({
                              stRequired: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
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
                        {(['acc', 'range', 'rof', 'shots', 'bulk', 'recoil'] as const).map(
                          (field) => (
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
                                            ? Number(e.target.value)
                                            : e.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          ),
                        )}
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
                    modes: [...(data.modes ?? []), { key: crypto.randomUUID(), name: 'New mode' }],
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
