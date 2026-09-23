import { type DragEvent, useRef, useState } from 'react';
import { skillDisplayName } from '../../../../shared/domain/defenseCalc.ts';
import {
  type ResolvedLibrarySkillSpecialization,
  effectiveSpecializationPolicy,
  initialLibrarySkillSpecialization,
  librarySkillCopyNotes,
  resolveLibrarySkillSpecialization,
} from '../../../../shared/domain/librarySkillSpecializations.ts';
import type { LibrarySkillOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { libraryMechanics } from '../../../../shared/schemas/libraryMechanics.ts';
import type { SkillOut } from '../../../../shared/schemas/skill.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import { AppIcon } from '../../../components/ui/AppIcon.tsx';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { DragHandle } from '../../../components/ui/DragHandle.tsx';
import { InfoTooltip } from '../../../components/ui/InfoTooltip.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
import { LibraryMechanicsNote } from './LibraryMechanicsNote.tsx';
import { RollSheet } from './RollSheet.tsx';
import { ProseActionPreview } from './SkillRulePreview.tsx';
import { ModifierBreakdownContent, skillEffectsForRow } from './combat/weaponEffectView.tsx';
import type { RollRequest } from './rollTypes.ts';
import {
  type SkillSort,
  type SkillTablePreferences,
  readSkillTablePreferences,
  saveSkillTablePreferences,
} from './skillTablePreferences.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import {
  useEntityEnumField,
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

const ATTRIBUTES = ['ST', 'DX', 'IQ', 'HT', 'Will', 'Per', 'Other'] as const;
const DIFFICULTIES = ['E', 'A', 'H', 'VH'] as const;
type SkillAttribute = (typeof ATTRIBUTES)[number];
type SkillDifficulty = (typeof DIFFICULTIES)[number];

interface AddSkillFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}

interface SkillSnapshot {
  name: string;
  nameRaw: string;
  attribute: SkillAttribute;
  difficulty: SkillDifficulty;
  points: number;
  pointsRaw: string;
  picked: LibrarySkillOut | null;
  specialization: string;
  techLevel: number | null;
  nameVersion: number;
}

function fixedPickedTechLevel(skill: LibrarySkillOut | null): number | null {
  if (!skill) return null;
  if (skill.techLevelPolicy?.kind === 'fixed') return skill.techLevelPolicy.techLevel;
  return skill.techLevelPolicy == null ? skill.techLevel : null;
}

function AddSkillForm({ characterId, campaignId, canWrite }: AddSkillFormProps) {
  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState<SkillAttribute>('DX');
  const [difficulty, setDifficulty] = useState<SkillDifficulty>('A');
  const [points, setPoints] = useState('1');
  const [picked, setPicked] = useState<LibrarySkillOut | null>(null);
  const [specialization, setSpecialization] = useState('');
  const [techLevel, setTechLevel] = useState('');
  const pickedPolicy = picked
    ? effectiveSpecializationPolicy(picked.specializationPolicy, picked.defaultSpecialization)
    : null;
  const nameVersion = useRef(0);
  const editName = (value: string) => {
    setName(value);
    nameVersion.current++;
    setPicked(null);
    setSpecialization('');
    setTechLevel('');
  };

  const { fetchOptions } = useLibraryFetcher<LibrarySkillOut>('skills', campaignId);
  const {
    creating,
    submit: submitEntity,
    reject,
    flashProps,
  } = useAddEntityForm({
    entityClass: 'character_skill',
    characterId,
    label: `skill "${skillDisplayName(name, specialization)}"`,
  });

  async function submit(snap: SkillSnapshot) {
    if (snap.picked && snap.picked.campaignId !== campaignId) {
      reject('Campaign changed — select a skill from the current campaign library');
      return;
    }
    let resolved: ResolvedLibrarySkillSpecialization = {
      specialization: snap.specialization.trim() || null,
      description: null,
      prerequisites: null,
      prerequisiteRules: null,
      defaults: null,
    };
    if (snap.picked) {
      try {
        resolved = resolveLibrarySkillSpecialization(snap.picked, snap.specialization);
      } catch (error) {
        reject((error as Error).message);
        return;
      }
    }
    await submitEntity(
      {
        name: snap.name,
        attribute: snap.attribute,
        difficulty: snap.difficulty,
        points: snap.points,
        characterId,
        librarySkillId: snap.picked?.id ?? null,
        defaults: resolved.defaults,
        specialization: resolved.specialization,
        techLevel: snap.techLevel,
        notes: librarySkillCopyNotes(snap.picked?.source, resolved),
      },
      () => {
        // Per AGENTS.md (rule 1: never silently discard user edits): only
        // clear fields whose current value still matches the snapshot we
        // submitted.  We use functional setters so the comparison runs
        // against the *live* state at completion time, not the
        // closure-captured value from the render that submitted; that
        // way a field the user has typed into during the await isn't
        // wiped, which is exactly the quick-edit loss this guard exists
        // to prevent.
        if (nameVersion.current === snap.nameVersion) {
          setName((cur) => (cur === snap.nameRaw ? '' : cur));
          setPicked((cur) => (cur === snap.picked ? null : cur));
          setSpecialization((cur) => (cur === snap.specialization ? '' : cur));
          setTechLevel('');
        }
        setPoints((cur) => (cur === snap.pointsRaw ? '1' : cur));
      },
      snap.picked
        ? libraryMechanics.parse({
            sourceId: snap.picked.id,
            campaignId: snap.picked.campaignId,
            sourceRevision: null,
            effects: snap.picked.effects ?? null,
            skillRules: {
              techLevelPolicy:
                snap.picked.techLevelPolicy ??
                (snap.picked.techLevel == null
                  ? { kind: 'not_applicable' }
                  : { kind: 'fixed', techLevel: snap.picked.techLevel }),
              prerequisites: resolved.prerequisiteRules ?? null,
              defaults: resolved.defaults ?? null,
              groups: snap.picked.groups ?? [],
              tags: snap.picked.tags ?? [],
              procedures: snap.picked.procedures,
            },
          })
        : null,
    );
  }

  if (!canWrite) return null;

  return (
    <form
      {...flashProps}
      className="field-rollback-flash flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const pParsed = Number(points);
        void submit({
          name: name.trim(),
          nameRaw: name,
          attribute,
          difficulty,
          points: Number.isFinite(pParsed) && pParsed >= 0 ? pParsed : 1,
          pointsRaw: points,
          picked,
          specialization,
          techLevel: fixedPickedTechLevel(picked) ?? (techLevel.trim() ? Number(techLevel) : null),
          nameVersion: nameVersion.current,
        });
      }}
    >
      <div className="form-control flex-1 basis-40 min-w-0">
        <span className="label-text text-xs" id="add-skill-name-label">
          Skill
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibrarySkillOut>
            value={name}
            onChange={editName}
            onPick={(opt) => {
              setName(opt.name);
              setAttribute(opt.attribute as SkillAttribute);
              setDifficulty(opt.difficulty as SkillDifficulty);
              nameVersion.current++;
              setPicked(opt);
              setSpecialization(initialLibrarySkillSpecialization(opt) ?? '');
              setTechLevel(fixedPickedTechLevel(opt)?.toString() ?? '');
            }}
            fetchOptions={fetchOptions}
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {o.name}
                  {o.techLevelPolicy?.kind === 'required'
                    ? ' / TL'
                    : o.techLevel != null
                      ? ` / TL${o.techLevel}`
                      : ''}
                </span>
                <span className="num text-xs text-base-content/70">
                  {o.attribute}/{o.difficulty}
                </span>
              </span>
            )}
            placeholder="e.g. Broadsword"
            inputProps={{ 'aria-labelledby': 'add-skill-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-skill-name-label"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => editName(e.target.value)}
            placeholder="e.g. Broadsword"
          />
        )}
        {picked && (
          <span className="min-w-0 break-words text-xs text-base-content/70">
            {skillDisplayName(picked.name, specialization)}
            {picked.techLevelPolicy?.kind === 'required'
              ? ' / TL'
              : picked.techLevel != null
                ? ` / TL${picked.techLevel}`
                : ''}
          </span>
        )}
      </div>
      {pickedPolicy?.kind === 'required_catalog' || pickedPolicy?.kind === 'optional_catalog' ? (
        <label className="form-control min-w-36">
          <span className="label-text text-xs">Specialization</span>
          <select
            aria-label="Specialization"
            className="select select-bordered select-sm"
            value={specialization}
            onChange={(event) => {
              setSpecialization(event.target.value);
              nameVersion.current++;
            }}
          >
            {pickedPolicy.kind === 'optional_catalog' && <option value="">None</option>}
            {pickedPolicy.options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : pickedPolicy?.kind === 'required_freeform' ||
        pickedPolicy?.kind === 'optional_freeform' ? (
        <label className="form-control min-w-36">
          <span className="label-text text-xs">Specialization</span>
          <input
            aria-label="Specialization"
            className="input input-bordered input-sm"
            value={specialization}
            maxLength={160}
            required={pickedPolicy.kind === 'required_freeform'}
            onChange={(event) => {
              setSpecialization(event.target.value);
              nameVersion.current++;
            }}
          />
        </label>
      ) : null}
      {picked?.techLevelPolicy?.kind === 'required' && (
        <label className="form-control w-20">
          <span className="label-text text-xs">TL *</span>
          <input
            aria-label="Skill Tech Level"
            className="input input-bordered input-sm num"
            type="number"
            min={0}
            max={12}
            required
            value={techLevel}
            onChange={(event) => setTechLevel(event.target.value)}
          />
        </label>
      )}
      <label className="form-control">
        <span className="label-text text-xs">Attr</span>
        <select
          className="select select-bordered select-sm"
          value={attribute}
          onChange={(e) => setAttribute(e.target.value as SkillAttribute)}
        >
          {ATTRIBUTES.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className="form-control">
        <span className="label-text text-xs">Diff</span>
        <select
          className="select select-bordered select-sm"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as SkillDifficulty)}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="form-control w-20">
        <span className="label-text text-xs">Pts</span>
        <input
          className="input input-bordered input-sm num"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </label>
      <button
        type="submit"
        className="btn btn-sm btn-primary"
        disabled={
          creating ||
          ((pickedPolicy?.kind === 'required_catalog' ||
            pickedPolicy?.kind === 'required_freeform') &&
            !specialization.trim()) ||
          (picked?.techLevelPolicy?.kind === 'required' && !techLevel.trim())
        }
      >
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface SkillRowProps {
  characterId: string;
  skill: SkillOut;
  canWrite: boolean;
  expanded: boolean;
  position: number;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (direction: -1 | 1) => void;
  onRoll: (req: RollRequest) => void;
  effects: CharacterDetail['effects'];
}

function SkillModifierTooltip({
  displayName,
  baseValue,
  effects,
  finalValue,
}: {
  displayName: string;
  baseValue: number | null;
  effects: CharacterDetail['effects'];
  finalValue: number | null;
}) {
  if (effects.length === 0) return null;
  return (
    <InfoTooltip
      ariaLabel={`View ${displayName} modifiers`}
      side="bottom"
      triggerClassName="num shrink-0 cursor-help rounded border border-warning px-1 text-[10px] text-warning transition-colors hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-primary"
      content={
        <div>
          <div className="label-eyebrow mb-2">{displayName} modifiers</div>
          <ModifierBreakdownContent
            baseLabel="Base skill"
            baseValue={baseValue ?? '—'}
            globalEffects={effects}
            finalValue={finalValue ?? '—'}
          />
        </div>
      }
    >
      <span aria-hidden="true">✦</span>
    </InfoTooltip>
  );
}

function SkillConfiguredDetails({
  skill,
  displayName,
  onRoll,
}: {
  skill: SkillOut;
  displayName: string;
  onRoll: (req: RollRequest) => void;
}) {
  return (
    <>
      <LibraryMechanicsNote mechanics={skill.libraryMechanics} />
      {skill.procedures && (
        <div className="space-y-2">
          {skill.procedures.actions.length > 0 && <h4 className="label-eyebrow">Actions</h4>}
          {skill.procedures.actions.map((action) => (
            <div key={action.id} className="rounded border border-base-300 p-2">
              <p>{action.label}</p>
              <p className="text-xs">{action.sourceText}</p>
              {skill.actionTargets?.[action.id] != null ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    onRoll({
                      label: `${displayName}: ${action.label}`,
                      baseTarget: skill.actionTargets?.[action.id] ?? 0,
                      rules: (skill.procedures?.modifiers ?? []).filter(
                        (rule) => rule.appliesTo !== 'base_level',
                      ),
                      ruleContext: skill.procedureContext ?? {},
                      action,
                    })
                  }
                >
                  Preview {action.label}
                </button>
              ) : (
                <>
                  <p className="text-xs">
                    Prose-only or roll basis unavailable. {action.roll?.notes}
                  </p>
                  <ProseActionPreview
                    action={action}
                    source={displayName}
                    context={skill.procedureContext ?? {}}
                  />
                </>
              )}
            </div>
          ))}
          {skill.procedures.benefits.map((benefit) => (
            <p className="text-xs" key={benefit.id}>
              {skill.benefitStatus?.find((candidate) => candidate.id === benefit.id)?.unlocked
                ? 'Active'
                : 'Locked'}
              : {benefit.label} — {benefit.sourceText}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function SkillRow({
  characterId,
  skill,
  canWrite,
  expanded,
  position,
  dragging,
  onToggle,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
  onRoll,
  effects,
}: SkillRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const displayName = skillDisplayName(skill.name, skill.specialization);
  const bonusEffects = skillEffectsForRow(effects, skill.name, skill.specialization);
  const modifierTooltip = (
    <SkillModifierTooltip
      displayName={displayName}
      baseValue={skill.level}
      effects={bonusEffects}
      finalValue={skill.effectiveLevel}
    />
  );
  const rowPatch = useEntityRowPatch('character_skill', skill.id, characterId, displayName);

  const nameField = useEntityNameField(rowPatch, skill.name);
  const pointsField = useEntityPointsField(rowPatch, displayName, skill.points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });
  const attributeField = useEntityEnumField(
    rowPatch,
    `${displayName} attribute`,
    'attribute',
    skill.attribute,
    ATTRIBUTES,
  );
  const difficultyField = useEntityEnumField(
    rowPatch,
    `${displayName} difficulty`,
    'difficulty',
    skill.difficulty,
    DIFFICULTIES,
  );
  const specializationField = useDraftField<string | null>({
    name: `${displayName} specialization`,
    serverValue: skill.specialization,
    format: (value) => value ?? '',
    parse: (value) => value.trim() || null,
    onSave: (value) => rowPatch.patch('specialization', value),
    flashKey: rowPatch.flashKey('specialization'),
  });
  const notesField = useDraftField<string | null>({
    name: `${displayName} description and notes`,
    serverValue: skill.notes,
    format: (value) => value ?? '',
    parse: (value) => value.trim() || null,
    onSave: (value) => rowPatch.patch('notes', value),
    flashKey: rowPatch.flashKey('notes'),
  });
  const techLevelField = useDraftField<number | null>({
    name: `${displayName} tech level`,
    serverValue: skill.techLevel,
    format: (value) => (value == null ? '' : String(value)),
    parse: (value) => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) {
        throw new Error('whole number from 0 to 12');
      }
      return parsed;
    },
    onSave: (value) => rowPatch.patch('techLevel', value),
    flashKey: rowPatch.flashKey('techLevel'),
  });
  const saving =
    nameField.isSaving ||
    pointsField.isSaving ||
    attributeField.isSaving ||
    difficultyField.isSaving ||
    specializationField.isSaving ||
    notesField.isSaving ||
    techLevelField.isSaving;
  const hasConfiguredRules = Boolean(skill.libraryMechanics || skill.procedures);
  const hasAdvancedDetails = hasConfiguredRules || skill.techLevel != null;
  const canExpand = canWrite || Boolean(skill.notes) || hasConfiguredRules;

  const removeSkill = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_skill',
        entityId: skill.id,
        humanName: `skill "${displayName}"`,
        characterId,
        prevValue: skill,
      });
    } catch (err) {
      toasts.push(`Couldn't delete skill — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return (
    <tbody
      aria-label={displayName}
      className={dragging ? 'opacity-50' : undefined}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <tr
        id={`skill-${skill.id}`}
        className={`${expanded ? 'bg-primary/5 ' : ''}scroll-mt-24 target:!bg-primary/20 target:outline target:outline-2 target:outline-primary`}
      >
        <td className="w-9 px-1 sm:px-2">
          <DragHandle
            aria-label={`Reorder ${displayName}, row ${position + 1}`}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              onMove(event.key === 'ArrowUp' ? -1 : 1);
            }}
          />
        </td>
        <td className="min-w-0 py-2 pl-1 sm:pl-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 break-words font-medium">
              {displayName}
              {skill.techLevel != null ? ` / TL${skill.techLevel}` : ''}
            </span>
            {modifierTooltip}
          </span>
          <span className="mt-0.5 block text-[10px] text-base-content/60 sm:hidden">
            {skill.attribute}/{skill.difficulty}
          </span>
          {skill.prerequisiteStatus && skill.prerequisiteStatus !== 'met' && (
            <span className="block break-words text-xs text-warning">
              {skill.prerequisiteStatus === 'unknown' ? 'Check prerequisites' : 'Unmet'}:{' '}
              {skill.prerequisiteMessages?.join('; ')}
            </span>
          )}
          {skill.defaultConditionMessages?.length ? (
            <span className="block break-words text-xs text-base-content/70">
              Defaults: {skill.defaultConditionMessages.join('; ')}
            </span>
          ) : null}
        </td>
        <td className="w-0 overflow-hidden p-0 text-center text-xs text-base-content/70 sm:w-auto sm:px-3">
          <span className="hidden sm:inline">
            {skill.attribute}/{skill.difficulty}
          </span>
        </td>
        <td className="num w-11 text-right text-xs text-base-content/70 sm:w-14">{skill.points}</td>
        <td className="w-12 text-right sm:w-16">
          <RollLevelChip
            level={skill.effectiveLevel ?? skill.level}
            name={displayName}
            title={
              skill.points <= 0
                ? skill.defaults == null
                  ? 'Defaults unknown — add the skill definition'
                  : skill.defaults.length === 0
                    ? 'This skill has no default'
                    : 'Best available declared default (B173)'
                : skill.effectiveLevel != null &&
                    skill.level != null &&
                    skill.effectiveLevel !== skill.level
                  ? `Base ${skill.level} + ${skill.effectiveLevel - skill.level} from trait effects`
                  : undefined
            }
            onRoll={(level) =>
              onRoll({
                label: displayName,
                baseTarget: level,
                rules:
                  skill.procedures?.modifiers.filter((rule) => rule.appliesTo !== 'base_level') ??
                  [],
                ruleContext: skill.procedureContext ?? {},
              })
            }
          />
        </td>
        <td className="w-10 px-1 text-right sm:w-16 sm:px-2">
          {canExpand && (
            <button
              type="button"
              className="btn btn-ghost btn-xs min-h-11 px-1 sm:min-h-0 sm:px-2"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Close' : canWrite ? 'Edit' : 'View'} ${displayName}`}
            >
              <span className="hidden sm:inline">
                {expanded ? 'Done' : canWrite ? 'Edit' : 'Details'}
              </span>
              <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="border-b border-base-300 bg-base-200 p-0">
            {canWrite ? (
              <div className="space-y-3 px-3 py-4 md:px-14 md:py-5">
                <header className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">Edit {displayName}</h3>
                  {saving && (
                    <span className="text-xs text-warning" aria-live="polite">
                      Saving…
                    </span>
                  )}
                </header>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_7rem_6rem_5rem] md:gap-3">
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Name</legend>
                    <input
                      aria-label={`${displayName} name`}
                      className={`${DRAFT_FIELD_CLASS} input input-sm w-full`}
                      {...nameField.inputProps}
                    />
                  </fieldset>
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Specialization</legend>
                    <input
                      aria-label={`${displayName} specialization`}
                      placeholder="None"
                      className={`${DRAFT_FIELD_CLASS} input input-sm w-full`}
                      {...specializationField.inputProps}
                    />
                  </fieldset>
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Attribute</legend>
                    <select
                      aria-label={`${displayName} attribute`}
                      className={`${DRAFT_FIELD_CLASS} select select-sm w-full`}
                      {...attributeField.selectProps}
                    >
                      {ATTRIBUTES.map((attribute) => (
                        <option key={attribute}>{attribute}</option>
                      ))}
                    </select>
                  </fieldset>
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Difficulty</legend>
                    <select
                      aria-label={`${displayName} difficulty`}
                      className={`${DRAFT_FIELD_CLASS} select select-sm w-full`}
                      {...difficultyField.selectProps}
                    >
                      {DIFFICULTIES.map((difficulty) => (
                        <option key={difficulty}>{difficulty}</option>
                      ))}
                    </select>
                  </fieldset>
                  <fieldset className="fieldset min-w-0 p-0">
                    <legend className="fieldset-legend text-xs">Points</legend>
                    <input
                      aria-label={`${displayName} points`}
                      className={`${DRAFT_FIELD_CLASS} input input-sm num w-full text-right`}
                      inputMode="numeric"
                      {...pointsField.inputProps}
                    />
                  </fieldset>
                </div>
                <fieldset className="fieldset min-w-0 p-0">
                  <legend className="fieldset-legend text-xs">Description &amp; notes</legend>
                  <textarea
                    aria-label={`${displayName} description and notes`}
                    className={`${DRAFT_FIELD_CLASS} textarea textarea-sm min-h-20 w-full`}
                    value={notesField.value}
                    onChange={(event) => notesField.setValue(event.target.value)}
                    onBlur={notesField.inputProps.onBlur}
                    data-flashing={notesField.inputProps['data-flashing']}
                    data-flash-parity={notesField.inputProps['data-flash-parity']}
                  />
                </fieldset>
                {hasAdvancedDetails && (
                  <details className="border-t border-base-300 pt-1">
                    <summary className="cursor-pointer py-2 text-xs text-base-content/70">
                      Source &amp; rules
                    </summary>
                    <div className="space-y-3 pb-2">
                      {skill.techLevel != null && (
                        <fieldset className="fieldset w-24 p-0">
                          <legend className="fieldset-legend text-xs">Tech level</legend>
                          <input
                            aria-label={`${displayName} tech level`}
                            className={`${DRAFT_FIELD_CLASS} input input-sm num w-full`}
                            inputMode="numeric"
                            {...techLevelField.inputProps}
                          />
                        </fieldset>
                      )}
                      <SkillConfiguredDetails
                        skill={skill}
                        displayName={displayName}
                        onRoll={onRoll}
                      />
                    </div>
                  </details>
                )}
                <footer className="flex items-center justify-between gap-3 border-t border-base-300 pt-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete skill
                  </button>
                  <button type="button" className="btn btn-sm" onClick={onToggle}>
                    Done
                  </button>
                </footer>
                <ConfirmDialog
                  open={confirmDelete}
                  title={`Delete skill "${displayName}"?`}
                  confirmLabel="Delete"
                  tone="error"
                  onConfirm={() => {
                    setConfirmDelete(false);
                    void removeSkill();
                  }}
                  onCancel={() => setConfirmDelete(false)}
                />
              </div>
            ) : (
              <div className="space-y-3 px-3 py-4 text-sm md:px-14 md:py-5">
                {skill.notes && <Markdown source={skill.notes} />}
                {hasConfiguredRules && (
                  <SkillConfiguredDetails skill={skill} displayName={displayName} onRoll={onRoll} />
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function SkillsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  return <SkillsTable key={character.id} character={character} canWrite={canWrite} />;
}

function SkillsTable({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  // Hosted once here (not per row) so every roll-target tap in the
  // table opens the SAME sheet instance instead of each row owning its
  // own dialog state.
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState(() => readSkillTablePreferences(character.id));
  const [saveFailed, setSaveFailed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const customOrder = [
    ...preferences.order.filter((id) => character.skills.some((skill) => skill.id === id)),
    ...character.skills
      .filter((skill) => !preferences.order.includes(skill.id))
      .map((skill) => skill.id),
  ];

  function save(next: SkillTablePreferences) {
    setPreferences(next);
    setSaveFailed(!saveSkillTablePreferences(character.id, next));
  }

  function compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
  }

  const sortedSkills = [...character.skills].sort((left, right) => {
    if (preferences.sort === 'custom') {
      return customOrder.indexOf(left.id) - customOrder.indexOf(right.id);
    }
    let comparison = 0;
    if (preferences.sort === 'name') {
      comparison = compareText(
        skillDisplayName(left.name, left.specialization),
        skillDisplayName(right.name, right.specialization),
      );
    } else if (preferences.sort === 'basis') {
      comparison = compareText(
        `${left.attribute}/${left.difficulty}`,
        `${right.attribute}/${right.difficulty}`,
      );
    } else if (preferences.sort === 'points') {
      comparison = left.points - right.points;
    } else {
      const leftLevel = left.effectiveLevel ?? left.level;
      const rightLevel = right.effectiveLevel ?? right.level;
      if (leftLevel == null || rightLevel == null) {
        if (leftLevel == null && rightLevel == null) comparison = 0;
        else comparison = leftLevel == null ? 1 : -1;
      } else {
        comparison = leftLevel - rightLevel;
      }
    }
    return (
      (preferences.descending ? -comparison : comparison) ||
      customOrder.indexOf(left.id) - customOrder.indexOf(right.id)
    );
  });

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = sortedSkills.filter((skill) => {
    if (!normalizedQuery) return true;
    return [
      skillDisplayName(skill.name, skill.specialization),
      skill.attribute,
      skill.difficulty,
      skill.notes ?? '',
      skill.prerequisiteMessages?.join(' ') ?? '',
      skill.defaultConditionMessages?.join(' ') ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  function sortBy(sort: Exclude<SkillSort, 'custom'>) {
    save({
      ...preferences,
      sort,
      descending: preferences.sort === sort ? !preferences.descending : false,
    });
  }

  function moveSkill(id: string, targetId: string) {
    const displayedOrder = sortedSkills.map((skill) => skill.id);
    const from = displayedOrder.indexOf(id);
    const to = displayedOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...displayedOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save({ order: next, sort: 'custom', descending: false });
    const visiblePosition = visibleSkills.findIndex((skill) => skill.id === targetId) + 1;
    setAnnouncement(
      `${character.skills.find((skill) => skill.id === id)?.name ?? 'Skill'} moved to position ${visiblePosition}.`,
    );
  }

  function moveBy(id: string, direction: -1 | 1) {
    const visibleOrder = visibleSkills.map((skill) => skill.id);
    const current = visibleOrder.indexOf(id);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= visibleOrder.length) return;
    moveSkill(id, visibleOrder[target] ?? id);
  }

  function sortHeader(
    label: string,
    sort: Exclude<SkillSort, 'custom'>,
    headerClassName = '',
    shortLabel?: string,
    hideButtonOnMobile = false,
  ) {
    const active = preferences.sort === sort;
    return (
      <th
        scope="col"
        className={headerClassName}
        aria-sort={active ? (preferences.descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className={`btn btn-ghost btn-xs h-auto min-h-0 whitespace-nowrap px-1 py-1 font-semibold ${hideButtonOnMobile ? 'hidden sm:inline-flex' : ''} ${headerClassName.includes('text-right') ? 'w-full justify-end' : 'justify-start'}`}
          onClick={() => sortBy(sort)}
          aria-label={`Sort by ${label}`}
        >
          <span className={shortLabel ? 'hidden sm:inline' : undefined}>{label}</span>
          {shortLabel && <span className="sm:hidden">{shortLabel}</span>}
          <span aria-hidden="true">{active ? (preferences.descending ? '↓' : '↑') : '↕'}</span>
        </button>
      </th>
    );
  }

  return (
    <section className="card p-0">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <div>
          <p className="label-eyebrow">Skills</p>
          <h2 className="font-display text-2xl">Skills & abilities</h2>
          <p className="mt-1 text-xs text-base-content/60">
            {character.skills.length} {character.skills.length === 1 ? 'skill' : 'skills'}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            className={`btn btn-sm ${showAdd ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => setShowAdd((current) => !current)}
            aria-expanded={showAdd}
          >
            {showAdd ? 'Close add form' : '+ Add skill'}
          </button>
        )}
      </header>

      {showAdd && (
        <div className="px-4 pb-3 sm:px-5">
          <AddSkillForm
            characterId={character.id}
            campaignId={character.campaignId ?? null}
            canWrite={canWrite}
          />
        </div>
      )}

      {character.skills.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-base-content/60 sm:px-5">No skills yet.</p>
      ) : (
        <>
          <div className="px-4 pb-3 sm:px-5">
            <label className="input input-sm flex w-full items-center gap-2 bg-base-200">
              <svg
                className="h-4 w-4 shrink-0 fill-none stroke-current text-base-content/50"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6.5" />
                <path d="m15 15 5 5" />
              </svg>
              <input
                type="search"
                className="min-w-0 grow"
                aria-label="Search skills"
                placeholder="Search skills…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="border-t border-base-300">
            <table className="table table-sm w-full table-fixed" aria-label="Skills">
              <caption className="sr-only">
                Character skills. Sort with column headings or use row handles for custom order.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-9 px-1 sm:px-2">
                    <span className="sr-only">Custom order</span>
                  </th>
                  {sortHeader('Skill', 'name')}
                  {sortHeader('Attr/Dif', 'basis', 'w-0 p-0 text-center sm:w-20', undefined, true)}
                  {sortHeader('Points', 'points', 'w-11 text-right sm:w-14', 'Pts')}
                  {sortHeader('Level', 'level', 'w-12 text-right sm:w-16', 'Lvl')}
                  <th scope="col" className="w-10 px-1 sm:w-16 sm:px-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              {visibleSkills.map((skill, position) => {
                return (
                  <SkillRow
                    key={skill.id}
                    characterId={character.id}
                    skill={skill}
                    canWrite={canWrite}
                    expanded={expandedId === skill.id}
                    position={position}
                    dragging={draggingId === skill.id}
                    onToggle={() =>
                      setExpandedId((current) => (current === skill.id ? null : skill.id))
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', skill.id);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingId(skill.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onDrop={() => {
                      if (draggingId) moveSkill(draggingId, skill.id);
                      setDraggingId(null);
                    }}
                    onMove={(direction) => moveBy(skill.id, direction)}
                    onRoll={setRollRequest}
                    effects={character.effects}
                  />
                );
              })}
            </table>
          </div>
          {visibleSkills.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-base-content/60">
              No skills match “{query}”.
            </p>
          )}
          <div className="border-t border-base-300 px-4 py-2 text-[10px] text-base-content/50 sm:px-5">
            Click a column heading to sort. Drag a row handle or focus it and use ↑/↓ for custom
            order.
          </div>
          {saveFailed && (
            <output className="block px-4 pb-3 text-xs text-warning sm:px-5">
              This browser could not save the skill order. It will reset when you leave this page.
            </output>
          )}
          <output className="sr-only" aria-live="polite">
            {announcement}
          </output>
        </>
      )}

      {rollRequest && (
        <RollSheet
          request={rollRequest}
          characterId={character.id}
          onClose={() => setRollRequest(null)}
        />
      )}
    </section>
  );
}
