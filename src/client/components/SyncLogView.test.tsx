import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
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

afterEach(() => {
  vi.restoreAllMocks();
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
