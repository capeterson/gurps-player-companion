import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { activeEffectDefinitionCreate } from '../../../shared/schemas/activeEffects.ts';
import { libraryModifierCreate } from '../../../shared/schemas/libraryMetadata.ts';
import { type LocalLibrarySkill, type LocalLibraryTrait, getLocalDb } from '../../db/dexie.ts';
import { api } from '../../lib/api.ts';
import { LibraryPage } from './LibraryPage.tsx';
import { plainExcerpt } from './LibrarySection.tsx';

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
      experimentalActiveEffects: false,
      viewerRole: owner ? 'owner' : 'member',
      revision: 1,
    } as never,
    {
      id: OTHER_CAMPAIGN,
      ownerId: 'owner',
      name: 'Zeta',
      experimentalActiveEffects: false,
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

it('preserves excerpt punctuation and does not split a Unicode character at the limit', () => {
  const prose = 'Damage > 10; HP < 5; 2 * 3 * 4; foo_bar_baz | # note.';
  expect(plainExcerpt(prose)).toBe(prose);
  expect(plainExcerpt(`${'x'.repeat(299)}😀Z`)).toBe(`${'x'.repeat(299)}😀`);
});

function setup(initialEntry = '/', transferOnly = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[initialEntry]}>
        <LibraryPage campaignId={CAMPAIGN} transferOnly={transferOnly} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('shows publication details without content-entry metadata badges on sourcebooks', async () => {
  await seed();
  localStorage.setItem(
    `gpc:fold:${CAMPAIGN}:library:sources`,
    JSON.stringify(['Publications', '']),
  );
  await getLocalDb().campaignLibrarySources.put({
    id: '0193b3c0-f1f0-7000-8000-00000000b001',
    campaignId: CAMPAIGN,
    name: 'GURPS Basic Set, Fourth Edition Revised',
    abbreviation: 'B',
    edition: 'Fourth Edition Revised',
    priority: 100,
    notes: 'Combined Characters and Campaigns with revised addenda.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 3,
  });
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /^Sources/ }));
  const source = await screen.findByRole('button', {
    name: 'GURPS Basic Set, Fourth Edition Revised',
  });
  expect(source).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Publications/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Publications', { exact: true })).not.toBeInTheDocument();
  expect(source.querySelector('.badge')).toBeNull();
  fireEvent.click(source);
  expect(
    await screen.findByText('Combined Characters and Campaigns with revised addenda.'),
  ).toBeVisible();
  expect(screen.getAllByText('B · Priority 100')[0]).toBeVisible();
  expect(
    document.getElementById(source.getAttribute('aria-controls') ?? '')?.querySelector('.badge'),
  ).toBeNull();
  for (const label of ['Legacy source', 'complete', 'definition']) {
    expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument();
  }
});

it('counts direct sourcebook links across every library category and updates from local changes', async () => {
  const db = getLocalDb();
  const firstSource = '0193b3c0-f1f0-7000-8000-00000000b101';
  const secondSource = '0193b3c0-f1f0-7000-8000-00000000b102';
  await seed();
  await db.campaigns.update(CAMPAIGN, { experimentalActiveEffects: true });
  await db.campaignLibrarySources.bulkPut([
    {
      id: firstSource,
      campaignId: CAMPAIGN,
      name: 'GURPS Main Book',
      abbreviation: 'MB',
      priority: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    },
    {
      id: secondSource,
      campaignId: CAMPAIGN,
      name: 'GURPS Empty Book',
      abbreviation: 'EB',
      priority: 20,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    },
  ] as never[]);
  const categories = [
    ['campaignLibraryRaces', 'race'],
    ['campaignLibraryModifiers', 'modifier'],
    ['campaignLibraryTraits', 'trait'],
    ['campaignLibrarySkills', 'skill'],
    ['campaignLibrarySpells', 'spell'],
    ['campaignLibraryItems', 'item'],
    ['campaignLibraryLanguages', 'language'],
    ['campaignLibraryTechniques', 'technique'],
    ['campaignLibraryStyles', 'style'],
    ['campaignLibraryEnchantments', 'enchantment'],
    ['campaignLibraryActiveEffects', 'effect'],
  ] as const;
  const linkedIds: Record<string, string> = Object.fromEntries(
    categories.map(([, suffix], index) => [
      suffix,
      `0193b3c0-f1f0-7000-8000-${String(0xb200 + index).padStart(12, '0')}`,
    ]),
  );
  for (const [tableName, suffix] of categories) {
    await db.table(tableName).put({
      id: linkedIds[suffix],
      campaignId: CAMPAIGN,
      name: `Linked ${suffix}`,
      sourceId: firstSource,
      ...(tableName === 'campaignLibraryTraits'
        ? { kind: 'perk', basePoints: 1, pointsPerLevel: null, maxLevel: null }
        : {}),
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);
  }
  // Legacy citations and nested applicability references do not create a direct link.
  await db.campaignLibraryTraits.put(
    trait('0193b3c0-f1f0-7000-8000-00000000b220', {
      name: 'Citation only',
      source: 'MB71',
      sourceId: null,
    }),
  );
  await db.campaignLibraryModifiers.put({
    ...libraryModifierCreate.parse({
      name: 'Nested reference only',
      category: 'enhancement',
      applicability: {
        traits: [{ section: 'traits', key: 'Nested trait', sourceId: firstSource }],
      },
    }),
    id: '0193b3c0-f1f0-7000-8000-00000000b222',
    campaignId: CAMPAIGN,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  setup('/?section=sources');
  const table = await screen.findByRole('table', { name: 'sources' });
  const sourceRow = (name: string) =>
    within(table).getByRole('button', { name }).closest('tr') as HTMLTableRowElement;
  const count = (name: string) => within(sourceRow(name)).getAllByRole('cell')[1];
  await waitFor(() => {
    expect(count('GURPS Main Book')).toHaveTextContent('11');
    expect(count('GURPS Empty Book')).toHaveTextContent('0');
  });

  const header = within(table).getByRole('button', { name: 'Sort by Entries' });
  expect(header).toBeVisible();
  for (const name of ['GURPS Main Book', 'GURPS Empty Book']) {
    const row = sourceRow(name);
    const nameCell = within(row).getByRole('button', { name });
    expect(count(name)).toHaveTextContent(name === 'GURPS Main Book' ? '11' : '0');
    expect(row.lastElementChild).toContainElement(
      within(row).getByRole('button', { name: `Edit ${name}` }),
    );
    expect(nameCell).toBeVisible();
  }

  // A source filter and search affect the displayed library, not publication totals.
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: secondSource } });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search library' }), {
    target: { value: 'GURPS' },
  });
  await waitFor(() => expect(count('GURPS Main Book')).toHaveTextContent('11'));

  const raceId = linkedIds.race;
  const modifierId = linkedIds.modifier;
  if (!raceId || !modifierId) throw new Error('Missing seeded library entries');
  await db.campaignLibraryRaces.update(raceId, {
    sourceId: secondSource,
    revision: 2,
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  await waitFor(() => {
    expect(count('GURPS Main Book')).toHaveTextContent('10');
    expect(count('GURPS Empty Book')).toHaveTextContent('1');
  });
  await db.campaignLibraryModifiers.delete(modifierId);
  await waitFor(() => expect(count('GURPS Main Book')).toHaveTextContent('9'));
  await db.campaignLibraryModifiers.put({
    ...libraryModifierCreate.parse({
      name: 'Newly linked modifier',
      category: 'enhancement',
      sourceId: secondSource,
      applicability: { universal: true },
    }),
    id: '0193b3c0-f1f0-7000-8000-00000000b221',
    campaignId: CAMPAIGN,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await waitFor(() => expect(count('GURPS Empty Book')).toHaveTextContent('2'));

  fireEvent.click(header);
  const names = () =>
    within(table)
      .getAllByRole('button', { name: /^GURPS (Main|Empty) Book$/ })
      .map((button) => button.textContent?.trim());
  expect(names()).toEqual(['GURPS Empty Book', 'GURPS Main Book']);
  fireEvent.click(header);
  expect(names()).toEqual(['GURPS Main Book', 'GURPS Empty Book']);
});

it('shows library content without source, completeness, role or preference badges', async () => {
  await seed();
  await getLocalDb().campaignLibraryTraits.update(NIGHT, {
    sourceId: '0193b3c0-f1f0-7000-8000-00000000b001',
    status: 'complete',
    role: 'definition',
    preferredEdition: true,
  });
  await getLocalDb().campaignLibraryTraits.update(FEAR, {
    sourceId: '0193b3c0-f1f0-7000-8000-00000000b001',
    status: 'needs_review',
    role: 'example',
    restricted: true,
  });
  setup();
  for (const [name, description] of [
    ['Night Vision', /in darkness/],
    ['Fearfulness', 'Easily frightened'],
  ] as const) {
    const entry = await screen.findByRole('button', { name });
    expect(entry).toBeVisible();
    expect(entry.querySelector('.badge')).toBeNull();
    fireEvent.click(entry);
    expect(await screen.findByText(description)).toBeVisible();
    const detail = document.getElementById(entry.getAttribute('aria-controls') ?? '');
    expect(detail?.querySelector('.badge')).toBeNull();
    for (const label of [
      'Legacy source',
      'complete',
      'needs review',
      'definition',
      'example',
      'Preferred',
      'Default edition',
      'Restricted',
      'Restricted · GM only',
    ]) {
      expect(
        within(detail as HTMLElement).queryByText(label, { exact: true }),
      ).not.toBeInTheDocument();
    }
  }
});

it('keeps citations beside the collapsed summary without repeating them in the details', async () => {
  await seed();
  await getLocalDb().campaignLibraryTraits.update(NIGHT, { sourceLocator: 'B71' });
  await getLocalDb().campaignLibraryTraits.update(FEAR, {
    source: null,
    sourceLocator: 'B136',
  });
  setup();
  for (const [name, summary, citation] of [
    ['Night Vision', 'Advantage · 1 pt', 'B71'],
    ['Fearfulness', 'Disadvantage · -2 pt', 'B136'],
  ] as const) {
    const entry = await screen.findByRole('button', { name });
    expect(entry).toHaveAttribute('aria-expanded', 'false');
    const row = entry.closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText(summary)).toBeVisible();
    expect(within(row).getByText(citation)).toBeVisible();
    fireEvent.click(entry);
    const detail = document.getElementById(
      entry.getAttribute('aria-controls') ?? '',
    ) as HTMLElement;
    expect(within(detail).queryByText(citation)).not.toBeInTheDocument();
    expect(within(detail).queryByText(`Source · ${citation}`)).not.toBeInTheDocument();
    expect(within(row).getByText(citation)).toBeVisible();
  }
});

it('searches descriptions and source across words, reports empty results and clears', async () => {
  await seed();
  const sourceId = '0193b3c0-f1f0-7000-8000-00000000f004';
  await getLocalDb().campaignLibrarySources.put({
    id: sourceId,
    campaignId: CAMPAIGN,
    name: 'GURPS Basic Set',
    abbreviation: 'BX',
    revision: 1,
  } as never);
  await getLocalDb().campaignLibraryTraits.update(NIGHT, {
    sourceId,
    applicability: { traits: [{ sourceId, definitionId: '0193b3c0-f1f0-7000-8000-00000000f005' }] },
  } as never);
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
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'BX Basic Set' } });
  expect(await screen.findByRole('button', { name: 'Night Vision' })).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: '00000000f004' },
  });
  expect(await screen.findByText(/No matches/)).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'No match' } });
  expect(await screen.findByText(/No matches/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByRole('button', { name: 'Fearfulness' })).toBeVisible();
});

it('shows stored active-effect definitions in authoring even before campaign opt-in', async () => {
  await seed();
  await getLocalDb().campaignLibraryActiveEffects.put({
    ...activeEffectDefinitionCreate.parse({
      name: 'Hidden draught',
      stacking: { kind: 'additive', key: 'hidden-draught' },
      effects: [{ target: 'st', value: 1 }],
    }),
    id: '0193b3c0-f1f0-7000-8000-00000000f003',
    campaignId: CAMPAIGN,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  });
  setup('/?section=activeEffects&q=Hidden%20draught');
  expect(await screen.findByRole('button', { name: /^Active Effects/ })).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Hidden draught' })).toBeVisible();
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
  expect(screen.getByText('**Bold** description 7')).toBeVisible();
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Night Vision' },
  });
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'advantage' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Duplicate traits edition: Night Vision')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Night Vision');
  expect(await getLocalDb().outbox.count()).toBe(0);
});

it('creates and deletes a trait through the outbox', async () => {
  await seed();
  setup();
  fireEvent.click(await screen.findByRole('button', { name: '+ Add trait' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
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

it('creates languages, techniques, and styles through the local-first library editor', async () => {
  await seed();
  setup();
  const db = getLocalDb();

  fireEvent.click(await screen.findByRole('button', { name: /^Languages/ }));
  fireEvent.click(await screen.findByRole('button', { name: '+ Add language' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Trade Sign' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Is Sign Language' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
  expect(await screen.findByRole('button', { name: 'Trade Sign' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: /^Techniques/ }));
  fireEvent.click(await screen.findByRole('button', { name: '+ Add technique' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Elbow Strike' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Default skill' }), {
    target: { value: 'Karate' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add technique' }));
  expect(await screen.findByRole('button', { name: 'Elbow Strike' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: /^Styles/ }));
  fireEvent.click(await screen.findByRole('button', { name: '+ Add style' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Northern Fist' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add skills' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Skills 1' }), {
    target: { value: 'Karate, specialized' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add perks' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Perks 1' }), {
    target: { value: 'Style Adaptation' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add style' }));
  expect(await screen.findByRole('button', { name: 'Northern Fist' })).toBeVisible();

  expect(await db.campaignLibraryLanguages.toArray()).toEqual([
    expect.objectContaining({ name: 'Trade Sign', isSignLanguage: true, campaignId: CAMPAIGN }),
  ]);
  expect(await db.campaignLibraryTechniques.toArray()).toEqual([
    expect.objectContaining({
      name: 'Elbow Strike',
      defaultSkillName: 'Karate',
      campaignId: CAMPAIGN,
    }),
  ]);
  expect(await db.campaignLibraryStyles.toArray()).toEqual([
    expect.objectContaining({
      name: 'Northern Fist',
      skills: ['Karate, specialized'],
      perks: ['Style Adaptation'],
      techniques: [],
      campaignId: CAMPAIGN,
    }),
  ]);
  expect(
    (await db.outbox.toArray())
      .map(({ entityClass, command, parentId }) => [entityClass, command, parentId])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  ).toEqual([
    ['campaign_library_language', 'create', CAMPAIGN],
    ['campaign_library_style', 'create', CAMPAIGN],
    ['campaign_library_technique', 'create', CAMPAIGN],
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
  setup('/', true);
  expect(await screen.findByRole('heading', { name: 'Import YAML' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'Merge (add/update)' })).toBeInTheDocument();
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  expect(dialog).toHaveTextContent('Traits: 0 in file · 2 to remove');
  expect(dialog).toHaveTextContent('The entire file will be imported');
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Import empty.yaml?' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  fireEvent.click(screen.getByRole('button', { name: 'Replace selected scope' }));
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

it('imports only the sourcebook selected from a full YAML file', async () => {
  await seed();
  vi.mocked(api).mockResolvedValue({ mode: 'merge' });
  setup('/', true);
  await screen.findByRole('heading', { name: 'Import YAML' });
  const yaml =
    'version: 14\nlibrary:\n  sources:\n    - key: alpha\n      name: Alpha\n      abbreviation: A\n  traits:\n    - name: Alpha Trait\n      kind: advantage\n      sourceKey: alpha\n  skills: []\n  items: []\n';
  const file = new File([yaml], 'books.yaml', { type: 'text/yaml' });
  Object.defineProperty(file, 'text', { value: async () => yaml });
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  const alpha = await screen.findByRole('checkbox', { name: 'A: Alpha' });
  fireEvent.click(alpha);
  expect(alpha).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Entire file' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  const dialog = await screen.findByRole('dialog', { name: 'Import books.yaml?' });
  expect(dialog).toHaveTextContent('Selected sourcebooks: alpha');
  fireEvent.click(screen.getByRole('button', { name: 'Merge library' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/campaigns/${CAMPAIGN}/library/import`,
      expect.objectContaining({
        body: expect.objectContaining({ sourceKeys: ['alpha'] }),
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
        <LibraryPage transferOnly />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Import YAML' });
  fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'replace' } });
  const file = new File(
    ['version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n'],
    'empty.yaml',
  );
  Object.defineProperty(file, 'text', {
    value: async () => 'version: 11\nlibrary:\n  traits: []\n  skills: []\n  items: []\n',
  });
  fireEvent.change(screen.getByLabelText('YAML file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review import' }));
  await screen.findByRole('dialog', { name: 'Import empty.yaml?' });
  fireEvent.click(screen.getByRole('button', { name: 'Switch campaign' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Import empty.yaml?' })).toBeNull(),
  );
  expect(api).not.toHaveBeenCalled();
});
