import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { syncStateStore } from '../sync/state.ts';
import { SyncLogView } from './SyncLogView.tsx';

const clearLocalAndFullResync = vi.fn();
const revertFailedOperation = vi.fn();

vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ clearLocalAndFullResync, revertFailedOperation }),
}));

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
    // Collapsed by default: the history stays scannable. (jsdom renders
    // a closed <details>' children, so this attribute — not DOM
    // presence — is what says the detail starts hidden.)
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')).toContainElement(title);

    const detail = within(disclosure);
    expect(detail.getByText('Before')).toBeInTheDocument();
    expect(detail.getByText('2')).toBeInTheDocument();
    expect(detail.getByText('After')).toBeInTheDocument();
    expect(detail.getByText('5')).toBeInTheDocument();
    expect(detail.getByText('quantity')).toBeInTheDocument();
  });

  it('says values are not recorded for pulled rows', async () => {
    await getLocalDb().syncLog.put({
      id: 'log-2',
      direction: 'pull',
      result: 'synced',
      entityClass: 'character_combat',
      entityId: 'combat-1',
      command: 'patch',
      details: { revision: 42 },
      occurredAt: new Date().toISOString(),
    });

    renderView();

    const title = await screen.findByText('character combat patch');
    const detail = within(title.closest('details') as HTMLDetailsElement);
    expect(detail.getByText('not recorded for downloads')).toBeInTheDocument();
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
