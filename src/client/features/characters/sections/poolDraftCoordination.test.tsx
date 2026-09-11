import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { useDraftField } from '../../../hooks/useDraftField.ts';
import { useCombatPatch } from './useCombatPatch.ts';
import { usePoolBumpers } from './usePoolBumpers.ts';

const ID = '0193b3c0-f1f0-7000-8000-00000000b0b2';
const toastPush = vi.fn();
vi.mock('../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: toastPush }) }));

function Harness() {
  const row = useLiveQuery(() => getLocalDb().characterCombat.get(ID));
  const character = {
    id: ID,
    derived: { hp: 10, fp: 10 },
    combat: row ?? { currentHp: 10, currentFp: 0 },
  } as unknown as CharacterDetail;
  // The always-mounted status panel and Combat tab use separate patch hooks.
  const statusPatch = useCombatPatch(character);
  const hp = useDraftField({
    name: 'HP',
    serverValue: row?.currentHp ?? 10,
    parse: Number,
    onSave: (value) => statusPatch('currentHp', value),
    enqueueOnCommit: {
      readCommitted: async () => (await getLocalDb().characterCombat.get(ID))?.currentHp ?? 10,
    },
    flashKey: `character_combat:${ID}:currentHp`,
  });
  const fp = useDraftField({
    name: 'FP',
    serverValue: row?.currentFp ?? 0,
    parse: Number,
    onSave: (value) => statusPatch('currentFp', value),
    enqueueOnCommit: {
      readCommitted: async () => (await getLocalDb().characterCombat.get(ID))?.currentFp ?? 0,
    },
    flashKey: `character_combat:${ID}:currentFp`,
  });
  const bumpers = usePoolBumpers(character, true, useCombatPatch(character));
  return (
    <>
      <input aria-label="HP" {...hp.inputProps} />
      <input aria-label="FP" {...fp.inputProps} />
      <button type="button" onClick={() => bumpers.bumpFp(-1)}>
        Lose FP
      </button>
    </>
  );
}
async function setup() {
  const db = getLocalDb();
  await db.characterCombat.add({
    id: ID,
    characterId: ID,
    currentHp: 10,
    currentFp: 0,
    conditions: [],
    maneuver: null,
    posture: 'standing',
    createdAt: '',
    updatedAt: '',
    revision: 1,
  });
  render(<Harness />);
  return db;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('fatigue bumper and status draft coordination', () => {
  it('applies fatigue injury to the HP edit blurred immediately before the click, even during a slow save', async () => {
    const db = await setup();
    const gate = deferred();
    const original = db.outbox.add.bind(db.outbox);
    const add = vi
      .spyOn(db.outbox, 'add')
      .mockImplementationOnce((...args) =>
        Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => original(...args)),
      );
    const hp = screen.getByRole('textbox', { name: 'HP' });
    fireEvent.change(hp, { target: { value: '8' } });
    fireEvent.blur(hp);
    fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await act(async () => gate.resolve());
    await waitFor(async () =>
      expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 7, currentFp: -1 }),
    );
    await waitFor(() => expect(hp).toHaveValue('7'));
    const ops = await db.outbox.toArray();
    expect(ops).toHaveLength(2);
    expect(ops.find((op) => op.fieldPath === 'currentHp')).toMatchObject({
      attemptedValue: 7,
      prevValue: 10,
    });
    expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
    add.mockRestore();
  });

  it.each([true, false])(
    'preserves gesture order when the second HP commit is before fatigue: %s',
    async (before) => {
      const db = await setup();
      const gate = deferred();
      const original = db.outbox.add.bind(db.outbox);
      const add = vi
        .spyOn(db.outbox, 'add')
        .mockImplementationOnce((...args) =>
          Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => original(...args)),
        );
      const hp = screen.getByRole('textbox', { name: 'HP' });
      fireEvent.change(hp, { target: { value: '8' } });
      fireEvent.blur(hp);
      if (!before) fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
      fireEvent.change(hp, { target: { value: '6' } });
      fireEvent.blur(hp);
      if (before) fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
      await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
      await act(async () => gate.resolve());
      await waitFor(async () =>
        expect(await db.characterCombat.get(ID)).toMatchObject({
          currentHp: before ? 5 : 6,
          currentFp: -1,
        }),
      );
      await waitFor(() => expect(hp).toHaveValue(before ? '5' : '6'));
      add.mockRestore();
    },
  );

  it('preserves a newer dirty HP draft when a local fatigue transaction fails and flashes the fields', async () => {
    const db = await setup();
    const gate = deferred();
    const add = vi.spyOn(db.outbox, 'add').mockImplementationOnce(() =>
      Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => {
        throw new Error('Disk full');
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const hp = screen.getByRole('textbox', { name: 'HP' });
    fireEvent.change(hp, { target: { value: '6' } });
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(expect.stringMatching(/FP and HP.*Disk full/), {
        kind: 'error',
      }),
    );
    expect(hp).toHaveValue('6');
    expect(hp).toHaveAttribute('data-flashing', 'true');
    expect(screen.getByRole('textbox', { name: 'FP' })).toHaveAttribute('data-flashing', 'true');
    expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 10, currentFp: 0 });
    expect(await db.outbox.count()).toBe(0);
    add.mockRestore();
    fireEvent.blur(hp);
    await waitFor(async () =>
      expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 6, currentFp: 0 }),
    );
    expect(hp).toHaveValue('6');
  });
  it('retains the successful intermediate local save as rollback baseline when the latest save fails', async () => {
    const db = await setup();
    const gate = deferred();
    const original = db.outbox.add.bind(db.outbox);
    const add = vi
      .spyOn(db.outbox, 'add')
      .mockImplementationOnce((...args) =>
        Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => original(...args)),
      )
      .mockImplementationOnce((...args) => original(...args))
      .mockRejectedValueOnce(new Error('Third write failed'));
    const hp = screen.getByRole('textbox', { name: 'HP' });
    for (const value of ['8', '6', '5']) {
      fireEvent.change(hp, { target: { value } });
      fireEvent.blur(hp);
    }
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(expect.stringMatching(/HP.*Third write failed/), {
        kind: 'error',
      }),
    );
    await waitFor(() => expect(hp).toHaveValue('6'));
    expect(hp).toHaveAttribute('data-flashing', 'true');
    expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 6, currentFp: 0 });
    expect(await db.outbox.toArray()).toMatchObject([
      { fieldPath: 'currentHp', attemptedValue: 6, prevValue: 10 },
    ]);
    add.mockRestore();
  });

  it('retains a different-field commit while HP saves slowly and applies later FP loss to it', async () => {
    const db = await setup();
    const gate = deferred();
    const original = db.outbox.add.bind(db.outbox);
    const add = vi
      .spyOn(db.outbox, 'add')
      .mockImplementationOnce((...args) =>
        Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => original(...args)),
      );
    const hp = screen.getByRole('textbox', { name: 'HP' });
    const fp = screen.getByRole('textbox', { name: 'FP' });
    fireEvent.change(hp, { target: { value: '8' } });
    fireEvent.blur(hp);
    fireEvent.change(fp, { target: { value: '3' } });
    fireEvent.blur(fp);
    fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await act(async () => gate.resolve());
    await waitFor(async () =>
      expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 8, currentFp: 2 }),
    );
    await waitFor(() => expect(fp).toHaveValue('2'));
    expect(hp).toHaveValue('8');
    add.mockRestore();
  });
  it('rolls back a failed HP draft to a successful interleaved fatigue gesture from another hook', async () => {
    const db = await setup();
    const gate = deferred();
    const original = db.outbox.add.bind(db.outbox);
    const add = vi.spyOn(db.outbox, 'add').mockImplementation((...args) => {
      if (args[0].fieldPath === 'currentHp' && args[0].attemptedValue === 6) {
        return Dexie.Promise.resolve(Dexie.waitFor(gate.promise)).then(() => {
          throw new Error('Last HP write failed');
        });
      }
      return original(...args);
    });
    const hp = screen.getByRole('textbox', { name: 'HP' });
    fireEvent.change(hp, { target: { value: '8' } });
    fireEvent.blur(hp);
    fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
    fireEvent.change(hp, { target: { value: '6' } });
    fireEvent.blur(hp);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(4));
    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(toastPush).toHaveBeenCalledWith(expect.stringMatching(/HP.*Last HP write failed/), {
        kind: 'error',
      }),
    );
    await waitFor(() => expect(hp).toHaveValue('7'));
    expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 7, currentFp: -1 });
    add.mockRestore();
  });
  it('keeps a later explicit HP reset even when it matches the still-stale displayed value', async () => {
    const db = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Lose FP' }));
    const hp = screen.getByRole('textbox', { name: 'HP' });
    fireEvent.change(hp, { target: { value: '8' } });
    fireEvent.change(hp, { target: { value: '10' } });
    fireEvent.blur(hp);
    await waitFor(async () =>
      expect(await db.characterCombat.get(ID)).toMatchObject({ currentHp: 10, currentFp: -1 }),
    );
    expect(hp).toHaveValue('10');
  });
});
