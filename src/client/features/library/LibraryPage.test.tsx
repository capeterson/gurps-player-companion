import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/api.ts';
import { LibraryPage } from './LibraryPage.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('./EffectsEditor.tsx', () => ({ EffectsEditor: () => null, effectPreview: () => '' }));
// Browser coverage exercises the real toolbar; here focus on draft lifetime and HTTP failure.
vi.mock('../../components/markdown/RichTextEditor.tsx', () => ({
  RichTextEditor: (props: {
    value: string;
    onChange: (s: string) => void;
    'aria-label': string;
  }) => (
    <textarea
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));
const traits = [
  {
    id: 'night',
    name: 'Night Vision',
    kind: 'advantage',
    basePoints: 1,
    description: '**See** in darkness',
    source: 'B71',
    availableModifiers: [],
    effects: [],
  },
  {
    id: 'fear',
    name: 'Fearfulness',
    kind: 'disadvantage',
    basePoints: -2,
    description: 'Easily frightened',
    source: 'B136',
    availableModifiers: [],
    effects: [],
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH') throw new Error('Network unavailable');
    if (path === '/auth/me') return { id: 'owner' };
    if (path === '/campaigns') return [{ id: 'campaign', ownerId: 'owner', name: 'Test' }];
    return { traits, skills: [], spells: [], items: [], enchantments: [] };
  });
});
function setup() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <LibraryPage campaignId="campaign" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('searches descriptions and source across words, reports empty results and clears', async () => {
  setup();
  await screen.findByText('Night Vision');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search library' }), {
    target: { value: 'DARKNESS b71' },
  });
  expect(screen.getByText('Night Vision')).toBeVisible();
  expect(screen.queryByText('Fearfulness')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 traits');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'No match' } });
  expect(screen.getByText(/No matches/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('Fearfulness')).toBeVisible();
});
it('preserves an edited description through filtering, category changes and a failed save', async () => {
  setup();
  await screen.findByText('Night Vision');
  const edit = screen.getAllByRole('button', { name: /Edit/ })[0];
  if (!edit) throw new Error('Missing edit action');
  fireEvent.click(edit);
  const description = screen.getByLabelText('Description');
  fireEvent.change(description, { target: { value: '**Still editing**' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Fearfulness' } });
  expect(description).toHaveValue('**Still editing**');
  fireEvent.click(screen.getByRole('button', { name: /^Skills/ }));
  expect(description).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Traits/ }));
  expect(description).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Save failed');
  expect(description).toHaveValue('**Still editing**');
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign/library/traits/night',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ description: '**Still editing**' }),
      }),
    ),
  );
});
it('renders sanitized markdown in descriptions', async () => {
  const view = setup();
  await waitFor(() =>
    expect(view.container.querySelector('.markdown-body strong')).toHaveTextContent('See'),
  );
});

it('reviews a Replace YAML file before submitting and permits cancellation', async () => {
  setup();
  await screen.findByText('Night Vision');
  fireEvent.click(screen.getByRole('button', { name: /Import YAML/ }));
  fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'replace' } });
  const file = new File(
    ['version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n'],
    'empty.yaml',
    { type: 'text/yaml' },
  );
  Object.defineProperty(file, 'text', {
    value: async () => 'version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n',
  });
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  const dialog = await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  expect(dialog).toHaveTextContent('Traits: 0 in file · 2 to remove');
  expect(
    vi
      .mocked(api)
      .mock.calls.some(([path, options]) => path.endsWith('/import') && options?.method === 'POST'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Import empty.yaml?' })).toBeNull();
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  fireEvent.click(screen.getByRole('button', { name: 'Replace library' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign/library/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ mode: 'replace' }),
      }),
    ),
  );
});

it('discards a Replace preview when the selected campaign changes', async () => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/auth/me') return { id: 'owner' };
    if (path === '/campaigns')
      return [
        { id: 'campaign-a', ownerId: 'owner', name: 'A' },
        { id: 'campaign-b', ownerId: 'owner', name: 'B' },
      ];
    if (options?.method === 'POST') return { created: {}, updated: {}, deleted: {} };
    return { traits, skills: [], spells: [], items: [], enchantments: [] };
  });
  function SwitchCampaign() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate('/?campaign=campaign-b')}>
        Switch campaign
      </button>
    );
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/?campaign=campaign-a']}>
        <SwitchCampaign />
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Night Vision');
  fireEvent.click(screen.getByRole('button', { name: /Import YAML/ }));
  fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'replace' } });
  const file = new File(
    ['version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n'],
    'empty.yaml',
  );
  Object.defineProperty(file, 'text', {
    value: async () => 'version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n',
  });
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  fireEvent.click(screen.getByRole('button', { name: 'Switch campaign' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Import empty.yaml?' })).toBeNull(),
  );
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([path, options]) => path.includes('/library/import') && options?.method === 'POST',
      ),
  ).toBe(false);
});
