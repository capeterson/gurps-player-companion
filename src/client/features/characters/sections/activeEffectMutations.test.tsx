import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { instantiateEffect } from '../../../../shared/domain/activeEffects.ts';
import { activeEffectDefinitionCreate } from '../../../../shared/schemas/activeEffects.ts';
import { characterCreate } from '../../../../shared/schemas/character.ts';
import { getLocalDb, resetLocalDb } from '../../../db/dexie.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { tokenStore } from '../../../lib/tokenStore.ts';
import { flashBus } from '../../../sync/flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from '../../../sync/orchestrator.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';
import { useCharacterDetail } from '../useCharacterDetail.ts';
import { mutateActiveEffects } from './activeEffectMutations.ts';
import { ActiveEffectsPanel } from './combat/ActiveEffectsPanel.tsx';
import { SoloTrackerCard } from './combat/SoloTrackerCard.tsx';
const id = '00000000-0000-4000-8000-000000000001';
const effect = instantiateEffect(
  activeEffectDefinitionCreate.parse({
    name: 'Potion',
    stacking: { kind: 'additive', key: 'potion' },
    effects: [{ target: 'st', value: 2 }],
  }),
  '00000000-0000-4000-8000-000000000002',
  new Date().toISOString(),
);
async function seed() {
  await getLocalDb().characters.put({
    ...characterCreate.parse({ name: 'Hero' }),
    id,
    ownerId: 'owner',
    campaignId: null,
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    dismissedWarnings: [],
    activeEffects: [effect],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  });
}
function login() {
  tokenStore.write({
    accessToken: `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
    refreshToken: 'refresh',
    accessTokenExpiresIn: 0,
  });
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSyncOrchestratorForTests();
  tokenStore.clear();
  await resetLocalDb();
});
it('composes rapid edits to the same and different instances, keeping other fields', async () => {
  await seed();
  await Promise.all([
    mutateActiveEffects(id, 'Notes', (entries) => entries.map((e) => ({ ...e, notes: 'First' }))),
    mutateActiveEffects(id, 'Notes', (entries) => entries.map((e) => ({ ...e, notes: 'Latest' }))),
    mutateActiveEffects(id, 'Deactivate', (entries) =>
      entries.map((e) => ({ ...e, state: 'inactive' })),
    ),
    enqueueFieldPatch({
      entityClass: 'character',
      entityId: id,
      fieldPath: 'name',
      attemptedValue: 'New hero',
    }),
  ]);
  const row = await getLocalDb().characters.get(id);
  expect(row?.activeEffects?.[0]).toMatchObject({ notes: 'Latest', state: 'inactive' });
  expect(row?.name).toBe('New hero');
  expect(await getLocalDb().outbox.count()).toBe(2);
});
it.each(['applied', 'rejected'] as const)(
  'settles %s with cursor protection, durable rollback notices and flashes',
  async (status) => {
    await seed();
    login();
    await mutateActiveEffects(id, 'Potion state', (entries) =>
      entries.map((e) => ({ ...e, state: 'inactive' })),
    );
    const flash = vi.fn();
    const off = flashBus.subscribe(`character:${id}:activeEffects`, flash);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/sync/operations'))
          return json({
            outcomes: JSON.parse(String(init?.body)).operations.map(
              (op: { clientOpId: string }) => ({
                clientOpId: op.clientOpId,
                status,
                newRevision: 2,
                reason: 'Effect rejected',
              }),
            ),
          });
        return json({ changes: [], nextCursor: {}, hasMore: {} });
      }),
    );
    getSyncOrchestrator().start();
    await waitFor(async () => expect(await getLocalDb().outbox.count()).toBe(0));
    expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]?.state).toBe(
      status === 'applied' ? 'inactive' : 'active',
    );
    expect(await getLocalDb().rejectionToasts.count()).toBe(status === 'rejected' ? 1 : 0);
    if (status === 'rejected') expect(flash).toHaveBeenCalled();
    off();
  },
);
it('preserves active effects during a stale cursor pull and purges them on logout', async () => {
  await seed();
  login();
  await mutateActiveEffects(id, 'Notes', (entries) =>
    entries.map((e) => ({ ...e, notes: 'Offline' })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        changes: [
          {
            entityClass: 'character',
            entityId: id,
            command: 'patch',
            revision: 2,
            data: { id, ownerId: 'owner', activeEffects: [], revision: 2 },
          },
        ],
        nextCursor: { character: 2 },
        hasMore: {},
      }),
    ),
  );
  await getSyncOrchestrator().triggerCursorPull();
  expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]?.notes).toBe('Offline');
  await getSyncOrchestrator().purge();
  expect(await getLocalDb().characters.count()).toBe(0);
  expect(await getLocalDb().outbox.count()).toBe(0);
});
function Panel() {
  const character = useCharacterDetail(id);
  return character ? <ActiveEffectsPanel character={character} canWrite /> : null;
}
function renderPanel() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <Panel />
      </ToastProvider>
    </QueryClientProvider>,
  );
}
it('saves notes, deactivates and reactivates offline without duplicating mechanics', async () => {
  await seed();
  renderPanel();
  const notes = await screen.findByLabelText('Potion notes');
  fireEvent.change(notes, { target: { value: 'Kept offline' } });
  fireEvent.blur(notes);
  await waitFor(async () =>
    expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]?.notes).toBe('Kept offline'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
  await screen.findByRole('button', { name: 'Activate' });
  expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]?.state).toBe('inactive');
  fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
  await screen.findByRole('button', { name: 'Deactivate' });
  expect((await getLocalDb().characters.get(id))?.activeEffects).toHaveLength(1);
});
it('shows toast and flashes notes when local persistence rejects a save', async () => {
  await seed();
  renderPanel();
  const notes = await screen.findByLabelText('Potion notes');
  vi.spyOn(getLocalDb().outbox, 'add').mockRejectedValueOnce(new Error('Disk full'));
  fireEvent.change(notes, { target: { value: 'Unsaved' } });
  fireEvent.blur(notes);
  await screen.findByText(/Couldn't save Potion notes.*Disk full/);
  await waitFor(() => expect(notes).toHaveAttribute('data-flashing', 'true'));
  expect(notes).toHaveValue('');
});

it('queues same-field follow-ups during a slow push and preserves a different-field edit', async () => {
  await seed();
  login();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const sent: Array<Array<{ fieldPath: string; attemptedValue: unknown }>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/operations')) {
        const operations = JSON.parse(String(init?.body)).operations;
        sent.push(operations);
        if (first) {
          first = false;
          await gate;
        }
        return json({
          outcomes: operations.map((op: { clientOpId: string }) => ({
            clientOpId: op.clientOpId,
            status: 'applied',
            newRevision: sent.length + 1,
          })),
        });
      }
      return json({ changes: [], nextCursor: {}, hasMore: {} });
    }),
  );
  await mutateActiveEffects(id, 'Notes', (entries) =>
    entries.map((e) => ({ ...e, notes: 'First' })),
  );
  getSyncOrchestrator().start();
  await waitFor(() => expect(sent).toHaveLength(1));
  await mutateActiveEffects(id, 'Notes', (entries) =>
    entries.map((e) => ({ ...e, notes: 'Second' })),
  );
  await mutateActiveEffects(id, 'State', (entries) =>
    entries.map((e) => ({ ...e, state: 'inactive' })),
  );
  await enqueueFieldPatch({
    entityClass: 'character',
    entityId: id,
    fieldPath: 'name',
    attemptedValue: 'Renamed',
  });
  release();
  await waitFor(async () => expect(await getLocalDb().outbox.count()).toBe(0), { timeout: 5_000 });
  expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]).toMatchObject({
    notes: 'Second',
    state: 'inactive',
  });
  expect((await getLocalDb().characters.get(id))?.name).toBe('Renamed');
  expect(sent.flat().filter((op) => op.fieldPath === 'activeEffects')).toHaveLength(2);
});

it('expires round effects through the outbox when the solo tracker advances, without undoing expiry on Previous', async () => {
  await seed();
  await getLocalDb().characters.update(id, {
    activeEffects: [{ ...effect, duration: { kind: 'rounds', amount: 1 }, remainingRounds: 1 }],
  });
  await getLocalDb().soloEncounters.put({
    characterId: id,
    round: 1,
    activeCombatantId: 'hero',
    combatants: [{ id: 'hero', name: 'Hero', orderKey: 1, active: true }],
    effects: [],
    updatedAt: new Date().toISOString(),
  });
  render(
    <ToastProvider>
      <SoloTrackerCard characterId={id} canWrite />
    </ToastProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Next turn' }));
  await waitFor(async () =>
    expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]).toMatchObject({
      state: 'expired',
      remainingRounds: 0,
    }),
  );
  expect((await getLocalDb().soloEncounters.get(id))?.round).toBe(2);
  expect(await getLocalDb().outbox.count()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await waitFor(async () => expect((await getLocalDb().soloEncounters.get(id))?.round).toBe(1));
  expect((await getLocalDb().characters.get(id))?.activeEffects?.[0]?.state).toBe('expired');
});
