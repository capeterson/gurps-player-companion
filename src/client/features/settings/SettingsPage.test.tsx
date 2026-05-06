import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';

// happy-dom implements <dialog> but showModal/close may be stubs.
// Ensure they set/remove the `open` attribute so RTL role queries work.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  }
  const original = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    original?.call(this);
  };
  const originalClose = HTMLDialogElement.prototype.close;
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    originalClose?.call(this);
  };
});

vi.mock('../../lib/apiKeys.ts', () => ({
  apiKeysApi: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiKeysApi } from '../../lib/apiKeys.ts';

const fakeKey = {
  id: 'key-uuid-1',
  name: 'My Script',
  prefix: 'gpc_abc12345',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
};

const fakeCreated = {
  plaintextKey: 'gpc_abc12345XYZabcXYZabc1234567890abcXYZ12',
  apiKey: fakeKey,
};

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <ApiKeysSection />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApiKeysSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when list returns []', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('No API keys yet.')).toBeInTheDocument();
    });
  });

  it('renders key rows with name, prefix, and created date', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([fakeKey]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('My Script')).toBeInTheDocument();
      expect(screen.getByText(/gpc_abc12345/)).toBeInTheDocument();
      expect(screen.getByText(/never used/)).toBeInTheDocument();
    });
  });

  it('shows last-used date when lastUsedAt is set', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([
      { ...fakeKey, lastUsedAt: '2026-03-15T12:00:00.000Z' },
    ]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText(/last used/)).toBeInTheDocument();
    });
  });

  it('generate flow: type name → click Mint key → create called', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockResolvedValue(fakeCreated);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'My Script');
    await user.click(screen.getByRole('button', { name: /mint key/i }));

    await waitFor(() => {
      expect(vi.mocked(apiKeysApi.create)).toHaveBeenCalledWith('My Script');
    });
  });

  it('shows ApiKeyCreatedDialog after successful create', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockResolvedValue(fakeCreated);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'My Script');
    await user.click(screen.getByRole('button', { name: /mint key/i }));

    await waitFor(() => {
      expect(screen.getByText('Save your API key')).toBeInTheDocument();
    });
    expect(screen.getByText(fakeCreated.plaintextKey)).toBeInTheDocument();
  });

  it('Copy button calls navigator.clipboard.writeText with the plaintext key', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockResolvedValue(fakeCreated);
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'copy test');
    await user.click(screen.getByRole('button', { name: /mint key/i }));
    await waitFor(() => screen.getByText('Save your API key'));

    await user.click(screen.getByText('Copy to clipboard'));

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith(fakeCreated.plaintextKey);
    });
    writeSpy.mockRestore();
  });

  it('"I\'ve saved it" closes the dialog', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockResolvedValue(fakeCreated);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'ack test');
    await user.click(screen.getByRole('button', { name: /mint key/i }));
    await waitFor(() => screen.getByText('Save your API key'));

    await user.click(screen.getByText("I've saved it"));

    await waitFor(() => {
      expect(screen.queryByText('Save your API key')).not.toBeInTheDocument();
    });
  });

  it('dialog onCancel prevents default (Escape does not close the dialog)', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockResolvedValue(fakeCreated);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'escape test');
    await user.click(screen.getByRole('button', { name: /mint key/i }));
    await waitFor(() => screen.getByText('Save your API key'));

    // Dispatch cancel event on the dialog element (simulates Escape key)
    const dialogs = document.querySelectorAll('dialog');
    // Find the ApiKeyCreatedDialog (has "Save your API key" heading inside)
    const apiKeyDialog = Array.from(dialogs).find((d) =>
      d.textContent?.includes('Save your API key'),
    );
    expect(apiKeyDialog).toBeTruthy();
    const cancelEvent = new Event('cancel', { cancelable: true, bubbles: false });
    apiKeyDialog?.dispatchEvent(cancelEvent);

    // onCancel handler must have called preventDefault
    expect(cancelEvent.defaultPrevented).toBe(true);
    // Dialog text still present
    expect(screen.getByText('Save your API key')).toBeInTheDocument();
  });

  it('Revoke button opens ConfirmDialog', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([fakeKey]);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByRole('button', { name: /revoke my script/i }));
    await user.click(screen.getByRole('button', { name: /revoke my script/i }));

    await waitFor(() => {
      expect(screen.getByText('Revoke API key')).toBeInTheDocument();
      // Body text of the dialog (inside <p>)
      expect(
        screen.getByText(/Any scripts using it will immediately lose access/),
      ).toBeInTheDocument();
    });
  });

  it('confirming revoke calls apiKeysApi.delete', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([fakeKey]);
    vi.mocked(apiKeysApi.delete).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByRole('button', { name: /revoke my script/i }));
    await user.click(screen.getByRole('button', { name: /revoke my script/i }));
    await waitFor(() => screen.getByText('Revoke API key'));

    // The ConfirmDialog has a "Revoke" confirm button (btn-error)
    const revokeBtns = screen.getAllByRole('button', { name: /^revoke$/i });
    // The confirm button is inside the modal (the list row button has aria-label "Revoke My Script")
    const confirmBtn = revokeBtns[0];
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(vi.mocked(apiKeysApi.delete)).toHaveBeenCalledWith(fakeKey.id);
    });
  });

  it('create error shows error message and does not open dialog', async () => {
    vi.mocked(apiKeysApi.list).mockResolvedValue([]);
    vi.mocked(apiKeysApi.create).mockRejectedValue(new ApiError(422, 'name already used'));
    const user = userEvent.setup();
    renderSection();

    await waitFor(() => screen.getByPlaceholderText(/e.g. CLI/i));
    await user.type(screen.getByPlaceholderText(/e.g. CLI/i), 'bad key');
    await user.click(screen.getByRole('button', { name: /mint key/i }));

    await waitFor(() => {
      expect(screen.getByText('name already used')).toBeInTheDocument();
    });
    expect(screen.queryByText('Save your API key')).not.toBeInTheDocument();
  });
});
