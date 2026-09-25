import { useState } from 'react';
import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../../../shared/constants/skills.ts';
import type {
  LibraryItemOut,
  LibrarySkillCreate,
  LibrarySkillOut,
  LibrarySkillSpecializationPolicy,
} from '../../../shared/schemas/campaignLibrary.ts';
import { skillProcedures } from '../../../shared/schemas/skillProcedures.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { EffectsEditor } from './EffectsEditor.tsx';

interface SkillFormProps {
  campaignId: string | null;
  initial?: LibrarySkillOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySkillCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}

export function SkillForm({
  campaignId,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
  libraryItems,
}: SkillFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [attribute, setAttribute] = useState<(typeof SKILL_ATTRIBUTES)[number]>(
    initial?.attribute ?? 'IQ',
  );
  const [difficulty, setDifficulty] = useState<(typeof SKILL_DIFFICULTIES)[number]>(
    initial?.difficulty ?? 'A',
  );
  const [techLevel, setTechLevel] = useState(
    initial?.techLevel != null ? String(initial.techLevel) : '',
  );
  const [techLevelKind, setTechLevelKind] = useState(
    initial?.techLevelPolicy?.kind ?? (initial?.techLevel != null ? 'fixed' : 'not_applicable'),
  );
  const [prerequisites, setPrerequisites] = useState(initial?.prerequisites ?? '');
  const [prerequisiteRules, setPrerequisiteRules] = useState(
    initial?.prerequisiteRules ? JSON.stringify(initial.prerequisiteRules, null, 2) : '',
  );
  const [defaults, setDefaults] = useState(
    initial?.defaults != null ? JSON.stringify(initial.defaults, null, 2) : '',
  );
  const [groups, setGroups] = useState((initial?.groups ?? []).join(', '));
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [procedures, setProcedures] = useState(
    JSON.stringify(initial?.procedures ?? { modifiers: [], actions: [], benefits: [] }, null, 2),
  );
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [defaultSpecialization, setDefaultSpecialization] = useState(
    initial?.defaultSpecialization ?? '',
  );
  const [specializationKind, setSpecializationKind] = useState<
    LibrarySkillSpecializationPolicy['kind']
  >(initial?.specializationPolicy.kind ?? 'none');
  const [specializations, setSpecializations] = useState(
    initial?.specializationPolicy.kind === 'required_catalog' ||
      initial?.specializationPolicy.kind === 'optional_catalog'
      ? initial.specializationPolicy.options.map((option) => ({
          ...option,
          editorKey: crypto.randomUUID(),
        }))
      : [],
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [effects, setEffects] = useState(initial?.effects ?? []);
  const [effectsValid, setEffectsValid] = useState(true);

  function handleSubmit() {
    if (!name.trim()) return;
    setRulesError(null);
    const tl = techLevel.trim() !== '' ? Number.parseInt(techLevel, 10) : null;
    let structuredPrerequisites: LibrarySkillCreate['prerequisiteRules'];
    let structuredDefaults: LibrarySkillCreate['defaults'];
    let parsedProcedures: LibrarySkillCreate['procedures'];
    try {
      parsedProcedures = skillProcedures.parse(JSON.parse(procedures));
      structuredPrerequisites = prerequisiteRules.trim() ? JSON.parse(prerequisiteRules) : null;
      structuredDefaults = defaults.trim() ? JSON.parse(defaults) : null;
    } catch (error) {
      setRulesError(`Invalid skill rules: ${(error as Error).message}`);
      return;
    }
    const specializationPolicy: LibrarySkillSpecializationPolicy =
      specializationKind === 'required_catalog' || specializationKind === 'optional_catalog'
        ? {
            kind: specializationKind,
            options: specializations.map(({ editorKey: _editorKey, ...option }) => option),
          }
        : { kind: specializationKind };
    const selectedDefault = defaultSpecialization.trim();
    const validDefault =
      specializationKind === 'none'
        ? null
        : specializationKind === 'required_catalog' || specializationKind === 'optional_catalog'
          ? (specializations.find(
              (option) => option.name.trim().toLowerCase() === selectedDefault.toLowerCase(),
            )?.name ?? null)
          : selectedDefault || null;
    onSubmit({
      name: name.trim(),
      attribute,
      difficulty,
      techLevel: tl,
      techLevelPolicy:
        techLevelKind === 'fixed'
          ? { kind: 'fixed', techLevel: tl ?? 0 }
          : techLevelKind === 'required'
            ? { kind: 'required', suggestedFrom: 'campaign' }
            : { kind: 'not_applicable' },
      defaultSpecialization: validDefault,
      specializationPolicy,
      description: description.trim() || null,
      source: source.trim() || null,
      prerequisites: prerequisites.trim() || null,
      prerequisiteRules: structuredPrerequisites,
      defaults: structuredDefaults,
      groups: groups
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      tags: tags
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      procedures: parsedProcedures,
      situationalModifiers: initial?.situationalModifiers ?? [],
      effects,
    });
  }

  return (
    <fieldset disabled={isPending} className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Attribute</span>
          <select
            className="select select-bordered select-sm"
            value={attribute}
            onChange={(e) => setAttribute(e.target.value as typeof attribute)}
          >
            {SKILL_ATTRIBUTES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text">Difficulty</span>
          <select
            className="select select-bordered select-sm"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          >
            {SKILL_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-32">
          <span className="label-text">TL policy</span>
          <select
            className="select select-bordered select-sm"
            value={techLevelKind}
            onChange={(event) =>
              setTechLevelKind(event.target.value as 'not_applicable' | 'required' | 'fixed')
            }
          >
            <option value="not_applicable">N/A</option>
            <option value="required">Required /TL</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
        <label className="form-control w-16">
          <span className="label-text">TL value</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={techLevel}
            onChange={(e) => setTechLevel(e.target.value)}
            min={0}
            max={12}
            placeholder="—"
            disabled={techLevelKind !== 'fixed'}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="B200"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Specializations</span>
          <select
            className="select select-bordered select-sm"
            value={specializationKind}
            onChange={(event) =>
              setSpecializationKind(event.target.value as LibrarySkillSpecializationPolicy['kind'])
            }
          >
            <option value="none">Not allowed</option>
            <option value="required_freeform">Required, free-form</option>
            <option value="optional_freeform">Optional, free-form</option>
            <option value="required_catalog">Required, from catalog</option>
            <option value="optional_catalog">Optional, from catalog</option>
          </select>
        </label>
        <div className="form-control">
          <span className="label-text">Default specialization</span>
          {specializationKind === 'required_catalog' ||
          specializationKind === 'optional_catalog' ? (
            <select
              className="select select-bordered select-sm"
              aria-label="Default specialization"
              value={defaultSpecialization}
              onChange={(event) => setDefaultSpecialization(event.target.value)}
            >
              <option value="">None</option>
              {specializations.map((option, index) => (
                <option key={`${option.name}-${index}`} value={option.name}>
                  {option.name || `Option ${index + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="input input-bordered input-sm"
              aria-label="Default specialization"
              value={defaultSpecialization}
              onChange={(event) => setDefaultSpecialization(event.target.value)}
              maxLength={160}
              disabled={specializationKind === 'none'}
              placeholder="e.g. Shortsword"
            />
          )}
        </div>
      </div>
      <details className="rounded border border-base-300 p-3">
        <summary>Modifiers, actions and level benefits</summary>
        <p className="text-xs">
          Define bounded rules using modifiers, actions and benefits. Source text remains alongside
          each rule. Unknown context is always left for the player to choose.
        </p>
        <label className="block">
          Structured skill rules
          <textarea
            aria-label="Structured skill rules"
            className="textarea textarea-bordered w-full font-mono"
            rows={12}
            value={procedures}
            onChange={(e) => setProcedures(e.target.value)}
          />
        </label>
      </details>
      {(specializationKind === 'required_catalog' || specializationKind === 'optional_catalog') && (
        <div className="space-y-2 rounded border border-base-300 p-3">
          <div className="flex items-center justify-between">
            <span className="label-text">Specialization catalog</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() =>
                setSpecializations((current) => [
                  ...current,
                  { name: '', editorKey: crypto.randomUUID() },
                ])
              }
            >
              + Add option
            </button>
          </div>
          {specializations.map((option, index) => (
            <div
              key={option.editorKey}
              className="grid gap-2 rounded bg-base-200/50 p-2 sm:grid-cols-2"
            >
              <input
                aria-label={`Specialization ${index + 1} name`}
                className="input input-bordered input-sm"
                value={option.name}
                maxLength={160}
                placeholder="Name"
                onChange={(event) =>
                  setSpecializations((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost btn-xs justify-self-end text-error"
                onClick={() =>
                  setSpecializations((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                Remove
              </button>
              <div inert={isPending}>
                <RichTextEditor
                  aria-label={`Specialization ${index + 1} description`}
                  value={option.description ?? ''}
                  placeholder="Description override (optional)"
                  onChange={(markdown) =>
                    setSpecializations((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, description: markdown || null } : item,
                      ),
                    )
                  }
                />
              </div>
              <textarea
                aria-label={`Specialization ${index + 1} prerequisites`}
                className="textarea textarea-bordered textarea-sm"
                value={option.prerequisites ?? ''}
                placeholder="Prerequisite override (optional)"
                onChange={(event) =>
                  setSpecializations((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, prerequisites: event.target.value || null }
                        : item,
                    ),
                  )
                }
              />
            </div>
          ))}
          {specializations.length === 0 && (
            <p className="text-xs text-error">Catalog policies require at least one option.</p>
          )}
        </div>
      )}
      <EffectsEditor
        campaignId={campaignId}
        effects={effects}
        libraryItems={libraryItems}
        onChange={setEffects}
        onValidityChange={setEffectsValid}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Prerequisite source text</span>
          <textarea
            className="textarea textarea-bordered textarea-sm"
            value={prerequisites}
            onChange={(event) => setPrerequisites(event.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Structured prerequisites (JSON)</span>
          <textarea
            className="textarea textarea-bordered textarea-sm font-mono text-xs"
            value={prerequisiteRules}
            onChange={(event) => setPrerequisiteRules(event.target.value)}
            placeholder='{"kind":"trait","name":"Magery","minimumLevel":1}'
          />
        </label>
        <label className="form-control">
          <span className="label-text">Default rules (JSON)</span>
          <textarea
            className="textarea textarea-bordered textarea-sm font-mono text-xs"
            value={defaults}
            onChange={(event) => setDefaults(event.target.value)}
            placeholder='[{"kind":"attribute","attribute":"IQ","modifier":-6}]'
          />
        </label>
        <div className="grid gap-2">
          <label className="form-control">
            <span className="label-text">Groups (comma-separated)</span>
            <input
              className="input input-bordered input-sm"
              value={groups}
              onChange={(event) => setGroups(event.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Tags (comma-separated)</span>
            <input
              className="input input-bordered input-sm"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={
            isPending ||
            !name.trim() ||
            !effectsValid ||
            ((specializationKind === 'required_catalog' ||
              specializationKind === 'optional_catalog') &&
              (specializations.length === 0 ||
                specializations.some((option) => !option.name.trim())))
          }
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add skill'}
        </button>
      </div>
      {(error || rulesError) && <p className="alert alert-error text-sm">{error || rulesError}</p>}
    </fieldset>
  );
}

// ── Spell form ──────────────────────────────────────────────────────────────
