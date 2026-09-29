import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdventureLogOut, adventureLogUpdate } from '../../../shared/schemas/adventureLog.ts';
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

const attachmentCharacters = vi.hoisted(() => [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'My wanderer',
    ownerId: 'user-me',
    campaignId: 'another-campaign',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Someone else',
    ownerId: 'owner-x',
    campaignId: 'c1',
  },
]);
vi.mock('../characters/useCharacterDetail.ts', () => ({
  useCharactersList: () => attachmentCharacters,
  useCampaignCharactersList: () => [],
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
    sessionNumber: null,
    title: 'My entry',
    location: null,
    body: '',
    visibility: 'campaign',
    xpAwards: [],
    createdAt: '2024-05-05T00:00:00.000Z',
    updatedAt: '2024-05-05T00:00:00.000Z',
    ...over,
  } as AdventureLogOut;
}

function renderPage(props?: { campaignId?: string }, cachedCampaigns?: CampaignOut[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (cachedCampaigns) queryClient.setQueryData(['campaigns'], cachedCampaigns);
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
          sessionNumber: 13,
          location: 'The Hollow Beneath Greymoor',
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

  it.each<[number | null, number[], string]>([
    [null, [3, 3], '3 points gained'],
    [null, [3, 5], 'Point awards: 8 points total'],
    [0, [0, 0], '0 points gained'],
    [1, [1, 1], '1 point gained'],
    [1000, [1000, 1000], '1000 points gained'],
    [null, [-2, 3], 'Point awards: 1 point total'],
    [null, [-1000, 1000], 'Point awards: 0 points total'],
  ])('shows award amounts (%s, %s) and saved recipient names', async (points, amounts, label) => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === `/campaigns/${CAMP_ID}/log`)
        return [
          makeEntry({
            pointsGained: points,
            xpAwards: amounts.map((amount, i) => ({
              characterId: attachmentCharacters[i]?.id ?? '',
              amount,
            })),
          }),
        ];
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText(new RegExp(label))).toBeVisible();
    const count = screen.getByRole('button', { name: 'Characters awarded points for My entry' });
    expect(count).toHaveTextContent('2 characters');
    await user.click(count);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(`My wanderer · ${amounts[0]} point`);
    expect(tooltip).toHaveTextContent(`Someone else · ${amounts[1]} point`);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('counts a repeated historical recipient once and shows their combined award', async () => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === `/campaigns/${CAMP_ID}/log`)
        return [
          makeEntry({
            xpAwards: [
              { characterId: attachmentCharacters[0]?.id ?? '', amount: 3 },
              { characterId: attachmentCharacters[0]?.id ?? '', amount: 3 },
            ],
          }),
        ];
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText(/6 points gained/)).toBeVisible();
    const trigger = screen.getByRole('button', { name: 'Characters awarded points for My entry' });
    expect(trigger).toHaveTextContent('1 character');
    await user.click(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('My wanderer · 6 points');
  });

  it('names the attached character in the private badge and preserves unavailable recipients', async () => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === `/campaigns/${CAMP_ID}/log`)
        return [
          makeEntry({
            visibility: 'private',
            characterId: attachmentCharacters[0]?.id,
            xpAwards: [{ characterId: 'deleted-character', amount: 4 }],
          }),
        ];
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByText('private · My wanderer')).toBeVisible();
    await user.hover(
      screen.getByRole('button', { name: 'Characters awarded points for My entry' }),
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Character unavailable · 4 points',
    );
  });

  it('replaces an older card with its editor in place and keeps the draft on a failed save', async () => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    let saved = false;
    vi.mocked(api).mockImplementation((async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') {
        if (!saved) throw new ApiError(422, 'Title rejected');
        return makeEntry({ id: 'older', title: 'Revised older entry' });
      }
      if (path === `/campaigns/${CAMP_ID}/log`)
        return [
          makeEntry({ id: 'newer', title: 'Newer entry' }),
          makeEntry({ id: 'older', title: saved ? 'Revised older entry' : 'Older entry' }),
        ];
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Older entry' }));
    const articles = screen.getAllByRole('article');
    expect(
      within(articles[0] as HTMLElement).getByRole('heading', { name: 'Newer entry' }),
    ).toBeVisible();
    const form = within(articles[1] as HTMLElement).getByRole('form', {
      name: 'Edit adventure log entry',
    });
    expect(screen.queryByRole('heading', { name: 'Older entry' })).not.toBeInTheDocument();
    await user.clear(within(form).getByLabelText('Title'));
    await user.type(within(form).getByLabelText('Title'), 'Revised older entry');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await within(form).findByText('Title rejected')).toBeVisible();
    expect(within(form).getByLabelText('Title')).toHaveValue('Revised older entry');
    saved = true;
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Revised older entry' })).toBeVisible();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Revised older entry' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Revised older entry' })).toBeVisible();
  });

  it('defaults to Campaign, offers only owned characters, and saves a private attachment', async () => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    vi.mocked(api).mockImplementation((async (
      path: string,
      options?: { method?: string; body?: unknown },
    ) => {
      if (options?.method === 'POST')
        return makeEntry({
          title: 'Secret',
          characterId: attachmentCharacters[0]?.id,
          visibility: 'private',
        });
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '+ New entry' }));
    const attachment = screen.getByRole('combobox', { name: 'Attached to' });
    expect(attachment).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Campaign' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'My wanderer' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Someone else' })).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'About log attachments' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('visible only to you');
    await user.selectOptions(attachment, attachmentCharacters[0]?.id ?? '');
    await user.type(screen.getByLabelText('Title'), 'Secret');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    expect(api).toHaveBeenCalledWith(
      `/campaigns/${CAMP_ID}/log`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          characterId: attachmentCharacters[0]?.id,
          visibility: 'private',
        }),
      }),
    );
  });

  it('preserves a legacy private attachment during ordinary edits', async () => {
    setupResponses();
    const base = vi.mocked(api).getMockImplementation();
    vi.mocked(api).mockImplementation((async (path: string, options?: { method?: string }) => {
      if (path === `/campaigns/${CAMP_ID}/log` && !options?.method)
        return [makeEntry({ visibility: 'private', characterId: null })];
      if (options?.method === 'PATCH')
        return makeEntry({ visibility: 'private', characterId: null });
      return base?.(path);
    }) as typeof api);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit My entry' }));
    expect(screen.getByRole('combobox', { name: 'Attached to' })).toHaveValue('legacy-private');
    expect(
      screen.getByRole('option', { name: 'Private (no character attached)' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), ' revised');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api).toHaveBeenCalledWith(
      `/campaigns/${CAMP_ID}/log/e1`,
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ characterId: undefined, visibility: undefined }),
      }),
    );
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

  it('renders session number and location metadata on entries that carry them', async () => {
    setupResponses();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    // The seeded entry (session 13, The Hollow Beneath Greymoor) renders
    // both; the other entry renders neither.
    expect(screen.getByText('· Session 13')).toBeInTheDocument();
    expect(screen.getByText('The Hollow Beneath Greymoor')).toBeInTheDocument();
    expect(screen.queryByText(/Session 14/)).not.toBeInTheDocument();
  });

  it('suggests the next session number and keeps it editable on create', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    const sessionNumber = screen.getByLabelText('Session number') as HTMLInputElement;
    expect(sessionNumber.value).toBe('14');
    await user.type(screen.getByPlaceholderText(/Session 13/), 'Session 14');
    await user.clear(sessionNumber);
    await user.type(sessionNumber, '21');
    await user.type(screen.getByLabelText('Location'), 'Tal Cabal');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find((c) => c[0] === `/campaigns/${CAMP_ID}/log` && c[1]?.method === 'POST');
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ sessionNumber: 21, location: 'Tal Cabal' });
    });
  });

  it('suggests session zero when no numbered log has been posted', async () => {
    const unnumbered = makeEntry({ id: 'e-unnumbered', sessionNumber: null });
    vi.mocked(api).mockImplementation((async (path: string) => {
      if (path === '/auth/me') return { id: ME_ID };
      if (path === '/campaigns') return [campaign];
      if (path === `/campaigns/${CAMP_ID}`) return campaign;
      if (path === `/campaigns/${CAMP_ID}/log`) return [unnumbered];
      return undefined;
    }) as unknown as typeof api);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '+ New entry' }));

    expect((screen.getByLabelText('Session number') as HTMLInputElement).value).toBe('0');
  });

  it('edit prefills session number and location, and PATCH carries them through', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Edit My entry'));
    expect((screen.getByLabelText('Session number') as HTMLInputElement).value).toBe('13');
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe(
      'The Hollow Beneath Greymoor',
    );

    const locationInput = screen.getByLabelText('Location') as HTMLInputElement;
    await user.clear(locationInput);
    await user.type(locationInput, 'Tal Cabal');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find(
          (c) => c[0] === `/campaigns/${CAMP_ID}/log/e-mine` && c[1]?.method === 'PATCH',
        );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({
        sessionNumber: 13,
        location: 'Tal Cabal',
      });
    });
  });

  it('clearing location and session number sends explicit nulls on PATCH', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Edit My entry'));
    await user.clear(screen.getByLabelText('Session number'));
    await user.clear(screen.getByLabelText('Location'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = vi
        .mocked(api)
        .mock.calls.find(
          (c) => c[0] === `/campaigns/${CAMP_ID}/log/e-mine` && c[1]?.method === 'PATCH',
        );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ sessionNumber: null, location: null });
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
    expect(screen.getByRole('dialog', { name: 'Delete My entry?' })).toBeInTheDocument();
    expect(mockConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete entry' }));

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
    const secondCampaign = { ...campaign, id: 'c2', name: 'Other Campaign' };
    renderPage({ campaignId: CAMP_ID }, [campaign, secondCampaign]);
    // Embedded mode renders an <h2> "Adventure Log" instead of the
    // h1+eyebrow block (the parent already shows the campaign name).
    await waitFor(() => {
      const headings = screen.getAllByText('Adventure Log');
      expect(headings.some((h) => h.tagName === 'H2')).toBe(true);
    });
    // The eyebrow "Campaign · ..." should NOT render in embedded mode.
    expect(screen.queryByText(/Campaign ·/)).not.toBeInTheDocument();
    // Even if the shared campaigns query is already cached, a campaign detail
    // route is fixed by its path and must not render a redundant picker.
    expect(screen.queryByRole('combobox', { name: 'Select campaign' })).not.toBeInTheDocument();
  });

  it('hides all row Edit/Delete controls while an editor draft is open', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    // Before opening any editor, the modifiable rows show their actions.
    expect(screen.getByLabelText('Edit My entry')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete My entry')).toBeInTheDocument();

    // Opening the create form immediately hides EVERY row's edit/delete
    // actions — otherwise clicking Edit here would silently replace the
    // in-progress draft.
    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    expect(screen.queryByLabelText('Edit My entry')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete My entry')).not.toBeInTheDocument();

    // Cancelling the create form restores them.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Edit My entry')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete My entry')).toBeInTheDocument();
  });

  it('keeps a newer draft when an earlier create save settles later', async () => {
    setupResponses();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My entry')).toBeInTheDocument());

    // Defer the POST that follows the create submit; call `releasePost()`
    // when we want the save to settle, so we can race the user typing into
    // the still-open form against the in-flight mutation.
    let releasePost: () => void = () => {};
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePost = () =>
            resolve(
              makeEntry({
                id: 'e-new',
                authorId: ME_ID,
                title: 'First title',
              }) as unknown as Response,
            );
        }) as unknown as ReturnType<typeof api>,
    );

    await user.click(screen.getByRole('button', { name: '+ New entry' }));
    const titleInput = screen.getByPlaceholderText(/Session 13/) as HTMLInputElement;
    await user.type(titleInput, 'First title');
    await user.type(screen.getByTestId('rich-text-editor'), 'first body');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    // The save is in flight; the editor stayed open. Keep typing into
    // the same title field — that newer title must NOT be wiped when
    // the earlier mutation later settles.
    await user.type(titleInput, ' (rev)');

    // Sanity: the form is still on screen with the newer typed title.
    expect(titleInput.value).toBe('First title (rev)');

    // Let the slow save resolve. The mutation's onSuccess guard sees
    // the current draft no longer matches the snapshot it was called
    // with, so it must leave the editor (and the newer draft) alone.
    releasePost();

    // The editor must stay mounted with the user's newer draft — if the
    // guard regressed and wiped the draft, the title input would have
    // been reset to empty (or the whole form unmounted).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save entry' })).toBeInTheDocument();
    });
    expect((screen.getByPlaceholderText(/Session 13/) as HTMLInputElement).value).toBe(
      'First title (rev)',
    );
  });

  it.each([
    [3, 3],
    [3, 4],
  ])(
    'preserves legacy duplicate awards while saving text edits (%s and %s points)',
    async (first, second) => {
      const recipientId = '0193b3c0-f1f0-7000-8000-00000000c002';
      let entry = makeEntry({
        title: 'Legacy session',
        body: 'Original notes',
        pointsGained: null,
        xpAwards: [
          { characterId: recipientId, amount: first },
          { characterId: recipientId, amount: second },
        ],
      });
      vi.mocked(api).mockImplementation((async (
        path: string,
        options?: { method?: string; body?: unknown },
      ) => {
        if (path === '/auth/me') return { id: ME_ID };
        if (path === '/campaigns') return [campaign];
        if (path === `/campaigns/${CAMP_ID}`) return campaign;
        if (path === `/campaigns/${CAMP_ID}/log`) return [entry];
        if (path === `/campaigns/${CAMP_ID}/log/e1` && options?.method === 'PATCH') {
          const wireBody = JSON.parse(JSON.stringify(options.body));
          const patch = adventureLogUpdate.parse(wireBody);
          // The mock applies the validated text-only request, preserving the
          // historical rows just as the shared route handler does.
          entry = { ...entry, body: patch.body ?? entry.body };
          return entry;
        }
        return undefined;
      }) as unknown as typeof api);
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Legacy session');
      await user.click(screen.getByLabelText('Edit Legacy session'));
      expect(screen.getByText('Applies to 1 selected character')).toBeInTheDocument();
      await user.clear(screen.getByTestId('rich-text-editor'));
      await user.type(screen.getByTestId('rich-text-editor'), 'Revised notes');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText('Revised notes');
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
      const saved = vi
        .mocked(api)
        .mock.calls.find(
          (call) => call[0] === `/campaigns/${CAMP_ID}/log/e1` && call[1]?.method === 'PATCH',
        );
      expect(saved).toBeDefined();
      const wireBody = JSON.parse(JSON.stringify(saved?.[1]?.body));
      expect(wireBody).toMatchObject({ body: 'Revised notes' });
      expect(wireBody).not.toHaveProperty('xpAwards');
      expect(wireBody).not.toHaveProperty('awardCharacterIds');
      expect(wireBody).not.toHaveProperty('pointsGained');
      expect(entry.xpAwards).toEqual([
        { characterId: recipientId, amount: first },
        { characterId: recipientId, amount: second },
      ]);
    },
  );
});
