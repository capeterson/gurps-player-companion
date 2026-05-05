import { useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SkillOut } from '../../../../shared/schemas/skill.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';

const ATTRIBUTES = ['ST', 'DX', 'IQ', 'HT', 'Will', 'Per', 'Other'] as const;
const DIFFICULTIES = ['E', 'A', 'H', 'VH'] as const;
type SkillAttribute = (typeof ATTRIBUTES)[number];
type SkillDifficulty = (typeof DIFFICULTIES)[number];

interface AddSkillFormProps {
  characterId: string;
  canWrite: boolean;
}

interface SkillSnapshot {
  name: string;
  nameRaw: string;
  attribute: SkillAttribute;
  difficulty: SkillDifficulty;
  points: number;
  pointsRaw: string;
}

function AddSkillForm({ characterId, canWrite }: AddSkillFormProps) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [attribute, setAttribute] = useState<SkillAttribute>('DX');
  const [difficulty, setDifficulty] = useState<SkillDifficulty>('A');
  const [points, setPoints] = useState('1');
  const [creating, setCreating] = useState(false);

  async function submit(snap: SkillSnapshot) {
    setCreating(true);
    try {
      await enqueueCreate({
        entityClass: 'character_skill',
        entityId: newClientId(),
        humanName: 'skill',
        characterId,
        attemptedValue: {
          name: snap.name,
          attribute: snap.attribute,
          difficulty: snap.difficulty,
          points: snap.points,
          characterId,
        },
      });
      // Per AGENTS.md (rule 1: never silently discard user edits): only
      // clear fields whose current value still matches the snapshot we
      // submitted.  If the user has started typing the next skill while
      // this enqueue was in flight, leave that draft alone.
      if (name === snap.nameRaw) setName('');
      if (points === snap.pointsRaw) setPoints('1');
    } catch (err) {
      toasts.push(`Couldn't add skill — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
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
        });
      }}
    >
      <label className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs">Skill</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Broadsword"
        />
      </label>
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
}

function SkillRow({ characterId, skill, canWrite }: SkillRowProps) {
  const toasts = useToasts();

  const patchSkill = (field: string, value: unknown) =>
    enqueueFieldPatch({
      entityClass: 'character_skill',
      entityId: skill.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: `${skill.name} ${field}`,
      flashKey: makeFlashKey('character_skill', skill.id, field),
      characterId,
    });

  const nameField = useDraftField<string>({
    name: `${skill.name} name`,
    serverValue: skill.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchSkill('name', v),
    flashKey: makeFlashKey('character_skill', skill.id, 'name'),
  });
  const pointsField = useDraftField<number>({
    name: `${skill.name} points`,
    serverValue: skill.points,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new Error('non-negative integer only');
      }
      return n;
    },
    onSave: (v) => patchSkill('points', v),
    flashKey: makeFlashKey('character_skill', skill.id, 'points'),
  });

  const removeSkill = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_skill',
        entityId: skill.id,
        humanName: `skill "${skill.name}"`,
        characterId,
        prevValue: skill,
      });
    } catch (err) {
      toasts.push(`Couldn't delete skill — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return (
    <li className="grid grid-cols-[1fr_4rem_4rem_4rem_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      {canWrite ? (
        <input
          aria-label={`${skill.name} name`}
          className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium`}
          {...nameField.inputProps}
        />
      ) : (
        <span className="font-medium">{skill.name}</span>
      )}
      <span className="text-xs text-base-content/70 num text-center">
        {skill.attribute}/{skill.difficulty}
      </span>
      {canWrite ? (
        <input
          aria-label={`${skill.name} points`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...pointsField.inputProps}
        />
      ) : (
        <span className="num text-right">{skill.points}</span>
      )}
      <span className="num text-right font-medium" aria-label={`${skill.name} level`}>
        {skill.level}
      </span>
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            if (confirm(`Delete skill "${skill.name}"?`)) void removeSkill();
          }}
          aria-label={`Delete skill ${skill.name}`}
        >
          ✕
        </button>
      )}
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

      <AddSkillForm characterId={character.id} canWrite={canWrite} />

      {character.skills.length === 0 ? (
        <p className="text-sm text-base-content/60">No skills yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_4rem_4rem_4rem_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Skill</span>
            <span className="text-center">Attr/Dif</span>
            <span className="text-right">Pts</span>
            <span className="text-right">Lvl</span>
            <span />
          </div>
          <ul>
            {character.skills.map((s) => (
              <SkillRow key={s.id} characterId={character.id} skill={s} canWrite={canWrite} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
