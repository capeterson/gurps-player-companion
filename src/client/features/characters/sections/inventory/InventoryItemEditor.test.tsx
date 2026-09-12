import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type InventoryItemOut,
  armorData,
  inventoryItemOut,
  weaponData,
} from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { ToastProvider } from '../../../../lib/toast.tsx';
import { flashBus } from '../../../../sync/flashBus.ts';
import { InventoryRow } from '../InventoryRow.tsx';
import { buildTree } from '../inventoryTree.ts';
import * as mutations from './itemMutations.ts';

const ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const CHARACTER = '0193b3c0-f1f0-7000-8000-00000000c001';
function item(overrides: Partial<InventoryItemOut> = {}): InventoryItemOut {
  return inventoryItemOut.parse({
    id: ID,
    characterId: CHARACTER,
    name: 'Coat',
    quantity: 1,
    weightLbs: 10,
    cost: 100,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: true,
    equipped: true,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: true,
    armor: armorData.parse({ dr: 2, locations: ['torso'] }),
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    effectiveWeightLbs: 10,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}
const selection = vi.fn();
function Harness({ canEdit = true }: { canEdit?: boolean }) {
  const items =
    useLiveQuery(
      async () =>
        (await getLocalDb().characterInventory.toArray()).map((row) =>
          inventoryItemOut.parse({ ...row, effectiveWeightLbs: row.weightLbs * row.quantity }),
        ),
      [],
    ) ?? [];
  const tree = buildTree(items);
  return (
    <ToastProvider>
      <table>
        <tbody>
          {(tree.byParent.get(null) ?? []).map((row) => (
            <InventoryRow
              key={row.id}
              item={row}
              depth={0}
              byParent={tree.byParent}
              isSelected={() => false}
              onRowClick={selection}
              canEdit={canEdit}
            />
          ))}
        </tbody>
      </table>
    </ToastProvider>
  );
}
async function setup(overrides: Partial<InventoryItemOut> = {}, canEdit = true) {
  await getLocalDb().characterInventory.put({ ...item(overrides), revision: 1 });
  render(<Harness canEdit={canEdit} />);
  await screen.findByText('Coat');
  return userEvent.setup();
}
async function armorEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Armor settings for Coat' }));
  return within(screen.getByRole('region', { name: 'Coat: Armor' }));
}
async function stored() {
  return inventoryItemOut.parse({
    ...(await getLocalDb().characterInventory.get(ID)),
    effectiveWeightLbs: 10,
  });
}
async function change(label: string, value: string) {
  const input = screen.getByLabelText(label, { exact: true });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
afterEach(() => {
  vi.restoreAllMocks();
  selection.mockClear();
});

describe('inline inventory editing', () => {
  it('toggles the same category closed with click or keyboard, without removing it or selecting the row', async () => {
    const user = await setup();
    const chip = screen.getByRole('button', { name: 'Armor settings for Coat' });
    await user.click(chip);
    expect(screen.getByRole('region', { name: 'Coat: Armor' })).toBeVisible();
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    await user.click(chip);
    expect(screen.queryByRole('region', { name: 'Coat: Armor' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(selection).not.toHaveBeenCalled();
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect((await stored()).isArmor).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('saves a focused field before the category click collapses it', async () => {
    const user = await setup();
    await armorEditor(user);
    const dr = screen.getByRole('textbox', { name: 'DR' });
    await user.clear(dr);
    await user.type(dr, '5');
    await user.click(screen.getByRole('button', { name: 'Armor settings for Coat' }));
    await waitFor(async () => expect((await stored()).armor?.dr).toBe(5));
    await armorEditor(user);
    expect(screen.getByRole('textbox', { name: 'DR' })).toHaveValue('5');
  });

  it('promotes individual populated advanced fields, including zero; cleared fields can hide again', async () => {
    const user = await setup({
      armor: armorData.parse({ dr: 2, drCrushing: 0, typedDr: { burn: 3 } }),
    });
    const editor = await armorEditor(user);
    expect(editor.getByRole('textbox', { name: 'Crushing DR' })).toHaveValue('0');
    expect(editor.getByRole('textbox', { name: 'Burning DR' })).toHaveValue('3');
    expect(editor.queryByRole('textbox', { name: 'Armor defense bonus' })).toBeNull();
    await user.click(editor.getByRole('button', { name: 'More options' }));
    await change('Armor defense bonus', '0');
    await waitFor(async () => expect((await stored()).armor?.db).toBe(0));
    await user.click(editor.getByRole('button', { name: 'Fewer options' }));
    expect(editor.getByRole('textbox', { name: 'Armor defense bonus' })).toHaveValue('0');
    expect(editor.queryByRole('textbox', { name: 'Cutting DR' })).toBeNull();
    await user.clear(editor.getByRole('textbox', { name: 'Armor defense bonus' }));
    await user.tab();
    await waitFor(() =>
      expect(editor.queryByRole('textbox', { name: 'Armor defense bonus' })).toBeNull(),
    );
    expect((await stored()).armor?.db).toBeNull();
  });

  it('preserves rapid same-field and different-field edits while an earlier save settles', async () => {
    const user = await setup({ armor: armorData.parse({ dr: 2, drCrushing: 1 }) });
    await armorEditor(user);
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = mutations.writeItemPath;
    vi.spyOn(mutations, 'writeItemPath').mockImplementationOnce(async (...args) => {
      await original(...args);
      await barrier;
    });
    await change('DR', '5');
    await waitFor(async () => expect((await stored()).armor?.dr).toBe(5));
    await change('DR', '6');
    await change('Crushing DR', '4');
    await waitFor(async () =>
      expect((await stored()).armor).toMatchObject({ dr: 6, drCrushing: 4 }),
    );
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'DR' })).toHaveValue('6'));
    expect(screen.getByRole('textbox', { name: 'Crushing DR' })).toHaveValue('4');
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.fieldPath).toBe('armor');
    expect(ops[0]?.attemptedValue).toMatchObject({ dr: 6, drCrushing: 4 });
    expect(ops[0]?.prevValue).toMatchObject({ dr: 2, drCrushing: 1 });
  });

  it('rolls back a failed save with a named toast and visible input flash', async () => {
    const user = await setup();
    await armorEditor(user);
    vi.spyOn(getLocalDb().outbox, 'add').mockRejectedValueOnce(new Error('storage unavailable'));
    await change('DR', '5');
    await screen.findByText(/Couldn't save Coat: DR — storage unavailable/);
    const dr = screen.getByRole('textbox', { name: 'DR' });
    await waitFor(() => expect(dr).toHaveValue('2'));
    expect(dr).toHaveAttribute('data-flashing', 'true');
    expect((await stored()).armor?.dr).toBe(2);
    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it('reflects asynchronous server rollback and flashes the collapsed inventory row', async () => {
    const user = await setup();
    await armorEditor(user);
    await change('DR', '5');
    await waitFor(async () => expect((await stored()).armor?.dr).toBe(5));
    await user.click(screen.getByRole('button', { name: 'Armor settings for Coat' }));
    await act(async () => {
      await getLocalDb().characterInventory.update(ID, { armor: armorData.parse({ dr: 2 }) });
      flashBus.emit({ key: `character_inventory:${ID}:armor`, reason: 'rejected' });
    });
    expect(
      screen.getByText('Coat', { selector: 'span.font-medium' }).closest('tr'),
    ).toHaveAttribute('data-flashing', 'true');
    await armorEditor(user);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'DR' })).toHaveValue('2'));
  });

  it('adds a category alongside armor and requires explicit removal confirmation', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'Add category to Coat' }));
    await user.click(screen.getByRole('button', { name: '+ Weapon' }));
    await screen.findByRole('region', { name: 'Coat: Weapon' });
    expect((await stored()).isArmor).toBe(true);
    expect((await stored()).weaponData).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    await user.click(screen.getByRole('button', { name: 'Keep category' }));
    expect((await stored()).weaponData).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove category' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(async () => expect((await stored()).weaponData).toBeNull());
    expect((await stored()).armor?.dr).toBe(2);
  });

  it('shows populated ranged fields, shield DB zero and alternate modes without More options', async () => {
    const user = await setup({
      weaponData: weaponData.parse({
        damage: 'sw+1 cut',
        db: 0,
        ranged: { acc: 0, range: '100/150' },
        alternateModes: [{ name: 'Thrust', damage: 'thr imp', reach: '1' }],
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    expect(screen.getByRole('textbox', { name: 'Shield defense bonus' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: 'Accuracy' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: 'Range' })).toHaveValue('100/150');
    expect(screen.getByRole('textbox', { name: 'Mode reach' })).toHaveValue('1');
    await change('Governing skill', 'Broadsword');
    await waitFor(async () => expect((await stored()).weaponData?.skill).toBe('Broadsword'));
    expect((await stored()).weaponData).toMatchObject({
      db: 0,
      ranged: { acc: 0 },
      alternateModes: [{ name: 'Thrust' }],
    });
  });

  it('retains existing enchantments and exposes their populated optional fields', async () => {
    const user = await setup({
      enchantments: [{ spellName: 'Fortify', spellLevel: 0, category: '+3', notes: 'Old runes' }],
    });
    await user.click(screen.getByRole('button', { name: 'Enchantments settings for Coat' }));
    expect(screen.getByRole('textbox', { name: 'Enchanter skill level' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: 'Enchantment label' })).toHaveValue('+3');
    await change('Spell name', 'Deflect');
    await waitFor(async () => expect((await stored()).enchantments[0]?.spellName).toBe('Deflect'));
    expect((await stored()).enchantments[0]).toMatchObject({
      spellLevel: 0,
      category: '+3',
      notes: 'Old runes',
    });
  });

  it('renders category summaries without edit controls for read-only viewers', async () => {
    await setup({}, false);
    expect(screen.getByText('Armor DR 2')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /settings for|Add category|Edit Coat/ }),
    ).toBeNull();
  });
});
