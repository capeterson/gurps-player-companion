import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSpellOut } from '../../../../shared/domain/characterDetail.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SpellOut } from '../../../../shared/schemas/spell.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { enqueueCreate, enqueueDelete, enqueueFieldPatch } from '../../../sync/outbox.ts';
import { SpellsPanel } from './SpellsPanel.tsx';

const enqueueCreateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const enqueueDeleteMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const enqueueFieldPatchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../sync/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sync/outbox.ts')>()),
  enqueueCreate: enqueueCreateMock,
  enqueueDelete: enqueueDeleteMock,
  enqueueFieldPatch: enqueueFieldPatchMock,
}));
vi.mock('./useLibraryFetcher.ts', () => ({
  useLibraryFetcher: () => ({ fetchOptions: async () => [] }),
}));

const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000a201';
const SPELL_ONE = '0193b3c0-f1f0-7000-8000-00000000a202';
const SPELL_TWO = '0193b3c0-f1f0-7000-8000-00000000a203';
const SPELL_ZERO = '0193b3c0-f1f0-7000-8000-00000000a204';

function makeSpell(
  id: string,
  name: string,
  points = 2,
  baseEnergyCost = 3,
  maintenanceCost: number | null = 1,
  overrides: Partial<SpellOut> = {},
): SpellOut {
  return {
    ...buildSpellOut(
      {
        id,
        characterId: CHARACTER_ID,
        name,
        college: 'Fire',
        difficulty: 'H',
        points,
        baseEnergyCost,
        maintenanceCost,
        castingTime: '2 seconds',
        duration: '1 minute',
        prerequisites: 'Magery 0',
        notes: `A short note for ${name}.`,
        librarySpellId: null,
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
      },
      12,
      0,
      'normal',
    ),
    ...overrides,
  };
}

function makeCharacter(
  spells: SpellOut[],
  overrides: Partial<CharacterDetail> = {},
): CharacterDetail {
  return {
    id: CHARACTER_ID,
    campaignId: null,
    derived: { hp: 10, fp: 10 },
    combat: null,
    manaLevel: 'normal',
    manaLevelKnown: true,
    traits: [{ name: 'Magery', level: 0 }],
    skills: [],
    effects: [],
    inventory: [],
    spells,
    ...overrides,
  } as unknown as CharacterDetail;
}

function renderPanel(
  character: CharacterDetail,
  canWrite = true,
  anchorSpellId: string | null = null,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(
    <SpellsPanel
      character={character}
      canWrite={canWrite}
      {...(anchorSpellId !== null ? { anchorSpellId } : {})}
    />,
    { wrapper: Wrapper },
  );
}

function editSpell(name = 'Fireball') {
  const button = screen.getAllByRole('button', { name: `Edit ${name}` })[0];
  if (!button) throw new Error(`Edit button missing for ${name}`);
  fireEvent.click(button);
}

function clickOneOfDuplicateActions(name: string) {
  const button = screen.getAllByRole('button', { name })[0];
  if (!button) throw new Error(`Action button missing: ${name}`);
  fireEvent.click(button);
}

beforeEach(() => {
  localStorage.clear();
  enqueueCreateMock.mockReset().mockResolvedValue(undefined);
  enqueueDeleteMock.mockReset().mockResolvedValue(undefined);
  enqueueFieldPatchMock.mockReset().mockResolvedValue(undefined);
});

describe('SpellsPanel reading and table controls', () => {
  it('shows read rows by default and opens a spell reference without entering edit mode', () => {
    const spell = makeSpell(SPELL_ONE, 'Fireball');
    renderPanel(makeCharacter([spell]));
    expect(screen.getByRole('region', { name: 'Spellbook' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Spells' })).toBeVisible();
    expect(screen.getByRole('button', { name: '+ Add spell' })).toBeVisible();
    expect(screen.queryByLabelText('Spell')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Read Fireball' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Read Fireball' }));
    const dialog = screen.getByRole('dialog', { name: 'Spell reference: Fireball' });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText('Casting cost')).toBeVisible();
    expect(within(dialog).getByText('Duration')).toBeVisible();
    expect(screen.queryByLabelText('Fireball name')).not.toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close spell reference' }));
    expect(dialog).not.toBeVisible();
  });

  it('filters by searchable spell details and sorts visible rows by points', () => {
    const spells = [
      makeSpell(SPELL_ONE, 'Cinder Veil', 4),
      makeSpell(SPELL_TWO, 'Ember Step', 1),
      makeSpell(SPELL_ZERO, 'Flame Ward', 2),
    ];
    renderPanel(makeCharacter(spells), false);
    const table = screen.getByRole('table', { name: 'Spells' });
    const search = screen.getByRole('searchbox', { name: 'Search spells' });
    fireEvent.change(search, { target: { value: 'ember' } });
    expect(within(table).getByRole('button', { name: 'Read Ember Step' })).toBeVisible();
    expect(
      within(table).queryByRole('button', { name: 'Read Cinder Veil' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('button', { name: 'Read Flame Ward' }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Points' }));
    const groups = [...table.querySelectorAll('tbody[aria-label]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Ember Step',
      'Flame Ward',
      'Cinder Veil',
    ]);
  });

  it('retains an open notes draft when the spell column filter hides its row', () => {
    renderPanel(
      makeCharacter([makeSpell(SPELL_ONE, 'Fireball'), makeSpell(SPELL_TWO, 'Ice Shield')]),
    );
    editSpell();
    const notes = screen.getByRole('textbox', { name: 'Fireball notes' });
    fireEvent.change(notes, { target: { value: 'Unsaved while filtered' } });

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Spell/ }));
    const filter = screen.getByRole('dialog', { name: 'Filter Spell' });
    fireEvent.click(within(filter).getByLabelText('Ice Shield'));
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(screen.queryByRole('rowgroup', { name: 'Fireball' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Fireball notes' })).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Spell/ }));
    const clearFilter = screen.getByRole('dialog', { name: 'Filter Spell' });
    fireEvent.click(within(clearFilter).getByRole('button', { name: 'Clear column filter' }));
    fireEvent.keyDown(clearFilter, { key: 'Escape' });
    expect(screen.getByRole('rowgroup', { name: 'Fireball' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Fireball notes' })).toHaveValue(
      'Unsaved while filtered',
    );
  });

  it('reveals an anchored spell through an active filter and then allows filtering it normally', () => {
    const spells = [makeSpell(SPELL_ONE, 'Fireball'), makeSpell(SPELL_TWO, 'Ice Shield')];
    renderPanel(makeCharacter(spells), false, SPELL_ONE);
    const table = screen.getByRole('table', { name: 'Spells' });
    const fireball = within(table).getByRole('rowgroup', { name: 'Fireball' });
    expect(fireball).toBeVisible();
    expect(fireball.querySelector('#spell-0193b3c0-f1f0-7000-8000-00000000a202')).toHaveAttribute(
      'aria-current',
      'true',
    );

    const search = screen.getByRole('searchbox', { name: 'Search spells' });
    fireEvent.change(search, { target: { value: 'ice' } });
    expect(fireball).not.toBeVisible();
    expect(within(table).getByRole('rowgroup', { name: 'Ice Shield' })).toBeVisible();
  });

  it('keeps read-only spell names and rolls available without exposing editor mutations', () => {
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]), false);
    expect(screen.getByRole('button', { name: 'Read Fireball' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Roll Fireball' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit Fireball' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add spell' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Fireball' }));
    expect(screen.getByRole('dialog', { name: /Roll Fireball/ })).toBeVisible();
    expect(enqueueCreate).not.toHaveBeenCalled();
    expect(enqueueDelete).not.toHaveBeenCalled();
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
  });

  it('keeps add form closed by default and preserves its unsaved draft across close/reopen', () => {
    renderPanel(makeCharacter([]));
    expect(screen.queryByLabelText('Spell')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '+ Add spell' }));
    const name = screen.getByLabelText('Spell');
    fireEvent.change(name, { target: { value: 'Lantern Light' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close add form' }));
    expect(name).not.toBeVisible();
    expect(enqueueCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '+ Add spell' }));
    expect(screen.getByLabelText('Spell')).toHaveValue('Lantern Light');
  });

  it('creates a custom spell through the outbox without assigning a default', async () => {
    renderPanel(makeCharacter([]));
    fireEvent.click(screen.getByRole('button', { name: '+ Add spell' }));
    fireEvent.change(screen.getByLabelText('Spell'), { target: { value: 'Lantern Light' } });
    fireEvent.change(screen.getByLabelText('College'), { target: { value: 'Light' } });
    fireEvent.change(screen.getByLabelText('Pts'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_spell',
          characterId: CHARACTER_ID,
          attemptedValue: expect.objectContaining({
            name: 'Lantern Light',
            college: 'Light',
            points: 2,
            baseEnergyCost: 1,
            characterId: CHARACTER_ID,
          }),
        }),
      ),
    );
  });

  it.each([
    { field: 'Pts', value: '0', issue: /points/ },
    { field: 'Cost', value: '-1', issue: /baseEnergyCost/ },
  ])(
    'keeps invalid $field input visible and reports its validation error',
    ({ field, value, issue }) => {
      renderPanel(makeCharacter([]));
      fireEvent.click(screen.getByRole('button', { name: '+ Add spell' }));
      fireEvent.change(screen.getByLabelText('Spell'), { target: { value: 'Invalid Spell' } });
      const input = screen.getByLabelText(field);
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

      expect(input).toHaveValue(value);
      expect(enqueueCreate).not.toHaveBeenCalled();
      expect(screen.getByText(/Couldn't add spell/)).toHaveTextContent(issue);
      expect(screen.getByLabelText('Spell').closest('form')).toHaveAttribute(
        'data-flashing',
        'true',
      );
    },
  );
});

describe('SpellsPanel row drafts', () => {
  it('retains row drafts when editing is closed and reopened, and commits a successful field patch', async () => {
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]));
    editSpell();
    const name = screen.getByLabelText('Fireball name');
    expect(name).toBeVisible();
    fireEvent.change(name, { target: { value: 'Flame Burst' } });
    clickOneOfDuplicateActions('Done editing Fireball');
    expect(name).not.toBeVisible();
    editSpell();
    expect(screen.getByLabelText('Fireball name')).toHaveValue('Flame Burst');

    const cost = screen.getByLabelText('Fireball base cost');
    fireEvent.change(cost, { target: { value: '4' } });
    fireEvent.blur(cost);
    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_spell',
          entityId: SPELL_ONE,
          fieldPath: 'baseEnergyCost',
          attemptedValue: 4,
          characterId: CHARACTER_ID,
        }),
      ),
    );
    expect(cost).toHaveValue('4');
  });

  it('reports and flashes a rejected field save while restoring its previous value', async () => {
    enqueueFieldPatchMock.mockRejectedValue(new Error('server rejected cost'));
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]));
    editSpell();
    const cost = screen.getByLabelText('Fireball base cost');
    fireEvent.change(cost, { target: { value: '4' } });
    fireEvent.blur(cost);

    await waitFor(() => expect(cost).toHaveValue('3'));
    await waitFor(() => expect(cost).toHaveAttribute('data-flashing', 'true'));
    expect(
      screen.getByText(/Couldn't save Fireball base cost — server rejected cost/),
    ).toBeVisible();
  });

  it('saves spell notes, retains them while filtered out, and flashes the summary with a visible rejection toast', async () => {
    renderPanel(
      makeCharacter([makeSpell(SPELL_ONE, 'Fireball'), makeSpell(SPELL_TWO, 'Ice Shield')]),
    );
    editSpell();
    const notes = screen.getByRole('textbox', { name: 'Fireball notes' });
    fireEvent.change(notes, { target: { value: 'Revised **description**' } });
    fireEvent.blur(notes);
    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: SPELL_ONE,
          fieldPath: 'notes',
          attemptedValue: 'Revised **description**',
        }),
      ),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search spells' }), {
      target: { value: 'ice' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search spells' }), {
      target: { value: '' },
    });
    expect(screen.getByRole('textbox', { name: 'Fireball notes' })).toHaveValue(
      'Revised **description**',
    );

    enqueueFieldPatchMock.mockRejectedValueOnce(new Error('network unavailable'));
    fireEvent.change(notes, { target: { value: 'Rejected description' } });
    fireEvent.blur(notes);
    clickOneOfDuplicateActions('Done editing Fireball');
    await waitFor(() =>
      expect(screen.getByRole('rowgroup', { name: 'Fireball' }).firstElementChild).toHaveAttribute(
        'data-flashing',
        'true',
      ),
    );
    expect(screen.getByText(/Couldn't save Fireball notes — network unavailable/)).toBeVisible();
    editSpell();
    expect(screen.getByRole('textbox', { name: 'Fireball notes' })).toHaveValue(
      'Revised **description**',
    );
  });

  it('queues same-field notes edits and preserves another field while the first notes save is slow', async () => {
    const attemptedNotes: unknown[] = [];
    let resolveFirstNotes: (() => void) | null = null;
    enqueueFieldPatchMock.mockImplementation(
      (args: { fieldPath: string; attemptedValue: unknown }) => {
        if (args.fieldPath === 'notes') {
          attemptedNotes.push(args.attemptedValue);
          if (attemptedNotes.length === 1) {
            return new Promise<void>((resolve) => {
              resolveFirstNotes = resolve;
            });
          }
        }
        return Promise.resolve();
      },
    );
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]));
    editSpell();
    const notes = screen.getByRole('textbox', { name: 'Fireball notes' });
    fireEvent.change(notes, { target: { value: 'First notes draft' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(attemptedNotes).toEqual(['First notes draft']));

    fireEvent.change(notes, { target: { value: 'Latest notes draft' } });
    fireEvent.blur(notes);
    const points = screen.getByRole('textbox', { name: 'Fireball points' });
    fireEvent.change(points, { target: { value: '4' } });
    fireEvent.blur(points);
    await waitFor(() => expect(enqueueFieldPatchMock).toHaveBeenCalledTimes(2));
    expect(attemptedNotes).toEqual(['First notes draft']);

    await act(async () => resolveFirstNotes?.());
    await waitFor(() =>
      expect(attemptedNotes).toEqual(['First notes draft', 'Latest notes draft']),
    );
    expect(notes).toHaveValue('Latest notes draft');
    expect(points).toHaveValue('4');
  });

  it('keeps a different-field edit when the name save is still in flight', async () => {
    let resolveName: (() => void) | null = null;
    enqueueFieldPatchMock.mockImplementation((args: { fieldPath: string }) => {
      if (args.fieldPath === 'name') {
        return new Promise<void>((resolve) => {
          resolveName = resolve;
        });
      }
      return Promise.resolve();
    });
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]));
    editSpell();
    const name = screen.getByLabelText('Fireball name');
    const points = screen.getByLabelText('Fireball points');
    fireEvent.change(name, { target: { value: 'Flame Burst' } });
    fireEvent.blur(name);
    await waitFor(() => expect(enqueueFieldPatchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(points, { target: { value: '3' } });
    fireEvent.blur(points);
    await waitFor(() => expect(enqueueFieldPatchMock).toHaveBeenCalledTimes(2));
    await act(async () => resolveName?.());
    expect(name).toHaveValue('Flame Burst');
    expect(points).toHaveValue('3');
  });

  it('queues same-field name edits until the slow first save settles', async () => {
    const attempted: unknown[] = [];
    let resolveFirst: (() => void) | null = null;
    enqueueFieldPatchMock.mockImplementation(
      (args: { fieldPath: string; attemptedValue: unknown }) => {
        if (args.fieldPath !== 'name') return Promise.resolve();
        attempted.push(args.attemptedValue);
        if (attempted.length === 1) {
          return new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve();
      },
    );
    renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball')]));
    editSpell();
    const name = screen.getByLabelText('Fireball name');
    fireEvent.change(name, { target: { value: 'Flame Burst' } });
    fireEvent.blur(name);
    await waitFor(() => expect(attempted).toEqual(['Flame Burst']));
    fireEvent.change(name, { target: { value: 'Meteor' } });
    fireEvent.blur(name);
    expect(attempted).toEqual(['Flame Burst']);
    await act(async () => resolveFirst?.());
    await waitFor(() => expect(attempted).toEqual(['Flame Burst', 'Meteor']));
    expect(name).toHaveValue('Meteor');
  });
});

describe('SpellsPanel casting availability', () => {
  it('keeps Cast unavailable for legacy no-default spells and unknown/no mana', () => {
    const zeroPoint = makeSpell(SPELL_ZERO, 'Unlearned', 0, 1, null, { level: null });
    const normal = renderPanel(makeCharacter([makeSpell(SPELL_ONE, 'Fireball'), zeroPoint]));
    expect(screen.getAllByRole('button', { name: 'Cast Unlearned' })[0]).toBeDisabled();
    normal.unmount();

    renderPanel(
      makeCharacter([makeSpell(SPELL_ONE, 'Fireball')], {
        manaLevel: 'none',
      }),
    );
    expect(screen.getAllByRole('button', { name: 'Cast Fireball' })[0]).toBeDisabled();
    expect(screen.getByText(/no-mana zone/)).toBeVisible();
  });
});
