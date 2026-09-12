import { useRef, useState } from 'react';
import { skillDisplayName } from '../../../../shared/domain/defenseCalc.ts';
import type { LibrarySkillOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { libraryMechanics } from '../../../../shared/schemas/libraryMechanics.ts';
import type { SkillOut } from '../../../../shared/schemas/skill.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
import { LibraryMechanicsNote } from './LibraryMechanicsNote.tsx';
import { RollSheet } from './RollSheet.tsx';
import { ModifierBreakdown, skillEffectsForRow } from './combat/weaponEffectView.tsx';
import type { RollRequest } from './rollTypes.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import {
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
  nameVersion: number;
}

function AddSkillForm({ characterId, campaignId, canWrite }: AddSkillFormProps) {
  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState<SkillAttribute>('DX');
  const [difficulty, setDifficulty] = useState<SkillDifficulty>('A');
  const [points, setPoints] = useState('1');
  const [picked, setPicked] = useState<LibrarySkillOut | null>(null);
  const nameVersion = useRef(0);
  const editName = (value: string) => {
    setName(value);
    nameVersion.current++;
    setPicked(null);
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
    label: `skill "${skillDisplayName(name, picked?.defaultSpecialization)}"`,
  });

  async function submit(snap: SkillSnapshot) {
    if (snap.picked && snap.picked.campaignId !== campaignId) {
      reject('Campaign changed — select a skill from the current campaign library');
      return;
    }
    await submitEntity(
      {
        name: snap.name,
        attribute: snap.attribute,
        difficulty: snap.difficulty,
        points: snap.points,
        characterId,
        librarySkillId: snap.picked?.id ?? null,
        defaults: snap.picked?.defaults ?? null,
        specialization: snap.picked?.defaultSpecialization ?? null,
        techLevel: snap.picked?.techLevel ?? null,
        notes:
          [
            snap.picked?.description,
            snap.picked?.source ? `Source: ${snap.picked.source}` : null,
            snap.picked?.prerequisites ? `Prerequisites: ${snap.picked.prerequisites}` : null,
          ]
            .filter(Boolean)
            .join('\n\n') || null,
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
        }
        setPoints((cur) => (cur === snap.pointsRaw ? '1' : cur));
      },
      snap.picked
        ? libraryMechanics.parse({
            sourceId: snap.picked.id,
            campaignId: snap.picked.campaignId,
            sourceRevision: null,
            effects: snap.picked.effects ?? null,
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
            }}
            fetchOptions={fetchOptions}
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {skillDisplayName(o.name, o.defaultSpecialization)}
                  {o.techLevel != null ? ` / TL${o.techLevel}` : ''}
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
            {skillDisplayName(picked.name, picked.defaultSpecialization)}
            {picked.techLevel != null ? ` / TL${picked.techLevel}` : ''}
          </span>
        )}
      </div>
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
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface SkillRowProps {
  characterId: string;
  skill: SkillOut;
  canWrite: boolean;
  onRoll: (req: RollRequest) => void;
  effects: CharacterDetail['effects'];
}

function SkillRow({ characterId, skill, canWrite, onRoll, effects }: SkillRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const displayName = skillDisplayName(skill.name, skill.specialization);
  const bonusEffects = skillEffectsForRow(effects, skill.name, skill.specialization);
  const rowPatch = useEntityRowPatch('character_skill', skill.id, characterId, displayName);

  const nameField = useEntityNameField(rowPatch, skill.name);
  const pointsField = useEntityPointsField(rowPatch, displayName, skill.points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });

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
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(3.5rem,4rem)_minmax(3rem,4rem)_minmax(3rem,4rem)_auto] gap-1 sm:grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_auto] sm:gap-2 items-center py-2 border-b border-base-300 last:border-0">
      {canWrite ? (
        <div className="min-w-0">
          <input
            aria-label={`${displayName} name`}
            className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm w-full min-w-0 font-medium`}
            {...nameField.inputProps}
          />
          {(skill.specialization || skill.techLevel != null) && (
            <span className="block break-words text-xs text-base-content/70">
              {skill.specialization ? `(${skill.specialization})` : ''}
              {skill.techLevel != null ? ` TL${skill.techLevel}` : ''}
            </span>
          )}
        </div>
      ) : (
        <span className="min-w-0 break-words font-medium">
          {displayName}
          {skill.techLevel != null ? ` / TL${skill.techLevel}` : ''}
        </span>
      )}
      <span className="text-xs text-base-content/70 num text-center">
        {skill.attribute}/{skill.difficulty}
      </span>
      {canWrite ? (
        <input
          aria-label={`${displayName} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{skill.points}</span>
      )}
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
        onRoll={(level) => onRoll({ label: displayName, baseTarget: level })}
      />
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete skill ${displayName}`}
        >
          ✕
        </button>
      )}
      <div className="col-span-full">
        {skill.level != null && skill.effectiveLevel != null && (
          <ModifierBreakdown
            baseLabel="Base skill"
            baseValue={skill.level}
            globalEffects={bonusEffects}
            finalValue={skill.effectiveLevel}
          />
        )}
        <LibraryMechanicsNote mechanics={skill.libraryMechanics} />
      </div>
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
    </li>
  );
}

export function SkillsPanel({
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

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Skills</p>
          <h2 className="font-display text-2xl">Skills & abilities</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.skills.length} {character.skills.length === 1 ? 'skill' : 'skills'}
        </p>
      </header>

      <AddSkillForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {character.skills.length === 0 ? (
        <p className="text-sm text-base-content/60">No skills yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(3.5rem,4rem)_minmax(3rem,4rem)_minmax(3rem,4rem)_auto] gap-1 sm:grid-cols-[minmax(0,1fr)_4rem_4rem_4rem_auto] sm:gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Skill</span>
            <span className="text-center">Attr/Dif</span>
            <span className="text-right">Pts</span>
            <span className="text-right">Lvl</span>
            <span />
          </div>
          <ul>
            {character.skills.map((s) => (
              <SkillRow
                key={s.id}
                characterId={character.id}
                skill={s}
                canWrite={canWrite}
                onRoll={setRollRequest}
                effects={character.effects}
              />
            ))}
          </ul>
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
