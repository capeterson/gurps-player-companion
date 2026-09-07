import { useState } from 'react';
import { techniqueBonus } from '../../../../shared/domain/techniqueCalc.ts';
import type { LibraryTechniqueOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import {
  TECHNIQUE_DIFFICULTIES,
  TECHNIQUE_DIFFICULTY_LABELS,
  type TechniqueDifficulty,
  type TechniqueOut,
} from '../../../../shared/schemas/technique.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { LibraryAutocomplete } from '../../../components/ui/LibraryAutocomplete.tsx';
import { RollLevelChip } from '../../../components/ui/RollLevelChip.tsx';
import { DRAFT_FIELD_CLASS } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';
import { RollSheet } from './RollSheet.tsx';
import type { RollRequest } from './rollTypes.ts';
import { useAddEntityForm } from './useAddEntityForm.ts';
import {
  useEntityEnumField,
  useEntityNameField,
  useEntityPointsField,
  useEntityRowPatch,
  useEntityTextField,
} from './useEntityRowPatch.ts';
import { useLibraryFetcher } from './useLibraryFetcher.ts';

interface AddTechniqueFormProps {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}

interface TechniqueSnapshot {
  name: string;
  nameRaw: string;
  defaultSkillName: string;
  defaultSkillNameRaw: string;
  difficulty: TechniqueDifficulty;
  points: number;
  pointsRaw: string;
  maxLevel: number | null;
  libraryTechniqueId: string | null;
}

function AddTechniqueForm({ characterId, campaignId, canWrite }: AddTechniqueFormProps) {
  const [name, setName] = useState('');
  const [defaultSkillName, setDefaultSkillName] = useState('');
  const [difficulty, setDifficulty] = useState<TechniqueDifficulty>('A');
  const [points, setPoints] = useState('1');
  const [pickedLibraryId, setPickedLibraryId] = useState<string | null>(null);
  const [pickedMaxLevel, setPickedMaxLevel] = useState<number | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);

  const { fetchOptions } = useLibraryFetcher<LibraryTechniqueOut>('techniques', campaignId);
  const { creating, submit: submitEntity } = useAddEntityForm({
    entityClass: 'character_technique',
    characterId,
    label: 'technique',
  });

  async function submit(snap: TechniqueSnapshot) {
    await submitEntity(
      {
        name: snap.name,
        defaultSkillName: snap.defaultSkillName,
        difficulty: snap.difficulty,
        points: snap.points,
        ...(snap.maxLevel != null ? { maxLevel: snap.maxLevel } : {}),
        characterId,
        ...(snap.libraryTechniqueId ? { libraryTechniqueId: snap.libraryTechniqueId } : {}),
      },
      () => {
        // AGENTS.md rule 1: only clear a field whose *current* value still
        // matches what we submitted (functional setter = live state).
        setName((cur) => (cur === snap.nameRaw ? '' : cur));
        setDefaultSkillName((cur) => (cur === snap.defaultSkillNameRaw ? '' : cur));
        setPoints((cur) => (cur === snap.pointsRaw ? '1' : cur));
        // The library-derived cap follows the pick guard: a pick made
        // during the in-flight create must survive.
        setPickedLibraryId((cur) => (cur === snap.libraryTechniqueId ? null : cur));
        setPickedMaxLevel((cur) => (cur === snap.maxLevel ? null : cur));
        setPointsError(null);
      },
    );
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !defaultSkillName.trim()) return;
        // Never silently substitute 1 for an invalid points draft; block
        // the submit and keep the typed value for correction instead.
        if (points.trim() === '') {
          setPointsError('Points must be an integer between 0 and 100');
          return;
        }
        const parsed = Number(points);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
          setPointsError('Points must be an integer between 0 and 100');
          return;
        }
        setPointsError(null);
        void submit({
          name: name.trim(),
          nameRaw: name,
          defaultSkillName: defaultSkillName.trim(),
          defaultSkillNameRaw: defaultSkillName,
          difficulty,
          points: parsed,
          pointsRaw: points,
          maxLevel: pickedMaxLevel,
          libraryTechniqueId: pickedLibraryId,
        });
      }}
    >
      <div className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs" id="add-technique-name-label">
          Technique
        </span>
        {campaignId ? (
          <LibraryAutocomplete<LibraryTechniqueOut>
            value={name}
            onChange={(v) => {
              setName(v);
              setPickedLibraryId(null);
              setPickedMaxLevel(null);
            }}
            onPick={(opt) => {
              setName(opt.name);
              setDefaultSkillName(opt.defaultSkillName);
              setDifficulty(opt.difficulty);
              setPickedLibraryId(opt.id);
              // Carry the library technique's level cap onto the row so
              // investing points can't exceed the technique's maximum.
              setPickedMaxLevel(opt.maxLevel ?? null);
            }}
            fetchOptions={fetchOptions}
            getOptionKey={(o) => o.id}
            renderOption={(o) => (
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate">{o.name}</span>
                <span className="num text-xs text-base-content/70">
                  {o.defaultSkillName}/{o.difficulty}
                </span>
              </span>
            )}
            placeholder="e.g. Feint"
            inputProps={{ 'aria-labelledby': 'add-technique-name-label' }}
          />
        ) : (
          <input
            aria-labelledby="add-technique-name-label"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Feint"
          />
        )}
      </div>
      <label className="form-control flex-1 min-w-[8rem]">
        <span className="label-text text-xs">Defaults from</span>
        <input
          className="input input-bordered input-sm"
          value={defaultSkillName}
          onChange={(e) => setDefaultSkillName(e.target.value)}
          placeholder="e.g. Broadsword"
        />
      </label>
      <label className="form-control">
        <span className="label-text text-xs">Diff</span>
        <select
          className="select select-bordered select-sm"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as TechniqueDifficulty)}
        >
          {TECHNIQUE_DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {TECHNIQUE_DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-control w-20">
        <span className="label-text text-xs">Pts</span>
        <input
          className="input input-bordered input-sm num"
          value={points}
          onChange={(e) => {
            setPoints(e.target.value);
            setPointsError(null);
          }}
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
      </button>
      {pointsError && <p className="basis-full text-error text-xs">{pointsError}</p>}
    </form>
  );
}

interface TechniqueRowProps {
  characterId: string;
  technique: TechniqueOut;
  canWrite: boolean;
  onRoll: (req: RollRequest) => void;
}

function TechniqueRow({ characterId, technique, canWrite, onRoll }: TechniqueRowProps) {
  const toasts = useToasts();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rowPatch = useEntityRowPatch(
    'character_technique',
    technique.id,
    characterId,
    technique.name,
  );

  const nameField = useEntityNameField(rowPatch, technique.name);
  const defaultSkillField = useEntityTextField(
    rowPatch,
    `${technique.name} default skill`,
    'defaultSkillName',
    technique.defaultSkillName,
    (v) => (v.length > 0 ? null : 'default skill cannot be empty'),
  );
  const difficultyField = useEntityEnumField<TechniqueDifficulty>(
    rowPatch,
    `${technique.name} difficulty`,
    'difficulty',
    technique.difficulty,
    TECHNIQUE_DIFFICULTIES,
  );
  const pointsField = useEntityPointsField(rowPatch, technique.name, technique.points, (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error('non-negative integer only');
    }
    return n;
  });

  const removeTechnique = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_technique',
        entityId: technique.id,
        humanName: `technique "${technique.name}"`,
        characterId,
        prevValue: technique,
      });
    } catch (err) {
      toasts.push(`Couldn't delete technique — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  const bonus = techniqueBonus(technique.points, technique.difficulty, technique.maxLevel);
  const levelTitle =
    technique.level === null
      ? `Skill "${technique.defaultSkillName}" not on sheet`
      : `${technique.defaultSkillName} ${technique.defaultSkillLevel} ${bonus >= 0 ? '+' : ''}${bonus}${
          technique.maxLevel !== null ? ` (capped at +${technique.maxLevel})` : ''
        }`;

  return (
    <li className="grid grid-cols-[1fr_1fr_5rem_4rem_4rem_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      {canWrite ? (
        <input
          aria-label={`${technique.name} name`}
          className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium`}
          {...nameField.inputProps}
        />
      ) : (
        <span className="font-medium">{technique.name}</span>
      )}
      {canWrite ? (
        <input
          aria-label={`${technique.name} default skill`}
          className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm`}
          {...defaultSkillField.inputProps}
        />
      ) : (
        <span className="text-sm text-base-content/70">{technique.defaultSkillName}</span>
      )}
      {canWrite ? (
        <select
          aria-label={`${technique.name} difficulty`}
          className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm`}
          {...difficultyField.selectProps}
        >
          {TECHNIQUE_DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {TECHNIQUE_DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-base-content/70 text-center">
          {TECHNIQUE_DIFFICULTY_LABELS[technique.difficulty]}
        </span>
      )}
      {canWrite ? (
        <input
          aria-label={`${technique.name} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{technique.points}</span>
      )}
      <RollLevelChip
        level={technique.level}
        name={technique.name}
        title={levelTitle}
        onRoll={(level) => onRoll({ label: technique.name, baseTarget: level })}
      />
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Delete technique ${technique.name}`}
        >
          ✕
        </button>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete technique "${technique.name}"?`}
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          setConfirmDelete(false);
          void removeTechnique();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

export function TechniquesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  // Hosted once here (not per row) so every roll-target tap opens the
  // SAME sheet instance -- mirrors SkillsPanel.
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const total = character.techniques.reduce((sum, t) => sum + t.points, 0);

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Techniques</p>
          <h2 className="font-display text-2xl">Techniques</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.techniques.length}{' '}
          {character.techniques.length === 1 ? 'technique' : 'techniques'}
          {' · '}
          <span className="num">{total}</span> pts
        </p>
      </header>

      <AddTechniqueForm
        characterId={character.id}
        campaignId={character.campaignId ?? null}
        canWrite={canWrite}
      />

      {character.techniques.length === 0 ? (
        <p className="text-sm text-base-content/60">No techniques yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_1fr_5rem_4rem_4rem_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Technique</span>
            <span>Defaults from</span>
            <span className="text-center">Diff</span>
            <span className="text-right">Pts</span>
            <span className="text-right">Lvl</span>
            <span />
          </div>
          <ul>
            {character.techniques.map((t) => (
              <TechniqueRow
                key={t.id}
                characterId={character.id}
                technique={t}
                canWrite={canWrite}
                onRoll={setRollRequest}
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
