/**
 * TechniquesPanel — S11 coverage for the new `character_technique` draft
 * inputs (name, default-skill binding, difficulty select, points), plus
 * the level display for a technique whose default skill isn't on the
 * sheet.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { TechniqueOut } from '../../../../shared/schemas/technique.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { TechniquesPanel } from './TechniquesPanel.tsx';

const enqueueFieldPatch = vi.hoisted(() => vi.fn());
const enqueueCreate = vi.hoisted(() => vi.fn());
const enqueueDelete = vi.hoisted(() => vi.fn());
const newClientId = vi.hoisted(() => vi.fn(() => 'new-technique-id'));

vi.mock('../../../sync/outbox.ts', () => ({
  enqueueFieldPatch,
  enqueueCreate,
  enqueueDelete,
  newClientId,
}));

// Deterministic library fixtures + a mocked LibraryAutocomplete so the
// panel's library-pick logic (maxLevel carry + race preservation) is
// tested without the real combobox's debounced network fetch.
const pickCounterattack = vi.hoisted(() => ({
  id: 'lib-tech-counterattack',
  name: 'Counterattack',
  defaultSkillName: 'Broadsword',
  difficulty: 'H',
  maxLevel: 4,
  description: null,
  source: null,
  prereq: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}));
const pickFeint = vi.hoisted(() => ({
  id: 'lib-tech-feint',
  name: 'Feint',
  // A distinct default so the post-create reset guard (which clears a
  // field still equal to the submitted snapshot) can't collide with the
  // previous pick.
  defaultSkillName: 'Rapier',
  difficulty: 'A',
  maxLevel: null,
  description: null,
  source: null,
  prereq: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}));

vi.mock('./useLibraryFetcher.ts', () => ({
  useLibraryFetcher: () => ({ fetchOptions: async () => [], isLoading: false }),
}));

vi.mock('../../../components/ui/LibraryAutocomplete.tsx', () => ({
  LibraryAutocomplete: ({
    value,
    onChange,
    onPick,
    placeholder,
    inputProps,
  }: {
    value: string;
    onChange: (v: string) => void;
    onPick: (o: { id: string }) => void;
    placeholder?: string;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
  }) => (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...inputProps}
      />
      <button type="button" onClick={() => onPick(pickCounterattack)}>
        Pick Counterattack
      </button>
      <button type="button" onClick={() => onPick(pickFeint)}>
        Pick Feint
      </button>
    </div>
  ),
}));

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c001';
const TECH_ID = '0193b3c0-f1f0-7000-8000-00000000c002';

function makeTechnique(overrides: Partial<TechniqueOut> = {}): TechniqueOut {
  return {
    id: TECH_ID,
    characterId: CHAR_ID,
    name: 'Feint',
    defaultSkillName: 'Broadsword',
    difficulty: 'A',
    points: 2,
    maxLevel: null,
    notes: null,
    libraryTechniqueId: null,
    defaultSkillLevel: 14,
    level: 16,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharacter(techniques: TechniqueOut[]): CharacterDetail {
  return { id: CHAR_ID, campaignId: null, techniques } as unknown as CharacterDetail;
}

function renderPanel(character: CharacterDetail, canWrite = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<TechniquesPanel character={character} canWrite={canWrite} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  enqueueFieldPatch.mockReset();
  enqueueCreate.mockReset();
  enqueueDelete.mockReset();
  enqueueFieldPatch.mockResolvedValue(undefined);
  enqueueCreate.mockResolvedValue(undefined);
  enqueueDelete.mockResolvedValue(undefined);
});

describe('TechniquesPanel rendering', () => {
  it('shows a resolved level as a tappable roll target', () => {
    renderPanel(makeCharacter([makeTechnique()]), false);
    const button = screen.getByRole('button', { name: 'Roll Feint' });
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Roll Feint' })).toBeInTheDocument();
    expect(screen.getByLabelText('Effective target 16')).toBeInTheDocument();
  });

  it('a technique whose default skill is missing is not rollable', () => {
    renderPanel(makeCharacter([makeTechnique({ level: null, defaultSkillLevel: null })]), false);
    expect(screen.queryByRole('button', { name: 'Roll Feint' })).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders an empty state when the character has no techniques', () => {
    renderPanel(makeCharacter([]));
    expect(screen.getByText('No techniques yet.')).toBeInTheDocument();
  });

  it('hides every editor for a read-only viewer', () => {
    renderPanel(makeCharacter([makeTechnique()]), false);
    expect(screen.queryByLabelText('Feint name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Feint difficulty')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete technique Feint' }),
    ).not.toBeInTheDocument();
  });
});

describe('TechniquesPanel row editing', () => {
  it('patches the default-skill binding through its own fieldPath, not `name`', async () => {
    renderPanel(makeCharacter([makeTechnique()]));
    const input = screen.getByLabelText('Feint default skill') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Rapier' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_technique',
          entityId: TECH_ID,
          fieldPath: 'defaultSkillName',
          attemptedValue: 'Rapier',
          flashKey: `character_technique:${TECH_ID}:defaultSkillName`,
        }),
      ),
    );
  });

  it('rejects an empty default skill locally with a toast and rollback', async () => {
    renderPanel(makeCharacter([makeTechnique()]));
    const input = screen.getByLabelText('Feint default skill') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe('Broadsword'));
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Couldn't save Feint default skill — default skill cannot be empty/),
    ).toBeInTheDocument();
  });

  it('patches the difficulty select on change', async () => {
    renderPanel(makeCharacter([makeTechnique()]));
    const select = screen.getByLabelText('Feint difficulty') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'H' } });

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({ fieldPath: 'difficulty', attemptedValue: 'H' }),
      ),
    );
    expect(select.value).toBe('H');
  });

  it('server rejection on the difficulty select rolls back, toasts, and flashes', async () => {
    enqueueFieldPatch.mockRejectedValue(new Error('field not writable'));
    renderPanel(makeCharacter([makeTechnique()]));
    const select = screen.getByLabelText('Feint difficulty') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'H' } });

    await waitFor(() => expect(select.value).toBe('A'));
    await waitFor(() => expect(select.dataset.flashing).toBe('true'));
    expect(
      screen.getByText(/Couldn't save Feint difficulty — field not writable/),
    ).toBeInTheDocument();
  });

  it('a slow points save does not clobber a parallel default-skill edit', async () => {
    let resolvePoints: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string }) => {
      if (args.fieldPath === 'points') {
        return new Promise<void>((res) => {
          resolvePoints = res;
        });
      }
      return Promise.resolve();
    });

    renderPanel(makeCharacter([makeTechnique()]));
    const points = screen.getByLabelText('Feint points') as HTMLInputElement;
    const skill = screen.getByLabelText('Feint default skill') as HTMLInputElement;

    fireEvent.change(points, { target: { value: '5' } });
    fireEvent.blur(points);
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(1));

    fireEvent.change(skill, { target: { value: 'Rapier' } });
    fireEvent.blur(skill);
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(2));
    expect(skill.value).toBe('Rapier');

    await act(async () => {
      resolvePoints?.();
    });
    expect(skill.value).toBe('Rapier');
    expect(points.value).toBe('5');
  });

  it('a same-field points follow-up queues and fires after the first settles', async () => {
    const attempted: unknown[] = [];
    let resolveFirst: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string; attemptedValue: unknown }) => {
      if (args.fieldPath !== 'points') return Promise.resolve();
      attempted.push(args.attemptedValue);
      if (attempted.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve();
    });

    renderPanel(makeCharacter([makeTechnique()]));
    const points = screen.getByLabelText('Feint points') as HTMLInputElement;

    fireEvent.change(points, { target: { value: '3' } });
    fireEvent.blur(points);
    await waitFor(() => expect(attempted).toEqual([3]));

    fireEvent.change(points, { target: { value: '4' } });
    fireEvent.blur(points);
    expect(attempted).toEqual([3]);

    await act(async () => {
      resolveFirst?.();
    });
    await waitFor(() => expect(attempted).toEqual([3, 4]));
    await waitFor(() => expect(points.value).toBe('4'));
  });
});

describe('TechniquesPanel add form', () => {
  it('enqueues a create with the default skill and difficulty', async () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Technique') as HTMLInputElement;
    const skill = screen.getByLabelText('Defaults from') as HTMLInputElement;
    const difficulty = screen.getByLabelText('Diff') as HTMLSelectElement;

    fireEvent.change(name, { target: { value: 'Disarming' } });
    fireEvent.change(skill, { target: { value: 'Broadsword' } });
    fireEvent.change(difficulty, { target: { value: 'H' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_technique',
          attemptedValue: expect.objectContaining({
            name: 'Disarming',
            defaultSkillName: 'Broadsword',
            difficulty: 'H',
            points: 1,
            characterId: CHAR_ID,
          }),
        }),
      ),
    );
    await waitFor(() => expect(name.value).toBe(''));
    await waitFor(() => expect(skill.value).toBe(''));
  });

  it('does not submit without both a name and a default skill', () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Technique') as HTMLInputElement;
    const form = name.closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(enqueueCreate).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: 'Feint' } });
    fireEvent.submit(form);
    expect(enqueueCreate).not.toHaveBeenCalled();
  });

  it('blocks an invalid points draft instead of silently substituting 1', () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Technique') as HTMLInputElement;
    const skill = screen.getByLabelText('Defaults from') as HTMLInputElement;
    const points = screen.getByLabelText('Pts') as HTMLInputElement;

    fireEvent.change(name, { target: { value: 'Disarming' } });
    fireEvent.change(skill, { target: { value: 'Broadsword' } });
    for (const bad of ['-1', '2.5', 'xyz']) {
      fireEvent.change(points, { target: { value: bad } });
    }
    fireEvent.submit(name.closest('form') as HTMLFormElement);

    expect(enqueueCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Points must be an integer between 0 and 100')).toBeInTheDocument();
    expect(points.value).toBe('xyz');

    fireEvent.change(points, { target: { value: '3' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    expect(enqueueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedValue: expect.objectContaining({ name: 'Disarming', points: 3 }),
      }),
    );
  });
});

describe('TechniquesPanel library picks', () => {
  it('carries a picked library technique maxLevel onto the create payload', async () => {
    renderPanel({
      id: CHAR_ID,
      campaignId: 'camp-1',
      techniques: [],
    } as unknown as CharacterDetail);
    const name = screen.getByLabelText('Technique') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Pick Counterattack' }));
    expect(name.value).toBe('Counterattack');
    expect((screen.getByLabelText('Defaults from') as HTMLInputElement).value).toBe('Broadsword');
    expect((screen.getByLabelText('Diff') as HTMLSelectElement).value).toBe('H');

    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedValue: expect.objectContaining({
            name: 'Counterattack',
            defaultSkillName: 'Broadsword',
            difficulty: 'H',
            maxLevel: 4,
            libraryTechniqueId: 'lib-tech-counterattack',
            characterId: CHAR_ID,
          }),
        }),
      ),
    );
  });

  it('keeps a library pick made during an in-flight create (including its cap)', async () => {
    let resolveFirst: (() => void) | null = null;
    const attempted: Array<Record<string, unknown>> = [];
    enqueueCreate.mockImplementation((args: { attemptedValue: Record<string, unknown> }) => {
      attempted.push(args.attemptedValue);
      if (attempted.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve();
    });

    renderPanel({
      id: CHAR_ID,
      campaignId: 'camp-1',
      techniques: [],
    } as unknown as CharacterDetail);
    const name = screen.getByLabelText('Technique') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Pick Counterattack' }));
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() => expect(attempted).toHaveLength(1));
    expect(attempted[0]?.libraryTechniqueId).toBe('lib-tech-counterattack');
    expect(attempted[0]?.maxLevel).toBe(4);

    // Pick a different technique while the first create is in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Pick Feint' }));
    expect(name.value).toBe('Feint');

    await act(async () => {
      resolveFirst?.();
    });
    expect(name.value).toBe('Feint');

    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() => expect(attempted).toHaveLength(2));
    // The newer pick's (uncapped) link survives — and no stale cap leaks.
    expect(attempted[1]?.libraryTechniqueId).toBe('lib-tech-feint');
    expect(attempted[1]?.maxLevel).toBeUndefined();
  });
});

describe('TechniquesPanel delete', () => {
  it('enqueues a delete carrying the row snapshot for rollback', async () => {
    const technique = makeTechnique();
    renderPanel(makeCharacter([technique]));

    fireEvent.click(screen.getByRole('button', { name: 'Delete technique Feint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(enqueueDelete).toHaveBeenCalledWith({
        entityClass: 'character_technique',
        entityId: TECH_ID,
        humanName: 'technique "Feint"',
        characterId: CHAR_ID,
        prevValue: technique,
      }),
    );
  });
});
