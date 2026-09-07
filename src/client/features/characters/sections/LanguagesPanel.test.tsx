/**
 * LanguagesPanel — S11 coverage for the new `character_language` draft
 * inputs (name, spoken/written fluency selects, points):
 *
 *   1. save success: the value sticks and the right outbox op is queued
 *   2. server rejection: rollback to the server value + toast + flash
 *   3. a slow save on one field does not clobber a parallel edit on a
 *      *different* field of the same row
 *   4. a same-field follow-up commit queues and fires after the
 *      in-flight save settles, with the user's later value winning
 *   5. add + delete route through enqueueCreate / enqueueDelete
 *
 * The outbox module is mocked so these tests exercise the panel + draft
 * plumbing without standing up Dexie; the Dexie-level cursor-vs-pending
 * case (S11's fifth bullet) is covered in orchestrator/outbox tests.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { LanguageOut } from '../../../../shared/schemas/language.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { LanguagesPanel } from './LanguagesPanel.tsx';

const enqueueFieldPatch = vi.hoisted(() => vi.fn());
const enqueueCreate = vi.hoisted(() => vi.fn());
const enqueueDelete = vi.hoisted(() => vi.fn());
const newClientId = vi.hoisted(() => vi.fn(() => 'new-language-id'));

vi.mock('../../../sync/outbox.ts', () => ({
  enqueueFieldPatch,
  enqueueCreate,
  enqueueDelete,
  newClientId,
}));

// Deterministic library fixtures + a mocked LibraryAutocomplete so the
// panel's library-pick logic (id + race preservation) is tested without
// the real combobox's debounced network fetch.
const pickCathrian = vi.hoisted(() => ({
  id: 'lib-lang-cathrian',
  name: 'Cathrian',
  description: null,
  source: null,
  isSignLanguage: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}));
const pickLatin = vi.hoisted(() => ({
  id: 'lib-lang-latin',
  name: 'Latin',
  description: null,
  source: null,
  isSignLanguage: false,
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
      <button type="button" onClick={() => onPick(pickCathrian)}>
        Pick Cathrian
      </button>
      <button type="button" onClick={() => onPick(pickLatin)}>
        Pick Latin
      </button>
    </div>
  ),
}));

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000f001';
const LANG_ID = '0193b3c0-f1f0-7000-8000-00000000f002';

function makeLanguage(overrides: Partial<LanguageOut> = {}): LanguageOut {
  return {
    id: LANG_ID,
    characterId: CHAR_ID,
    name: 'Latin',
    spokenFluency: 'broken',
    writtenFluency: 'none',
    points: 1,
    notes: null,
    libraryLanguageId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharacter(languages: LanguageOut[]): CharacterDetail {
  return { id: CHAR_ID, campaignId: null, languages } as unknown as CharacterDetail;
}

function renderPanel(character: CharacterDetail, canWrite = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<LanguagesPanel character={character} canWrite={canWrite} />, { wrapper: Wrapper });
}

beforeEach(() => {
  enqueueFieldPatch.mockReset();
  enqueueCreate.mockReset();
  enqueueDelete.mockReset();
  enqueueFieldPatch.mockResolvedValue(undefined);
  enqueueCreate.mockResolvedValue(undefined);
  enqueueDelete.mockResolvedValue(undefined);
});

describe('LanguagesPanel rendering', () => {
  it('lists a language with its fluency labels and point total', () => {
    renderPanel(makeCharacter([makeLanguage({ points: 3 })]), false);
    expect(screen.getByText('Latin')).toBeInTheDocument();
    expect(screen.getByText('Broken')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    // Both the row's points cell and the header total read "3".
    expect(screen.getAllByText('3')).toHaveLength(2);
  });

  it('hides the add form and every editor for a read-only viewer', () => {
    renderPanel(makeCharacter([makeLanguage()]), false);
    expect(screen.queryByLabelText('Latin name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Latin spoken fluency')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete language Latin' })).not.toBeInTheDocument();
  });

  it('renders an empty state when the character has no languages', () => {
    renderPanel(makeCharacter([]));
    expect(screen.getByText('No languages yet.')).toBeInTheDocument();
  });
});

describe('LanguagesPanel fluency select', () => {
  it('save success: patches the fluency field through the outbox', async () => {
    renderPanel(makeCharacter([makeLanguage()]));
    const select = screen.getByLabelText('Latin spoken fluency') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'accented' } });

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_language',
          entityId: LANG_ID,
          fieldPath: 'spokenFluency',
          attemptedValue: 'accented',
          characterId: CHAR_ID,
          flashKey: `character_language:${LANG_ID}:spokenFluency`,
        }),
      ),
    );
    expect(select.value).toBe('accented');
  });

  it('server rejection: rolls back to the server value, toasts, and flashes', async () => {
    enqueueFieldPatch.mockRejectedValue(new Error('unknown fluency level'));
    renderPanel(makeCharacter([makeLanguage()]));
    const select = screen.getByLabelText('Latin spoken fluency') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'native' } });

    await waitFor(() => expect(select.value).toBe('broken'));
    await waitFor(() => expect(select.dataset.flashing).toBe('true'));
    expect(
      screen.getByText(/Couldn't save Latin spoken fluency — unknown fluency level/),
    ).toBeInTheDocument();
  });

  it('a slow spoken-fluency save does not clobber a parallel written-fluency edit', async () => {
    let resolveSpoken: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string }) => {
      if (args.fieldPath === 'spokenFluency') {
        return new Promise<void>((res) => {
          resolveSpoken = res;
        });
      }
      return Promise.resolve();
    });

    renderPanel(makeCharacter([makeLanguage()]));
    const spoken = screen.getByLabelText('Latin spoken fluency') as HTMLSelectElement;
    const written = screen.getByLabelText('Latin written fluency') as HTMLSelectElement;

    fireEvent.change(spoken, { target: { value: 'accented' } });
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(1));

    fireEvent.change(written, { target: { value: 'broken' } });
    await waitFor(() => expect(enqueueFieldPatch).toHaveBeenCalledTimes(2));
    expect(written.value).toBe('broken');

    await act(async () => {
      resolveSpoken?.();
    });
    // The slow save settling must not reset the other field.
    expect(written.value).toBe('broken');
    expect(spoken.value).toBe('accented');
  });

  it('a same-field follow-up queues and fires after the first save settles (latest wins)', async () => {
    const attempted: unknown[] = [];
    let resolveFirst: (() => void) | null = null;
    enqueueFieldPatch.mockImplementation((args: { fieldPath: string; attemptedValue: unknown }) => {
      if (args.fieldPath !== 'spokenFluency') return Promise.resolve();
      attempted.push(args.attemptedValue);
      if (attempted.length === 1) {
        return new Promise<void>((res) => {
          resolveFirst = res;
        });
      }
      return Promise.resolve();
    });

    renderPanel(makeCharacter([makeLanguage()]));
    const spoken = screen.getByLabelText('Latin spoken fluency') as HTMLSelectElement;

    fireEvent.change(spoken, { target: { value: 'accented' } });
    await waitFor(() => expect(attempted).toEqual(['accented']));

    fireEvent.change(spoken, { target: { value: 'native' } });
    // Still in flight — the second commit queues rather than racing.
    expect(attempted).toEqual(['accented']);

    await act(async () => {
      resolveFirst?.();
    });

    await waitFor(() => expect(attempted).toEqual(['accented', 'native']));
    await waitFor(() => expect(spoken.value).toBe('native'));
  });
});

describe('LanguagesPanel points and name', () => {
  it('commits a points edit on blur', async () => {
    renderPanel(makeCharacter([makeLanguage()]));
    const points = screen.getByLabelText('Latin points') as HTMLInputElement;

    fireEvent.change(points, { target: { value: '4' } });
    fireEvent.blur(points);

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({ fieldPath: 'points', attemptedValue: 4 }),
      ),
    );
  });

  it('rejects a non-integer points value locally with a toast and rollback', async () => {
    renderPanel(makeCharacter([makeLanguage()]));
    const points = screen.getByLabelText('Latin points') as HTMLInputElement;

    fireEvent.change(points, { target: { value: 'many' } });
    fireEvent.blur(points);

    await waitFor(() => expect(points.value).toBe('1'));
    expect(enqueueFieldPatch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Couldn't save Latin points — non-negative integer only/),
    ).toBeInTheDocument();
  });

  it('commits a name edit on blur', async () => {
    renderPanel(makeCharacter([makeLanguage()]));
    const name = screen.getByLabelText('Latin name') as HTMLInputElement;

    fireEvent.change(name, { target: { value: 'Vulgar Latin' } });
    fireEvent.blur(name);

    await waitFor(() =>
      expect(enqueueFieldPatch).toHaveBeenCalledWith(
        expect.objectContaining({ fieldPath: 'name', attemptedValue: 'Vulgar Latin' }),
      ),
    );
  });
});

describe('LanguagesPanel add form', () => {
  it('seeds points from the fluency pair and enqueues a create', async () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;
    const spoken = screen.getByLabelText('Spoken') as HTMLSelectElement;
    const written = screen.getByLabelText('Written') as HTMLSelectElement;

    // Defaults are native/native — a mother tongue, which the auto-cost
    // suggests at the written-native cost of 3.
    fireEvent.change(spoken, { target: { value: 'accented' } });
    fireEvent.change(written, { target: { value: 'broken' } });
    const points = screen.getByLabelText('Pts') as HTMLInputElement;
    expect(points.value).toBe('3'); // accented spoken (2) + broken written (1)

    fireEvent.change(name, { target: { value: '  Latin  ' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          entityClass: 'character_language',
          attemptedValue: expect.objectContaining({
            name: 'Latin',
            spokenFluency: 'accented',
            writtenFluency: 'broken',
            points: 3,
            characterId: CHAR_ID,
          }),
        }),
      ),
    );
    await waitFor(() => expect(name.value).toBe(''));
  });

  it('an explicit points override wins over the fluency-derived suggestion', async () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;
    const points = screen.getByLabelText('Pts') as HTMLInputElement;

    fireEvent.change(name, { target: { value: 'Mother Tongue' } });
    fireEvent.change(points, { target: { value: '0' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(enqueueCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedValue: expect.objectContaining({ name: 'Mother Tongue', points: 0 }),
        }),
      ),
    );
  });

  it('does not submit an empty name', () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    expect(enqueueCreate).not.toHaveBeenCalled();
  });

  it('keeps a name typed during an in-flight create instead of clearing it', async () => {
    let resolveCreate: (() => void) | null = null;
    enqueueCreate.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCreate = res;
        }),
    );
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;

    fireEvent.change(name, { target: { value: 'Latin' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(1));

    // User keeps typing while the create is in flight.
    fireEvent.change(name, { target: { value: 'Greek' } });
    await act(async () => {
      resolveCreate?.();
    });
    expect(name.value).toBe('Greek');
  });

  it('blocks an invalid points draft instead of silently using the suggestion', () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;
    const points = screen.getByLabelText('Pts') as HTMLInputElement;

    for (const bad of ['-2', '1.5', 'abc']) {
      fireEvent.change(points, { target: { value: bad } });
    }
    expect(points.value).toBe('abc');
    fireEvent.change(name, { target: { value: 'Elvish' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);

    // Never enqueued, the typed value stays in the box, and the error is shown.
    expect(enqueueCreate).not.toHaveBeenCalled();
    expect(screen.getByText('Points must be an integer between 0 and 100')).toBeInTheDocument();
    expect(points.value).toBe('abc');

    // Correcting the value and re-submitting clears the error and works.
    fireEvent.change(points, { target: { value: '4' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    expect(
      screen.queryByText('Points must be an integer between 0 and 100'),
    ).not.toBeInTheDocument();
    expect(enqueueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedValue: expect.objectContaining({ name: 'Elvish', points: 4 }),
      }),
    );
  });

  it('an empty points box falls back to the fluency-derived suggestion', () => {
    renderPanel(makeCharacter([]));
    const name = screen.getByLabelText('Language') as HTMLInputElement;
    const spoken = screen.getByLabelText('Spoken') as HTMLSelectElement;
    const written = screen.getByLabelText('Written') as HTMLSelectElement;
    fireEvent.change(spoken, { target: { value: 'accented' } });
    fireEvent.change(written, { target: { value: 'none' } });

    const points = screen.getByLabelText('Pts') as HTMLInputElement;
    fireEvent.change(points, { target: { value: '' } });
    expect(points.value).toBe('2'); // accented spoken only

    fireEvent.change(name, { target: { value: 'Elvish' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    expect(enqueueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptedValue: expect.objectContaining({ name: 'Elvish', points: 2 }),
      }),
    );
  });
});

describe('LanguagesPanel library picks', () => {
  it('a library pick made during an in-flight create keeps the newer link', async () => {
    let resolveCreate: (() => void) | null = null;
    enqueueCreate.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveCreate = res;
        }),
    );
    // campaignId present ⇨ the autocomplete branch renders (mocked).
    renderPanel({
      id: CHAR_ID,
      campaignId: 'camp-1',
      languages: [],
    } as unknown as CharacterDetail);
    const name = screen.getByLabelText('Language') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Pick Cathrian' }));
    expect(name.value).toBe('Cathrian');

    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(1));
    expect(
      (enqueueCreate.mock.calls[0]?.[0] as { attemptedValue: { libraryLanguageId: string } })
        .attemptedValue.libraryLanguageId,
    ).toBe('lib-lang-cathrian');

    // Pick a different library language while the create is still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Pick Latin' }));
    expect(name.value).toBe('Latin');

    await act(async () => {
      resolveCreate?.();
    });

    // The visible pick (Latin) survives the first create settling.
    expect(name.value).toBe('Latin');

    // Submitting again now uses the preserved newer library link.
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    await waitFor(() => expect(enqueueCreate).toHaveBeenCalledTimes(2));
    expect(
      (enqueueCreate.mock.calls[1]?.[0] as { attemptedValue: { libraryLanguageId: string } })
        .attemptedValue.libraryLanguageId,
    ).toBe('lib-lang-latin');
  });
});

describe('LanguagesPanel delete', () => {
  it('enqueues a delete carrying the row snapshot for rollback', async () => {
    const language = makeLanguage();
    renderPanel(makeCharacter([language]));

    fireEvent.click(screen.getByRole('button', { name: 'Delete language Latin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(enqueueDelete).toHaveBeenCalledWith({
        entityClass: 'character_language',
        entityId: LANG_ID,
        humanName: 'language "Latin"',
        characterId: CHAR_ID,
        prevValue: language,
      }),
    );
  });

  it('toasts when the delete enqueue itself fails', async () => {
    enqueueDelete.mockRejectedValue(new Error('db closed'));
    renderPanel(makeCharacter([makeLanguage()]));

    fireEvent.click(screen.getByRole('button', { name: 'Delete language Latin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.getByText(/Couldn't delete language — db closed/)).toBeInTheDocument(),
    );
  });
});
