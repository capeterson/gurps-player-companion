import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import type { CharacterListItem } from '../../../shared/schemas/character.ts';

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function HomePage() {
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });
  const characters = useQuery({
    queryKey: ['characters'],
    queryFn: () => api<CharacterListItem[]>('/characters'),
  });

  return (
    <div className="space-y-6">
      <section>
        <p className="label-eyebrow">Welcome</p>
        <h1 className="font-display text-3xl">{me.data?.displayName ?? '…'}</h1>
        <p className="text-sm text-base-content/70">{me.data?.email}</p>
      </section>
      <section className="grid md:grid-cols-2 gap-4">
        <Link to="/characters" className="card bg-base-200 border border-base-300 p-5 hover:bg-base-300">
          <p className="label-eyebrow">Your characters</p>
          <p className="font-display text-2xl num">{characters.data?.length ?? '—'}</p>
        </Link>
      </section>
    </div>
  );
}
