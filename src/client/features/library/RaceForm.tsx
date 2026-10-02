import { useEffect, useRef, useState } from 'react';
import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../../../shared/constants/skills.ts';
import { TRAIT_KINDS } from '../../../shared/constants/traits.ts';
import { validateRaceDefinition } from '../../../shared/domain/race.ts';
import { libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import {
  type LibraryRaceCreate,
  type LibraryRaceOut,
  RACE_ATTRIBUTE_AXES,
  type RaceOption,
  type RaceProfile,
  libraryRaceCreate,
  raceProfile,
} from '../../../shared/schemas/race.ts';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { EffectsEditor } from './EffectsEditor.tsx';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { RACE_AXIS_LABELS } from './RaceSummary.tsx';
import { newEditorId } from './editorId.ts';
import { libraryFormError } from './libraryFormErrors.ts';

const input = 'input input-sm w-full';
function TextField({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="form-control min-w-0">
      <span className="label-text">{label}</span>
      <input
        className={input}
        type={numeric ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Lines({
  label,
  values,
  onChange,
}: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const serialized = values.join('\n');
  const [raw, setRaw] = useState(serialized);
  const published = useRef(serialized);
  useEffect(() => {
    if (published.current !== serialized) {
      published.current = serialized;
      setRaw(serialized);
    }
  }, [serialized]);
  return (
    <label className="form-control min-w-0">
      <span className="label-text">{label} (one per line)</span>
      <textarea
        className="textarea w-full"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const lines = e.target.value.split('\n').filter((v) => v.trim());
          published.current = lines.join('\n');
          onChange(lines);
        }}
      />
    </label>
  );
}
/** Stable editor identities are separate from author-editable component keys. */
function useEditorRowIds(count: number) {
  const ids = useRef<string[]>([]);
  while (ids.current.length < count) ids.current.push(newEditorId());
  return ids.current;
}

export function RaceProfileEditor({
  value,
  onChange,
  validity,
  prefix,
}: {
  value: RaceProfile;
  onChange: (v: RaceProfile) => void;
  validity: (key: string, valid: boolean) => void;
  prefix: string;
}) {
  const traitIds = useEditorRowIds(value.traits.length);
  const skillIds = useEditorRowIds(value.skills.length);
  const patch = (v: Partial<RaceProfile>) => onChange({ ...value, ...v });
  return (
    <div className="space-y-3 min-w-0">
      <TextField
        label="Package points"
        numeric
        value={value.points}
        onChange={(v) => patch({ points: Number(v) })}
      />
      <p className="text-sm text-base-content/70">
        The package total includes its attributes, traits, and racial skill purchases.
      </p>
      <fieldset className="fieldset">
        <legend className="fieldset-legend">Attribute adjustments</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {RACE_ATTRIBUTE_AXES.map((axis) => (
            <TextField
              key={axis}
              label={RACE_AXIS_LABELS[axis]}
              numeric
              value={value.attributeModifiers[axis] ?? 0}
              onChange={(v) =>
                patch({ attributeModifiers: { ...value.attributeModifiers, [axis]: Number(v) } })
              }
            />
          ))}
        </div>
      </fieldset>
      <LibraryAdvancedFields title={`Component traits · ${value.traits.length}`}>
        {value.traits.map((trait, i) => (
          <fieldset className="fieldset border-b border-base-300 pb-3 min-w-0" key={traitIds[i]}>
            <legend className="fieldset-legend">Trait {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Trait name"
                value={trait.name}
                onChange={(name) =>
                  patch({ traits: value.traits.map((t, n) => (n === i ? { ...t, name } : t)) })
                }
              />
              <label className="form-control">
                Kind
                <select
                  className="select select-sm w-full"
                  value={trait.kind}
                  onChange={(e) =>
                    patch({
                      traits: value.traits.map((t, n) =>
                        n === i ? { ...t, kind: e.target.value as typeof t.kind } : t,
                      ),
                    })
                  }
                >
                  {TRAIT_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <TextField
                label="Trait points"
                numeric
                value={trait.points}
                onChange={(v) =>
                  patch({
                    traits: value.traits.map((t, n) => (n === i ? { ...t, points: Number(v) } : t)),
                  })
                }
              />
              <TextField
                label="Trait level (optional)"
                numeric
                value={trait.level ?? ''}
                onChange={(v) =>
                  patch({
                    traits: value.traits.map((t, n) =>
                      n === i ? { ...t, level: v === '' ? null : Number(v) } : t,
                    ),
                  })
                }
              />
              <TextField
                label="Component key"
                value={trait.key}
                onChange={(key) =>
                  patch({ traits: value.traits.map((t, n) => (n === i ? { ...t, key } : t)) })
                }
              />
              <TextField
                label="Trait description"
                value={trait.description ?? ''}
                onChange={(description) =>
                  patch({
                    traits: value.traits.map((t, n) => (n === i ? { ...t, description } : t)),
                  })
                }
              />
            </div>
            <EffectsEditor
              effects={trait.effects}
              onChange={(effects) =>
                patch({ traits: value.traits.map((t, n) => (n === i ? { ...t, effects } : t)) })
              }
              onValidityChange={(valid) => validity(`${prefix}:trait:${traitIds[i]}`, valid)}
            />
            <button
              type="button"
              className="btn btn-sm justify-self-start"
              onClick={() => {
                validity(`${prefix}:trait:${traitIds[i]}`, true);
                traitIds.splice(i, 1);
                patch({ traits: value.traits.filter((_, n) => n !== i) });
              }}
            >
              Remove trait {i + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            patch({
              traits: [
                ...value.traits,
                {
                  key: newEditorId(),
                  name: '',
                  kind: 'advantage',
                  points: 0,
                  level: null,
                  description: null,
                  effects: [],
                },
              ],
            })
          }
        >
          Add component trait
        </button>
      </LibraryAdvancedFields>
      <LibraryAdvancedFields title={`Racial skill purchases · ${value.skills.length}`}>
        {value.skills.map((skill, i) => {
          const update = (p: Partial<typeof skill>) =>
            patch({ skills: value.skills.map((s, n) => (n === i ? { ...s, ...p } : s)) });
          return (
            <fieldset className="fieldset border-b border-base-300 pb-3" key={skillIds[i]}>
              <legend className="fieldset-legend">Skill {i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Skill name"
                  value={skill.name}
                  onChange={(name) => update({ name })}
                />
                <TextField
                  label="Purchased points"
                  numeric
                  value={skill.points}
                  onChange={(v) => update({ points: Number(v) })}
                />
                <label>
                  Attribute
                  <select
                    className="select select-sm w-full"
                    value={skill.attribute ?? ''}
                    onChange={(e) =>
                      update({ attribute: (e.target.value || null) as typeof skill.attribute })
                    }
                  >
                    <option value="">Unspecified</option>
                    {SKILL_ATTRIBUTES.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Difficulty
                  <select
                    className="select select-sm w-full"
                    value={skill.difficulty ?? ''}
                    onChange={(e) =>
                      update({ difficulty: (e.target.value || null) as typeof skill.difficulty })
                    }
                  >
                    <option value="">Unspecified</option>
                    {SKILL_DIFFICULTIES.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <TextField
                  label="Specialization"
                  value={skill.specialization ?? ''}
                  onChange={(v) => update({ specialization: v || null })}
                />
                <TextField
                  label="Tech level (optional)"
                  numeric
                  value={skill.techLevel ?? ''}
                  onChange={(v) => update({ techLevel: v === '' ? null : Number(v) })}
                />
                <TextField
                  label="Skill key"
                  value={skill.key}
                  onChange={(key) => update({ key })}
                />
                <TextField
                  label="Skill description"
                  value={skill.description ?? ''}
                  onChange={(description) => update({ description })}
                />
              </div>
              <button
                type="button"
                className="btn btn-sm justify-self-start"
                onClick={() => {
                  skillIds.splice(i, 1);
                  patch({ skills: value.skills.filter((_, n) => n !== i) });
                }}
              >
                Remove skill {i + 1}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            patch({
              skills: [
                ...value.skills,
                {
                  key: newEditorId(),
                  name: '',
                  points: 0,
                  attribute: null,
                  difficulty: null,
                  specialization: null,
                  techLevel: null,
                  description: null,
                },
              ],
            })
          }
        >
          Add racial skill
        </button>
      </LibraryAdvancedFields>
      <Lines
        label="Features"
        values={value.features}
        onChange={(features) => patch({ features })}
      />
      <LibraryAdvancedFields title="Permanent effects">
        <EffectsEditor
          effects={value.effects}
          onChange={(effects) => patch({ effects })}
          onValidityChange={(valid) => validity(`${prefix}:effects`, valid)}
        />
      </LibraryAdvancedFields>
    </div>
  );
}
export function RaceForm({
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: LibraryRaceOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryRaceCreate) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<LibraryRaceCreate>(() =>
    libraryRaceCreate.parse(
      initial
        ? Object.fromEntries(
            Object.keys(libraryRaceCreate.shape).map((k) => [
              k,
              initial[k as keyof LibraryRaceOut],
            ]),
          )
        : { name: 'New race' },
    ),
  );
  const variantIds = useEditorRowIds(value.variants.length);
  const formIds = useEditorRowIds(value.forms.length);
  const optionIds = { variants: variantIds, forms: formIds };
  const [formError, setFormError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const validity = (key: string, valid: boolean) =>
    setInvalid((old) => (old[key] === !valid ? old : { ...old, [key]: !valid }));
  const patch = (v: Partial<LibraryRaceCreate>) => setValue((old) => ({ ...old, ...v }));
  const options = (field: 'variants' | 'forms', label: string) => (
    <LibraryAdvancedFields
      title={`${label} · ${value[field].length}`}
      hint={
        field === 'variants'
          ? 'Each variant is a complete replacement profile.'
          : 'Each form is a complete physical profile. The selected race or variant determines the purchase cost.'
      }
    >
      {value[field].map((option, i) => (
        <fieldset
          key={optionIds[field][i]}
          className="fieldset border-b border-base-300 pb-4 min-w-0"
        >
          <legend className="fieldset-legend">
            {label} {i + 1}
          </legend>
          <TextField
            label="Option name"
            value={option.name}
            onChange={(name) =>
              patch({ [field]: value[field].map((o, n) => (n === i ? { ...o, name } : o)) })
            }
          />
          <TextField
            label="Option key"
            value={option.key}
            onChange={(key) =>
              patch({ [field]: value[field].map((o, n) => (n === i ? { ...o, key } : o)) })
            }
          />
          <TextField
            label="Option description"
            value={option.description ?? ''}
            onChange={(description) =>
              patch({ [field]: value[field].map((o, n) => (n === i ? { ...o, description } : o)) })
            }
          />
          <RaceProfileEditor
            value={option}
            prefix={`${field}:${optionIds[field][i]}`}
            validity={validity}
            onChange={(profile) =>
              patch({ [field]: value[field].map((o, n) => (n === i ? { ...o, ...profile } : o)) })
            }
          />
          <button
            type="button"
            className="btn btn-sm justify-self-start"
            onClick={() => {
              const removedPrefix = `${field}:${optionIds[field][i]}:`;
              setInvalid((old) =>
                Object.fromEntries(
                  Object.entries(old).filter(([k]) => !k.startsWith(removedPrefix)),
                ),
              );
              optionIds[field].splice(i, 1);
              patch({ [field]: value[field].filter((_, n) => n !== i) });
            }}
          >
            Remove option {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        onClick={() =>
          patch({
            [field]: [
              ...value[field],
              {
                ...raceProfile.parse({}),
                key: newEditorId(),
                name: '',
                description: null,
              } satisfies RaceOption,
            ],
          })
        }
      >
        Add {field === 'variants' ? 'variant' : 'form'}
      </button>
    </LibraryAdvancedFields>
  );
  return (
    <fieldset className="fieldset min-w-0 space-y-3" disabled={isPending}>
      <legend className="sr-only">{initial ? 'Edit race' : 'Add race'}</legend>
      <TextField
        label="Race or lens name"
        value={value.name}
        onChange={(name) => patch({ name })}
      />
      <label>
        Definition type
        <select
          className="select select-sm w-full"
          value={value.kind}
          onChange={(e) => patch({ kind: e.target.value as 'race' | 'lens' })}
        >
          <option value="race">Race</option>
          <option value="lens">Lens</option>
        </select>
      </label>
      <TextField
        label="Source abbreviation"
        value={value.source ?? ''}
        onChange={(source) => patch({ source })}
      />
      <RichTextEditor
        aria-label="Race description"
        value={value.description ?? ''}
        onChange={(description) => patch({ description })}
      />
      <RaceProfileEditor
        value={value}
        onChange={(profile) => patch(profile)}
        prefix="base"
        validity={validity}
      />
      {(value.kind === 'race' || value.variants.length > 0 || value.forms.length > 0) && (
        <>
          {options('variants', 'Variants')}
          {options('forms', 'Alternate forms')}
        </>
      )}
      {(value.kind === 'lens' ||
        value.compatibleRaceKeys.length > 0 ||
        value.removesTraits.length > 0 ||
        value.removesSkills.length > 0) && (
        <>
          <Lines
            label="Compatible race keys"
            values={value.compatibleRaceKeys}
            onChange={(compatibleRaceKeys) => patch({ compatibleRaceKeys })}
          />
          <p className="text-sm text-base-content/70">
            Leave compatibility empty to allow any race. Use human for the default Human race.
          </p>
          <Lines
            label="Replaced trait keys"
            values={value.removesTraits}
            onChange={(removesTraits) => patch({ removesTraits })}
          />
          <Lines
            label="Replaced skill keys"
            values={value.removesSkills}
            onChange={(removesSkills) => patch({ removesSkills })}
          />
        </>
      )}
      <LibraryMetadataEditor
        value={libraryMetadata.parse(value)}
        onChange={(metadata) => patch(metadata)}
      />
      <LibraryFormFooter
        noun="race"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(value.name.trim()) && !Object.values(invalid).some(Boolean)}
        error={error || formError}
        onCancel={onCancel}
        onSubmit={() => {
          try {
            const body = libraryRaceCreate.parse(value);
            validateRaceDefinition(body);
            onSubmit(body);
            setFormError(null);
          } catch (cause) {
            setFormError(libraryFormError(cause));
          }
        }}
      />
    </fieldset>
  );
}
