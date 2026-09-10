import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../../db/dexie.ts';
import { api } from '../../lib/api.ts';
import { useCharacterDetail } from './useCharacterDetail.ts';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));

async function seed() {
  const db = getLocalDb();
  const dates = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
  await db.characters.put({
    id: 'character',
    ownerId: 'owner',
    campaignId: 'campaign',
    name: 'Test',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    tempEffects: [],
    dismissedWarnings: [],
    activeConditionGroups: [],
    ...dates,
  });
  await db.characterTraits.put({
    id: 'trait',
    characterId: 'character',
    name: 'Skin',
    kind: 'advantage',
    points: 5,
    level: 1,
    variantName: null,
    notes: null,
    modifiers: [],
    libraryTraitId: 'skin',
    ...dates,
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useCharacterDetail('character'), { wrapper }) };
}

describe('local library effect availability', () => {
  it('keeps linked effects unknown until loading finishes, including known empty definitions', async () => {
    await seed();
    let complete: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result, client } = setup();
    await waitFor(() => expect(result.current?.libraryEffectsKnown).toBe(false));
    await act(async () => complete({ traits: [{ id: 'skin', effects: [] }], skills: [] }));
    await waitFor(() => expect(result.current?.libraryEffectsKnown).toBe(true));
    expect(result.current?.derived.traitDr).toBe(0);
    act(() =>
      client.setQueryData(['campaigns', 'campaign', 'library'], {
        traits: [{ id: 'skin', effects: [{ target: 'dr', value: 5, scaling: 'flat' }] }],
        skills: [],
      }),
    );
    await waitFor(() => expect(result.current?.derived.traitDr).toBe(5));
    expect(result.current?.libraryEffectsKnown).toBe(true);
  });

  it.each(['missing', 'offline'])(
    'keeps %s definitions unknown instead of treating them as zero',
    async (mode) => {
      await seed();
      if (mode === 'offline') vi.mocked(api).mockRejectedValue(new Error('Offline'));
      else vi.mocked(api).mockResolvedValue({ traits: [], skills: [] });
      const { result, client } = setup();
      await waitFor(() =>
        expect(client.getQueryState(['campaigns', 'campaign', 'library'])?.fetchStatus).toBe(
          'idle',
        ),
      );
      await waitFor(() => expect(result.current?.libraryEffectsKnown).toBe(false));
    },
  );
});
