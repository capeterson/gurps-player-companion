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

  const recent = (characters ?? []).slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="card overflow-hidden p-card sm:p-8">
        <div className="max-w-2xl space-y-3">
          <p className="label-eyebrow">Welcome</p>
          <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
            {me.data?.displayName ?? 'Adventurer'}
          </h1>
          <p className="text-sm text-muted">Pick up where you left off.</p>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <p className="label-eyebrow">Recent characters</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((c) => (
              <div
                key={c.id}
                className="card flex min-w-0 flex-col gap-1 p-card transition hover:border-border-strong"
              >
                <Link to={`/characters/${c.id}`} className="min-w-0">
                  <p className="font-display text-lg font-semibold leading-tight truncate">
                    {c.name}
                  </p>
                  <p className="text-xs text-muted">
                    ST {c.st} · DX {c.dx} · IQ {c.iq} · HT {c.ht}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
