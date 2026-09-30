import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import type { LibraryMechanics } from '../../../shared/schemas/libraryMechanics.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { tokenStore } from '../../lib/tokenStore.ts';
import {
  getSyncOrchestrator,
  resetSyncOrchestratorForTests,
  setRejectionNotifier,
} from '../../sync/orchestrator.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';
import { GmCampaignDashboardPage } from '../campaigns/GmCampaignDashboardPage.tsx';
import { GmCharacterCard } from '../campaigns/GmCharacterCard.tsx';
import { useCampaignCharacterDetails } from '../campaigns/useCampaignCharacterDetails.ts';
import { CharacterSheetPage } from './CharacterSheetPage.tsx';
import { LibraryMechanicsNote } from './sections/LibraryMechanicsNote.tsx';
import { DefensesCard } from './sections/combat/DefensesCard.tsx';
import { useCharacterDetail } from './useCharacterDetail.ts';

vi.mock('../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));

const CID = '0193b3c0-f1f0-7000-8000-00000000c001';
const CAMPAIGN = '0193b3c0-f1f0-7000-8000-00000000c002';
const SOURCE = '0193b3c0-f1f0-7000-8000-00000000c003';
const SKILL = '0193b3c0-f1f0-7000-8000-00000000c004';
const TRAIT = '0193b3c0-f1f0-7000-8000-00000000c005';
const snapshot: LibraryMechanics = {
  sourceId: SOURCE,
  campaignId: CAMPAIGN,
  sourceRevision: 4,
  effects: [
    { target: 'dx', value: 2, scaling: 'flat' },
    { target: 'dodge', value: 1, scaling: 'flat' },
  ],
};

async function seed(mechanics: LibraryMechanics | undefined = snapshot) {
  const db = getLocalDb();
  const dates = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
  await db.characters.put({
    id: CID,
    ownerId: 'owner',
    campaignId: CAMPAIGN,
    name: 'Test Hero',
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
    id: TRAIT,
    characterId: CID,
    name: 'Reflexes',
    kind: 'advantage',
    points: 15,
    level: 1,
    variantName: null,
    notes: null,
    modifiers: [],
    libraryTraitId: SOURCE,
    libraryMechanics: mechanics,
    ...dates,
  });
  await db.characterSkills.put({
    id: SKILL,
    characterId: CID,
    name: 'Sword',
    attribute: 'DX',
    difficulty: 'A',
    points: 2,
    techLevel: null,
    specialization: null,
    notes: null,
    librarySkillId: SKILL,
    libraryMechanics: {
      ...snapshot,
      sourceId: SKILL,
      effects: [{ target: 'skill', skillName: 'Sword', value: 1, scaling: 'flat' }],
    },
    ...dates,
  });
}

afterEach(() => {
  const scrollMethod = originalScrollIntoView;
  if (scrollMethod) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollMethod);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  setRejectionNotifier(null);
});

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

function RouteLocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

describe('durable character mechanics', () => {
  it.each([true, false])('retains a detached owned copy offline, known=%s', async (known) => {
    await seed();
    const mechanics = { ...snapshot, detached: true, effects: known ? snapshot.effects : null };
    await getLocalDb().characterTraits.update(TRAIT, {
      libraryTraitId: null,
      libraryMechanics: mechanics,
    });
    getLocalDb().close();
    await getLocalDb().open();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const player = renderHook(() => useCharacterDetail(CID));
    const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
    await waitFor(() => expect(player.result.current?.libraryEffectsKnown).toBe(known));
    await waitFor(() => expect(gm.result.current?.[0]?.libraryEffectsKnown).toBe(known));
    expect(player.result.current?.derived).toEqual(gm.result.current?.[0]?.derived);
    if (known) expect(player.result.current?.derived.effectiveDx).toBe(12);
    render(<LibraryMechanicsNote mechanics={mechanics} />);
    expect(
      screen.getByText(known ? /Saved rules retained/ : /Library rules unresolved/),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('updates open player and GM readers after a same-length library edit and a dropped-WS reconnect', async () => {
    await seed();
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    const player = renderHook(() => useCharacterDetail(CID));
    const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
    await waitFor(() => expect(player.result.current?.derived.effectiveDx).toBe(12));
    await waitFor(() => expect(gm.result.current?.[0]?.derived.effectiveDx).toBe(12));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await expect(getSyncOrchestrator().triggerCursorPull(true)).rejects.toThrow();
    expect(player.result.current?.derived.effectiveDx).toBe(12);
    const row = await getLocalDb().characterTraits.get(TRAIT);
    const next = {
      ...snapshot,
      sourceRevision: 10,
      effects: snapshot.effects?.map((effect) =>
        effect.target === 'dx' ? { ...effect, value: 5 } : effect,
      ),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              changes: [
                {
                  entityClass: 'character_trait',
                  entityId: TRAIT,
                  command: 'patch',
                  revision: 11,
                  data: { ...row, libraryMechanics: next, revision: 11 },
                },
              ],
              nextCursor: { character_trait: 11 },
              hasMore: {},
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
    // No WebSocket is present: reconnect/periodic HTTP pull alone must refresh both views.
    await act(async () => {
      await getSyncOrchestrator().triggerCursorPull(true);
    });
    await waitFor(() => expect(player.result.current?.derived.effectiveDx).toBe(15));
    await waitFor(() => expect(gm.result.current?.[0]?.derived.effectiveDx).toBe(15));
    expect(player.result.current?.skills[0]?.effectiveLevel).toBe(16);
    expect(gm.result.current?.[0]?.derived).toEqual(player.result.current?.derived);
  });
  it.each(['player', 'gm'])(
    'keeps the %s page available offline and hides unresolved calculations',
    async (view) => {
      await seed();
      await getLocalDb().characterTraits.update(TRAIT, { libraryMechanics: null });
      await getLocalDb().campaigns.put({
        id: CAMPAIGN,
        ownerId: 'owner',
        viewerRole: 'owner',
        name: 'Local Campaign',
        description: null,
        pointTarget: null,
        disadvantageCap: null,
        quirkCap: null,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      tokenStore.write({
        accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
        refreshToken: 'refresh',
        accessTokenExpiresIn: 0,
      });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
      const path = view === 'player' ? `/characters/${CID}` : `/campaigns/${CAMPAIGN}/gm`;
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/characters/:id" element={<CharacterSheetPage />} />
              <Route path="/campaigns/:id/gm" element={<GmCampaignDashboardPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(screen.getByText(/Linked rules are unavailable/)).toBeInTheDocument(),
      );
      expect(screen.queryByText('Dodge')).not.toBeInTheDocument();
      await act(async () => {
        await getLocalDb().characterTraits.update(TRAIT, { libraryMechanics: snapshot });
      });
      await waitFor(() =>
        expect(screen.queryByText(/Linked rules are unavailable/)).not.toBeInTheDocument(),
      );
      expect(screen.getAllByText('Dodge').length).toBeGreaterThan(0);
    },
  );

  it('shows Sheet overview above Identity only in Overview while Current Status stays available', async () => {
    await seed();
    await getLocalDb().campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      houseRules: campaignHouseRules.parse({ protectNaturalDr: true }),
      experimentalActiveEffects: false,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
    client.setQueryData(['campaigns'], []);

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/characters/${CID}`]}>
          <Routes>
            <Route path="/characters/:id" element={<CharacterSheetPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open character navigation' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open character navigation' }));
    expect(screen.getByRole('button', { name: /^Sheet overview/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Combat' }));
    expect(screen.queryByRole('button', { name: /^Sheet overview/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open character navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByRole('button', { name: /^Sheet overview/ })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Character description' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('complementary', { name: 'Current Status' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Adjust HP,/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Adjust FP,/ })).toBeVisible();
    expect(screen.getByText('No description yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit description' })).toBeVisible();
    expect(screen.queryByLabelText('description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('links active innate DR to the named trait and reveals its row without opening edit mode', async () => {
    await seed({
      ...snapshot,
      effects: [{ target: 'dr', value: 2, scaling: 'flat' }],
    });
    await getLocalDb().campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      houseRules: campaignHouseRules.parse({ protectNaturalDr: true }),
      experimentalActiveEffects: false,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
    client.setQueryData(['campaigns'], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/characters/${CID}`]}>
          <RouteLocationProbe />
          <Routes>
            <Route path="/characters/:id" element={<CharacterSheetPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open character navigation' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open character navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Combat' }));
    const incomingAttack = await screen.findByRole('button', { name: 'Incoming attack' });
    if (incomingAttack.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(incomingAttack);
    }
    const protection = await screen.findByRole('list', { name: 'Protection layers' });
    const source = within(protection).getByRole('link', { name: 'Reflexes' });
    expect(source).toHaveAttribute('href', `/characters/${CID}#trait-${TRAIT}`);
    fireEvent.click(source);

    const traitRow = document.getElementById(`trait-${TRAIT}`);
    expect(traitRow).toBeVisible();
    expect(traitRow).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      `/characters/${CID}#trait-${TRAIT}`,
    );
    expect(screen.getByRole('button', { name: 'Edit Reflexes' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Edit Reflexes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reflexes' }));
    expect(screen.getByText('Source & rules')).toBeVisible();
  });

  it('shows description Markdown by default, retains its editor draft, and queues a clear as empty text', async () => {
    await seed(undefined);
    await getLocalDb().outbox.clear();
    await getLocalDb().rejectionToasts.clear();
    await getLocalDb().campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
    client.setQueryData(['campaigns'], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/characters/${CID}`]}>
          <Routes>
            <Route path="/characters/:id" element={<CharacterSheetPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const description = await screen.findByRole('group', { name: 'Character description' });
    expect(description).toBeVisible();
    expect(screen.getByText('Description', { exact: true })).toBeVisible();
    expect(screen.getByText('No description yet.')).toBeVisible();
    expect(screen.queryByLabelText('description')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    const editor = screen.getByRole('textbox', { name: 'description' });
    fireEvent.change(editor, {
      target: { value: '[A useful reference](https://example.com/reference)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing description' }));
    expect(await screen.findByRole('link', { name: 'A useful reference' })).toHaveAttribute(
      'href',
      'https://example.com/reference',
    );
    await waitFor(async () => {
      const op = (await getLocalDb().outbox.toArray()).find(
        (row) => row.fieldPath === 'appearance',
      );
      expect(op?.attemptedValue).toBe('[A useful reference](https://example.com/reference)');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(screen.getByRole('button', { name: 'Back to rich text' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'description' })).toHaveValue(
      '[A useful reference](https://example.com/reference)',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'description' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing description' }));
    expect(screen.getByText('No description yet.')).toBeVisible();
    await waitFor(async () => {
      const op = (await getLocalDb().outbox.toArray()).find(
        (row) => row.fieldPath === 'appearance',
      );
      expect(op?.attemptedValue).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    expect(screen.getByRole('textbox', { name: 'description' })).toHaveValue('');
  });

  it('rolls a rejected description back visibly and reports the reason', async () => {
    await seed(undefined);
    await getLocalDb().outbox.clear();
    await getLocalDb().rejectionToasts.clear();
    await getLocalDb().campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/campaigns')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/sync/operations')) {
        const body = JSON.parse(String(init?.body)) as {
          operations: Array<{ clientOpId: string }>;
        };
        return new Response(
          JSON.stringify({
            outcomes: body.operations.map(({ clientOpId }) => ({
              clientOpId,
              status: 'rejected',
              reason: 'description rejected in test',
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/sync/cursor')) {
        return new Response(JSON.stringify({ changes: [], nextCursor: {}, hasMore: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const realToast =
      await vi.importActual<typeof import('../../lib/toast.tsx')>('../../lib/toast.tsx');
    function ToastRejectionBridge() {
      const toasts = realToast.useToasts();
      useEffect(() => {
        setRejectionNotifier((record) => {
          toasts.push(`Couldn't sync ${record.humanName} — ${record.reason}`, {
            kind: 'error',
            persistent: true,
            id: record.id,
          });
        });
        return () => setRejectionNotifier(null);
      }, [toasts]);
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
    client.setQueryData(['campaigns'], []);
    render(
      <QueryClientProvider client={client}>
        <realToast.ToastProvider>
          <MemoryRouter initialEntries={[`/characters/${CID}`]}>
            <Routes>
              <Route path="/characters/:id" element={<CharacterSheetPage />} />
            </Routes>
          </MemoryRouter>
          <ToastRejectionBridge />
        </realToast.ToastProvider>
      </QueryClientProvider>,
    );
    const description = await screen.findByRole('group', { name: 'Character description' });
    expect(description).toBeVisible();
    getSyncOrchestrator().start();
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit raw markdown' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'description' }), {
      target: { value: 'Unsaved description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing description' }));
    await waitFor(async () => {
      expect(await getLocalDb().outbox.count()).toBe(0);
      expect(await getLocalDb().characters.get(CID)).toMatchObject({ appearance: null });
    });
    expect(await screen.findByText('No description yet.')).toBeVisible();
    await waitFor(() => expect(description).toHaveAttribute('data-flashing', 'true'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't sync description — description rejected in test",
    );
    getSyncOrchestrator().stop();
    setRejectionNotifier(null);
  });

  it('shows condition controls only for effect groups and applies their modifiers when enabled', async () => {
    await seed(snapshot);
    await getLocalDb().outbox.clear();
    await getLocalDb().rejectionToasts.clear();
    await getLocalDb().campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: null,
      disadvantageCap: null,
      quirkCap: null,
      experimentalActiveEffects: false,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });
    client.setQueryData(['campaigns'], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/characters/${CID}`]}>
          <Routes>
            <Route path="/characters/:id" element={<CharacterSheetPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Attributes' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Conditional effects' })).not.toBeInTheDocument();

    const conditionalMechanics: LibraryMechanics = {
      ...snapshot,
      effects: [
        {
          target: 'dx',
          value: 2,
          scaling: 'flat',
          conditionGroup: 'focused',
          conditionLabel: 'Focused',
        },
      ],
    };
    await getLocalDb().characterTraits.update(TRAIT, { libraryMechanics: conditionalMechanics });
    expect(screen.queryByRole('button', { name: 'Conditional effects' })).not.toBeInTheDocument();
    await getLocalDb().campaigns.update(CAMPAIGN, { experimentalActiveEffects: true });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Conditional effects' })).toBeVisible(),
    );
    const focused = screen.getByRole('checkbox', { name: 'Focused' });
    expect(focused).not.toBeChecked();
    fireEvent.click(focused);
    await waitFor(async () =>
      expect((await getLocalDb().characters.get(CID))?.activeConditionGroups).toEqual(['focused']),
    );
    await getLocalDb().campaigns.update(CAMPAIGN, { experimentalActiveEffects: false });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Conditional effects' })).not.toBeInTheDocument(),
    );
    expect((await getLocalDb().characters.get(CID))?.activeConditionGroups).toEqual(['focused']);
    const sheetOverview = screen.getByRole('button', { name: /^Sheet overview/ });
    fireEvent.click(sheetOverview);
    expect(sheetOverview).toHaveTextContent('ST 10 · DX 10');
    await getLocalDb().campaigns.update(CAMPAIGN, { experimentalActiveEffects: true });
    await waitFor(() => expect(sheetOverview).toHaveTextContent('ST 10 · DX 12'));
    fireEvent.click(sheetOverview);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Conditional effects' })).toBeVisible(),
    );
    const reenabledFocused = screen.getByRole('checkbox', { name: 'Focused' });
    expect(reenabledFocused).toBeChecked();
    fireEvent.click(reenabledFocused);
    await waitFor(async () =>
      expect((await getLocalDb().characters.get(CID))?.activeConditionGroups).toEqual([]),
    );
  });

  it('renders human labels for active and legacy dismissed warning codes', async () => {
    await seed();
    const db = getLocalDb();
    await db.characters.update(CID, {
      dismissedWarnings: ['legacy.some_old-warning'],
    });
    await db.campaigns.put({
      id: CAMPAIGN,
      ownerId: 'owner',
      viewerRole: 'owner',
      name: 'Local Campaign',
      description: null,
      pointTarget: 10,
      disadvantageCap: null,
      quirkCap: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], { id: 'owner', displayName: 'Owner' });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/characters/${CID}`]}>
          <Routes>
            <Route path="/characters/:id" element={<CharacterSheetPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Point target exceeded')).toBeInTheDocument());
    expect(screen.getByText('Legacy: Some old warning')).toBeInTheDocument();
    expect(screen.queryByText('points.over_target')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy.some_old-warning')).not.toBeInTheDocument();
  });

  it('validates synced declarations, preserves pending input, and retains definitions on HTTP failure', async () => {
    await seed();
    const db = getLocalDb();
    const row = await db.characterTraits.get(TRAIT);
    tokenStore.write({
      accessToken: `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`,
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    await enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: TRAIT,
      fieldPath: 'name',
      attemptedValue: 'My edited name',
    });
    const updated = {
      ...snapshot,
      sourceRevision: 9,
      effects: [{ target: 'dx' as const, value: 4, scaling: 'flat' as const }],
    };
    const response = (mechanics: unknown) =>
      new Response(
        JSON.stringify({
          changes: [
            {
              entityClass: 'character_trait',
              entityId: TRAIT,
              command: 'patch',
              revision: 2,
              data: { ...row, name: 'Stale server name', revision: 2, libraryMechanics: mechanics },
            },
          ],
          nextCursor: { character_trait: 2 },
          hasMore: {},
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(response(updated))),
    );
    await getSyncOrchestrator().triggerCursorPull(true);
    expect((await db.characterTraits.get(TRAIT))?.name).toBe('My edited name');
    expect((await db.characterTraits.get(TRAIT))?.libraryMechanics).toEqual(updated);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    await expect(getSyncOrchestrator().triggerCursorPull(true)).rejects.toThrow();
    expect((await db.characterTraits.get(TRAIT))?.libraryMechanics).toEqual(updated);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(response({ ...updated, effects: [{ target: 'invalid' }] })),
        ),
    );
    await expect(getSyncOrchestrator().triggerCursorPull(true)).rejects.toThrow();
    expect((await db.characterTraits.get(TRAIT))?.libraryMechanics).toEqual(updated);
  });

  it('preserves player and GM derivations and dispatched defenses through an offline DB close/reopen', async () => {
    await seed();
    const first = renderHook(() => useCharacterDetail(CID));
    await waitFor(() => expect(first.result.current?.libraryEffectsKnown).toBe(true));
    const online = first.result.current;
    first.unmount();
    const db = getLocalDb();
    db.close();
    await db.open();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const player = renderHook(() => useCharacterDetail(CID));
    const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
    await waitFor(() => expect(player.result.current?.libraryEffectsKnown).toBe(true));
    await waitFor(() => expect(gm.result.current?.[0]?.libraryEffectsKnown).toBe(true));
    expect(player.result.current).toEqual(online);
    expect(gm.result.current?.[0]).toEqual(online);
    expect(online?.derived.effectiveDx).toBe(12);
    expect(online?.skills[0]?.effectiveLevel).toBe(13);
    if (!player.result.current) throw new Error('Missing character');
    const openRoll = vi.fn();
    render(<DefensesCard character={player.result.current} openRoll={openRoll} />);
    fireEvent.click(screen.getByRole('button', { name: /^Dodge/ }));
    expect(openRoll.mock.calls[0]?.[0].baseTarget).toBe(9);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'deleted', 'different-source', 'different-campaign'])(
    'shows %s mechanics as unavailable on both readers and the GM card',
    async (mode) => {
      await seed();
      const value =
        mode === 'legacy'
          ? null
          : {
              ...snapshot,
              ...(mode === 'deleted' ? { sourceRevision: null, effects: null } : {}),
              ...(mode === 'different-source' ? { sourceId: SKILL } : {}),
              ...(mode === 'different-campaign' ? { campaignId: SKILL } : {}),
            };
      await getLocalDb().characterTraits.update(TRAIT, { libraryMechanics: value });
      const player = renderHook(() => useCharacterDetail(CID));
      const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
      await waitFor(() => expect(player.result.current?.libraryEffectsKnown).toBe(false));
      await waitFor(() => expect(gm.result.current?.[0]?.libraryEffectsKnown).toBe(false));
      const character = gm.result.current?.[0];
      if (!character) throw new Error('Missing character');
      render(
        <MemoryRouter>
          <GmCharacterCard character={character} lookup="Sword" />
        </MemoryRouter>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Linked rules are unavailable');
      expect(screen.queryByText('Dodge')).not.toBeInTheDocument();
      expect(screen.queryByText('Sword')).not.toBeInTheDocument();
    },
  );

  it('recognizes known empty effects and updates both views when a subsequent synced revision arrives', async () => {
    await seed({ ...snapshot, effects: [] });
    const player = renderHook(() => useCharacterDetail(CID));
    const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
    await waitFor(() => expect(player.result.current?.libraryEffectsKnown).toBe(true));
    expect(player.result.current?.derived.effectiveDx).toBe(10);
    await act(async () => {
      await getLocalDb().characterTraits.update(TRAIT, {
        libraryMechanics: { ...snapshot, sourceRevision: 5 },
      });
    });
    await waitFor(() => expect(player.result.current?.derived.effectiveDx).toBe(12));
    await waitFor(() => expect(gm.result.current?.[0]?.derived.effectiveDx).toBe(12));
  });

  it('purges definitions with their character rows before another account uses the DB', async () => {
    await seed();
    await getSyncOrchestrator().purge();
    expect(await getLocalDb().characterTraits.count()).toBe(0);
    expect(await getLocalDb().characterSkills.count()).toBe(0);
    const player = renderHook(() => useCharacterDetail(CID));
    await waitFor(() => expect(player.result.current).toBeNull());
  });
});

it('loads campaign house rules from Dexie, preserves them offline, and reacts to synced changes', async () => {
  await seed();
  const db = getLocalDb();
  const player = renderHook(() => useCharacterDetail(CID));
  await waitFor(() => expect(player.result.current?.houseRulesKnown).toBe(false));
  await db.campaigns.put({
    id: CAMPAIGN,
    ownerId: 'owner',
    name: 'Campaign',
    pointTarget: null,
    disadvantageCap: null,
    quirkCap: null,
    houseRules: { protectNaturalDr: false },
    revision: 10,
  } as never);
  await waitFor(() => expect(player.result.current?.houseRulesKnown).toBe(true));
  expect(player.result.current?.houseRules.protectNaturalDr).toBe(false);
  player.unmount();
  db.close();
  await db.open();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
  const offline = renderHook(() => useCharacterDetail(CID));
  const gm = renderHook(() => useCampaignCharacterDetails(CAMPAIGN));
  await waitFor(() => expect(offline.result.current?.houseRules.protectNaturalDr).toBe(false));
  await waitFor(() => expect(gm.result.current?.[0]?.houseRules.protectNaturalDr).toBe(false));
  await db.campaigns.update(CAMPAIGN, {
    houseRules: campaignHouseRules.parse({ protectNaturalDr: true }),
    revision: 11,
  });
  await waitFor(() => expect(offline.result.current?.houseRules.protectNaturalDr).toBe(true));
  expect(fetch).not.toHaveBeenCalled();
});
