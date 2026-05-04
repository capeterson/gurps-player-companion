import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CharacterDetail, CharacterListItem } from '../../../shared/schemas/character.ts';
import { api } from '../../lib/api.ts';

export function CharactersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const characters = useQuery({
    queryKey: ['characters'],
    queryFn: () => api<CharacterListItem[]>('/characters'),
  });

  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<CharacterDetail>('/characters', {
        method: 'POST',
        body: { name, st: 10, dx: 10, iq: 10, ht: 10 },
      }),
    onSuccess: (created) => {
      setName('');
      qc.invalidateQueries({ queryKey: ['characters'] });
      navigate(`/characters/${created.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="label-eyebrow">Characters</p>
        <h1 className="font-display text-3xl">Your characters</h1>
      </header>

      <form
        className="flex items-end gap-3 card bg-base-200 border border-base-300 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate();
        }}
      >
        <label className="form-control flex-1">
          <span className="label-text">New character name</span>
          <input
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sir Lancelot"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>

      {create.isError && (
        <p className="text-error text-sm">Couldn’t create — {(create.error as Error).message}</p>
      )}

      <ul className="grid md:grid-cols-2 gap-3">
        {(characters.data ?? []).map((c) => (
          <li key={c.id}>
            <Link
              to={`/characters/${c.id}`}
              className="card bg-base-200 border border-base-300 p-4 block hover:bg-base-300 transition-colors"
            >
              <div className="flex items-baseline justify-between">
                <p className="font-display text-xl">{c.name}</p>
                <span className="label-eyebrow">TL {c.techLevel ?? '—'}</span>
              </div>
              <p className="text-sm text-base-content/70">
                <span className="num">ST {c.st}</span> · <span className="num">DX {c.dx}</span> ·{' '}
                <span className="num">IQ {c.iq}</span> · <span className="num">HT {c.ht}</span>
              </p>
            </Link>
          </li>
        ))}
        {characters.data?.length === 0 && (
          <li className="text-base-content/60 text-sm">No characters yet.</li>
        )}
      </ul>
    </div>
  );
}
