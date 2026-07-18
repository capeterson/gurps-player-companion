import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdventureLogOut } from '../../../shared/schemas/adventureLog.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { ApiError, api } from '../../lib/api.ts';
import { LogPage } from '../log/LogPage.tsx';

// Mock the Tiptap-backed editor with a plain textarea so tests stay
// deterministic and don't depend on ProseMirror's happy-dom quirks.
// The real <Markdown> renderer is kept (it works under node/happy-dom)
// so the sanitized body pipeline is exercised end-to-end here.
vi.mock('../../components/markdown/RichTextEditor.tsx', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const mockConfirm = vi.hoisted(() => vi.fn(() => true));
Object.defineProperty(window, 'confirm', { value: mockConfirm, writable: true });

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...orig, api: vi.fn() };
});

const ME_ID = 'user-me';
const OWNER_ID = 'owner-x';
const CAMP_ID = 'c1';

const campaign: CampaignOut = {
  id: CAMP_ID,
  name: 'Test Campaign',
  description: '',
  ownerId: OWNER_ID,
  members: [
    { userId: ME_ID, role: 'member', displayName: 'Me', joinedAt: '2024-01-01T00:00:00.000Z' },
    {
      userId: 'other-author',
      role: 'member',
      displayName: 'Other',
      joinedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  shareCharacterSheets: false,
} as unknown as CampaignOut;

function makeEntry(over: Partial<AdventureLogOut>): AdventureLogOut {
  return {
    id: 'e1',
    campaignId: CAMP_ID,
    authorId: ME_ID,
    authorDisplayName: 'Me',
    sessionDate: '2024-05-05',
    title: 'My entry',
    body: '',
    visibility: 'campaign',
    xpAwards: [],
    createdAt: '2024-05-05T00:00:00.000Z',
    updatedAt: '2024-05-05T00:00:00.000Z',
    ...over,
  } as AdventureLogOut;
}

function renderPage(props?: { campaignId?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LogPage {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupResponses() {
  vi.mocked(api).mockImplementation((async (path: string) => {
    if (path === '/auth/me') return { id: ME_ID };
    if (path === '/campaigns') return [campaign];
    if (path === `/campaigns/${CAMP_ID}`) return campaign;
    if (path === `/campaigns/${CAMP_ID}/log`) {
      return [
        makeEntry({
          id: 'e-mine',
          authorId: ME_ID,
          title: 'My entry',
          body: '## Hello\n\n**bold**',
        }),
        makeEntry({
          id: 'e-other',
          authorId: 'other-author',
          authorDisplayName: 'Other',
          title: 'Not mine',
          body: '<script>alert(1)</script>',
        }),
      ];
    }
    return undefined;
  }) as unknown as typeof api);
}

describe('LogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true);
  });

  it('renders the layout and markdown-rendered entry bodies (no raw HTML execution)', async () => {
    setupResponses();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('My entry')).toBeInTheDocument();
    });
    // Filter chips present and aligned.
    expect(screen.getByText(/All/)).toBeInTheDocument();
    expect(screen.getByText(/Shared/)).toBeInTheDocument();
    expect(screen.getByText(/Private/)).toBeInTheDocument();
    // My entry body is rendered as markdown -> an <h2> appears.
    const markdownBlocks = document.querySelectorAll('.markdown-body');
    expect(markdownBlocks.length).toBeGreaterThanOrEqual(2);
    const mine = markdownBlocks.item(0);
    const other = markdownBlocks.item(1);
    expect(mine?.innerHTML).toContain('<h2>Hello</h2>');
    // The other author's <script> is escaped, never a live element.
    expect(other?.innerHTML).not.toMatch(/<script/i);
    expect(other?.innerHTML).toContain('alert(1)');
  });

  it('shows Edit/Delete only for entries the viewer can modify (author or owner)', async () => {
    setupResponses();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('My entry')).toBeInTheDocument();
    });
    // Mine (author): editable.
    expect(screen.getByLabelText('Edit My entry')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete My entry')).toBeInTheDocument();
    // Not mine and not owner: no controls.
    expect(screen.queryByLabelText('Edit Not mine')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Not mine')).not.toBeInTheDocument();
  });

  it('creates an entry via POST and invalidates the list', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    await user.type(screen.getByPlaceholderText(/Session 13/), 'Session 14');
    await user.type(screen.getByTestId('rich-text-editor'), 'A _new_ log line.');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find((c) => c[0] === `/campaigns/${CAMP_ID}/log` && c[1]?.method === 'POST');
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ title: 'Session 14', body: 'A _new_ log line.' });
    });
  });

  it('edits an entry via PATCH prefilled with its content', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Edit My entry'));
    // The title field is prefilled with the entry's title.
    const titleInput = screen.getByPlaceholderText(/Session 13/) as HTMLInputElement;
    expect(titleInput.value).toBe('My entry');
    await user.clear(titleInput);
    await user.type(titleInput, 'My entry (rev)');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find(
          (c) => c[0] === `/campaigns/${CAMP_ID}/log/e-mine` && c[1]?.method === 'PATCH',
        );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ title: 'My entry (rev)' });
    });
  });

  it('deletes an entry via DELETE after confirmation', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Delete My entry'));
    expect(mockConfirm).toHaveBeenCalled();

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find(
          (c) => c[0] === `/campaigns/${CAMP_ID}/log/e-mine` && c[1]?.method === 'DELETE',
        );
      expect(call).toBeDefined();
    });
  });

  it('shows a save error toast when create fails', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    vi.mocked(api).mockImplementationOnce(async () => {
      throw new ApiError(422, 'Validation error');
    });
    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    await user.type(screen.getByPlaceholderText(/Session 13/), 'Bad');
    await user.type(screen.getByTestId('rich-text-editor'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => {
      expect(screen.getByText('Validation error')).toBeInTheDocument();
    });
  });

  it('embedded mode (campaignId prop) hides the campaign eyebrow title block', async () => {
    setupResponses();
    renderPage({ campaignId: CAMP_ID });
    // Embedded mode renders an <h2> "Adventure Log" instead of the
    // h1+eyebrow block (the parent already shows the campaign name).
    await waitFor(() => {
      const headings = screen.getAllByText('Adventure Log');
      expect(headings.some((h) => h.tagName === 'H2')).toBe(true);
    });
    // The eyebrow "Campaign · ..." should NOT render in embedded mode.
    expect(screen.queryByText(/Campaign ·/)).not.toBeInTheDocument();
  });
});
