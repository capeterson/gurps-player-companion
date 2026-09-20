/** Fictional play-state fixtures. Every payload is validated by the normal API. */
export interface SeedItem {
  name: string;
  library?: string;
  data?: Record<string, unknown>;
  enchantments?: string[];
  contents?: SeedItem[];
}
export interface SeedCharacter {
  email: string;
  displayName: string;
  manager?: boolean;
  character: { name: string } & Record<string, unknown>;
  traits: ({ name: string } & Record<string, unknown>)[];
  skills: ({ name: string; points: number } & Record<string, unknown>)[];
  spells: ({ name: string; points: number } & Record<string, unknown>)[];
  languages: ({ name: string } & Record<string, unknown>)[];
  techniques: ({ name: string; points: number } & Record<string, unknown>)[];
  inventory: SeedItem[];
  combat: Record<string, unknown>;
  effects: { name: string; state: 'active' | 'inactive' | 'expired'; sourceItem?: string }[];
}
const motherTongue = {
  name: 'Coast Common',
  spokenFluency: 'native',
  writtenFluency: 'native',
  points: 0,
};
const worn = (name: string, enchantments: string[] = []): SeedItem => ({
  name,
  library: name,
  data: { worn: true, equipped: true },
  enchantments,
});
const rations: SeedItem = { name: 'Rations', data: { quantity: 4, weightLbs: 0.5, cost: 2 } };

export const lanternCharacters: SeedCharacter[] = [
  {
    email: 'rowan@example.invalid',
    displayName: 'Rowan',
    character: {
      name: 'Kestrel Vale',
      st: 12,
      dx: 13,
      iq: 11,
      ht: 12,
      perMod: 1,
      age: 28,
      height: '5 ft 9 in',
      weight: '155 lb',
      birthdate: '12 Rainmoot, 1178',
      appearance:
        '## Keeper of the last light\n\nA coastal scout with a weathered blue cloak and a promise to keep.\n\n- Find the missing lighthouse keeper.\n- Return the **brass compass** to its owner.\n\n### Contacts\n| Name | Connection |\n| --- | --- |\n| Captain Iona | Owes us passage |\n| Fen the keeper | Missing since the storm |',
    },
    traits: [
      { name: 'Combat Reflexes', points: 15 },
      { name: 'Fit', points: 5 },
      { name: 'Acute Vision', points: 4, level: 2 },
      { name: 'Sense of Duty', points: -5 },
      { name: 'Lantern vigil', points: -1 },
    ],
    skills: [
      { name: 'Broadsword', points: 8 },
      { name: 'Shield', points: 4 },
      { name: 'Bow', points: 8 },
      { name: 'Stealth', points: 8 },
      { name: 'Survival', specialization: 'Woodlands', points: 2 },
      { name: 'Survival', specialization: 'Island/Beach', points: 4 },
      { name: 'Observation', points: 4 },
      { name: 'Swimming', points: 1 },
      { name: 'Climbing', points: 2 },
      { name: 'First Aid', techLevel: 3, points: 1 },
      { name: 'Merchant', points: 0 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'accented', writtenFluency: 'n/a', points: 2 },
    ],
    techniques: [{ name: 'Feint', points: 3 }],
    inventory: [
      worn("Wayfarer's sword", ['Beacon Edge']),
      worn('Round shield'),
      worn('Coastal bow'),
      worn('Mail hauberk'),
      worn('Steel cap'),
      worn('Leather leggings'),
      worn('Travel boots'),
      {
        name: 'Quiver',
        data: { isContainer: true, worn: true, weightLbs: 1, cost: 10 },
        contents: [{ name: 'Arrows', data: { quantity: 18, weightLbs: 0.1, cost: 2 } }],
      },
      {
        name: 'Trail pack',
        library: 'Trail pack',
        data: { worn: true },
        contents: [
          rations,
          { name: 'Hemp rope', data: { weightLbs: 3, cost: 10 } },
          {
            name: 'Oilskin pouch',
            data: { isContainer: true, weightLbs: 0.2, cost: 5 },
            contents: [
              {
                name: 'Brass compass',
                data: { weightLbs: 0.2, cost: 25, notes: 'Engraved with Fen’s initials.' },
              },
              { name: 'Greyhaven tide chart', data: { weightLbs: 0.1, cost: 3 } },
            ],
          },
        ],
      },
      {
        name: 'Spare cloak',
        data: { weightLbs: 2, cost: 20, externalLocation: 'Greyhaven inn — room 3' },
      },
    ],
    combat: {
      currentHp: 10,
      currentFp: 9,
      maneuver: 'Attack',
      posture: 'standing',
      conditions: [],
    },
    effects: [{ name: 'Beacon Ward', state: 'active' }],
  },
  {
    email: 'mira@example.invalid',
    displayName: 'Mira',
    character: {
      name: 'Mira Ashfall',
      st: 9,
      dx: 11,
      iq: 15,
      ht: 11,
      fpMod: 2,
      willMod: 1,
      age: 34,
      height: '5 ft 6 in',
      weight: '130 lb',
      birthdate: 'First thaw, 1172',
      appearance:
        '## Cartographer of forgotten magic\n\nInk-stained cuffs, copper spectacles, and a satchel full of questions.\n\n> The beacon is a warning, not a weapon.\n\n**Research:** compare the Old Beacon Script with the tide-gate inscription.',
    },
    traits: [
      { name: 'Magery', points: 25, level: 2 },
      { name: 'Sense of Duty', points: -5 },
      {
        name: 'Curious',
        points: -5,
        modifiers: [
          {
            name: 'Easier self-control',
            category: 'limitation',
            costType: 'percent',
            costValue: -50,
          },
        ],
      },
      { name: 'Lantern vigil', points: -1 },
    ],
    skills: [
      { name: 'Thaumatology', points: 8 },
      { name: 'Research', points: 4 },
      { name: 'First Aid', techLevel: 3, points: 2 },
      { name: 'Diplomacy', points: 4 },
      { name: 'Staff', points: 4 },
      { name: 'Observation', points: 1 },
    ],
    spells: [
      { name: 'Light', points: 4 },
      { name: 'Ignite Fire', points: 1 },
      { name: 'Lend Energy', points: 2 },
      { name: 'Minor Healing', points: 4 },
      { name: 'Major Healing', points: 4 },
      { name: 'Shield', points: 2 },
    ],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'broken', writtenFluency: 'accented', points: 3 },
    ],
    techniques: [],
    inventory: [
      {
        name: 'Ash staff',
        data: {
          worn: true,
          equipped: true,
          weightLbs: 4,
          cost: 10,
          weaponData: {
            skill: 'Staff',
            damage: 'sw+2 cr',
            reach: '1,2',
            parry: '0',
            stRequired: 7,
            alternateModes: [{ name: 'Thrust', damage: 'thr+2 cr' }],
          },
        },
      },
      {
        name: 'Quilted coat',
        data: {
          worn: true,
          equipped: true,
          isArmor: true,
          weightLbs: 5,
          cost: 30,
          armor: { dr: 1, flexible: true, locations: ['torso', 'arm_left', 'arm_right'] },
        },
      },
      worn('Focus crystal'),
      worn('Tideglass wand'),
      {
        name: 'Spent focus',
        library: 'Focus crystal',
        data: { worn: true, powerstoneData: { maxEnergy: 3, currentEnergy: 0 } },
      },
      {
        name: 'Scholar’s satchel',
        data: { worn: true, isContainer: true, weightLbs: 1, cost: 30 },
        contents: [
          {
            name: 'Medical kit',
            data: { isContainer: true, weightLbs: 1, cost: 50 },
            contents: [{ name: 'Clean bandages', data: { quantity: 6, weightLbs: 0.1, cost: 1 } }],
          },
          {
            name: 'Field journal',
            data: {
              weightLbs: 1,
              cost: 15,
              notes: 'Includes a rubbing of the tide-gate inscription.',
            },
          },
          rations,
        ],
      },
    ],
    combat: {
      currentHp: 9,
      currentFp: 4,
      maneuver: 'Concentrate',
      posture: 'kneeling',
      conditions: [],
    },
    effects: [{ name: 'Lantern Sight', state: 'inactive', sourceItem: 'Tideglass wand' }],
  },
  {
    email: 'bram@example.invalid',
    displayName: 'Bram',
    manager: true,
    character: {
      name: 'Bram Stonebridge',
      st: 14,
      dx: 11,
      iq: 10,
      ht: 13,
      hpMod: 2,
      age: 46,
      height: '6 ft 2 in',
      weight: '225 lb',
      birthdate: '9 Deepwinter, 1160',
      appearance:
        '## The bridge holds\n\nA retired mason who measures every room for a defensible doorway.\n\n- Repair the Greyhaven crossing.\n- Keep the party alive long enough to be paid.\n\n**Current injury:** battered left arm after holding the bridge; condition tracking is manual.',
    },
    traits: [
      { name: 'Stoneblood', points: 5 },
      { name: 'Combat Reflexes', points: 15 },
      { name: 'Code of Honor', points: -10 },
      { name: 'Sense of Duty', points: -5 },
    ],
    skills: [
      { name: 'Axe/Mace', points: 12 },
      { name: 'Shield', points: 8 },
      { name: 'Brawling', points: 4 },
      { name: 'Armoury', specialization: 'Body Armor', techLevel: 3, points: 4 },
      { name: 'Climbing', points: 2 },
      { name: 'First Aid', techLevel: 3, points: 1 },
      { name: 'Merchant', points: 2 },
      { name: 'Swimming', points: 0 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'none', writtenFluency: 'broken', points: 1 },
    ],
    techniques: [{ name: 'Disarming', points: 4 }],
    inventory: [
      {
        name: 'Bridgekeeper’s axe',
        data: {
          worn: true,
          equipped: true,
          weightLbs: 4,
          cost: 100,
          weaponData: {
            skill: 'Axe/Mace',
            damage: 'sw+2 cut',
            reach: '1',
            parry: '0U',
            stRequired: 11,
          },
        },
      },
      worn('Round shield'),
      worn('Mail hauberk', ["Warden's Stitch"]),
      worn('Steel cap'),
      worn('Leather leggings'),
      worn('Travel boots'),
      {
        name: 'Storm mantle',
        data: {
          worn: true,
          equipped: true,
          isArmor: true,
          weightLbs: 2,
          cost: 150,
          armor: { dr: 1, typedDr: { burn: 3 }, locations: ['torso', 'neck'], flexible: true },
        },
      },
      {
        name: 'Trail pack',
        library: 'Trail pack',
        data: { worn: true },
        contents: [
          { name: 'Mason’s tools', data: { weightLbs: 12, cost: 100 } },
          rations,
          { name: 'Rallying draught', data: { quantity: 2, weightLbs: 0.5, cost: 40 } },
        ],
      },
      {
        name: 'Iron salvage',
        data: { quantity: 3, weightLbs: 20, cost: 5, externalLocation: 'Party handcart' },
      },
    ],
    combat: {
      currentHp: 5,
      currentFp: 8,
      maneuver: 'All-Out Defense',
      posture: 'standing',
      conditions: ['reeling'],
    },
    effects: [{ name: 'Rallying Draught', state: 'expired', sourceItem: 'Rallying draught' }],
  },
];
