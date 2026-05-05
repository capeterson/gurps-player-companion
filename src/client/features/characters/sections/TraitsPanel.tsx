import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { TraitOut } from '../../../../shared/schemas/trait.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { api } from '../../../lib/api.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { applyDetailToCache, characterDetailKey } from './useCharacterPatch.ts';

const TRAIT_KINDS = [
  'advantage',
  'disadvantage',
  'perk',
  'quirk',
  'language',
  'cultural_familiarity',
] as const;

type TraitKind = (typeof TRAIT_KINDS)[number];

interface AddTraitFormProps {
  characterId: string;
  canWrite: boolean;
}

interface TraitSnapshot {
  name: string;
  nameRaw: string;
  kind: TraitKind;
  points: number;
  pointsRaw: string;
}

function AddTraitForm({ characterId, canWrite }: AddTraitFormProps) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TraitKind>('advantage');
  const [points, setPoints] = useState('0');

  const create = useMutation({
    mutationFn: (snap: TraitSnapshot) =>
      api<{ trait: TraitOut; character: CharacterDetail }>(`/characters/${characterId}/traits`, {
        method: 'POST',
        body: { name: snap.name, kind: snap.kind, points: snap.points },
      }),
    onSuccess: (res, snap) => {
      applyDetailToCache(qc, characterId, res.character);
      // Per AGENTS.md (rule 1: never silently discard user edits): only
      // clear fields whose current value still matches the snapshot we
      // submitted.  If the user has started typing the next trait while
      // this POST was in flight, leave that draft alone.
      if (name === snap.nameRaw) setName('');
      if (points === snap.pointsRaw) setPoints('0');
    },
    onError: (err) => {
      toasts.push(`Couldn't add trait — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // `Number.isFinite` keeps both 0 and negative values (a -10
        // disadvantage) intact.  `Number(...) || 0` would already
        // preserve 0 here but breaks if the user clears the field —
        // make the parse explicit and let invalid input fall to 0.
        const pParsed = Number(points);
        create.mutate({
          name: name.trim(),
          nameRaw: name,
          kind,
          points: Number.isFinite(pParsed) ? pParsed : 0,
          pointsRaw: points,
        });
      }}
    >
      <label className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs">Trait name</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Combat Reflexes"
        />
      </label>
      <label className="form-control">
        <span className="label-text text-xs">Kind</span>
        <select
          className="select select-bordered select-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as TraitKind)}
        >
          {TRAIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace('_', ' ')}
            </option>
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
      <button type="submit" className="btn btn-sm btn-primary" disabled={create.isPending}>
        {create.isPending ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface TraitRowProps {
  characterId: string;
  trait: TraitOut;
  canWrite: boolean;
}

function TraitRow({ characterId, trait, canWrite }: TraitRowProps) {
  const qc = useQueryClient();
  const toasts = useToasts();

  const patchTrait = async (field: string, value: unknown) => {
    const res = await api<{ trait: TraitOut; character: CharacterDetail }>(
      `/characters/${characterId}/traits/${trait.id}`,
      {
        method: 'PATCH',
        body: { [field]: value },
      },
    );
    applyDetailToCache(qc, characterId, res.character);
  };

  const nameField = useDraftField<string>({
    name: `${trait.name} name`,
    serverValue: trait.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchTrait('name', v),
  });
  const pointsField = useDraftField<number>({
    name: `${trait.name} points`,
    serverValue: trait.points,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('integer only');
      return n;
    },
    onSave: (v) => patchTrait('points', v),
  });
  const notesField = useDraftField<string | null>({
    name: `${trait.name} notes`,
    serverValue: trait.notes ?? '',
    parse: (s) => (s.trim().length === 0 ? null : s),
    onSave: (v) => patchTrait('notes', v),
  });

  const remove = useMutation({
    mutationFn: () =>
      api<CharacterDetail>(`/characters/${characterId}/traits/${trait.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (detail) => applyDetailToCache(qc, characterId, detail),
    onError: (err) => {
      toasts.push(`Couldn't delete trait — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  return (
    <li className="grid grid-cols-[1fr_auto_auto] gap-2 items-start py-2 border-b border-base-300 last:border-0">
      <div>
        {canWrite ? (
          <input
            aria-label={`${trait.name} name`}
            className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm w-full font-medium`}
            value={nameField.value}
            onChange={nameField.inputProps.onChange}
            onBlur={nameField.inputProps.onBlur}
            data-flashing={nameField.inputProps['data-flashing']}
            data-flash-parity={nameField.inputProps['data-flash-parity']}
          />
        ) : (
          <span className="font-medium">{trait.name}</span>
        )}
        <p className="text-xs text-base-content/60 capitalize">{trait.kind.replace('_', ' ')}</p>
        {canWrite ? (
          <textarea
            aria-label={`${trait.name} notes`}
            className={`${DRAFT_FIELD_CLASS} textarea textarea-ghost textarea-sm w-full mt-1 text-xs`}
            placeholder="Notes…"
            value={notesField.value}
            onChange={(e) => notesField.setValue(e.target.value)}
            onBlur={notesField.inputProps.onBlur}
            data-flashing={notesField.inputProps['data-flashing']}
            data-flash-parity={notesField.inputProps['data-flash-parity']}
            rows={1}
          />
        ) : (
          trait.notes && <p className="text-xs text-base-content/60 mt-1">{trait.notes}</p>
        )}
      </div>
      <div className="text-right">
        {canWrite ? (
          <input
            aria-label={`${trait.name} points`}
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-20 num text-right`}
            value={pointsField.value}
            onChange={pointsField.inputProps.onChange}
            onBlur={pointsField.inputProps.onBlur}
            data-flashing={pointsField.inputProps['data-flashing']}
            data-flash-parity={pointsField.inputProps['data-flash-parity']}
          />
        ) : (
          <span className="num">{trait.points}</span>
        )}
        <p className="label-eyebrow">pts</p>
      </div>
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            if (confirm(`Delete trait "${trait.name}"?`)) remove.mutate();
          }}
          disabled={remove.isPending}
          aria-label={`Delete trait ${trait.name}`}
        >
          ✕
        </button>
      )}
    </li>
  );
}

export function TraitsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const grouped = new Map<TraitKind, TraitOut[]>();
  for (const t of character.traits) {
    const arr = grouped.get(t.kind) ?? [];
    arr.push(t);
    grouped.set(t.kind, arr);
  }

  return (
    <section className="card space-y-3 p-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Traits</p>
          <h2 className="font-display text-2xl">Advantages, disadvantages & quirks</h2>
        </div>
        <p className="text-xs text-base-content/60">
          {character.traits.length} {character.traits.length === 1 ? 'entry' : 'entries'}
        </p>
      </header>

      <AddTraitForm characterId={character.id} canWrite={canWrite} />

      {character.traits.length === 0 ? (
        <p className="text-sm text-base-content/60">No traits yet.</p>
      ) : (
        TRAIT_KINDS.filter((k) => (grouped.get(k)?.length ?? 0) > 0).map((kind) => (
          <div key={kind}>
            <h3 className="label-eyebrow mt-2">{kind.replace('_', ' ')}</h3>
            <ul>
              {(grouped.get(kind) ?? []).map((t) => (
                <TraitRow key={t.id} characterId={character.id} trait={t} canWrite={canWrite} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
