import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInventoryItemOut } from '../../../../../shared/domain/characterDetail.ts';
import type { LibraryEnchantmentOut } from '../../../../../shared/schemas/campaignLibrary.ts';
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
function Harness({
  canEdit = true,
  fetchEnchantmentOptions,
}: {
  canEdit?: boolean;
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>;
}) {
  const items =
    useLiveQuery(
      async () =>
        (await getLocalDb().characterInventory.toArray()).map((row) =>
          buildInventoryItemOut(row, new Map()),
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
              {...(fetchEnchantmentOptions ? { fetchEnchantmentOptions } : {})}
            />
          ))}
        </tbody>
      </table>
    </ToastProvider>
  );
}
async function setup(
  overrides: Partial<InventoryItemOut> = {},
  canEdit = true,
  fetchEnchantmentOptions?: (query: string) => Promise<LibraryEnchantmentOut[]>,
) {
  await getLocalDb().characterInventory.put({ ...item(overrides), revision: 1 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness
        canEdit={canEdit}
        {...(fetchEnchantmentOptions ? { fetchEnchantmentOptions } : {})}
      />
    </QueryClientProvider>,
  );
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
  vi.unstubAllGlobals();
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

  it('edits persisted base armor without baking in an enchantment bonus', async () => {
    const user = await setup({
      armor: armorData.parse({ dr: 3, flexible: false, locations: ['torso'] }),
      enchantments: [
        {
          spellName: 'Fortify',
          mechanics: {
            applicability: 'armor',
            effects: [{ target: 'dr', value: 3 }],
            levels: [],
            stackingPolicy: { kind: 'stack' },
          },
        },
      ],
    });
    const editor = await armorEditor(user);
    expect(editor.getByRole('textbox', { name: 'DR' })).toHaveValue('3');
    await user.click(editor.getByRole('button', { name: 'More options' }));
    await user.click(editor.getByRole('checkbox', { name: 'Flexible armor' }));
    await waitFor(async () => {
      expect((await stored()).armor).toMatchObject({ dr: 3, flexible: true });
    });
    expect(screen.getByText('Armor DR 6')).toBeVisible();
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
    // Adding a category starts from the item details, not a chip on every row.
    expect(screen.queryByRole('button', { name: 'Add category to Coat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit Coat' }));
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

  it('adds an alternate attack when randomUUID is unavailable', async () => {
    const user = await setup({ weaponData: weaponData.parse({ damage: 'sw cut' }) });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('textbox', { name: 'Attack name' })).toBeVisible();
    expect(screen.queryAllByLabelText(/(mode|attack).*key/i)).toHaveLength(0);
    await user.type(screen.getByRole('textbox', { name: 'New alternate attack name' }), 'Thrust');
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(7);
        return bytes;
      },
    });

    await user.click(screen.getByRole('button', { name: 'Add alternate attack' }));

    await waitFor(async () => {
      const modes = (await stored()).weaponData?.modes;
      expect(modes?.[1]).toMatchObject({ name: 'Thrust' });
      expect(modes?.[1]?.key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  it('keeps stable attack keys and source references while renaming, editing, adding, and removing attacks', async () => {
    const user = await setup({
      weaponData: weaponData.parse({
        modes: [
          { key: 'primary-stable-id', name: 'Swing', damage: 'sw cut', sourceRow: 'B404' },
          { key: 'alternate-stable-id', name: 'Thrust', damage: 'thr imp', sourceRow: 'B405' },
        ],
        damage: 'sw cut',
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    await user.click(screen.getByRole('button', { name: 'More options' }));

    const weapon = screen.getByRole('region', { name: 'Coat: Weapon' });
    const primaryName = within(weapon).getAllByRole('textbox', { name: 'Attack name' })[0];
    const primarySource = within(weapon).getAllByRole('textbox', { name: 'Source reference' })[0];
    if (!primaryName || !primarySource) {
      throw new Error('Expected primary attack fields');
    }
    expect(primaryName).toHaveValue('Swing');
    expect(primarySource).toHaveValue('B404');
    expect(screen.queryAllByLabelText(/(mode|attack).*key/i)).toHaveLength(0);

    await user.clear(primaryName);
    await user.type(primaryName, 'Heavy swing');
    fireEvent.blur(primaryName);
    await user.clear(primarySource);
    await user.type(primarySource, 'B404, p. 4');
    fireEvent.blur(primarySource);

    const alternate = screen.getByRole('group', { name: 'Alternate attack 1' });
    const alternateName = within(alternate).getByRole('textbox', { name: 'Attack name' });
    await user.clear(alternateName);
    await user.type(alternateName, 'Quick thrust');
    fireEvent.blur(alternateName);
    const alternateSource = within(alternate).getByRole('textbox', { name: 'Source reference' });
    await user.clear(alternateSource);
    await user.type(alternateSource, 'B405, p. 12');
    fireEvent.blur(alternateSource);
    const alternateDamage = within(alternate).getByRole('textbox', { name: 'Damage' });
    await user.clear(alternateDamage);
    await user.type(alternateDamage, 'thr+1 imp');
    fireEvent.blur(alternateDamage);
    await waitFor(async () => {
      expect((await stored()).weaponData?.modes?.[0]).toMatchObject({
        key: 'primary-stable-id',
        name: 'Heavy swing',
        sourceRow: 'B404, p. 4',
      });
      expect((await stored()).weaponData?.modes?.[1]).toMatchObject({
        key: 'alternate-stable-id',
        name: 'Quick thrust',
        sourceRow: 'B405, p. 12',
        damage: 'thr+1 imp',
      });
    });

    await user.type(screen.getByRole('textbox', { name: 'New alternate attack name' }), 'Pommel');
    await user.click(screen.getByRole('button', { name: 'Add alternate attack' }));
    await waitFor(async () => expect((await stored()).weaponData?.modes).toHaveLength(3));
    const afterAdd = (await stored()).weaponData?.modes ?? [];
    expect(afterAdd[0]).toMatchObject({
      key: 'primary-stable-id',
      name: 'Heavy swing',
      sourceRow: 'B404, p. 4',
    });
    expect(afterAdd[1]).toMatchObject({ key: 'alternate-stable-id', name: 'Quick thrust' });
    expect(afterAdd[2]).toMatchObject({ name: 'Pommel' });
    expect(afterAdd[2]?.key).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove alternate attack 1' }));
    await user.click(screen.getByRole('button', { name: /^Remove$/ }));
    await waitFor(async () => expect((await stored()).weaponData?.modes).toHaveLength(2));
    expect((await stored()).weaponData?.modes).toMatchObject([
      { key: 'primary-stable-id', name: 'Heavy swing', sourceRow: 'B404, p. 4' },
      { name: 'Pommel' },
    ]);
  });

  it('shows populated ranged fields, shield side, DB zero and alternate modes without More options', async () => {
    const user = await setup({
      weaponData: weaponData.parse({
        damage: 'sw+1 cut',
        db: 0,
        wieldedSide: 'left',
        ranged: { acc: 0, range: { kind: 'fixed', halfDamageYards: 100, maxYards: 150 } },
        alternateModes: [{ name: 'Thrust', damage: 'thr imp', reach: '1' }],
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    expect(screen.getByRole('textbox', { name: 'Shield defense bonus' })).toHaveValue('0');
    expect(screen.getByRole('combobox', { name: 'Shield side' })).toHaveValue('left');
    expect(screen.getAllByRole('textbox', { name: 'Accuracy' })[0]).toHaveValue('0');
    expect(screen.getAllByRole('combobox', { name: 'Range' })[0]).toHaveValue('fixed');
    expect(screen.getAllByRole('spinbutton', { name: '1/2D (yd)' })[0]).toHaveValue(100);
    expect(screen.getAllByRole('spinbutton', { name: 'Max (yd)' })[0]).toHaveValue(150);
    expect(screen.getAllByRole('textbox', { name: 'Reach' }).at(-1)).toHaveValue('1');
    const governingSkill = within(
      screen.getByRole('region', { name: 'Coat: Weapon' }),
    ).getAllByLabelText('Governing skill')[0];
    if (!governingSkill) {
      throw new Error('Expected primary governing skill field');
    }
    fireEvent.change(governingSkill, { target: { value: 'Broadsword' } });
    fireEvent.blur(governingSkill);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shield side' }), 'right');
    await waitFor(async () => expect((await stored()).weaponData?.skill).toBe('Broadsword'));
    await waitFor(async () => expect((await stored()).weaponData?.wieldedSide).toBe('right'));
    expect((await stored()).weaponData).toMatchObject({
      db: 0,
      wieldedSide: 'right',
      ranged: { acc: 0 },
      alternateModes: [{ name: 'Thrust' }],
    });
  });

  it('saves and visibly rolls back structured Range edits', async () => {
    const user = await setup({
      weaponData: weaponData.parse({
        damage: '1d pi',
        ranged: { acc: 2, range: { kind: 'fixed', halfDamageYards: 100, maxYards: 150 } },
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    await change('Max (yd)', '180');
    await waitFor(async () =>
      expect((await stored()).weaponData?.ranged?.range).toMatchObject({ maxYards: 180 }),
    );
    vi.spyOn(getLocalDb().outbox, 'add').mockRejectedValueOnce(new Error('storage unavailable'));
    await change('Max (yd)', '190');
    await screen.findByText(/Couldn't save Coat: Range — storage unavailable/);
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'Max (yd)' })).toHaveValue(180),
    );
    expect(
      screen.getByRole('spinbutton', { name: 'Max (yd)' }).closest('.field-rollback-flash'),
    ).toHaveAttribute('data-flashing', 'true');
  });

  it('queues a follow-up Range edit and preserves a different weapon field during a slow save', async () => {
    const user = await setup({
      weaponData: weaponData.parse({
        damage: '1d pi',
        ranged: { acc: 2, range: { kind: 'fixed', halfDamageYards: 100, maxYards: 150 } },
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = mutations.writeItemPath;
    vi.spyOn(mutations, 'writeItemPath').mockImplementationOnce(async (...args) => {
      await original(...args);
      await barrier;
    });
    await change('Max (yd)', '180');
    await waitFor(async () =>
      expect((await stored()).weaponData?.ranged?.range).toMatchObject({ maxYards: 180 }),
    );
    await change('Max (yd)', '200');
    await change('Accuracy', '3');
    await waitFor(async () =>
      expect((await stored()).weaponData?.ranged).toMatchObject({
        acc: 3,
        range: { maxYards: 200 },
      }),
    );
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'Max (yd)' })).toHaveValue(200),
    );
    expect(screen.getAllByRole('textbox', { name: 'Accuracy' })[0]).toHaveValue('3');
  });

  it('retains existing enchantments and exposes their populated optional fields', async () => {
    const user = await setup({
      enchantments: [
        {
          spellName: 'Fortify',
          spellLevel: 0,
          level: 2,
          category: '+3',
          notes: 'Old runes',
          definitionId: '0193b3c0-f1f0-7000-8000-00000000e002',
          definitionRevision: 7,
          definitionSource: 'M66',
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Enchantments settings for Coat' }));
    expect(screen.getByRole('textbox', { name: 'Enchanter skill level' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: 'Enchantment level' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Enchantment label' })).toHaveValue('+3');
    expect(screen.getByText('Source: M66')).toBeVisible();
    expect(screen.queryByText(/revision|snapshot|follows library|retained/i)).toBeNull();
    await change('Spell name', 'Deflect');
    await waitFor(async () => expect((await stored()).enchantments[0]?.spellName).toBe('Deflect'));
    expect((await stored()).enchantments[0]).toMatchObject({
      spellLevel: 0,
      category: '+3',
      notes: 'Old runes',
      definitionId: '0193b3c0-f1f0-7000-8000-00000000e002',
      definitionRevision: 7,
      definitionSource: 'M66',
    });
  });

  it('attaches campaign definitions as owned snapshots and allows custom typed mechanics', async () => {
    const definition: LibraryEnchantmentOut = {
      id: '0193b3c0-f1f0-7000-8000-00000000e001',
      campaignId: '0193b3c0-f1f0-7000-8000-00000000c002',
      name: 'Fortify',
      description: null,
      source: 'M66',
      tags: ['armor'],
      applicability: 'armor',
      effects: [{ target: 'dr', value: 1 }],
      levels: [],
      stackingPolicy: { kind: 'highest', key: 'fortify' },
      revision: 7,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const fetchOptions = vi.fn(async () => [definition]);
    const user = await setup({ enchantments: [{ spellName: 'Legacy note' }] }, true, fetchOptions);
    await user.click(screen.getByRole('button', { name: 'Enchantments settings for Coat' }));
    expect(screen.getByText('Source: Character sheet')).toBeVisible();
    const name = screen.getByLabelText('New enchantment name');
    await user.type(name, 'Fort');
    const definitionOption = await screen.findByRole('option', { name: /Fortify/ });
    expect(definitionOption).toHaveTextContent('Armor');
    await user.click(definitionOption);
    await user.click(screen.getByRole('button', { name: 'Add enchantment' }));
    await waitFor(async () =>
      expect((await stored()).enchantments[1]).toMatchObject({
        spellName: 'Fortify',
        definitionId: definition.id,
        definitionRevision: 7,
        mechanics: {
          applicability: 'armor',
          effects: [{ target: 'dr', value: 1 }],
        },
      }),
    );
    expect(screen.getByText('Source: M66')).toBeVisible();
    expect(screen.queryByText(/revision|snapshot|follows library|retained/i)).toBeNull();

    await user.type(screen.getByLabelText('New enchantment name'), 'Local ward');
    expect(screen.getByLabelText('Custom enchantment effect')).toHaveTextContent(
      'Damage resistance (DR)',
    );
    await user.selectOptions(screen.getByLabelText('Custom enchantment effect'), 'dr');
    const value = screen.getByLabelText('Custom enchantment value');
    await user.clear(value);
    await user.type(value, '2');
    await user.click(screen.getByRole('button', { name: 'Add enchantment' }));
    await waitFor(async () =>
      expect((await stored()).enchantments[2]).toMatchObject({
        spellName: 'Local ward',
        mechanics: { effects: [{ target: 'dr', value: 2 }] },
      }),
    );
  });

  it('renders category summaries without edit controls for read-only viewers', async () => {
    await setup({}, false);
    expect(screen.getByText('Armor DR 2')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /settings for|Add category|Edit Coat/ }),
    ).toBeNull();
  });

  it('shows plain language activation choices and shield direction', async () => {
    const user = await setup({
      magicItemData: {
        spellName: 'Light',
        spellSkillLevel: 12,
        mode: 'powered',
        energyCost: 1,
      },
      weaponData: weaponData.parse({ db: 1, wieldedSide: null }),
    });
    await user.click(screen.getByRole('button', { name: 'Weapon settings for Coat' }));
    expect(screen.getByLabelText('Shield side')).toHaveTextContent('All directions');
    await user.click(screen.getByRole('button', { name: 'Magic item settings for Coat' }));
    expect(screen.getByLabelText('Activation')).toHaveTextContent(
      'Uses chargesUses energyAlways on',
    );
  });
});
