import { useEffect, useId, useState } from 'react';
import { parse, stringify } from 'yaml';
import { HIT_LOCATIONS } from '../../../shared/constants/hitLocations.ts';
import { type ArmorData, armorData } from '../../../shared/schemas/inventory.ts';
import { StructuredFields } from './StructuredFields.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

const DR_TYPES = [
  ['cut', 'Cutting'],
  ['imp', 'Impaling'],
  ['pi', 'Piercing'],
  ['pi_minus', 'Small piercing'],
  ['pi_plus', 'Large piercing'],
  ['pi_pp', 'Huge piercing'],
  ['burn', 'Burning'],
  ['corr', 'Corrosion'],
  ['fat', 'Fatigue'],
  ['tox', 'Toxic'],
] as const;

function readArmor(text: string): { data: ArmorData | null; error: string | null } {
  if (!text.trim()) return { data: null, error: null };
  try {
    return { data: armorData.parse(parse(text)), error: null };
  } catch (cause) {
    return {
      data: null,
      error: libraryFormError(cause, {
        dr: 'DR',
        drCrushing: 'Crushing DR',
        typedDr: 'Damage-type DR',
        locations: 'Coverage',
      }),
    };
  }
}

function readDraft(text: string): unknown {
  try {
    return text.trim() ? parse(text) : null;
  } catch {
    return null;
  }
}

/** Visual coverage and complete typed fields share the same armor draft. */
export function ArmorFacetEditor({
  text,
  onChange,
  onValidityChange,
}: {
  text: string;
  onChange: (text: string) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [initial] = useState(() => readArmor(text));
  const armorDrErrorId = `armor-dr-error-${useId()}`;
  const [advanced, setAdvanced] = useState(Boolean(initial.error));
  const [error, setError] = useState(initial.error ?? '');
  const [custom, setCustom] = useState('');
  const [data, setData] = useState<ArmorData | null>(initial.data);
  const [draft, setDraft] = useState<unknown>(() => readDraft(text));

  function update(next: ArmorData | null) {
    setData(next);
    setDraft(next);
    setError('');
    onChange(next ? stringify(next) : '');
  }

  function toggleAdvanced() {
    if (advanced) {
      const result = readArmor(text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setData(result.data);
      setError('');
      setAdvanced(false);
      return;
    }
    setAdvanced(true);
    setDraft(readDraft(text));
  }

  const locations = data?.locations ?? [];
  const customLocations = locations.filter(
    (location) => !HIT_LOCATIONS.includes(location as (typeof HIT_LOCATIONS)[number]),
  );
  const facingConflict = Boolean(data?.frontOnly && data.backOnly);
  useEffect(() => {
    onValidityChange?.(
      !error && !facingConflict && (data === null || armorData.safeParse(data).success),
    );
  }, [data, error, facingConflict, onValidityChange]);
  function numericError(value: number, label: string): string | null {
    if (!Number.isInteger(value)) return `${label} must be a whole number.`;
    if (value < 0 || value > 1000) return `${label} must be between 0 and 1000.`;
    return null;
  }
  return (
    <fieldset className="fieldset min-w-0 space-y-3 rounded-box border border-base-300 p-3">
      <legend className="fieldset-legend">Armor protection</legend>
      <button type="button" className="btn btn-sm w-fit" onClick={toggleAdvanced}>
        {advanced ? 'Visual armor fields' : 'All armor fields'}
      </button>
      {advanced ? (
        <StructuredFields
          schema={armorData.nullable()}
          value={draft}
          label="Armor data"
          path="armor"
          onChange={(next) => {
            setDraft(next);
            const result = armorData.nullable().safeParse(next);
            setError(result.success ? '' : libraryFormError(result.error));
            if (result.success) setData(result.data);
            onChange(next == null ? '' : stringify(next));
          }}
        />
      ) : (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={data !== null}
              onChange={(event) => update(event.target.checked ? armorData.parse({}) : null)}
            />
            <span>Armor item</span>
          </label>
          {data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text">Damage resistance (DR)</span>
                  <input
                    aria-label="Damage resistance (DR)"
                    aria-invalid={Boolean(numericError(data.dr, 'DR'))}
                    aria-describedby={numericError(data.dr, 'DR') ? armorDrErrorId : undefined}
                    type="number"
                    min={0}
                    max={1000}
                    className="input input-sm input-bordered w-full"
                    value={data.dr}
                    onChange={(event) => update({ ...data, dr: Number(event.target.value) })}
                  />
                  {numericError(data.dr, 'DR') && (
                    <span id={armorDrErrorId} className="label text-error" role="alert">
                      {numericError(data.dr, 'DR')}
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 self-end pb-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={data.flexible}
                    onChange={(event) => update({ ...data, flexible: event.target.checked })}
                  />
                  <span>Flexible armor</span>
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={data.concealable ?? false}
                  onChange={(event) => update({ ...data, concealable: event.target.checked })}
                />
                <span>Concealable inner layer (B286)</span>
              </label>
              <fieldset className="fieldset min-w-0">
                <legend className="fieldset-legend">Protected locations</legend>
                <p className="text-sm text-base-content/70">
                  Choose the locations this armor protects. Torso also covers vitals.
                </p>
                {locations.length === 0 && (
                  <p className="text-sm text-warning">No protected locations selected.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {HIT_LOCATIONS.map((location) => (
                    <button
                      key={location}
                      type="button"
                      aria-pressed={locations.includes(location)}
                      className={`btn btn-xs ${locations.includes(location) ? 'btn-primary' : 'btn-ghost border-base-300'}`}
                      onClick={() =>
                        update({
                          ...data,
                          locations: locations.includes(location)
                            ? locations.filter((value) => value !== location)
                            : [...locations, location],
                        })
                      }
                    >
                      {location.replaceAll('_', ' ')}
                    </button>
                  ))}
                </div>
                {customLocations.length > 0 && (
                  <div aria-label="Custom covered locations" className="flex flex-wrap gap-2">
                    {customLocations.map((location) => (
                      <button
                        key={location}
                        type="button"
                        className="btn btn-xs btn-ghost border-base-300"
                        aria-label={`Remove location ${location}`}
                        onClick={() =>
                          update({
                            ...data,
                            locations: locations.filter((value) => value !== location),
                          })
                        }
                      >
                        {location} ×
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input input-sm input-bordered min-w-0 flex-1"
                    aria-label="Custom armor location"
                    maxLength={40}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder="Custom location"
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!custom.trim()}
                    onClick={() => {
                      const location = custom.trim();
                      if (!location) return;
                      update({ ...data, locations: [...new Set([...locations, location])] });
                      setCustom('');
                    }}
                  >
                    Add location
                  </button>
                </div>
              </fieldset>
              <details>
                <summary className="cursor-pointer font-medium">Damage-type DR overrides</summary>
                <div className="grid gap-2 pt-3 sm:grid-cols-2">
                  {DR_TYPES.map(([key, label]) => {
                    const value = data.typedDr[key];
                    return (
                      <label key={key} className="form-control">
                        <span className="label-text">{label} DR</span>
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          aria-invalid={
                            value != null && Boolean(numericError(value, `${label} DR`))
                          }
                          className="input input-sm input-bordered w-full"
                          value={value ?? ''}
                          placeholder={`Use base DR (${data.dr})`}
                          onChange={(event) => {
                            const typedDr = { ...data.typedDr };
                            typedDr[key] =
                              event.target.value === '' ? null : Number(event.target.value);
                            update({ ...data, typedDr });
                          }}
                        />
                        {value != null && numericError(value, `${label} DR`) && (
                          <span className="label text-error" role="alert">
                            {numericError(value, `${label} DR`)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </details>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text">Crushing DR override</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    className="input input-sm input-bordered w-full"
                    aria-label="Crushing DR override"
                    value={data.drCrushing ?? ''}
                    placeholder={`Use base DR (${data.dr})`}
                    onChange={(event) =>
                      update({
                        ...data,
                        drCrushing: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Defense Bonus</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    className="input input-sm input-bordered w-full"
                    aria-label="Defense Bonus"
                    value={data.db ?? ''}
                    placeholder="No armor DB"
                    onChange={(event) =>
                      update({
                        ...data,
                        db: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={data.frontOnly}
                    aria-invalid={facingConflict}
                    onChange={(event) =>
                      update({
                        ...data,
                        frontOnly: event.target.checked,
                        backOnly: event.target.checked ? false : data.backOnly,
                      })
                    }
                  />
                  <span>Front only</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={data.backOnly}
                    aria-invalid={facingConflict}
                    onChange={(event) =>
                      update({
                        ...data,
                        backOnly: event.target.checked,
                        frontOnly: event.target.checked ? false : data.frontOnly,
                      })
                    }
                  />
                  <span>Back only</span>
                </label>
              </div>
              {facingConflict && (
                <p role="alert" className="text-error">
                  Choose Front only or Back only, not both.
                </p>
              )}
              <label className="form-control">
                <span className="label-text">Armor notes</span>
                <textarea
                  className="textarea textarea-bordered w-full"
                  rows={2}
                  value={data.notes ?? ''}
                  onChange={(event) => update({ ...data, notes: event.target.value || null })}
                />
              </label>
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
