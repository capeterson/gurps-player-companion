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
      { name: 'Breakwater Poise', points: 12 },
      { name: 'Longwatch Lungs', points: 7 },
      { name: 'Horizon Reader', points: 6, level: 2 },
      { name: 'Greyhaven Promise', points: -7 },
      { name: 'Lantern vigil', points: -1 },
    ],
    skills: [
      { name: 'Quayblade', points: 8 },
      { name: 'Bulwark Handling', points: 4 },
      { name: 'Reedbow', points: 8 },
      { name: 'Shingle Ghosting', points: 8 },
      { name: 'Coastal Foraging', specialization: 'Cliff Gardens', points: 2 },
      { name: 'Coastal Foraging', specialization: 'Tide Flats', points: 4 },
      { name: 'Horizon Watch', points: 4 },
      { name: 'Current Riding', points: 1 },
      { name: 'Cliff Traverse', points: 2 },
      { name: 'Saltwound Care', techLevel: 3, points: 1 },
      { name: 'Quayside Barter', points: 0 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'accented', writtenFluency: 'n/a', points: 2 },
    ],
    techniques: [{ name: 'False Lantern Step', points: 3 }],
    inventory: [
      worn("Wayfarer's sword", ['Beacon Edge']),
      worn('Breakwater buckler'),
      worn('Reedglass bow', ['Gullfeather Draw']),
      worn('Tidewire coat'),
      worn('Beacon rivet cap'),
      worn('Reedweave greaves'),
      worn('Cliffgrip boots'),
      {
        name: 'Quiver',
        data: { isContainer: true, worn: true, weightLbs: 1, cost: 10 },
        contents: [{ name: 'Arrows', data: { quantity: 18, weightLbs: 0.1, cost: 2 } }],
      },
      {
        name: 'Trail pack',
        library: 'Trail pack',
        data: { worn: true },
        enchantments: ['Foamfold Lining'],
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
      { name: 'Magery (Tideglass attunement)', points: 25, level: 2 },
      { name: 'Greyhaven Promise', points: -7 },
      {
        name: 'Echo Collector',
        points: -6,
        modifiers: [
          {
            name: 'Trusted companion intervenes',
            category: 'limitation',
            costType: 'percent',
            costValue: -30,
          },
        ],
      },
      { name: 'Lantern vigil', points: -1 },
    ],
    skills: [
      { name: 'Beacon Resonance', points: 8 },
      { name: 'Archive Diving', points: 4 },
      { name: 'Saltwound Care', techLevel: 3, points: 2 },
      { name: 'Harbor Mediation', points: 4 },
      { name: 'Beacon Rod', points: 4 },
      { name: 'Horizon Watch', points: 1 },
    ],
    spells: [
      { name: 'Glimmer Shoal', points: 4 },
      { name: 'Ember Thread', points: 1 },
      { name: 'Borrowed Dawn', points: 2 },
      { name: 'Stitch the Salt', points: 4 },
      { name: 'Mend the Undertow', points: 4 },
      { name: 'Breakwater Veil', points: 2 },
    ],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'broken', writtenFluency: 'accented', points: 3 },
    ],
    techniques: [],
    inventory: [
      worn('Beacon rod'),
      worn('Mistquilt coat'),
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
      { name: 'Stoneblood', points: 6 },
      { name: 'Breakwater Poise', points: 12 },
      { name: 'Bridgekeeper Oath', points: -8 },
      { name: 'Greyhaven Promise', points: -7 },
    ],
    skills: [
      { name: 'Salvage Haft', points: 12 },
      { name: 'Bulwark Handling', points: 8 },
      { name: 'Dockside Scrapping', points: 4 },
      { name: 'Salvage Fitting', specialization: 'Body Armor', techLevel: 3, points: 4 },
      { name: 'Cliff Traverse', points: 2 },
      { name: 'Saltwound Care', techLevel: 3, points: 1 },
      { name: 'Quayside Barter', points: 2 },
      { name: 'Current Riding', points: 0 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'none', writtenFluency: 'broken', points: 1 },
    ],
    techniques: [{ name: 'Hook the Haft', points: 4 }],
    inventory: [
      worn('Bridgehook axe'),
      worn('Breakwater buckler'),
      worn('Tidewire coat', ["Warden's Stitch"]),
      worn('Beacon rivet cap'),
      worn('Reedweave greaves'),
      worn('Cliffgrip boots'),
      worn('Storm mantle'),
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
  {
    email: 'iona@example.invalid',
    displayName: 'Iona',
    character: {
      name: 'Iona Reedwake',
      st: 11,
      dx: 12,
      iq: 13,
      ht: 12,
      perMod: 1,
      age: 39,
      height: '5 ft 10 in',
      weight: '165 lb',
      birthdate: '3 Highwater, 1167',
      appearance:
        '## Pilot of the shoals\n\nA ferry captain with a knotted chart cord. Find a safe berth for the rescued keeper.',
    },
    traits: [
      { name: 'Tidewise Balance', points: 8 },
      { name: 'Greyhaven Promise', points: -7 },
      { name: 'Counts the gulls', points: -1 },
    ],
    skills: [
      { name: 'Tidepilot', points: 12 },
      { name: 'Current Riding', points: 4 },
      { name: 'Tether Cast', points: 8 },
      { name: 'Quayblade', points: 4 },
      { name: 'Bulwark Handling', points: 2 },
      { name: 'Horizon Watch', points: 4 },
      { name: 'Coastal Foraging', specialization: 'Tide Flats', points: 2 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'native', writtenFluency: 'n/a', points: 3 },
    ],
    techniques: [{ name: 'False Lantern Step', points: 2 }],
    inventory: [
      worn("Wayfarer's sword"),
      worn('Rescue tether'),
      worn('Breakwater buckler', ['Mooring Counterweight']),
      worn('Mistquilt coat'),
      {
        name: 'Pilot’s locker',
        data: { isContainer: true, worn: true, weightLbs: 1.6, cost: 42 },
        contents: [{ name: 'Mooring ledger', data: { weightLbs: 0.4, cost: 9 } }, rations],
      },
    ],
    combat: { currentHp: 11, currentFp: 10, maneuver: 'Wait', posture: 'standing', conditions: [] },
    effects: [],
  },
  {
    email: 'sable@example.invalid',
    displayName: 'Sable',
    character: {
      name: 'Sable Fenwick',
      st: 10,
      dx: 11,
      iq: 14,
      ht: 12,
      willMod: 1,
      age: 31,
      height: '5 ft 5 in',
      weight: '145 lb',
      birthdate: '18 Reedfall, 1175',
      appearance:
        '## Keeper of the marsh garden\n\nA field medic carrying sealed jars of fictional salt herbs. Recover the garden beneath the flooded jetty.',
    },
    traits: [
      { name: 'Gentle Hands', points: 7 },
      { name: 'Magery (Tideglass attunement)', points: 16, level: 1 },
      { name: 'Greyhaven Promise', points: -7 },
      { name: 'Pocket gardener', points: 1 },
    ],
    skills: [
      { name: 'Saltwound Care', techLevel: 3, points: 8 },
      { name: 'Marsh Distilling', techLevel: 3, points: 8 },
      { name: 'Beacon Resonance', points: 4 },
      { name: 'Harbor Mediation', points: 4 },
      { name: 'Beacon Rod', points: 2 },
      { name: 'Coastal Foraging', specialization: 'Cliff Gardens', points: 4 },
    ],
    spells: [
      { name: 'Stitch the Salt', points: 8 },
      { name: 'Borrowed Dawn', points: 4 },
      { name: 'Root the Jetty', points: 4 },
      { name: 'Quiet Mooring', points: 2 },
    ],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'broken', writtenFluency: 'broken', points: 2 },
    ],
    techniques: [],
    inventory: [
      worn('Beacon rod'),
      worn('Mistquilt coat', ["Warden's Stitch"]),
      worn('Focus crystal'),
      {
        name: 'Distiller roll',
        library: 'Distiller roll',
        data: { worn: true },
        enchantments: ['Foamfold Lining'],
        contents: [
          {
            name: 'Sealed marsh jars',
            data: {
              quantity: 3,
              weightLbs: 0.3,
              cost: 7,
              notes: 'Fictional ingredients; no automatic healing effect.',
            },
          },
          { name: 'Clean bandages', data: { quantity: 8, weightLbs: 0.1, cost: 1 } },
        ],
      },
      { name: 'Tideglass mirror', library: 'Tideglass mirror', data: { worn: true } },
    ],
    combat: {
      currentHp: 10,
      currentFp: 7,
      maneuver: 'Concentrate',
      posture: 'standing',
      conditions: [],
    },
    effects: [{ name: 'Beacon Ward', state: 'active' }],
  },
  {
    email: 'orin@example.invalid',
    displayName: 'Orin',
    character: {
      name: 'Orin Bellstrand',
      st: 12,
      dx: 12,
      iq: 12,
      ht: 11,
      age: 24,
      height: '5 ft 8 in',
      weight: '160 lb',
      birthdate: '6 Bellmoot, 1182',
      appearance:
        '## The signal arrives\n\nA jetty mechanic with glass beads braided into his sleeves. Decode the false distress signal before another crew follows it.',
    },
    traits: [
      { name: 'Signal Memory', points: 6 },
      { name: 'Longwatch Lungs', points: 7 },
      { name: 'Storm Debt', points: -9 },
      { name: 'Lantern vigil', points: -1 },
    ],
    skills: [
      { name: 'Signal Weaving', points: 8 },
      { name: 'Harbor Winchcraft', techLevel: 3, points: 8 },
      { name: 'Gullcall Performance', points: 4 },
      { name: 'Salvage Fitting', specialization: 'Jetty Hardware', techLevel: 3, points: 4 },
      { name: 'Salvage Haft', points: 4 },
      { name: 'Bulwark Handling', points: 2 },
      { name: 'Archive Diving', points: 2 },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'accented', writtenFluency: 'n/a', points: 2 },
    ],
    techniques: [{ name: 'Hook the Haft', points: 3 }],
    inventory: [
      worn('Bridgehook axe', ['Beacon Edge']),
      worn('Breakwater buckler'),
      worn('Salvage apron'),
      worn('Signal beads', ['Harbor Whisper']),
      {
        name: 'Jetty toolbelt',
        library: 'Jetty toolbelt',
        data: { worn: true },
        contents: [
          { name: 'Winch spanner', data: { weightLbs: 1.5, cost: 16 } },
          { name: 'Signal chalk', data: { quantity: 5, weightLbs: 0.05, cost: 1 } },
        ],
      },
      {
        name: 'Spare winch drum',
        data: { weightLbs: 24, cost: 85, externalLocation: 'Party handcart' },
      },
    ],
    combat: { currentHp: 9, currentFp: 8, maneuver: 'Ready', posture: 'crouching', conditions: [] },
    effects: [],
  },
];
