import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { readDrainableOps } from '../sync/outbox.ts';
import { syncStateStore } from '../sync/state.ts';
import { appendSyncLog, redactSyncLogForCharacters } from '../sync/syncLog.ts';
import { SyncLogView } from './SyncLogView.tsx';

const clearLocalAndFullResync = vi.fn();
const revertFailedOperation = vi.fn();

vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ clearLocalAndFullResync, revertFailedOperation }),
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
    const title = await screen.findByText('Appearance');
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
    const title = await screen.findByText('Appearance');
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
    expect(detail.getByText('quantity')).toBeInTheDocument();
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

    const title = await screen.findByText('ST base');
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
