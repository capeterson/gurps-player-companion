import { useState } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { InventoryItemOut } from '../../../../shared/schemas/inventory.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../hooks/useDraftField.ts';
import { useDraftToggle } from '../../../hooks/useDraftToggle.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueFieldPatch,
  newClientId,
} from '../../../sync/outbox.ts';

function fmtWeight(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

interface AddItemFormProps {
  characterId: string;
  canWrite: boolean;
}

interface ItemSnapshot {
  name: string;
  nameRaw: string;
  quantity: number;
  quantityRaw: string;
  weightLbs: number;
  weightRaw: string;
}

function AddItemForm({ characterId, canWrite }: AddItemFormProps) {
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [weight, setWeight] = useState('0');
  const [creating, setCreating] = useState(false);

  async function submit(snap: ItemSnapshot) {
    setCreating(true);
    try {
      await enqueueCreate({
        entityClass: 'character_inventory',
        entityId: newClientId(),
        humanName: 'item',
        characterId,
        attemptedValue: {
          name: snap.name,
          quantity: snap.quantity,
          weightLbs: snap.weightLbs,
          characterId,
        },
      });
      // Per AGENTS.md (rule 1: never silently discard user edits): only
      // reset fields whose current value still matches what we
      // submitted.  If the user has started typing the next item while
      // this enqueue was in flight, leave that draft in place.
      if (name === snap.nameRaw) setName('');
      if (quantity === snap.quantityRaw) setQuantity('1');
      if (weight === snap.weightRaw) setWeight('0');
    } catch (err) {
      toasts.push(`Couldn't add item — ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  if (!canWrite) return null;

  return (
    <form
      className="flex flex-wrap items-end gap-2 p-3 bg-base-100/40 border border-base-300 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // `Number.isFinite` preserves valid 0 (e.g. a quest token with
        // 0 weight or a quantity-tracked stack at 0).  `Number(...) || 1`
        // would silently coerce 0 to 1.
        const qParsed = Number(quantity);
        const wParsed = Number(weight);
        void submit({
          name: name.trim(),
          nameRaw: name,
          quantity: Number.isFinite(qParsed) ? qParsed : 1,
          quantityRaw: quantity,
          weightLbs: Number.isFinite(wParsed) ? wParsed : 0,
          weightRaw: weight,
        });
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
      <button type="submit" className="btn btn-sm btn-primary" disabled={creating}>
        {creating ? 'Adding…' : 'Add'}
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
  const toasts = useToasts();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const patchItem = (field: string, value: unknown) =>
    enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: item.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: `${item.name} ${field}`,
      flashKey: makeFlashKey('character_inventory', item.id, field),
      characterId,
    });

  const nameField = useDraftField<string>({
    name: `${item.name} name`,
    serverValue: item.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => patchItem('name', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'name'),
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
    flashKey: makeFlashKey('character_inventory', item.id, 'quantity'),
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
    flashKey: makeFlashKey('character_inventory', item.id, 'weightLbs'),
  });

  // Use the same draft-with-queue pattern as text fields so rapid
  // toggles (check, then immediately uncheck) serialize through the
  // outbox with the latest click winning, instead of each click
  // sending `!item.worn` against the original prop and racing.
  const wornToggle = useDraftToggle({
    name: `${item.name} worn`,
    serverValue: item.worn,
    onSave: (v) => patchItem('worn', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'worn'),
  });
  const equippedToggle = useDraftToggle({
    name: `${item.name} equipped`,
    serverValue: item.equipped,
    onSave: (v) => patchItem('equipped', v),
    flashKey: makeFlashKey('character_inventory', item.id, 'equipped'),
  });

  const removeItem = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character_inventory',
        entityId: item.id,
        humanName: `item "${item.name}"`,
        characterId,
        prevValue: item,
      });
    } catch (err) {
      toasts.push(`Couldn't delete item — ${(err as Error).message}`, { kind: 'error' });
    }
  };

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
              className={`${DRAFT_FIELD_CLASS} checkbox checkbox-xs`}
              checked={canWrite ? wornToggle.checked : item.worn}
              onChange={() => canWrite && wornToggle.toggle()}
              disabled={!canWrite}
              aria-label={`${item.name} worn`}
              {...wornToggle.flashProps}
            />
            worn
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              className={`${DRAFT_FIELD_CLASS} checkbox checkbox-xs`}
              checked={canWrite ? equippedToggle.checked : item.equipped}
              onChange={() => canWrite && equippedToggle.toggle()}
              disabled={!canWrite}
              aria-label={`${item.name} equipped`}
              {...equippedToggle.flashProps}
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
          onClick={() => setConfirmOpen(true)}
          aria-label={`Delete item ${item.name}`}
        >
          ✕
        </button>
      )}
      {canWrite && (
        <ConfirmDialog
          open={confirmOpen}
          title="Delete item?"
          confirmLabel="Delete"
          tone="error"
          onConfirm={() => {
            setConfirmOpen(false);
            void removeItem();
          }}
          onCancel={() => setConfirmOpen(false)}
        >
          Permanently remove <strong>{item.name}</strong> from this character's inventory.
        </ConfirmDialog>
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
    <section className="card space-y-3 p-5">
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
