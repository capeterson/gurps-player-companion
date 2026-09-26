import { useState } from 'react';
import type {
  LibraryEnchantmentCreate,
  LibraryEnchantmentOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import type { EnchantmentEffectTarget } from '../../../shared/schemas/inventory.ts';
import { SkillReferenceCombobox } from '../../components/ui/SkillReferenceCombobox.tsx';

const ENCHANTMENT_TARGETS: readonly EnchantmentEffectTarget[] = [
  'weapon_attack',
  'weapon_damage',
  'weapon_accuracy',
  'weapon_parry',
  'weapon_block',
  'armor_divisor',
  'dr',
  'db',
  'weight_reduction_percent',
  'skill',
];

export function EnchantmentForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  campaignId: string | null;
  initial?: LibraryEnchantmentOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryEnchantmentCreate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [applicability, setApplicability] = useState<LibraryEnchantmentCreate['applicability']>(
    initial?.applicability ?? 'any',
  );
  const [stackingKind, setStackingKind] = useState<'stack' | 'highest'>(
    initial?.stackingPolicy.kind ?? 'stack',
  );
  const [stackingKey, setStackingKey] = useState(
    initial?.stackingPolicy.kind === 'highest' ? initial.stackingPolicy.key : '',
  );
  const [effects, setEffects] = useState<LibraryEnchantmentCreate['effects']>(
    initial?.effects ?? [],
  );
  const [levels, setLevels] = useState<LibraryEnchantmentCreate['levels']>(initial?.levels ?? []);
  const valid =
    name.trim() &&
    (stackingKind === 'stack' || stackingKey.trim()) &&
    effects.every((effect) => effect.target !== 'skill' || effect.skillName?.trim()) &&
    new Set(levels.map((entry) => entry.level)).size === levels.length &&
    levels.every((entry) =>
      entry.effects.every((effect) => effect.target !== 'skill' || effect.skillName?.trim()),
    );
  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control min-w-[12rem] flex-1">
          <span className="label-text">Name *</span>
          <input
            className="input input-bordered input-sm"
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="form-control w-32">
          <span className="label-text">Applies to</span>
          <select
            className="select select-bordered select-sm"
            value={applicability}
            onChange={(event) =>
              setApplicability(event.target.value as LibraryEnchantmentCreate['applicability'])
            }
          >
            {['any', 'weapon', 'armor', 'shield'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            className="input input-bordered input-sm"
            value={source}
            maxLength={40}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
      </div>
      <label className="form-control">
        <span className="label-text">Description</span>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="form-control">
        <span className="label-text">Tags (comma separated)</span>
        <input
          className="input input-bordered input-sm"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="form-control w-36">
          <span className="label-text">Stacking</span>
          <select
            className="select select-bordered select-sm"
            value={stackingKind}
            onChange={(event) => setStackingKind(event.target.value as 'stack' | 'highest')}
          >
            <option value="stack">Stack all</option>
            <option value="highest">Highest by key</option>
          </select>
        </label>
        {stackingKind === 'highest' && (
          <label className="form-control min-w-[12rem] flex-1">
            <span className="label-text">Combination key *</span>
            <input
              className="input input-bordered input-sm"
              value={stackingKey}
              maxLength={80}
              onChange={(event) => setStackingKey(event.target.value)}
              placeholder="fortify"
            />
          </label>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-text">Typed mechanics</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setEffects([...effects, { target: 'weapon_attack', value: 1 }])}
          >
            + Add effect
          </button>
        </div>
        <EnchantmentEffectRows effects={effects} campaignId={campaignId} onChange={setEffects} />
      </div>
      <div className="space-y-2 border-t border-base-300/60 pt-3">
        <div className="flex items-center justify-between">
          <span className="label-text">Optional levels</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() =>
              setLevels([
                ...levels,
                {
                  level: Math.max(0, ...levels.map((entry) => entry.level)) + 1,
                  effects: [],
                },
              ])
            }
          >
            + Add level
          </button>
        </div>
        {levels.map((level, levelIndex) => (
          <fieldset
            key={`${levelIndex}-${level.level}`}
            className="rounded-lg border p-3 space-y-2"
          >
            <legend className="px-2 text-xs">Level {levelIndex + 1}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="form-control w-24">
                <span className="label-text">Level *</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input input-bordered input-sm"
                  value={level.level}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    setLevels(
                      levels.map((entry, index) =>
                        index === levelIndex
                          ? { ...entry, level: Number.isNaN(value) ? 1 : value }
                          : entry,
                      ),
                    );
                  }}
                />
              </label>
              <label className="form-control min-w-[10rem] flex-1">
                <span className="label-text">Label</span>
                <input
                  className="input input-bordered input-sm"
                  value={level.label ?? ''}
                  onChange={(event) =>
                    setLevels(
                      levels.map((entry, index) =>
                        index === levelIndex
                          ? { ...entry, label: event.target.value || undefined }
                          : entry,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() =>
                  setLevels(
                    levels.map((entry, index) =>
                      index === levelIndex
                        ? {
                            ...entry,
                            effects: [...entry.effects, { target: 'dr', value: 1 }],
                          }
                        : entry,
                    ),
                  )
                }
              >
                + Effect
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error"
                onClick={() =>
                  setLevels(levels.filter((_, entryIndex) => entryIndex !== levelIndex))
                }
              >
                Remove level
              </button>
            </div>
            <EnchantmentEffectRows
              nested
              effects={level.effects}
              campaignId={campaignId}
              onChange={(effects) =>
                setLevels(
                  levels.map((entry, index) =>
                    index === levelIndex ? { ...entry, effects } : entry,
                  ),
                )
              }
            />
          </fieldset>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isPending || !valid}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim() || null,
              source: source.trim() || null,
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
              applicability,
              effects,
              levels,
              stackingPolicy:
                stackingKind === 'highest'
                  ? { kind: 'highest', key: stackingKey.trim() }
                  : { kind: 'stack' },
            })
          }
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add enchantment'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type EnchantmentEffect = LibraryEnchantmentCreate['effects'][number];

/**
 * One editable row per typed enchantment effect. Shared by the base
 * mechanics and every optional level; `nested` indents the level rows.
 */
function EnchantmentEffectRows({
  effects,
  campaignId,
  onChange,
  nested = false,
}: {
  effects: readonly EnchantmentEffect[];
  campaignId: string | null;
  onChange: (effects: EnchantmentEffect[]) => void;
  nested?: boolean;
}) {
  const replace = (index: number, next: EnchantmentEffect) =>
    onChange(effects.map((entry, entryIndex) => (entryIndex === index ? next : entry)));
  return (
    <>
      {effects.map((effect, index) => (
        <div
          key={`${index}-${effect.target}`}
          className={`flex flex-wrap items-end gap-2${nested ? ' pl-3' : ''}`}
        >
          <label className={`form-control flex-1 ${nested ? 'min-w-[11rem]' : 'min-w-[12rem]'}`}>
            <span className="label-text">Target</span>
            <select
              className="select select-bordered select-sm"
              value={effect.target}
              onChange={(event) => {
                const target = event.target.value as EnchantmentEffectTarget;
                replace(index, {
                  target,
                  value: effect.value,
                  ...(target === 'skill' ? { skillName: '*' } : {}),
                });
              }}
            >
              {ENCHANTMENT_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control w-24">
            <span className="label-text">Value</span>
            <input
              type="number"
              className="input input-bordered input-sm"
              value={effect.value}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                replace(index, { ...effect, value: Number.isNaN(value) ? 0 : value });
              }}
              min={-100}
              max={100}
            />
          </label>
          {effect.target === 'skill' && (
            <div className="form-control min-w-[10rem] flex-1">
              <span className="label-text">Skill</span>
              <SkillReferenceCombobox
                aria-label="Skill"
                value={effect.skillName ?? ''}
                campaignId={campaignId}
                onChange={(value) => replace(index, { ...effect, skillName: value })}
              />
            </div>
          )}
          <button
            type="button"
            className={`btn btn-ghost text-error ${nested ? 'btn-xs' : 'btn-sm'}`}
            onClick={() => onChange(effects.filter((_, entryIndex) => entryIndex !== index))}
          >
            Remove
          </button>
        </div>
      ))}
    </>
  );
}
