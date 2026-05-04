import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { api } from '../../../lib/api.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { applyDetailToCache } from './useCharacterPatch.ts';

function fmtWeight(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

interface AddItemFormProps {
  characterId: string;
  canWrite: boolean;
}

function AddItemForm({ characterId, canWrite }: AddItemFormProps) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [weight, setWeight] = useState('0');

  const create = useMutation({
    mutationFn: () =>
      api<{ item: InventoryItemOut; character: CharacterDetail }>(
        `/characters/${characterId}/inventory`,
        {
          method: 'POST',
          body: {
            name: name.trim(),
            quantity: Number(quantity) || 1,
            weightLbs: Number(weight) || 0,
          },
        },
      ),
    onSuccess: (res) => {
      applyDetailToCache(qc, characterId, res.character);
      setName('');
      setQuantity('1');
      setWeight('0');
    },
    onError: (err) => {
      toasts.push(`Couldn't add item — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        create.mutate();
      }}
    >
      <label className="form-control flex-1 min-w-[10rem]">
        <span className="label-text text-xs">Item</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Backpack"
        />
      </label>
      <label className="form-control w-20">
        <span className="label-text text-xs">Qty</span>
        <input
          className="input input-bordered input-sm num"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>
      <label className="form-control w-24">
        <span className="label-text text-xs">Wt (lb)</span>
        <input
          className="input input-bordered input-sm num"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={create.isPending}>
        {create.isPending ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}

interface ItemRowProps {
  characterId: string;
  item: InventoryItemOut;
  canWrite: boolean;
}

function ItemRow({ characterId, item, canWrite }: ItemRowProps) {
  const qc = useQueryClient();
  const toasts = useToasts();

  const patchItem = async (field: string, value: unknown) => {
    const res = await api<{ item: InventoryItemOut; character: CharacterDetail }>(
      `/characters/${characterId}/inventory/${item.id}`,
      { method: 'PATCH', body: { [field]: value } },
    );
    applyDetailToCache(qc, characterId, res.character);
  };

  const nameField = useDraftField<string>({
    name: `${item.name} name`,
    serverValue: item.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchItem('name', v),
  });
  const qtyField = useDraftField<number>({
    name: `${item.name} quantity`,
    serverValue: item.quantity,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        throw new Error('non-negative integer only');
      return n;
    },
    onSave: (v) => patchItem('quantity', v),
  });
  const weightField = useDraftField<number>({
    name: `${item.name} weight`,
    serverValue: item.weightLbs,
    parse: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) throw new Error('non-negative number only');
      return n;
    },
    format: (v) => fmtWeight(v),
    onSave: (v) => patchItem('weightLbs', v),
  });

  const toggleWorn = useMutation({
    mutationFn: () => patchItem('worn', !item.worn),
    onError: (err) => {
      toasts.push(`Couldn't toggle worn — ${(err as Error).message}`, { kind: 'error' });
    },
  });
  const toggleEquipped = useMutation({
    mutationFn: () => patchItem('equipped', !item.equipped),
    onError: (err) => {
      toasts.push(`Couldn't toggle equipped — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      api<CharacterDetail>(`/characters/${characterId}/inventory/${item.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (detail) => applyDetailToCache(qc, characterId, detail),
    onError: (err) => {
      toasts.push(`Couldn't delete item — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  return (
    <li className="grid grid-cols-[1fr_4rem_5rem_5rem_auto_auto] gap-2 items-center py-2 border-b border-base-300 last:border-0">
      <div>
        {canWrite ? (
          <input
            aria-label={`${item.name} name`}
            className={`${DRAFT_FIELD_CLASS} input input-ghost input-sm font-medium w-full`}
            {...nameField.inputProps}
          />
        ) : (
          <span className="font-medium">{item.name}</span>
        )}
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={item.worn}
              onChange={() => canWrite && toggleWorn.mutate()}
              disabled={!canWrite}
              aria-label={`${item.name} worn`}
            />
            worn
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={item.equipped}
              onChange={() => canWrite && toggleEquipped.mutate()}
              disabled={!canWrite}
              aria-label={`${item.name} equipped`}
            />
            equipped
          </label>
        </div>
      </div>
      {canWrite ? (
        <input
          aria-label={`${item.name} quantity`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...qtyField.inputProps}
        />
      ) : (
        <span className="num text-right">{item.quantity}</span>
      )}
      {canWrite ? (
        <input
          aria-label={`${item.name} weight`}
          className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right`}
          {...weightField.inputProps}
        />
      ) : (
        <span className="num text-right">{fmtWeight(item.weightLbs)}</span>
      )}
      <span
        className="num text-right text-base-content/70"
        aria-label={`${item.name} effective weight`}
      >
        {fmtWeight(item.effectiveWeightLbs)}
      </span>
      <span className="text-xs text-base-content/50">
        {item.worn ? 'worn' : item.equipped ? 'equip' : 'pack'}
      </span>
      {canWrite && (
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => {
            if (confirm(`Delete item "${item.name}"?`)) remove.mutate();
          }}
          disabled={remove.isPending}
          aria-label={`Delete item ${item.name}`}
        >
          ✕
        </button>
      )}
    </li>
  );
}

export function InventoryPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const totalRaw = character.inventory.reduce((sum, i) => sum + i.weightLbs * i.quantity, 0);
  return (
    <section className="card bg-base-200 border border-base-300 p-5 space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label-eyebrow">Inventory</p>
          <h2 className="font-display text-2xl">Carried & equipped</h2>
        </div>
        <div className="text-right">
          <p className="text-xs text-base-content/60">
            <span className="num">{character.inventory.length}</span>{' '}
            {character.inventory.length === 1 ? 'item' : 'items'}
          </p>
          <p className="text-xs text-base-content/60">
            <span className="num">{fmtWeight(character.encumbrance.playerWeightLbs)}</span>/
            <span className="num">{fmtWeight(totalRaw)}</span> lb worn/raw
          </p>
        </div>
      </header>

      <AddItemForm characterId={character.id} canWrite={canWrite} />

      {character.inventory.length === 0 ? (
        <p className="text-sm text-base-content/60">No items yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_4rem_5rem_5rem_auto_auto] gap-2 label-eyebrow border-b border-base-300 pb-1">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Wt</span>
            <span className="text-right">Eff</span>
            <span />
            <span />
          </div>
          <ul>
            {character.inventory.map((i) => (
              <ItemRow key={i.id} characterId={character.id} item={i} canWrite={canWrite} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
