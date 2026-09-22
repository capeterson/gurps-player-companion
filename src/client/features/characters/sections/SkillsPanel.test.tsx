/**
 * SkillsPanel — the "Lvl" cell as a tappable roll target.
 *
 * A computed level opens the shared roll sheet at that target
 * (rolls mutate nothing, so this works identically for read-only
 * viewers); a null level (untrained without an available declared default)
 * stays plain, non-interactive text.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySkillOut } from '../../../../shared/schemas/campaignLibrary.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SkillOut } from '../../../../shared/schemas/skill.ts';
import { skillCreate } from '../../../../shared/schemas/skill.ts';
import { getLocalDb, resetLocalDb } from '../../../db/dexie.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { flashBus } from '../../../sync/flashBus.ts';
import { SkillsPanel } from './SkillsPanel.tsx';

const enqueueCreate = vi.hoisted(() => vi.fn());
const enqueueFieldPatch = vi.hoisted(() => vi.fn());
vi.mock('../../../sync/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sync/outbox.ts')>()),
  enqueueCreate,
  enqueueFieldPatch,
}));
const picks = vi.hoisted(() =>
  ['Pistol', 'Rifle'].map((specialty, index) => ({
    id: `0193b3c0-f1f0-7000-8000-00000000f00${index}`,
    name: 'Guns',
    campaignId: '0193b3c0-f1f0-7000-8000-00000000c002',
    attribute: 'DX',
    difficulty: 'E',
    defaultSpecialization: specialty,
    specializationPolicy: {
      kind: 'required_catalog' as const,
      options:
        specialty === 'Pistol'
          ? [
              { name: 'Pistol' },
              {
                name: 'Revolver',
                description: 'Revolver training',
                prerequisites: 'Revolver permit',
                defaults: [{ kind: 'attribute' as const, attribute: 'DX' as const, modifier: -5 }],
              },
            ]
          : [{ name: specialty }],
    },
    techLevel: 8 + index,
    description: `${specialty} training`,
    source: 'B198',
    prerequisites: 'Training',
    effects: [{ target: 'dx' as const, value: 1, scaling: 'flat' as const }],
    defaults: [{ kind: 'attribute' as const, attribute: 'DX' as const, modifier: -4 }],
  })),
);
vi.mock('./useLibraryFetcher.ts', () => ({
  useLibraryFetcher: () => ({ fetchOptions: async () => [], isLoading: false }),
}));
vi.mock('../../../components/ui/LibraryAutocomplete.tsx', () => ({
  LibraryAutocomplete: ({
    value,
    onChange,
    onPick,
    inputProps,
  }: {
    value: string;
    onChange: (value: string) => void;
    onPick: (value: unknown) => void;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
  }) => (
    <div>
      <input value={value} onChange={(event) => onChange(event.target.value)} {...inputProps} />
      {picks.map((pick) => (
        <button key={pick.id} type="button" onClick={() => onPick(pick)}>
          Pick {pick.defaultSpecialization}
        </button>
      ))}
    </div>
  ),
}));
beforeEach(() => {
  localStorage.clear();
  enqueueCreate.mockReset();
  enqueueCreate.mockResolvedValue(undefined);
  enqueueFieldPatch.mockReset();
  enqueueFieldPatch.mockResolvedValue(undefined);
});

function makeSkill(overrides: Partial<SkillOut> = {}): SkillOut {
  const base: SkillOut = {
    id: 'skill-1',
    characterId: 'char-1',
    name: 'Broadsword',
    attribute: 'DX',
    difficulty: 'A',
    points: 8,
    techLevel: null,
    specialization: null,
    notes: null,
    librarySkillId: null,
    level: 14,
    effectiveLevel: 14,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
  // Mirror the server: effectiveLevel tracks level's null-ness by default
  // (no trait bonuses to apply against a missing attribute default).
  // Callers can still pass effectiveLevel explicitly to override.
  if (overrides.effectiveLevel === undefined && 'level' in overrides) {
    base.effectiveLevel = overrides.level ?? null;
  }
  return base;
}

function makeCharacter(skills: SkillOut[]): CharacterDetail {
  return {
    id: 'char-1',
    campaignId: null,
    skills,
  } as unknown as CharacterDetail;
}

function renderPanel(
  character: CharacterDetail,
  canWrite = false,
  openAdd = canWrite && character.skills.length === 0,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const view = render(<SkillsPanel character={character} canWrite={canWrite} />, {
    wrapper: Wrapper,
  });
  if (openAdd) fireEvent.click(screen.getByRole('button', { name: '+ Add skill' }));
  return view;
}

describe('SkillsPanel', () => {
  it('allows a custom skill after a picked character becomes campaignless', async () => {
    const view = renderPanel(
      { ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' },
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    view.rerender(<SkillsPanel character={makeCharacter([])} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/Couldn't add skill.*Campaign changed/);
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
    expect(enqueueCreate.mock.calls[0]?.[0]).toMatchObject({
      attemptedValue: {
        name: 'Custom',
        librarySkillId: null,
        defaults: null,
        specialization: null,
        notes: null,
      },
      localLibraryMechanics: null,
    });
  });
  it('rejects a previous campaign pick without discarding the draft', async () => {
    const view = renderPanel(
      { ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' },
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    view.rerender(
      <SkillsPanel character={{ ...makeCharacter([]), campaignId: 'other-campaign' }} canWrite />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/Couldn't add skill.*Campaign changed/);
    expect(enqueueCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Skill')).toHaveValue('Guns');
    expect(screen.getByLabelText('Skill').closest('form')).toHaveAttribute('data-flashing', 'true');
    view.rerender(
      <SkillsPanel
        character={{ ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' }}
        canWrite
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
    expect(enqueueCreate.mock.calls[0]?.[0].localLibraryMechanics.campaignId).toBe(
      '0193b3c0-f1f0-7000-8000-00000000c002',
    );
  });
  it('accepts the combined maximum-length library descriptions without truncation', async () => {
    const original = picks[0];
    if (!original) throw new Error('Missing fixture');
    const long = {
      ...original,
      description: 'D'.repeat(20_000),
      prerequisites: 'P'.repeat(20_000),
      source: 'S'.repeat(40),
    };
    picks[0] = long;
    try {
      renderPanel(
        { ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' },
        true,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
      const body = skillCreate.parse(enqueueCreate.mock.calls[0]?.[0].attemptedValue);
      expect(body.notes).toContain(long.description);
      expect(body.notes).toContain(long.prerequisites);
      expect(body.notes).toContain(long.source);
    } finally {
      picks[0] = original;
    }
  });

  it('durably queues picked metadata and restores it after reopening IndexedDB', async () => {
    await resetLocalDb();
    const actual =
      await vi.importActual<typeof import('../../../sync/outbox.ts')>('../../../sync/outbox.ts');
    enqueueCreate.mockImplementation(actual.enqueueCreate);
    const view = renderPanel(
      { ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' },
      true,
    );
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(screen.getByLabelText('Skill')).toHaveValue(''));
      view.unmount();
      const db = getLocalDb();
      db.close();
      await db.open();
      const [row] = await db.characterSkills.toArray();
      const [op] = await db.outbox.toArray();
      expect(row).toMatchObject({ name: 'Guns', specialization: 'Pistol', techLevel: 8 });
      expect(row?.defaults).toEqual(picks[0]?.defaults);
      expect(op?.attemptedValue).toMatchObject({
        specialization: 'Pistol',
        techLevel: 8,
        defaults: picks[0]?.defaults,
      });
      expect(op?.status).toBe('pending');
    } finally {
      await resetLocalDb();
    }
  });

  it('retains the picked definition on failure and retries with the same metadata', async () => {
    enqueueCreate.mockRejectedValueOnce(new Error('Disk full'));
    renderPanel({ ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/Couldn't add skill.*Disk full/);
    expect(screen.getByLabelText('Skill')).toHaveValue('Guns');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(2));
    expect(enqueueCreate.mock.calls[1]?.[0].attemptedValue).toEqual(
      enqueueCreate.mock.calls[0]?.[0].attemptedValue,
    );
  });

  it('copies specialty, learned TL and explicit descriptive fields from a picked definition', async () => {
    const character = {
      ...makeCharacter([]),
      campaignId: '0193b3c0-f1f0-7000-8000-00000000c002',
      techLevel: 3,
    };
    renderPanel(character, true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
    expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).toEqual({
      characterId: 'char-1',
      name: 'Guns',
      attribute: 'DX',
      difficulty: 'E',
      points: 1,
      specialization: 'Pistol',
      techLevel: 8,
      librarySkillId: picks[0]?.id,
      defaults: picks[0]?.defaults,
      notes: 'Pistol training\n\nSource: B198\n\nPrerequisites: Training',
    });
    expect(enqueueCreate.mock.calls[0]?.[0].humanName).toBe('skill "Guns/Pistol"');
    expect(enqueueCreate.mock.calls[0]?.[0].localLibraryMechanics).toMatchObject({
      sourceId: picks[0]?.id,
      effects: picks[0]?.effects,
      sourceRevision: null,
    });
    expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).not.toHaveProperty('libraryMechanics');
    await waitFor(() => expect(screen.getByLabelText('Skill')).toHaveValue(''));
    act(() =>
      flashBus.emit({ key: 'character_skill:char-1:create', reason: 'Library link rejected' }),
    );
    expect(screen.getByLabelText('Skill').closest('form')).toHaveAttribute('data-flashing', 'true');
  });

  it('copies a selected catalog specialization and its per-specialty overrides', async () => {
    renderPanel({ ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    fireEvent.change(screen.getByLabelText('Specialization'), { target: { value: 'Revolver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
    expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).toMatchObject({
      specialization: 'Revolver',
      defaults: [{ kind: 'attribute', attribute: 'DX', modifier: -5 }],
      notes: 'Revolver training\n\nSource: B198\n\nPrerequisites: Revolver permit',
    });
  });

  it('detaches picked metadata after a manual name change', async () => {
    renderPanel({ ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    fireEvent.change(screen.getByLabelText('Skill'), { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledOnce());
    expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue).toMatchObject({
      name: 'Custom',
      specialization: null,
      techLevel: null,
      librarySkillId: null,
      notes: null,
    });
  });

  it('keeps a newer same-name library pick while a prior add is pending', async () => {
    let finish = () => {};
    enqueueCreate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderPanel({ ...makeCharacter([]), campaignId: '0193b3c0-f1f0-7000-8000-00000000c002' }, true);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Pistol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Rifle' }));
    await act(async () => finish());
    expect(screen.getByLabelText('Skill')).toHaveValue('Guns');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(2));
    expect(enqueueCreate.mock.calls[0]?.[0].attemptedValue.specialization).toBe('Pistol');
    expect(enqueueCreate.mock.calls[1]?.[0].attemptedValue).toMatchObject({
      specialization: 'Rifle',
      techLevel: 9,
      librarySkillId: picks[1]?.id,
    });
  });

  it('shows distinct specialized row and roll/history labels while preserving learned TL', () => {
    const skills = ['Pistol', 'Rifle'].map((specialization) =>
      makeSkill({
        id: specialization,
        name: 'Guns',
        specialization,
        techLevel: 8,
      }),
    );
    renderPanel({ ...makeCharacter(skills), techLevel: 4 });
    expect(screen.getByText('Guns/Pistol / TL8')).toBeInTheDocument();
    expect(screen.getByText('Guns/Rifle / TL8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Guns/Pistol' }));
    expect(screen.getByRole('dialog', { name: 'Roll Guns/Pistol' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    const history = JSON.parse(localStorage.getItem('gurps:rollHistory:char-1') ?? '[]');
    expect(history[0].label).toBe('Guns/Pistol');
  });

  it('edits the base name and specialization in the inline full-width editor', () => {
    renderPanel(
      makeCharacter([
        makeSkill({ name: 'Current Affairs', specialization: 'Popular Culture', techLevel: 8 }),
      ]),
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Current Affairs/Popular Culture' }));
    const name = screen.getByLabelText('Current Affairs/Popular Culture name');
    const specialization = screen.getByLabelText('Current Affairs/Popular Culture specialization');
    expect(name).toHaveValue('Current Affairs');
    expect(specialization).toHaveValue('Popular Culture');
    expect(screen.getByText('Edit Current Affairs/Popular Culture')).toBeInTheDocument();
    expect(screen.getByText('Source & rules')).toBeInTheDocument();
  });

  it('keeps the add form and advanced details collapsed until they are useful', () => {
    renderPanel(makeCharacter([makeSkill()]), true, false);

    expect(screen.queryByLabelText('Skill')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Add skill' }));
    expect(screen.getByLabelText('Skill')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close add form' }));
    expect(screen.queryByLabelText('Skill')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Broadsword' }));
    expect(screen.queryByText('Source & rules')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Broadsword description and notes')).toBeInTheDocument();
  });

  it('sorts from clickable headers and persists custom keyboard ordering', () => {
    renderPanel(
      makeCharacter([
        makeSkill({ id: 'z', name: 'Zephyr', points: 2, level: 11 }),
        makeSkill({ id: 'a', name: 'Acrobatics', points: 8, level: 13 }),
      ]),
    );

    const skillHeading = screen.getByRole('button', { name: 'Sort by Skill' }).closest('th');
    expect(skillHeading).toHaveAttribute('aria-sort', 'ascending');
    const pointsHeading = screen.getByRole('button', { name: 'Sort by Points' }).closest('th');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Points' }));
    expect(pointsHeading).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Points' }));
    expect(pointsHeading).toHaveAttribute('aria-sort', 'descending');

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Zephyr, row 2' }), {
      key: 'ArrowUp',
    });
    expect(screen.getByText('Zephyr moved to position 1.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('gurps:skillTable:char-1') ?? '{}')).toMatchObject({
      order: ['z', 'a'],
      sort: 'custom',
      descending: false,
    });
  });

  it('filters by details without exposing a second browsing column', () => {
    renderPanel(
      makeCharacter([
        makeSkill({ id: 'a', name: 'Broadsword', notes: 'Two-handed fencing' }),
        makeSkill({ id: 'b', name: 'Stealth', notes: 'Move quietly' }),
      ]),
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'quietly' },
    });
    expect(screen.getByText('Stealth')).toBeInTheDocument();
    expect(screen.queryByText('Broadsword')).not.toBeInTheDocument();
  });

  it('shows editing controls only to writers while preserving read-only browsing tools', async () => {
    renderPanel(makeCharacter([makeSkill({ name: 'Stealth', notes: 'Move quietly' })]), false);

    expect(screen.queryByRole('button', { name: '+ Add skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Stealth' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort by Skill' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search skills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder Stealth, row 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Stealth' }));
    expect(await screen.findByText('Move quietly')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete skill' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stealth name')).not.toBeInTheDocument();
  });

  it('saves an inline field and rolls it back with a toast and flash on failure', async () => {
    enqueueFieldPatch.mockRejectedValueOnce(new Error('Disk full'));
    renderPanel(makeCharacter([makeSkill()]), true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Broadsword' }));
    const points = screen.getByLabelText('Broadsword points');
    fireEvent.change(points, { target: { value: '12' } });
    fireEvent.blur(points);

    expect(
      await screen.findByText("Couldn't save Broadsword points — Disk full"),
    ).toBeInTheDocument();
    expect(points).toHaveValue('8');
    expect(points).toHaveAttribute('data-flashing', 'true');
    expect(enqueueFieldPatch).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'points', attemptedValue: 12 }),
    );
  });

  it('queues a newer same-field edit and saves a different field in parallel', async () => {
    let finishFirst = () => {};
    enqueueFieldPatch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    renderPanel(makeCharacter([makeSkill()]), true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Broadsword' }));

    const name = screen.getByLabelText('Broadsword name');
    fireEvent.change(name, { target: { value: 'Longsword' } });
    fireEvent.blur(name);
    fireEvent.change(name, { target: { value: 'Rapier' } });
    fireEvent.blur(name);
    expect(enqueueFieldPatch).toHaveBeenCalledTimes(1);

    const notes = screen.getByLabelText('Broadsword description and notes');
    fireEvent.change(notes, { target: { value: 'A different field' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(2));
    expect(enqueueFieldPatch.mock.calls[1]?.[0]).toMatchObject({
      fieldPath: 'notes',
      attemptedValue: 'A different field',
    });

    await act(async () => finishFirst());
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(3));
    expect(enqueueFieldPatch.mock.calls[2]?.[0]).toMatchObject({
      fieldPath: 'name',
      attemptedValue: 'Rapier',
    });
  });

  it('shows applied skill modifiers from a compact tooltip affordance', () => {
    const character = {
      ...makeCharacter([
        makeSkill({
          name: 'Guns',
          specialization: 'Pistol',
          level: 12,
          effectiveLevel: 14,
        }),
      ]),
      effects: [
        {
          sourceKind: 'trait',
          sourceName: 'Gunslinger Talent',
          sourceId: 'trait-1',
          target: 'skill',
          value: 2,
          skillName: 'Guns',
          skillSpecialty: 'Pistol',
          active: true,
        },
      ],
    } as CharacterDetail;
    renderPanel(character);

    expect(screen.queryByText('Global effects')).not.toBeInTheDocument();
    expect(screen.queryByText('Modifiers')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'View Guns/Pistol modifiers' });
    expect(trigger).toHaveClass('border-warning', 'text-warning');

    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Guns/Pistol modifiers');
    expect(tooltip).toHaveTextContent('Base skill: 12');
    expect(tooltip).toHaveTextContent('+2 Gunslinger Talent');
    expect(tooltip).toHaveTextContent('Final: 14');
  });

  it('renders a roll button for a skill with a computed level that opens the roll sheet at that target', () => {
    const skill = makeSkill({ name: 'Broadsword', level: 14 });
    renderPanel(makeCharacter([skill]));

    const button = screen.getByRole('button', { name: 'Roll Broadsword' });
    fireEvent.click(button);

    expect(screen.getByRole('dialog', { name: 'Roll Broadsword' })).toBeInTheDocument();
    expect(screen.getByLabelText('Effective target 14')).toBeInTheDocument();
  });

  it('does not make a null-level skill cell a button', () => {
    const skill = makeSkill({
      name: 'Thaumatology',
      difficulty: 'VH',
      points: 0,
      level: null,
    });
    renderPanel(makeCharacter([skill]));

    expect(screen.queryByRole('button', { name: 'Roll Thaumatology' })).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('contains long read-only skill names within the skill column', () => {
    const longName = 'PneumonoultramicroscopicsilicovolcanoconiosisUnbreakableSkill';
    renderPanel(makeCharacter([makeSkill({ name: longName })]), false);

    expect(screen.getByText(longName)).toHaveClass('min-w-0', 'break-words');
  });

  it('works for read-only viewers too, since a roll mutates nothing', () => {
    const skill = makeSkill({ name: 'Stealth', level: 12 });
    renderPanel(makeCharacter([skill]), false);

    const button = screen.getByRole('button', { name: 'Roll Stealth' });
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Roll Stealth' })).toBeInTheDocument();
  });
});
