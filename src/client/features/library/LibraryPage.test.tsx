import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { type LocalLibrarySkill, type LocalLibraryTrait, getLocalDb } from '../../db/dexie.ts';
import { api } from '../../lib/api.ts';
import { LibraryPage } from './LibraryPage.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('./EffectsEditor.tsx', () => ({ EffectsEditor: () => null, effectPreview: () => '' }));
const { renderMarkdown } = vi.hoisted(() => ({ renderMarkdown: vi.fn() }));
vi.mock('../../components/markdown/markdownProcessor.ts', async (original) => {
  const actual = await original<typeof import('../../components/markdown/markdownProcessor.ts')>();
  renderMarkdown.mockImplementation(actual.renderMarkdown);
  return { ...actual, renderMarkdown };
});
// Browser coverage exercises the real toolbar; here focus on draft lifetime and local-first saves.
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

const CAMPAIGN = '0193b3c0-f1f0-7000-8000-00000000ca01';
const OTHER_CAMPAIGN = '0193b3c0-f1f0-7000-8000-00000000ca02';
const NIGHT = '0193b3c0-f1f0-7000-8000-00000000f001';
const FEAR = '0193b3c0-f1f0-7000-8000-00000000f002';

function trait(id: string, overrides: Partial<LocalLibraryTrait>): LocalLibraryTrait {
  return {
    id,
    campaignId: CAMPAIGN,
    name: 'Trait',
    kind: 'advantage',
    basePoints: 1,
    pointsPerLevel: null,
    maxLevel: null,
    description: null,
    source: null,
    availableModifiers: [],
    variants: [],
    effects: [],
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 3,
    ...overrides,
  } as LocalLibraryTrait;
}

function skill(index: number, overrides: Partial<LocalLibrarySkill> = {}): LocalLibrarySkill {
  return {
    id: `0193b3c0-f1f0-7000-8000-${String(index).padStart(12, '0')}`,
    campaignId: CAMPAIGN,
    name: `Skill ${String(index).padStart(3, '0')}`,
    attribute: index % 2 === 0 ? 'DX' : 'IQ',
    difficulty: index % 3 === 0 ? 'H' : 'A',
    techLevel: null,
    techLevelPolicy: { kind: 'not_applicable' },
    description: `**Bold** description ${index}`,
    source: null,
    defaultSpecialization: null,
    specializationPolicy: { kind: 'none' },
    defaults: null,
    prerequisites: null,
    prerequisiteRules: null,
    groups: [],
    tags: [],
    procedures: [],
    situationalModifiers: [],
    effects: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 3,
    ...overrides,
  } as LocalLibrarySkill;
}

async function seed({ owner = true }: { owner?: boolean } = {}) {
  const db = getLocalDb();
  await db.campaigns.bulkPut([
    {
      id: CAMPAIGN,
      ownerId: owner ? 'owner' : 'someone-else',
      name: 'Test',
      viewerRole: owner ? 'owner' : 'member',
      revision: 1,
    } as never,
    {
      id: OTHER_CAMPAIGN,
      ownerId: 'owner',
      name: 'Zeta',
      viewerRole: 'owner',
      revision: 1,
    } as never,
  ]);
  await db.campaignLibraryTraits.bulkPut([
    trait(NIGHT, {
      name: 'Night Vision',
      description: '**See** in darkness',
      source: 'B71',
    }),
    trait(FEAR, {
      name: 'Fearfulness',
      kind: 'disadvantage',
      basePoints: -2,
      description: 'Easily frightened',
      source: 'B136',
    }),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    localStorage.clear();
  } catch {}
});

function setup(initialEntry = '/') {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <LibraryPage campaignId={CAMPAIGN} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('searches descriptions and source across words, reports empty results and clears', async () => {
  await seed();
  setup();
  await screen.findByRole('button', { name: 'Night Vision' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search library' }), {
    target: { value: 'DARKNESS b71' },
  });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Fearfulness' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Night Vision' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('1 of 2 traits match');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'No match' } });
  expect(await screen.findByText(/No matches/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByRole('button', { name: 'Fearfulness' })).toBeVisible();
});

it('groups traits by kind, sorts within groups from the column heading and folds groups', async () => {
  await seed();
  await getLocalDb().campaignLibraryTraits.put(
    trait('0193b3c0-f1f0-7000-8000-00000000f003', { name: 'Acute Hearing', basePoints: 2 }),
  );
  const view = setup();
  const table = await screen.findByRole('table', { name: 'traits' });
  await within(table).findByRole('button', { name: 'Acute Hearing' });
  const advantages = within(table).getByRole('button', { name: /^Advantage/ });
  expect(advantages).toHaveTextContent('Advantage 2');
  expect(within(table).getByRole('button', { name: /^Disadvantage/ })).toHaveTextContent(
    'Disadvantage 1',
  );
  // Entry toggles are the collapsed (aria-expanded=false) buttons; group
  // headings are expanded and the Edit/Delete icons have no expanded state.
  const names = () =>
    within(table)
      .getAllByRole('button', { expanded: false })
      .map((button) => button.textContent);
  expect(names()).toEqual(['Acute Hearing', 'Night Vision', 'Fearfulness']);
  fireEvent.click(within(table).getByRole('button', { name: 'Sort by Points' }));
  expect(names()).toEqual(['Night Vision', 'Acute Hearing', 'Fearfulness']);
  fireEvent.click(within(table).getByRole('button', { name: 'Sort by Points' }));
  expect(names()).toEqual(['Acute Hearing', 'Night Vision', 'Fearfulness']);

  fireEvent.click(advantages);
  expect(advantages).toHaveAttribute('aria-expanded', 'false');
  expect(within(table).queryByRole('button', { name: 'Night Vision' })).toBeNull();
  view.unmount();
  setup();
  const again = await screen.findByRole('table', { name: 'traits' });
  await within(again).findByRole('button', { name: 'Fearfulness' });
  expect(within(again).queryByRole('button', { name: 'Night Vision' })).toBeNull();
  // A search shows every match regardless of folded groups.
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  expect(await within(again).findByRole('button', { name: 'Night Vision' })).toBeVisible();
});

it('renders markdown only for an expanded entry, even in a large library', async () => {
  await seed();
  await getLocalDb().campaignLibrarySkills.bulkPut(
    Array.from({ length: 500 }, (_, index) => skill(index)),
  );
  setup('/?section=skills');
  expect(await screen.findByText('500 of 500 skills.', { exact: false })).toBeVisible();
  expect(renderMarkdown).not.toHaveBeenCalled();
  // Collapsed rows show a plain-text excerpt instead.
  expect(screen.getByText('Bold description 7')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Skill 007' }));
  await waitFor(() =>
    expect(document.querySelector('.markdown-body strong')).toHaveTextContent('Bold'),
  );
  expect(renderMarkdown).toHaveBeenCalledTimes(1);
});

it('opens a deep-linked entry in its section', async () => {
  await seed();
  const target = skill(42, { name: 'Lockpicking', description: 'Opens **locks**' });
  await getLocalDb().campaignLibrarySkills.bulkPut([skill(1), target]);
  setup(`/?section=skills&open=${target.id}`);
  const row = await screen.findByRole('button', { name: 'Lockpicking' });
  expect(row).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() =>
    expect(document.querySelector('.markdown-body strong')).toHaveTextContent('locks'),
  );
});

it('keeps an edited description through filtering and category changes, then saves locally', async () => {
  await seed();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Night Vision' }));
  const description = screen.getByLabelText('Description');
  fireEvent.change(description, { target: { value: '**Still editing**' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Fearfulness' } });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 of 2 traits match'));
  expect(description).toHaveValue('**Still editing**');
  fireEvent.click(screen.getByRole('button', { name: /^Skills/ }));
  expect(description).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Traits/ }));
  expect(description).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByLabelText('Description')).toBeNull());
  const db = getLocalDb();
  expect(await db.campaignLibraryTraits.get(NIGHT)).toMatchObject({
    description: '**Still editing**',
  });
  expect(await db.outbox.toArray()).toEqual([
    expect.objectContaining({
      entityClass: 'campaign_library_trait',
      entityId: NIGHT,
      command: 'patch',
      parentId: CAMPAIGN,
      attemptedValue: expect.objectContaining({ description: '**Still editing**' }),
    }),
  ]);
  expect(api).not.toHaveBeenCalled();
});

it('keeps the draft open with the reason when the edit is already known to be invalid', async () => {
  await seed();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Fearfulness' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name *' }), {
    target: { value: 'Night Vision' },
  });
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'advantage' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('A trait with that name already exists')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Name *' })).toHaveValue('Night Vision');
  expect(await getLocalDb().outbox.count()).toBe(0);
});

it('creates and deletes a trait through the outbox', async () => {
  await seed();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: '+ Add trait' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name *' }), {
    target: { value: 'New Trait' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add trait' }));
  expect(await screen.findByRole('button', { name: 'New Trait' })).toBeVisible();
  expect(await screen.findByRole('button', { name: '+ Add trait' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Delete Night Vision' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete library trait' });
  expect(dialog).toHaveTextContent('Night Vision');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Night Vision' })).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(dialog).not.toBeVisible());
  // Primary keys are random UUIDs; order by enqueue time, then command, as the drain does.
  const rank = { create: 0, patch: 1, delete: 2 } as const;
  const ops = (await getLocalDb().outbox.toArray()).sort(
    (a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt) || rank[a.command] - rank[b.command],
  );
  expect(ops.map((op) => [op.command, op.parentId])).toEqual([
    ['create', CAMPAIGN],
    ['delete', CAMPAIGN],
  ]);
  expect(api).not.toHaveBeenCalled();
});

it('hides owner controls from members', async () => {
  await seed({ owner: false });
  setup();
  await screen.findByRole('button', { name: 'Night Vision' });
  expect(screen.queryByRole('button', { name: /Edit Night Vision/ })).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Add trait' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Import YAML/ })).toBeNull();
});

it('reviews a Replace YAML file before submitting and permits cancellation', async () => {
  await seed();
  vi.mocked(api).mockResolvedValue({
    mode: 'replace',
    traits: { created: 0, updated: 0, deleted: 2 },
    skills: { created: 0, updated: 0, deleted: 0 },
    spells: { created: 0, updated: 0, deleted: 0 },
    items: { created: 0, updated: 0, deleted: 0 },
    enchantments: { created: 0, updated: 0, deleted: 0 },
  });
  setup();
  await screen.findByRole('button', { name: 'Night Vision' });
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
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Import empty.yaml?' })).toBeNull();
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  fireEvent.click(screen.getByRole('button', { name: 'Replace library' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/campaigns/${CAMPAIGN}/library/import`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ mode: 'replace' }),
      }),
    ),
  );
});

it('discards a Replace preview when the selected campaign changes', async () => {
  await seed();
  function SwitchCampaign() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(`/?campaign=${OTHER_CAMPAIGN}`)}>
        Switch campaign
      </button>
    );
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/?campaign=${CAMPAIGN}`]}>
        <SwitchCampaign />
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Night Vision' });
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
  expect(api).not.toHaveBeenCalled();
});
