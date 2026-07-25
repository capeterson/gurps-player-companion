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
