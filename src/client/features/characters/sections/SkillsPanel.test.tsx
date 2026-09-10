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
vi.mock('../../../sync/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sync/outbox.ts')>()),
  enqueueCreate,
}));
const picks = vi.hoisted(() =>
  ['Pistol', 'Rifle'].map((specialty, index) => ({
    id: `0193b3c0-f1f0-7000-8000-00000000f00${index}`,
    name: 'Guns',
    attribute: 'DX',
    difficulty: 'E',
    defaultSpecialization: specialty,
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
  enqueueCreate.mockReset();
  enqueueCreate.mockResolvedValue(undefined);
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

function renderPanel(character: CharacterDetail, canWrite = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<SkillsPanel character={character} canWrite={canWrite} />, { wrapper: Wrapper });
}

describe('SkillsPanel', () => {
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
    expect(enqueueCreate.mock.calls[0]?.[0].humanName).toBe('skill "Guns (Pistol)"');
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
    expect(screen.getByText('Guns (Pistol) / TL8')).toBeInTheDocument();
    expect(screen.getByText('Guns (Rifle) / TL8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll Guns (Pistol)' }));
    expect(screen.getByRole('dialog', { name: 'Roll Guns (Pistol)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    const history = JSON.parse(localStorage.getItem('gurps:rollHistory:char-1') ?? '[]');
    expect(history[0].label).toBe('Guns (Pistol)');
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
