import { useId } from 'react';
import {
  type EnchantmentApplicability,
  type EnchantmentEffectTarget,
  type EnchantmentMechanics,
  enchantmentMechanics,
} from '../../../../../shared/schemas/inventory.ts';
import { SkillReferenceCombobox } from '../../../../components/ui/SkillReferenceCombobox.tsx';
import { newEditorId } from '../../../library/editorId.ts';
import { ENCHANTMENT_APPLICABILITY_LABELS, ENCHANTMENT_EFFECT_LABELS } from './enchantmentText.ts';

const MAX_EFFECTS = 30;
const MAX_LEVELS = 20;

export interface EffectDraft {
  key: string;
  target: EnchantmentEffectTarget;
  value: string;
  skillName: string;
}
export interface LevelDraft {
  key: string;
  level: string;
  label: string;
  effects: EffectDraft[];
}
/** Strings while typing; numbers only once the whole draft validates. */
export interface MechanicsDraft {
  applicability: EnchantmentApplicability;
  stacking: 'stack' | 'highest';
  stackingKey: string;
  effects: EffectDraft[];
  levels: LevelDraft[];
}

function effectDraft(effect?: EnchantmentMechanics['effects'][number]): EffectDraft {
  return {
    key: newEditorId(),
    target: effect?.target ?? 'dr',
    value: effect ? String(effect.value) : '1',
    skillName: effect?.skillName ?? '',
  };
}

export function mechanicsDraft(mechanics: EnchantmentMechanics | null | undefined): MechanicsDraft {
  return {
    applicability: mechanics?.applicability ?? 'any',
    stacking: mechanics?.stackingPolicy.kind ?? 'stack',
    stackingKey: mechanics?.stackingPolicy.kind === 'highest' ? mechanics.stackingPolicy.key : '',
    effects: (mechanics?.effects ?? []).map(effectDraft),
    levels: (mechanics?.levels ?? []).map((level) => ({
      key: newEditorId(),
      level: String(level.level),
      label: level.label ?? '',
      effects: level.effects.map(effectDraft),
    })),
  };
}

const WHOLE = /^[+-]?\d+$/;
const VALUE_ERROR = 'Enter a whole number from -100 to 100';
const LEVEL_ERROR = 'Enter a whole number from 1 to 100';

function messageFor(path: string, message: string): string {
  if (path.endsWith('.value')) return VALUE_ERROR;
  if (path.endsWith('.skillName')) return 'Choose a skill';
  if (path.endsWith('.label')) return 'Use up to 80 characters';
  if (path === 'stackingPolicy.key') return 'Name the group (up to 80 characters)';
  if (/^levels\.\d+\.level$/.test(path))
    return message.includes('unique') ? 'Use each level number once' : LEVEL_ERROR;
  if (path.endsWith('effects')) return `Use up to ${MAX_EFFECTS} effects`;
  if (path === 'levels') return `Use up to ${MAX_LEVELS} levels`;
  return message;
}

/** Validate with the shared schema; an invalid draft keeps the form open. */
export function parseMechanicsDraft(
  draft: MechanicsDraft,
): { ok: true; mechanics: EnchantmentMechanics } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const effects = (list: EffectDraft[], prefix: string) =>
    list.map((effect, index) => {
      if (!WHOLE.test(effect.value.trim())) errors[`${prefix}.${index}.value`] = VALUE_ERROR;
      return {
        target: effect.target,
        value: Number(effect.value.trim()),
        ...(effect.target === 'skill' ? { skillName: effect.skillName.trim() } : {}),
      };
    });
  const candidate = {
    applicability: draft.applicability,
    effects: effects(draft.effects, 'effects'),
    levels: draft.levels.map((level, index) => {
      if (!WHOLE.test(level.level.trim())) errors[`levels.${index}.level`] = LEVEL_ERROR;
      return {
        level: Number(level.level.trim()),
        ...(level.label.trim() ? { label: level.label.trim() } : {}),
        effects: effects(level.effects, `levels.${index}.effects`),
      };
    }),
    stackingPolicy:
      draft.stacking === 'stack'
        ? { kind: 'stack' as const }
        : { kind: 'highest' as const, key: draft.stackingKey.trim() },
  };
  const parsed = enchantmentMechanics.safeParse(candidate);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      errors[path] ??= messageFor(path, issue.message);
    }
  return Object.keys(errors).length > 0 || !parsed.success
    ? { ok: false, errors }
    : { ok: true, mechanics: parsed.data };
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="text-xs text-error mt-1">
      {message}
    </p>
  ) : null;
}

function EffectRows({
  effects,
  prefix,
  title,
  errors,
  onChange,
  campaignId,
  skillNames,
}: {
  effects: EffectDraft[];
  prefix: string;
  title: string;
  errors: Record<string, string>;
  onChange: (effects: EffectDraft[]) => void;
  campaignId?: string | null | undefined;
  skillNames: readonly string[];
}) {
  const id = useId();
  const update = (index: number, patch: Partial<EffectDraft>) =>
    onChange(effects.map((effect, i) => (i === index ? { ...effect, ...patch } : effect)));
  return (
    <div className="min-w-0 space-y-2">
      {effects.length === 0 && <p className="text-xs text-base-content/60">No effects.</p>}
      {effects.map((effect, index) => {
        const name = `${title} effect ${index + 1}`;
        const valueError = errors[`${prefix}.${index}.value`];
        const skillError = errors[`${prefix}.${index}.skillName`];
        return (
          // Narrow rows wrap; the divider keeps each effect's controls together.
          <div
            key={effect.key}
            className="flex min-w-0 flex-wrap items-start gap-2 border-b border-base-300/60 pb-2"
          >
            <select
              aria-label={name}
              value={effect.target}
              onChange={(event) =>
                update(index, { target: event.target.value as EnchantmentEffectTarget })
              }
              className="select select-sm select-bordered min-w-0 flex-[1_1_11rem]"
            >
              {Object.entries(ENCHANTMENT_EFFECT_LABELS).map(([target, label]) => (
                <option key={target} value={target}>
                  {label}
                </option>
              ))}
            </select>
            <div className="w-20 shrink-0">
              <input
                aria-label={`${name} value`}
                inputMode="numeric"
                value={effect.value}
                aria-invalid={valueError != null}
                aria-describedby={valueError ? `${id}-${index}-value` : undefined}
                onChange={(event) => update(index, { value: event.target.value })}
                className="input input-sm input-bordered w-full text-right"
              />
            </div>
            {effect.target === 'skill' && (
              <div className="min-w-0 flex-[1_1_12rem]">
                <SkillReferenceCombobox
                  aria-label={`${name} skill`}
                  value={effect.skillName}
                  onChange={(skillName) => update(index, { skillName })}
                  onPick={(option) => update(index, { skillName: option.label })}
                  campaignId={campaignId}
                  characterSkills={skillNames.map((skill) => ({
                    name: skill,
                    specialization: null,
                  }))}
                  placeholder="Skill name"
                  className="min-w-0"
                />
                <FieldError id={`${id}-${index}-skill`} message={skillError} />
              </div>
            )}
            <button
              type="button"
              aria-label={`Remove ${name.charAt(0).toLowerCase()}${name.slice(1)}`}
              onClick={() => onChange(effects.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm text-error"
            >
              Remove
            </button>
            {valueError && (
              <p id={`${id}-${index}-value`} className="basis-full text-xs text-error">
                {valueError}
              </p>
            )}
          </div>
        );
      })}
      <FieldError id={`${id}-list`} message={errors[prefix]} />
      <button
        type="button"
        className="btn btn-sm"
        disabled={effects.length >= MAX_EFFECTS}
        onClick={() => onChange([...effects, effectDraft()])}
      >
        Add {title === 'Base' ? 'effect' : `${title.toLowerCase()} effect`}
      </button>
    </div>
  );
}

/**
 * Typed effects of an independent enchantment, edited as one form: a skill
 * effect needs its skill and level numbers must be unique, so the draft is
 * validated as a whole before it is queued.
 */
export function EnchantmentMechanicsForm({
  spellName,
  draft,
  errors,
  pending,
  onChange,
  onSave,
  onCancel,
  campaignId,
  skillNames,
}: {
  spellName: string;
  draft: MechanicsDraft;
  errors: Record<string, string>;
  pending: boolean;
  onChange: (draft: MechanicsDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  campaignId?: string | null | undefined;
  skillNames: readonly string[];
}) {
  const id = useId();
  const errorCount = Object.keys(errors).length;
  const nextLevel = Math.min(
    100,
    Math.max(0, ...draft.levels.map((level) => Number(level.level) || 0)) + 1,
  );
  return (
    <form
      aria-label={`Effects of ${spellName}`}
      className="min-w-0 space-y-4 rounded-lg border border-base-300 bg-base-100 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="label-eyebrow">Applies to</span>
          <select
            value={draft.applicability}
            onChange={(event) =>
              onChange({ ...draft, applicability: event.target.value as EnchantmentApplicability })
            }
            className="select select-sm select-bordered w-full min-w-0"
          >
            {Object.entries(ENCHANTMENT_APPLICABILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="label-eyebrow">With other enchantments</span>
          <select
            value={draft.stacking}
            onChange={(event) =>
              onChange({ ...draft, stacking: event.target.value as MechanicsDraft['stacking'] })
            }
            className="select select-sm select-bordered w-full min-w-0"
          >
            <option value="stack">Adds to other bonuses</option>
            <option value="highest">Only the highest in a group applies</option>
          </select>
        </label>
        {draft.stacking === 'highest' && (
          <label className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2">
            <span className="label-eyebrow">Group</span>
            <input
              value={draft.stackingKey}
              maxLength={80}
              placeholder="e.g. fortify"
              aria-invalid={errors['stackingPolicy.key'] != null}
              aria-describedby={errors['stackingPolicy.key'] ? `${id}-group` : undefined}
              onChange={(event) => onChange({ ...draft, stackingKey: event.target.value })}
              className="input input-sm input-bordered w-full min-w-0"
            />
            <FieldError id={`${id}-group`} message={errors['stackingPolicy.key']} />
          </label>
        )}
      </div>
      <section className="min-w-0 space-y-2" aria-label="Effects">
        <h5 className="label-eyebrow">Effects</h5>
        <EffectRows
          effects={draft.effects}
          prefix="effects"
          title="Base"
          errors={errors}
          onChange={(effects) => onChange({ ...draft, effects })}
          campaignId={campaignId}
          skillNames={skillNames}
        />
      </section>
      <section className="min-w-0 space-y-2" aria-label="Levels">
        <h5 className="label-eyebrow">Levels</h5>
        {draft.levels.length > 0 && (
          <p className="text-xs text-base-content/60">
            A level’s effects apply when the enchantment’s level matches it.
          </p>
        )}
        {draft.levels.map((level, index) => {
          const update = (patch: Partial<LevelDraft>) =>
            onChange({
              ...draft,
              levels: draft.levels.map((row, i) => (i === index ? { ...row, ...patch } : row)),
            });
          const title = `Level ${index + 1}`;
          return (
            <fieldset
              key={level.key}
              className="min-w-0 space-y-3 rounded-lg border border-base-300 p-3"
            >
              <legend className="px-2 text-xs">{title}</legend>
              <div className="flex min-w-0 flex-wrap items-start gap-2">
                <label className="flex w-24 shrink-0 flex-col gap-1 text-sm">
                  <span className="label-eyebrow">Level</span>
                  <input
                    aria-label={`${title} number`}
                    inputMode="numeric"
                    value={level.level}
                    aria-invalid={errors[`levels.${index}.level`] != null}
                    onChange={(event) => update({ level: event.target.value })}
                    className="input input-sm input-bordered w-full text-right"
                  />
                </label>
                <label className="flex min-w-0 flex-[1_1_10rem] flex-col gap-1 text-sm">
                  <span className="label-eyebrow">Label</span>
                  <input
                    aria-label={`${title} label`}
                    value={level.label}
                    maxLength={80}
                    placeholder="e.g. Greater"
                    onChange={(event) => update({ label: event.target.value })}
                    className="input input-sm input-bordered w-full min-w-0"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error self-end"
                  aria-label={`Remove level ${index + 1}`}
                  onClick={() =>
                    onChange({ ...draft, levels: draft.levels.filter((_, i) => i !== index) })
                  }
                >
                  Remove level
                </button>
              </div>
              <FieldError
                id={`${id}-level-${index}`}
                message={errors[`levels.${index}.level`] ?? errors[`levels.${index}.label`]}
              />
              <EffectRows
                effects={level.effects}
                prefix={`levels.${index}.effects`}
                title={title}
                errors={errors}
                onChange={(effects) => update({ effects })}
                campaignId={campaignId}
                skillNames={skillNames}
              />
            </fieldset>
          );
        })}
        <FieldError id={`${id}-levels`} message={errors.levels} />
        <button
          type="button"
          className="btn btn-sm"
          disabled={draft.levels.length >= MAX_LEVELS}
          onClick={() =>
            onChange({
              ...draft,
              levels: [
                ...draft.levels,
                { key: newEditorId(), level: String(nextLevel), label: '', effects: [] },
              ],
            })
          }
        >
          Add level
        </button>
      </section>
      {errorCount > 0 && (
        <p role="alert" className="text-sm text-error">
          Fix the {errorCount === 1 ? 'highlighted field' : `${errorCount} highlighted fields`}{' '}
          before saving.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          Save effects
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
