import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { useCharactersList } from '../characters/useCharacterDetail.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function HomePage() {
  // /auth/me stays on the API: account identity is server-issued and
  // can't be served from Dexie.  Everything below it reads from the
  // local store via useLiveQuery.
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });
  const characters = useCharactersList();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="card overflow-hidden bg-base-200 border border-base-300 p-6 sm:p-8">
        <div className="max-w-2xl space-y-3">
          <p className="label-eyebrow">Welcome</p>
          <h1 className="font-display text-4xl sm:text-5xl leading-tight">
            {me.data?.displayName ?? 'Adventurer'}
          </h1>
          <p className="text-sm text-muted">
            Jump back into your campaign tools without the old wall of empty space.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link to="/characters" className="btn btn-primary">
              View characters
            </Link>
            <Link to="/settings" className="btn btn-ghost">
              Settings
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/characters"
          className="card bg-base-200 border border-base-300 p-5 hover:bg-base-300 transition-colors"
        >
          <p className="label-eyebrow">Your characters</p>
          <p className="font-display text-3xl num">{characters?.length ?? '—'}</p>
          <p className="text-sm text-muted">Open sheets, create heroes, and track advancement.</p>
        </Link>
        <Link
          to="/settings"
          className="card bg-base-200 border border-base-300 p-5 hover:bg-base-300 transition-colors"
        >
          <p className="label-eyebrow">Account</p>
          <p className="font-display text-3xl">Settings</p>
          <p className="text-sm text-muted">Password and browser-local sync status.</p>
        </Link>
      </section>
    </div>
  );
}
