/** Sample equipment loadouts (seed V5) through the seed's API transport.
 * A character that already has loadouts is left alone, so a refresh never
 * recreates loadouts a player renamed or deleted. Callers own the transaction.
 */
import { z } from 'zod';
import type { LanternRequest } from './lanternCoastContent.ts';

interface SeedLoadout {
  readonly name: string;
  /** Inventory item names; null means "whatever is equipped when seeded". */
  readonly items: readonly string[] | null;
}

/** Synthetic loadouts per Lantern Coast character name. The first is equipped. */
export const LANTERN_LOADOUTS: Readonly<Record<string, readonly SeedLoadout[]>> = {
  'Kestrel Vale': [
    { name: 'Field kit', items: null },
    {
      name: 'Shore patrol',
      items: [
        "Wayfarer's sword",
        'Breakwater buckler',
        'Shoalwatch brigandine',
        'Tidewire coif',
        'Dock leather gloves',
        'Cliffgrip boots',
      ],
    },
    {
      name: 'Travel',
      items: ['Tidewire coat', 'Cliffgrip boots', 'Trail pack', 'Hemp rope', 'Spare cloak'],
    },
  ],
};

const sheet = z.object({
  inventory: z.array(z.object({ id: z.string(), name: z.string(), equipped: z.boolean() })),
});
const loadoutList = z.object({ loadouts: z.array(z.unknown()) });
const created = z.object({ id: z.string().uuid() });

export async function addLanternLoadouts(
  request: LanternRequest,
  actor: string,
  characterId: string,
  characterName: string,
) {
  const fixtures = LANTERN_LOADOUTS[characterName];
  if (!fixtures) return;
  const path = `/characters/${characterId}`;
  if (loadoutList.parse(await request(actor, `${path}/loadouts`, 'GET')).loadouts.length) return;
  const { inventory } = sheet.parse(await request(actor, path, 'GET'));
  const ids: string[] = [];
  for (const [sortOrder, fixture] of fixtures.entries()) {
    const itemIds = fixture.items
      ? fixture.items.flatMap((name) => inventory.find((item) => item.name === name)?.id ?? [])
      : inventory.filter((item) => item.equipped).map((item) => item.id);
    const loadout = created.parse(
      await request(actor, `${path}/loadouts`, 'POST', { name: fixture.name, itemIds, sortOrder }),
    );
    ids.push(loadout.id);
  }
  // Equipping the current set leaves the sheet unchanged but demonstrates
  // the active loadout and Last Equipped.
  if (ids[0]) await request(actor, `${path}/loadouts/${ids[0]}/equip`, 'POST');
}
