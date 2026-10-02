import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNCED_ENTITY_CLASSES, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { syncEntityTable } from '../db/syncEntityStore.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { readDrainableOps } from '../sync/outbox.ts';
import { syncStateStore } from '../sync/state.ts';
import {
  appendSyncLog,
  lastChangesSyncKey,
  lastSuccessfulSyncKey,
  redactSyncLogForCharacters,
} from '../sync/syncLog.ts';
import { SyncLogView } from './SyncLogView.tsx';

const wsStatus = vi.hoisted(() => ({ state: 'connected', lastConnectedAt: null as string | null }));
vi.mock('../sync/useSyncWsStatus.ts', () => ({ useSyncWsStatus: () => wsStatus }));

const clearLocalAndFullResync = vi.fn();
const revertFailedOperation = vi.fn();
const syncNow = vi.fn();

vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ clearLocalAndFullResync, revertFailedOperation, syncNow }),
}));

beforeEach(() => {
  // Happy DOM 15 activates every ancestor <details> when a nested summary
  // bubbles. Match browser activation: only that summary's own details toggles.
  const dispatch = HTMLDetailsElement.prototype.dispatchEvent;
  vi.spyOn(HTMLDetailsElement.prototype, 'dispatchEvent').mockImplementation(function (
    this: HTMLDetailsElement,
    event: Event,
  ) {
    if (
      event.type === 'click' &&
      event.target instanceof HTMLElement &&
      event.target.tagName === 'SUMMARY' &&
      event.target.parentElement !== this
    )
      return HTMLElement.prototype.dispatchEvent.call(this, event);
    return dispatch.call(this, event);
  });
});

function renderView() {
  return render(
    <ToastProvider>
      <SyncLogView open onClose={() => {}} online />
    </ToastProvider>,
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  syncNow.mockReset();
  wsStatus.state = 'connected';
  wsStatus.lastConnectedAt = null;
  syncStateStore.reset('synced');
  await resetLocalDb();
});

it.each(['Original campaign', 'Destination campaign'])(
  'retains an ambiguous legacy addition until the user selects %s',
  async (choice) => {
    const db = getLocalDb();
    const common = {
      validationVersion: 1,
      status: 'pending',
      attemptCount: 0,
      enqueuedAt: '2026-09-10T00:00:01Z',
    } as const;
    await db.outbox.bulkPut([
      {
        ...common,
        clientOpId: 'assignment',
        coalesceKey: 'character|campaignId',
        entityClass: 'character',
        entityId: 'character',
        command: 'patch',
        fieldPath: 'campaignId',
        prevValue: 'A',
        attemptedValue: 'B',
      },
      {
        ...common,
        clientOpId: 'create',
        coalesceKey: 'trait|create',
        entityClass: 'character_trait',
        entityId: 'trait',
        parentId: 'character',
        command: 'create',
        attemptedValue: { name: 'Unsaved', libraryTraitId: 'source' },
        localCampaignDependencyUnknown: true,
      },
    ]);
    await db.characterTraits.put({ id: 'trait', name: 'Unsaved', revision: -1 } as never);
    renderView();
    expect(
      await screen.findByRole('region', { name: 'Confirm campaign order' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/older unsaved library addition needs its campaign order confirmed/),
    ).toBeInTheDocument();
    expect(await readDrainableOps(50)).toEqual([]);
    await userEvent.setup().click(screen.getByRole('button', { name: choice }));
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Confirm campaign order' }),
      ).not.toBeInTheDocument(),
    );
    expect((await db.characterTraits.get('trait'))?.name).toBe('Unsaved');
    expect((await db.outbox.get('create'))?.attemptedValue).toEqual({
      name: 'Unsaved',
      libraryTraitId: 'source',
    });
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual([
      choice === 'Original campaign' ? 'create' : 'assignment',
    ]);
  },
);

describe('SyncLogView download debug log', () => {
  it('downloads a well-formed JSON dump when clicked', async () => {
    let capturedBlob: Blob | null = null;
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:mock-url';
      });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Download sync debug log' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as unknown as Blob).text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toHaveProperty('meta');
    expect(parsed).toHaveProperty('outbox');
    expect(parsed).toHaveProperty('rejectionToasts');
    expect(parsed).toHaveProperty('syncLog');
    expect(parsed).toHaveProperty('syncCursors');
  });

  it('shows an error toast if building the dump fails', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Download sync debug log' }));

    expect(await screen.findByText(/Couldn't build debug log/)).toBeInTheDocument();
  });
});

it('shows an explicit recovery control for a held unsaved library addition', async () => {
  const db = getLocalDb();
  const campaignId = '0193b3c0-f1f0-7000-8000-00000000f101';
  await db.outbox.put({
    clientOpId: 'held-library-create',
    entityClass: 'campaign_library_trait',
    entityId: '0193b3c0-f1f0-7000-8000-00000000f102',
    parentId: campaignId,
    command: 'create',
    coalesceKey: 'held-library-create|',
    attemptedValue: { name: 'Retained definition' },
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: '2026-09-30T00:00:00.000Z',
    attemptCount: 0,
    localSourceMigrationUnknown: true,
    localSourceMigrationIntent: { attemptedValue: { sourceKey: 'old-book' }, prevValue: null },
    serverReason: 'Choose a sourcebook for the retained edit.',
  });
  revertFailedOperation.mockResolvedValue({
    clientOpId: 'held-library-create',
    entityClass: 'campaign_library_trait',
    entityId: '0193b3c0-f1f0-7000-8000-00000000f102',
    parentId: campaignId,
    command: 'create',
    coalesceKey: 'held-library-create|',
    attemptedValue: { name: 'Retained definition' },
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: '2026-09-30T00:00:00.000Z',
    attemptCount: 0,
  });
  const user = userEvent.setup();
  renderView();

  expect(
    await screen.findByRole('region', { name: 'Choose sourcebooks for retained edits' }),
  ).toHaveTextContent('Choose a sourcebook for an older edit');
  await user.click(screen.getByRole('button', { name: 'Revert older edit' }));
  expect(await screen.findByRole('heading', { name: 'Revert this local change?' })).toBeVisible();
  expect(
    screen.getByText(
      'The unsaved addition and its later queued edits will be removed from this device.',
    ),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Revert change' }));
  await waitFor(() => expect(revertFailedOperation).toHaveBeenCalledWith('held-library-create'));
});

describe('SyncLogView event details', () => {
  it('loads a compressed change only when opened and formats raw payloads only when requested', async () => {
    const db = getLocalDb();
    await db.characters.put({ id: 'hero', ownerId: 'me', name: 'Hero', revision: 42 } as never);
    const after = 'New appearance notes. '.repeat(70).trim();
    await appendSyncLog({
      id: 'compressed-change',
      direction: 'push',
      result: 'synced',
      entityClass: 'character',
      entityId: 'hero',
      command: 'patch',
      fieldPath: 'appearance',
      humanName: 'Appearance',
      previousValue: 'Old appearance notes. '.repeat(70),
      newValue: after,
      details: { status: 'applied', newRevision: 42 },
      occurredAt: '2026-09-29T00:00:00Z',
    });
    await appendSyncLog({
      id: 'cursor-response',
      direction: 'pull',
      result: 'synced',
      entityClass: 'character',
      entityId: 'hero',
      command: 'patch',
      details: { revision: 42, appliedFields: [] },
      occurredAt: '2026-09-29T00:00:01Z',
    });
    const getBody = vi.spyOn(db.syncLogBodies, 'get');
    const user = userEvent.setup();
    renderView();
    const title = await screen.findByRole('link', { name: 'Character: Hero · Description' });
    expect(getBody).not.toHaveBeenCalled();
    expect(screen.queryByText('character patch')).not.toBeInTheDocument();
    expect(screen.queryByText(after)).not.toBeInTheDocument();
    await user.click(title.closest('summary') as HTMLElement);
    expect(await screen.findByText(after)).toBeInTheDocument();
    expect(getBody).toHaveBeenCalledOnce();
    const change = title.closest('details') as HTMLDetailsElement;
    expect(change.querySelector('pre')).toBeNull();
    await user.click(within(change).getByText('Request'));
    await waitFor(() => expect(change.querySelector('pre')?.textContent).toContain(after));
    await user.click(within(change).getByText('Response'));
    await waitFor(() => expect(change.textContent).toContain('"revision": 42'));
    await redactSyncLogForCharacters(['hero']);
    expect(
      await screen.findByText('removed — you no longer have access to this character'),
    ).toBeInTheDocument();
    expect(screen.queryByText(after)).not.toBeInTheDocument();
    expect(screen.queryByText('Request')).not.toBeInTheDocument();
  });

  it('explains a missing compressed body when the change is opened', async () => {
    const db = getLocalDb();
    await db.characters.put({ id: 'hero', ownerId: 'me', name: 'Hero', revision: 42 } as never);
    await appendSyncLog({
      id: 'missing-body',
      fieldPath: 'appearance',
      direction: 'push',
      result: 'synced',
      entityClass: 'character',
      entityId: 'hero',
      command: 'patch',
      humanName: 'Appearance',
      newValue: 'Long appearance. '.repeat(90),
    });
    await db.syncLogBodies.delete('missing-body');
    renderView();
    const title = await screen.findByRole('link', { name: 'Character: Hero · Description' });
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    expect(
      await screen.findByText(
        /Couldn't load change details — Recorded sync details are no longer available/,
      ),
    ).toBeInTheDocument();
  });

  it('combines a change and its revision acknowledgement with folded Request and Response', async () => {
    const db = getLocalDb();
    await db.syncLog.bulkPut([
      {
        id: 'change',
        direction: 'push',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        command: 'patch',
        fieldPath: 'quantity',
        humanName: 'Torch quantity',
        previousValue: 2,
        newValue: 5,
        details: { clientOpId: 'quantity-op', status: 'applied', newRevision: 42 },
        occurredAt: '2026-09-28T00:00:00Z',
      },
      {
        id: 'acknowledgement',
        direction: 'pull',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        command: 'patch',
        details: { revision: 42, appliedFields: [] },
        occurredAt: '2026-09-28T00:00:01Z',
      },
    ]);

    renderView();
    const user = userEvent.setup();
    const title = await screen.findByText('Torch quantity');
    const change = title.closest('details') as HTMLDetailsElement;
    expect(screen.queryByText('character inventory patch')).not.toBeInTheDocument();
    expect(change.open).toBe(false);
    await user.click(title.closest('summary') as HTMLElement);
    const request = within(change).getByText('Request').closest('details') as HTMLDetailsElement;
    const response = within(change).getByText('Response').closest('details') as HTMLDetailsElement;
    expect(request.open).toBe(false);
    expect(response.open).toBe(false);
    expect(screen.queryByText('Raw')).not.toBeInTheDocument();
    await user.click(within(request).getByText('Request'));
    expect(request.open).toBe(true);
    await waitFor(() =>
      expect(request.querySelector('pre')?.textContent).toContain('"attemptedValue": 5'),
    );
    expect(request.querySelector('pre')?.textContent).not.toContain('newRevision');
    await user.click(within(response).getByText('Response'));
    expect(response.open).toBe(true);
    await waitFor(() =>
      expect(response.querySelector('pre')?.textContent).toContain('"status": "applied"'),
    );
    expect(response.querySelector('pre')?.textContent).toContain('"newRevision": 42');
    expect(response.querySelector('pre')?.textContent).toContain('"revision": 42');
    expect(within(change).getByText('2')).toBeInTheDocument();
    expect(within(change).getByText('5')).toBeInTheDocument();
    // Grouping affects the view only; the debug journal keeps both records.
    expect(await db.syncLog.count()).toBe(2);
  });

  it.each([
    { entityId: 'another-torch', details: { revision: 42, appliedFields: [] } },
    { entityClass: 'character_skill' as const, details: { revision: 42, appliedFields: [] } },
    { details: { revision: 43, appliedFields: [] } },
    { details: { revision: 42 } },
    { details: { revision: 42, appliedFields: ['notes'] }, previousValue: 'old', newValue: 'new' },
    { occurredAt: '2026-09-27T00:00:00Z', details: { revision: 42, appliedFields: [] } },
  ])('keeps unrelated or data-changing downloads as separate items: %j', async (overrides) => {
    await getLocalDb().syncLog.bulkPut([
      {
        id: 'change',
        direction: 'push',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        command: 'patch',
        humanName: 'Torch quantity',
        details: { status: 'applied', newRevision: 42 },
        occurredAt: '2026-09-28T00:00:00Z',
      },
      {
        id: 'download',
        direction: 'pull',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        command: 'patch',
        humanName: 'Separate download',
        occurredAt: '2026-09-28T00:00:01Z',
        ...overrides,
      },
    ]);
    renderView();
    expect(await screen.findByText('Torch quantity')).toBeInTheDocument();
    expect(await screen.findByText('Separate download')).toBeInTheDocument();
  });

  it('hides Request and Response payloads when access to the character is lost', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: 'masked-character',
      ownerId: 'someone-else',
      name: 'Masked',
      minimalViewMasked: true,
      revision: 42,
    } as never);
    await db.syncLog.bulkPut([
      {
        id: 'private-change',
        direction: 'push',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        parentId: 'masked-character',
        command: 'patch',
        humanName: 'Private torch',
        previousValue: 'private-before',
        newValue: 'private-after',
        details: { status: 'applied', newRevision: 42 },
        occurredAt: '2026-09-28T00:00:00Z',
      },
      {
        id: 'private-response',
        direction: 'pull',
        result: 'synced',
        entityClass: 'character_inventory',
        entityId: 'torch',
        parentId: 'masked-character',
        command: 'patch',
        details: { revision: 42, appliedFields: [], secret: 'private-response' },
        occurredAt: '2026-09-28T00:00:01Z',
      },
    ]);
    renderView();
    const title = await screen.findByText('character inventory patch');
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    expect(
      screen.getByText('removed — you no longer have access to this character'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Response')).not.toBeInTheDocument();
    expect(screen.queryByText(/private-/)).not.toBeInTheDocument();
    expect(screen.queryByText('Private torch')).not.toBeInTheDocument();
  });

  it('folds each synced event over its before/after values, collapsed by default', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-1',
      direction: 'push',
      result: 'synced',
      entityClass: 'character_inventory',
      entityId: 'inv-1',
      command: 'patch',
      fieldPath: 'quantity',
      humanName: 'Torch quantity',
      previousValue: 2,
      newValue: 5,
      occurredAt: new Date().toISOString(),
    });

    renderView();

    const title = await screen.findByText('Torch quantity');
    const disclosure = title.closest('details') as HTMLDetailsElement;
    expect(disclosure).not.toBeNull();
    // Collapsed rows don't mount their payloads until requested.
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')).toContainElement(title);

    const detail = within(disclosure);
    expect(detail.queryByText('Before')).not.toBeInTheDocument();
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    expect(detail.getByText('Before')).toBeInTheDocument();
    expect(detail.getByText('2')).toBeInTheDocument();
    expect(detail.getByText('After')).toBeInTheDocument();
    expect(detail.getByText('5')).toBeInTheDocument();
    expect(detail.getByText('Quantity')).toBeInTheDocument();
  });

  it('says when a pulled row changed no local data fields', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-2',
      direction: 'pull',
      result: 'synced',
      entityClass: 'character_combat',
      entityId: 'combat-1',
      command: 'patch',
      details: { revision: 42, appliedFields: [] },
      occurredAt: new Date().toISOString(),
    });

    renderView();

    const title = await screen.findByText('character combat patch');
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(detail.getByText('no data fields changed locally')).toBeInTheDocument();
  });

  it('identifies legacy pulled rows whose values cannot be reconstructed', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-legacy-pull',
      direction: 'pull',
      result: 'synced',
      entityClass: 'character_skill',
      entityId: 'skill-legacy',
      command: 'patch',
      details: { revision: 17 },
      occurredAt: new Date().toISOString(),
    });

    renderView();

    const title = await screen.findByText('character skill patch');
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(
      detail.getByText('not recorded by the app version that downloaded this change'),
    ).toBeInTheDocument();
  });

  it('names campaign access loss on a redacted campaign snapshot', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-campaign-redacted',
      direction: 'pull',
      result: 'synced',
      entityClass: 'campaign',
      entityId: 'campaign-1',
      command: 'patch',
      redacted: true,
      occurredAt: new Date().toISOString(),
    });

    renderView();

    const title = await screen.findByText('campaign patch');
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(
      detail.getByText('removed — you no longer have access to this campaign'),
    ).toBeInTheDocument();
  });

  it('hides queued values for a character the viewer can no longer see', async () => {
    // The outbox is deliberately not swept on downgrade -- the op still
    // has to be delivered -- so this view has to apply the gate itself.
    const db = getLocalDb();
    await db.characters.put({
      id: 'char-masked',
      ownerId: 'someone-else',
      campaignId: 'camp-1',
      name: 'Masked',
      minimalViewMasked: true,
      revision: 3,
    } as never);
    await db.outbox.put({
      clientOpId: 'op-masked',
      entityClass: 'character_inventory',
      entityId: 'inv-1',
      parentId: 'char-masked',
      command: 'patch',
      coalesceKey: 'inv-1|notes',
      fieldPath: 'notes',
      attemptedValue: 'private-after',
      prevValue: 'private-before',
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 0,
      humanName: 'Masked item notes',
    } as never);

    renderView();

    // The title falls back to the generic class label: `humanName` is
    // private content too on a child op (`item "..."`), and it is the
    // visible row title.
    const title = await screen.findByText('character inventory patch');
    expect(screen.queryByText('Masked item notes')).toBeNull();
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(
      detail.getByText('hidden — you no longer have access to this character'),
    ).toBeInTheDocument();
    expect(screen.queryByText('private-before')).toBeNull();
    expect(screen.queryByText('private-after')).toBeNull();
  });

  it('still shows queued values for a character the viewer owns', async () => {
    const db = getLocalDb();
    await db.characters.put({
      id: 'char-mine',
      ownerId: 'me',
      campaignId: null,
      name: 'Mine',
      revision: 1,
    } as never);
    await db.outbox.put({
      clientOpId: 'op-mine',
      entityClass: 'character',
      entityId: 'char-mine',
      command: 'patch',
      coalesceKey: 'char-mine|st',
      fieldPath: 'st',
      attemptedValue: 14,
      prevValue: 10,
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 0,
      humanName: 'ST base',
    } as never);

    renderView();

    const title = await screen.findByRole('link', { name: 'Character: Mine · ST' });
    await userEvent.setup().click(title.closest('summary') as HTMLElement);
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(detail.getByText('Before')).toBeInTheDocument();
    expect(detail.getByText('10')).toBeInTheDocument();
    expect(detail.getByText('14')).toBeInTheDocument();
  });

  it('labels a local cycle failure as a sync failure, not a download', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-local',
      direction: 'local',
      result: 'failed',
      reason: 'Signed out — sign in again to resume syncing',
      occurredAt: new Date().toISOString(),
    });

    renderView();

    expect(await screen.findByText(/Sync failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Download failed/)).toBeNull();
  });

  it('explains a failed cycle instead of showing a healthy log', async () => {
    syncStateStore.reset('synced');
    syncStateStore.setError('Downloading server changes failed (HTTP 530)');
    await getLocalDb().syncLog.put({
      id: 'log-3',
      direction: 'pull',
      result: 'failed',
      reason: 'Downloading server changes failed (HTTP 530)',
      occurredAt: new Date().toISOString(),
    });

    renderView();

    // The banner answers "why is the badge red?" without a toast.
    expect(await screen.findByText("Sync isn't currently working")).toBeInTheDocument();
    // findBy, not getBy: the journal rows arrive from a Dexie liveQuery.
    expect(await screen.findByText(/Download failed/)).toBeInTheDocument();
    expect(screen.getAllByText(/HTTP 530/).length).toBeGreaterThan(0);
  });
});

it.each(SYNCED_ENTITY_CLASSES)(
  'shows focused values, entity destination and upload diagnostics for %s',
  async (entityClass) => {
    const db = getLocalDb();
    await db.characters.put({ id: 'parent', ownerId: 'me', name: 'Parent', revision: 1 } as never);
    await db.campaigns.put({ id: 'campaign', name: 'Lantern Coast', revision: 1 } as never);
    const id = entityClass === 'character_combat' ? 'parent' : 'entity';
    const row = {
      id,
      characterId: 'parent',
      campaignId: 'campaign',
      name: 'Visible entity',
      revision: 42,
    };
    await syncEntityTable(entityClass)?.put(row);
    await appendSyncLog({
      id: 'visible-event',
      entityClass,
      entityId: id,
      parentId: entityClass.startsWith('campaign_library_')
        ? 'campaign'
        : entityClass.startsWith('character_')
          ? 'parent'
          : undefined,
      entityName: 'Visible entity',
      direction: 'push',
      result: 'synced',
      command: 'patch',
      previousValue: { points: 1, name: 'Unchanged name' },
      newValue: { points: 2, name: 'Unchanged name' },
      request: {
        method: 'POST',
        path: '/api/v1/sync/operations',
        operation: { attemptedValue: { points: 2, name: 'Unchanged name' }, baseRevision: 41 },
      },
      details: { status: 'applied', newRevision: 42 },
    });
    renderView();
    const link = await screen.findByRole('link', { name: /Visible entity/ });
    expect(link.getAttribute('href')).toMatch(
      entityClass.startsWith('campaign') ? /^\/campaigns\// : /^\/characters\//,
    );
    const change = link.closest('details') as HTMLDetailsElement;
    await userEvent.setup().click(change.querySelector('summary') as HTMLElement);
    const detail = within(change);
    expect(detail.getByText('Before')).toBeVisible();
    expect(detail.getByText('After')).toBeVisible();
    expect(detail.getByText('Points')).toBeVisible();
    expect(detail.getByText('Pushed', { exact: false })).toBeVisible();
    expect(detail.queryByText(/Unchanged name/)).not.toBeInTheDocument();
    await userEvent.setup().click(detail.getByText('Request', { exact: true }));
    await waitFor(() => expect(change.textContent).toContain('"baseRevision": 41'));
    expect(change.textContent).toContain('Unchanged name');
    await userEvent.setup().click(detail.getByText('Response', { exact: true }));
    await waitFor(() => expect(change.textContent).toContain('"status": "applied"'));
  },
);

it('keeps a settings upload as Pushed when its cursor refresh changes fields or arrives first', async () => {
  const db = getLocalDb();
  await db.campaigns.put({ id: 'campaign', name: 'Lantern Coast', revision: 42 } as never);
  await db.syncLog.bulkPut([
    {
      id: 'save',
      direction: 'push',
      result: 'synced',
      entityClass: 'campaign',
      entityId: 'campaign',
      command: 'patch',
      source: 'Campaign settings',
      humanName: 'campaign rules updated',
      entityName: 'Lantern Coast',
      previousValue: { skillPrerequisitePolicy: 'block' },
      newValue: { skillPrerequisitePolicy: 'warn' },
      request: { method: 'PATCH', body: { skillPrerequisitePolicy: 'warn' } },
      details: { newRevision: 42 },
      occurredAt: '2026-09-29T12:00:01Z',
    },
    {
      id: 'refresh',
      direction: 'pull',
      result: 'synced',
      entityClass: 'campaign',
      entityId: 'campaign',
      command: 'patch',
      previousValue: { skillPrerequisitePolicy: 'block', activeEffectDefinitions: [] },
      newValue: {
        skillPrerequisitePolicy: 'warn',
        activeEffectDefinitions: [{ name: 'Test Ward' }],
      },
      details: {
        revision: 42,
        appliedFields: ['skillPrerequisitePolicy', 'activeEffectDefinitions'],
      },
      occurredAt: '2026-09-29T12:00:00Z',
    },
  ]);
  renderView();
  const link = await screen.findByRole('link', { name: /Lantern Coast/ });
  expect(screen.getAllByText(/Pushed/)).toHaveLength(1);
  expect(screen.queryByText(/Pulled/)).not.toBeInTheDocument();
  const change = link.closest('details') as HTMLDetailsElement;
  await userEvent.setup().click(change.querySelector('summary') as HTMLElement);
  expect(within(change).getByText('Before')).toBeVisible();
  expect(within(change).getByText(/Active effect definitions.*details in Response/)).toBeVisible();
  await userEvent.setup().click(within(change).getByText('Response', { exact: true }));
  await waitFor(() => expect(change.textContent).toContain('Test Ward'));
  expect(change.textContent).toContain('"previousValue"');
});

it('shows standalone downloads without a Request and deleted subjects without a link', async () => {
  await getLocalDb().syncLog.put({
    id: 'deleted',
    entityClass: 'campaign_library_spell',
    entityId: 'missing',
    parentId: 'campaign',
    entityName: 'Sample Storm Spell',
    direction: 'pull',
    result: 'synced',
    command: 'delete',
    previousValue: { name: 'Sample Storm Spell' },
    details: { revision: 42, appliedFields: ['name'] },
    occurredAt: new Date().toISOString(),
  });
  renderView();
  const title = await screen.findByText('Library spell: Sample Storm Spell · Deleted');
  expect(title.closest('a')).toBeNull();
  const change = title.closest('details') as HTMLDetailsElement;
  await userEvent.setup().click(change.querySelector('summary') as HTMLElement);
  expect(within(change).queryByText('Request')).not.toBeInTheDocument();
  expect(within(change).getByText('Removed', { exact: true })).toBeVisible();
  expect(within(change).getByText('Response')).toBeVisible();
});

it('shows independent WebSocket status and the last successful changed operation as relative times', async () => {
  const now = Date.now();
  wsStatus.state = 'reconnecting';
  wsStatus.lastConnectedAt = new Date(now - 10 * 60_000).toISOString();
  const checkAt = new Date(now - 60_000).toISOString();
  await getLocalDb().syncMeta.put({ key: lastSuccessfulSyncKey(), value: checkAt });
  await appendSyncLog({
    id: 'success',
    direction: 'push',
    result: 'synced',
    entityClass: 'campaign',
    entityId: 'campaign',
    command: 'patch',
    occurredAt: new Date(now - 2 * 60_000).toISOString(),
  });
  await appendSyncLog({
    id: 'poll',
    direction: 'pull',
    result: 'synced',
    entityClass: 'campaign',
    entityId: 'campaign',
    details: { revision: 42, appliedFields: [] },
    occurredAt: new Date(now).toISOString(),
  });
  renderView();
  const connection = await screen.findByRole('region', { name: 'Connection status' });
  expect(within(connection).getByText('WebSocket')).toBeVisible();
  expect(within(connection).getByText('Disconnected · Reconnecting')).toBeVisible();
  expect(within(connection).getByText('10 minutes ago')).toBeVisible();
  const lastSync = within(connection).getByText('Last sync').parentElement;
  const lastChanges = within(connection).getByText('Last changes').parentElement;
  if (!lastSync || !lastChanges) throw new Error('Expected both timestamp summaries');
  expect(await within(lastSync).findByText('1 minute ago')).toHaveAttribute('datetime', checkAt);
  expect(await within(lastChanges).findByText('2 minutes ago')).toBeVisible();
  expect(await within(connection).findByText('2 minutes ago')).toBeVisible();
  expect(
    within(connection).getByText('HTTP sync continues while WebSocket reconnects.'),
  ).toBeVisible();
  expect(screen.queryByText("Sync isn't currently working")).not.toBeInTheDocument();
});

it('shows unknown connection and sync times without fabricating timestamps', async () => {
  wsStatus.state = 'connecting';
  renderView();
  const connection = await screen.findByRole('region', { name: 'Connection status' });
  expect(within(connection).getByText('Connecting')).toBeVisible();
  expect(within(connection).getByText('Not yet connected')).toBeVisible();
  expect(within(connection).getByText('No successful sync recorded')).toBeVisible();
  expect(within(connection).getByText('No changes recorded')).toBeVisible();
});

it('runs a requested sync and shows its successful empty-check time', async () => {
  syncNow.mockImplementation(async () => {
    await getLocalDb().syncMeta.put({
      key: lastSuccessfulSyncKey(),
      value: new Date().toISOString(),
    });
  });
  renderView();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sync now' }));
  expect(syncNow).toHaveBeenCalledOnce();
  const connection = await screen.findByRole('region', { name: 'Connection status' });
  expect(await within(connection).findByText('just now')).toBeVisible();
  expect(within(connection).getByText('No changes recorded')).toBeVisible();
  expect(await screen.findByText('Sync completed')).toBeVisible();
});

it('reports a failed requested sync without changing the last-sync time', async () => {
  syncNow.mockRejectedValue(new Error('server unavailable'));
  renderView();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sync now' }));
  expect(await screen.findByText("Couldn't sync — server unavailable")).toBeVisible();
  const connection = screen.getByRole('region', { name: 'Connection status' });
  expect(within(connection).getByText('No successful sync recorded')).toBeVisible();
});

it('keeps separate sync and change times after the journal is pruned', async () => {
  const now = Date.now();
  const changeAt = new Date(now - 5 * 60_000).toISOString();
  await appendSyncLog({ direction: 'push', result: 'synced', occurredAt: changeAt });
  await getLocalDb().syncLog.clear();
  await getLocalDb().syncMeta.put({
    key: lastSuccessfulSyncKey(),
    value: new Date(now - 60_000).toISOString(),
  });
  expect((await getLocalDb().syncMeta.get(lastChangesSyncKey()))?.value).toBe(changeAt);
  renderView();
  const connection = await screen.findByRole('region', { name: 'Connection status' });
  expect(await within(connection).findByText('1 minute ago')).toBeVisible();
  expect(await within(connection).findByText('5 minutes ago')).toHaveAttribute(
    'datetime',
    changeAt,
  );
});

it('does not treat a legacy empty-check timestamp as the last data change', async () => {
  await getLocalDb().syncMeta.put({
    key: lastSuccessfulSyncKey(),
    value: new Date().toISOString(),
  });
  renderView();
  const connection = await screen.findByRole('region', { name: 'Connection status' });
  expect(await within(connection).findByText('just now')).toBeVisible();
  expect(within(connection).getByText('No changes recorded')).toBeVisible();
});

it('shows one net HP change for a continuous burst while retaining each compressed request and response', async () => {
  for (const [id, before, after, second] of [
    ['first', 10, 9, 0],
    ['second', 9, 8, 1],
  ] as const) {
    await appendSyncLog({
      id,
      batchId: 'hp-burst',
      direction: 'push',
      result: 'synced',
      entityClass: 'character_combat',
      entityId: 'combat',
      fieldPath: 'currentHp',
      command: 'patch',
      humanName: 'HP',
      previousValue: before,
      newValue: after,
      occurredAt: `2026-09-29T12:00:0${second}Z`,
      request: {
        clientOpId: id,
        attemptedValue: after,
        diagnostic: 'bounded request '.repeat(150),
      },
      details: { newRevision: 40 + second },
    });
  }
  renderView();
  const title = await screen.findByText('HP', { exact: true });
  expect(screen.getAllByText('HP', { exact: true })).toHaveLength(1);
  const change = title.closest('details') as HTMLDetailsElement;
  await userEvent.setup().click(change.querySelector('summary') as HTMLElement);
  expect(await within(change).findByText('2 rapid adjustments · net change -2')).toBeVisible();
  expect(within(change).getByText('10', { exact: true })).toBeVisible();
  expect(within(change).getByText('8', { exact: true })).toBeVisible();
  await userEvent.setup().click(within(change).getByText('Request', { exact: true }));
  await waitFor(() => {
    expect(change.textContent).toContain('"clientOpId": "first"');
    expect(change.textContent).toContain('"clientOpId": "second"');
  });
  await userEvent.setup().click(within(change).getByText('Response', { exact: true }));
  await waitFor(() => {
    expect(change.textContent).toContain('"newRevision": 40');
    expect(change.textContent).toContain('"newRevision": 41');
  });
});

it.each(['different burst', 'discontinuous values', 'failed operation', 'remote change'])(
  'keeps %s separate from an HP burst',
  async (boundary) => {
    const base = {
      entityClass: 'character_combat' as const,
      entityId: 'combat',
      fieldPath: 'currentHp',
      command: 'patch' as const,
      humanName: 'HP',
      batchId: 'burst',
    };
    await getLocalDb().syncLog.bulkPut([
      {
        ...base,
        id: 'old',
        direction: 'push',
        result: 'synced',
        previousValue: 10,
        newValue: 9,
        occurredAt: '2026-09-29T12:00:00Z',
      },
      {
        ...base,
        id: 'new',
        direction: boundary === 'remote change' ? 'pull' : 'push',
        result: boundary === 'failed operation' ? 'failed' : 'synced',
        batchId: boundary === 'different burst' ? 'other' : 'burst',
        previousValue: boundary === 'discontinuous values' ? 7 : 9,
        newValue: 8,
        occurredAt: '2026-09-29T12:00:01Z',
      },
    ]);
    renderView();
    await waitFor(() => expect(screen.getAllByText('HP', { exact: true })).toHaveLength(2));
  },
);

it.each(['whole-row pull', 'whole-row failure', 'cycle failure'])(
  'does not fold HP uploads across an intervening %s',
  async (boundary) => {
    const base = {
      entityClass: 'character_combat' as const,
      entityId: 'combat',
      command: 'patch' as const,
      humanName: 'HP',
      fieldPath: 'currentHp',
      batchId: 'burst',
      direction: 'push' as const,
      result: 'synced' as const,
    };
    await getLocalDb().syncLog.bulkPut([
      { ...base, id: 'old', previousValue: 10, newValue: 9, occurredAt: '2026-09-29T12:00:00Z' },
      {
        id: 'boundary',
        direction: boundary === 'whole-row pull' ? 'pull' : 'local',
        result: boundary === 'whole-row pull' ? 'synced' : 'failed',
        ...(boundary !== 'cycle failure'
          ? { entityClass: 'character_combat' as const, entityId: 'combat' }
          : {}),
        reason: 'intervening event',
        occurredAt: '2026-09-29T12:00:01Z',
      },
      { ...base, id: 'new', previousValue: 9, newValue: 8, occurredAt: '2026-09-29T12:00:02Z' },
    ]);
    renderView();
    await waitFor(() => expect(screen.getAllByText('HP', { exact: true })).toHaveLength(2));
  },
);
