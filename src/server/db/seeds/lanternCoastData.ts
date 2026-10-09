/** Fictional play-state fixtures. Every payload is validated by the normal API. */
import type { AdventureLogCreate } from '../../../shared/schemas/adventureLog.ts';

/** Stable keys identify authored seed notes; they are never sent to the API. */
export interface SeedLogDefinition
  extends Pick<AdventureLogCreate, 'sessionDate' | 'title' | 'body'> {
  key: string;
  sessionNumber: number;
  location: string;
}
export interface SeedSharedLogDefinition extends SeedLogDefinition {
  /** Omitted for a note-only entry; existing session awards remain unchanged. */
  awardPerCharacter?: number;
}

export const lanternSharedLogs: SeedSharedLogDefinition[] = [
  {
    key: 'charter-and-promise',
    sessionDate: '2026-09-04',
    sessionNumber: 0,
    title: 'A charter and a promise',
    location: 'Greyhaven inn',
    body: 'The party agreed to find Fen before the autumn storms.\n\n- Secure passage.\n- Collect supplies.\n- Visit the keeper’s workshop.',
    awardPerCharacter: 0,
  },
  {
    key: 'ferry-with-one-empty-berth',
    sessionDate: '2026-09-06',
    sessionNumber: 1,
    title: 'The ferry with one empty berth',
    location: 'Reedwake ferry, South Shoals',
    body: 'Iona brought us through the shoals on a falling tide. A passenger’s blanket was still tucked beneath the forward bench, but nobody at the landing would claim it.\n\nOrin heard a distress pattern from the abandoned bell buoy. We stayed in the marked channel instead of following it. Kestrel recovered a blue keeper’s cord from the buoy’s chain; Sable fed the cold deckhands while Mira copied the marks on its collar.\n\n**Unfinished business:** ask the harbor clerk who boarded at the last landing, and compare the buoy’s signal with Fen’s records.',
  },
  {
    key: 'garden-under-jetty',
    sessionDate: '2026-09-09',
    sessionNumber: 2,
    title: 'The garden beneath the jetty',
    location: 'Old Greyhaven jetty',
    body: '## What the water left behind\n\nSable found blackened roots in the flooded herb beds. Bram braced the walkway while the others carried seed jars and the gardener’s ledger to dry ground. The damage did not follow the highest flood line.\n\n| Recovered | In whose keeping |\n| --- | --- |\n| Garden ledger and root samples | Sable |\n| Rubbed tide-gate inscription | Mira |\n| Lens bracket with fresh tool marks | Orin |\n\nFen’s workshop door had been opened from inside. We left a note for him and took the inland road toward Stonebridge before the next squall.',
  },
  {
    key: 'bridge-in-rain',
    sessionDate: '2026-09-11',
    sessionNumber: 3,
    title: 'The bridge in the rain',
    location: 'Stonebridge crossing',
    body: '**Bram held the bridge** while the villagers crossed. Kestrel found a safe path along the bank; Mira spent her reserves keeping the way lit.',
    awardPerCharacter: 3,
  },
  {
    key: 'beacon-at-greyhaven',
    sessionDate: '2026-09-18',
    sessionNumber: 4,
    title: 'The beacon at Greyhaven',
    location: 'Greyhaven lighthouse',
    body: '## A light on the horizon\n\nWe reached **Greyhaven** at dusk. The lighthouse was silent, but a fresh trail led down to the sea caves.\n\n- Kestrel found the keeper’s brass compass.\n- Mira deciphered the inscription above the tide gate.\n- Bram held the bridge while the villagers crossed.\n\n**Next session:** follow the lanterns beneath the cliffs.',
    awardPerCharacter: 3,
  },
];
export interface SeedItem {
  name: string;
  library?: string;
  data?: Record<string, unknown>;
  enchantments?: string[];
  contents?: SeedItem[];
}
/** Synthetic enchanted purchases are functional in the campaign's normal mana. */
export const LANTERN_ITEM_POWER = 15;
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
  privateLogs: SeedLogDefinition[];
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
      {
        name: "Beacon Courier's Seal",
        points: 1,
        notes:
          'Fen vouched for me at the keeper stations. A bed and a tide chart, never command over their crews.',
      },
      {
        name: 'Missing-Keeper Obligation',
        points: -5,
        notes:
          'I promised Fen’s sister I would bring him home, even if the paid expedition turns back.',
      },
      {
        name: 'Always Checks the Knot',
        points: -1,
        notes: 'My first courier bag went overboard. I check every fastening twice.',
      },
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
      { name: 'Ropework', points: 2, notes: 'Courier climbs and awkward parcels.' },
      {
        name: 'Marsh Tracking',
        points: 4,
        notes: 'Read a passage through reeds without trampling the evidence.',
      },
      { name: 'Weather Reading', points: 2, notes: 'Learned on the overnight keeper route.' },
      {
        name: 'Smuggler Routes',
        points: 1,
        notes: 'Old delivery paths; I would rather not explain every customer.',
      },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'accented', writtenFluency: 'n/a', points: 2 },
    ],
    techniques: [{ name: 'False Lantern Step', points: 3 }],
    privateLogs: [
      {
        key: 'kestrel-courier-route',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Kestrel Vale: The route I left off the map',
        location: 'Greyhaven inn',
        body: 'Fen’s sister asked whether I still knew the old courier path. I said yes. I did not mention the final stop.\n\n### Before we leave\n- Let Iona choose the crossing. Knowing a footpath is not knowing a tide.\n- Keep Mira’s maps dry.\n- Ask Fen why he stopped sending receipts from the western station.\n\nThe hollow below Greyhaven has no name on the public charts. I delivered a sealed packet there last winter. Fen met me himself and paid double for silence. I kept the money.',
      },
      {
        key: 'kestrel-safe-bank',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Kestrel Vale: Footprints above the water',
        location: 'Stonebridge crossing',
        body: 'Bram told me to find a bank that would hold. I found one. Three trips across; no one left behind.\n\nA blue thread snagged on the upstream willow. Same knot as Fen’s courier cords, tied by someone wearing gloves. The print beside it was fresh, pointing toward Greyhaven rather than away from the flood.\n\nI tucked the thread into my pouch before Mira could catalogue it. That was cowardly. Tomorrow I will show her, and ask her to keep the courier route out of the shared map until we know who is watching it.',
      },
      {
        key: 'kestrel-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Kestrel Vale: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: 'The brass compass does not point north. It points to the hollow where I delivered Fen’s packet.\n\nI knew the destination before anyone opened the tide gate. I let Mira call it a fresh lead because I wanted one more evening without questions.\n\n**Next watch:** tell Iona first. She deserves to know what water I am asking her to enter. Then tell the others about the packet, the extra pay and the little blue seal. Bring Fen home; let his sister decide whether the promise was kept.',
      },
    ],
    inventory: [
      worn("Wayfarer's sword", ['Beacon Edge']),
      worn('Breakwater buckler'),
      worn('Reedglass bow', ['Gullfeather Draw']),
      worn('Tidewire coat'),
      worn('Shoalwatch brigandine'),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Beacon visor'),
      worn('Dock leather gloves'),
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
      {
        name: 'Archive Custodian',
        points: 1,
        notes: 'Access to the Greyhaven archive’s reading room and uncatalogued tide charts.',
      },
      {
        name: 'Must Credit the Discoverer',
        points: -5,
        notes: 'I will not publish another keeper’s finding under my own name.',
      },
      {
        name: 'Keeps Every Rubbing',
        points: -1,
        notes: 'Even the failed copies have dates and labels.',
      },
    ],
    skills: [
      { name: 'Beacon Resonance', points: 8 },
      { name: 'Archive Diving', points: 4 },
      { name: 'Saltwound Care', techLevel: 3, points: 2 },
      { name: 'Harbor Mediation', points: 4 },
      { name: 'Beacon Rod', points: 4 },
      { name: 'Horizon Watch', points: 1 },
      {
        name: 'Salvage Fitting',
        specialization: 'Jetty Hardware',
        techLevel: 3,
        points: 1,
        notes: 'Repairing archive map frames with Orin.',
      },
      {
        name: 'Beacon Lenscraft',
        techLevel: 3,
        points: 2,
        notes: 'Inspect lenses without destroying their calibration.',
      },
      {
        name: 'Tideglass Inscription',
        points: 4,
        notes: 'Copy working inscriptions, including uncertain readings.',
      },
      { name: 'Shoal Cartography', points: 2, notes: 'Field maps that a pilot can actually use.' },
      {
        name: 'Harbor Law',
        points: 1,
        notes: 'Know when an archive permit is not a salvage claim.',
      },
      {
        name: 'Storykeeping',
        points: 1,
        notes: 'Record the witness before correcting the chronology.',
      },
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
    privateLogs: [
      {
        key: 'mira-archive-copy',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Mira Ashfall: A footnote with no author',
        location: 'Greyhaven archive',
        body: '**Working hypothesis:** the beacon was designed to warn ships away from the shoals, not call them toward the coast.\n\nThe archive copy supports that reading. Unfortunately, its final line is in my mentor’s hand, on paper younger than the original. The catalogue calls the whole sheet ancient.\n\nI have borrowed the copy under my own custodian’s seal. If I am wrong, I must return it with a correction. If I am right, I must still credit whoever altered it. Kestrel thinks scholarship means certainty. I wish I had not encouraged that impression.',
      },
      {
        key: 'mira-cost-of-light',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Mira Ashfall: What I could read by the bridge',
        location: 'Stonebridge crossing',
        body: 'The light held long enough for the last family to cross. My hands still shake when I close the ink bottle.\n\nBram thanked me for making the stones visible. Sable asked whether I had eaten. I answered the first question more gracefully than the second.\n\nIn the wet rubbing from the jetty, the sign I translated as *warning* has a second stroke. In the archive copy it does not. This is not damage; the neighboring marks survive. I need the gate itself, good daylight and another reader before I defend the translation again.',
      },
      {
        key: 'mira-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Mira Ashfall: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: '## Two readings\n\n| Copy | Final instruction |\n| --- | --- |\n| Archive sheet | Keep the light above the shoals |\n| Tide-gate stone | Carry the light beneath the shoals |\n\nI told the party I had deciphered the inscription. I had deciphered the words, then quietly chosen the version I wanted.\n\nTomorrow I will ask Sable to read the disputed line before I show her my notes. Orin should compare the lettering with the lens bracket. If the archive was changed deliberately, Fen may have discovered the correction before we did. No publication is worth another missing keeper.',
      },
    ],
    inventory: [
      worn('Beacon rod'),
      worn('Mistquilt coat'),
      worn('Storm mantle'),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Beacon visor'),
      worn('Cliffgrip boots'),
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
      {
        name: "Dockwright's Union Token",
        points: 1,
        notes: 'The union tool shed and an introduction to local crews.',
      },
      {
        name: 'Unsafe-Bridge Compulsion',
        points: -5,
        notes: 'I cannot walk away from a crossing I know is unsafe.',
      },
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
      {
        name: 'Jetty Masonry',
        techLevel: 3,
        points: 8,
        notes: 'Thirty years of work in wet stone.',
      },
      {
        name: 'Hull Patching',
        techLevel: 3,
        points: 2,
        notes: 'Emergency repairs for Iona’s ferries.',
      },
      { name: 'Ropework', points: 2, notes: 'Lift a brace without putting a worker beneath it.' },
      {
        name: 'Cargo Appraisal',
        points: 1,
        notes: 'Spot rotten timber before paying for a cartload.',
      },
      {
        name: 'Storm Drill',
        points: 2,
        notes: 'A crew needs a practiced retreat, not a brave speech.',
      },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Old Beacon Script', spokenFluency: 'none', writtenFluency: 'broken', points: 1 },
    ],
    techniques: [{ name: 'Hook the Haft', points: 4 }],
    privateLogs: [
      {
        key: 'bram-old-invoice',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Bram Stonebridge: The invoice in my coat',
        location: 'Greyhaven inn',
        body: 'I brought the old Stonebridge invoice. Folded twice, tucked behind the union token. Nobody asked why.\n\nWe used good stone and bad pins on that repair. The foreman said the iron would be replaced after the winter levy. I signed the work off because the crossing had already been closed a month and the village needed it.\n\nMy name is on the bottom. If we go inland, I inspect the pins before we put a cart on the bridge. I would prefer the others think this is fussiness.',
      },
      {
        key: 'bram-failed-pin',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Bram Stonebridge: Pin four failed first',
        location: 'Stonebridge crossing',
        body: '### Repair record\n1. Fourth pin sheared at the old scarf joint.\n2. Downstream brace held until the miller’s children were clear.\n3. Left arm took the load when the brace slipped. Do not pretend it is fit for lifting tomorrow.\n\nThose were the pins I signed for. Rain found the weakness; rain did not make it.\n\nSable bound my arm without asking me to be proud of it. I owe her the truth and a patient who follows instructions. When we return, I will give the village the invoice and help rebuild the crossing with my own wages.',
      },
      {
        key: 'bram-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Bram Stonebridge: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: 'Everyone says I held the bridge. Nobody says I helped make it unsafe.\n\nThere is the same cheap iron in the tide gate’s hinge. That does not prove the same supplier, but I will not leave another bad fitting for the next crew to discover with their bodies.\n\nAsk Orin to inspect it with me. Tell him about the invoice before he lends me his tools. Get Fen out first if the water is rising; mark the fault plainly and come back with a proper brace. A promise needs a work date.',
      },
    ],
    inventory: [
      worn('Bridgehook axe'),
      worn('Breakwater buckler'),
      worn('Tidewire coat', ["Warden's Stitch"]),
      worn('Beacon cuirass'),
      worn('Quay backplate'),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Beacon visor'),
      worn('Dock leather gloves'),
      worn('Reedweave greaves'),
      worn('Cliffgrip boots'),
      {
        ...worn('Storm mantle'),
        data: {
          worn: true,
          equipped: false,
          notes: 'Spare outer mantle; unequip the plates before wearing it over the mail.',
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
      {
        name: "Tidepilot's Charter",
        points: 1,
        notes: 'Licensed passage through the shoals and use of the pilot notice board.',
      },
      {
        name: 'Crew Before Cargo',
        points: -5,
        notes: 'I abandon a profitable load before I abandon a passenger.',
      },
      {
        name: 'Lantern vigil',
        points: -1,
        notes: 'I check the stern lantern myself before taking the night watch.',
      },
    ],
    skills: [
      { name: 'Tidepilot', points: 12 },
      { name: 'Current Riding', points: 4 },
      { name: 'Tether Cast', points: 8 },
      { name: 'Quayblade', points: 4 },
      { name: 'Bulwark Handling', points: 2 },
      { name: 'Horizon Watch', points: 4 },
      { name: 'Coastal Foraging', specialization: 'Tide Flats', points: 2 },
      { name: 'Smallcraft Sailing', points: 8, notes: 'Ferry work began in a borrowed skiff.' },
      {
        name: 'Channel Sounding',
        points: 4,
        notes: 'Keep the lead line honest when the charts are old.',
      },
      { name: 'Weather Reading', points: 2, notes: 'Watch the squall before watching the fare.' },
      {
        name: 'Rescue Coordination',
        points: 4,
        notes: 'Give each deckhand a task and count everyone back aboard.',
      },
      { name: 'Harbor Law', points: 1, notes: 'Passenger manifests and contested berths.' },
      {
        name: 'Silent Signing',
        points: 2,
        notes: 'Hands are easier to hear than voices in a storm.',
      },
      {
        name: 'Dockside Etiquette',
        points: 1,
        notes: 'Remember who lent a berth when no money changed hands.',
      },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'native', writtenFluency: 'n/a', points: 3 },
    ],
    techniques: [{ name: 'False Lantern Step', points: 2 }],
    privateLogs: [
      {
        key: 'iona-manifest',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Iona Reedwake: Six fares, seven blankets',
        location: 'Greyhaven ferry landing',
        body: 'Paid fares: six. Blankets issued: seven. The boy with the grey scarf asked to disembark at the bell buoy, which is not a landing.\n\nI refused. At the next count, his blanket was empty and the rail latch was open. No splash that anyone would admit to hearing.\n\nThe clerk offered to strike him from the manifest as a counting error. I let the line stand. I have not told his mother because I do not yet know whether he went overboard or climbed onto the buoy. I need an answer before I need a clean account book.',
      },
      {
        key: 'iona-crew-count',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Iona Reedwake: A crossing without losses',
        location: 'Stonebridge crossing',
        body: 'Two grandparents, the miller, three children. All on the far bank. Bram would not count himself until Sable had his arm wrapped.\n\nI can count people all day. It does not put the missing passenger back on my ferry.\n\nOrin recognized the bell-buoy pattern but went quiet when I asked where he learned it. Ask again when we are alone. Kestrel found a keeper’s cord on the buoy; I should have asked whose knot it was. Captain’s work includes the awkward question, not only the line thrown at the right moment.',
      },
      {
        key: 'iona-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Iona Reedwake: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: 'The cave trail has a grey wool thread on its lowest thorn. Could belong to anyone. I still kept it.\n\n**Before we launch:**\n- Leave the manifest with the innkeeper.\n- Give Sable the passenger’s name: Tavin Rook, fifteen, paid in copper.\n- Tie a return line where the tide cannot lift it clear.\n\nIf Tavin is with Fen, two berths stay empty for them. If he is not, I will tell his mother what happened aboard my ferry. Nobody else will carry that message for me.',
      },
    ],
    inventory: [
      worn("Wayfarer's sword"),
      worn('Rescue tether'),
      worn('Breakwater buckler', ['Mooring Counterweight']),
      worn('Mistquilt coat'),
      worn('Salvage apron'),
      worn('Quay backplate'),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Reedweave greaves'),
      worn('Cliffgrip boots'),
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
      {
        name: 'Refuge-House Key',
        points: 1,
        notes: 'A pantry shelf and a treatment corner at the Greyhaven refuge.',
      },
      {
        name: 'Patient Before Purse',
        points: -5,
        notes: 'I treat the person at the door before asking who will pay.',
      },
    ],
    skills: [
      { name: 'Saltwound Care', techLevel: 3, points: 8 },
      { name: 'Marsh Distilling', techLevel: 3, points: 8 },
      { name: 'Beacon Resonance', points: 4 },
      { name: 'Harbor Mediation', points: 4 },
      { name: 'Beacon Rod', points: 2 },
      { name: 'Coastal Foraging', specialization: 'Cliff Gardens', points: 4 },
      {
        name: 'Patient Triage',
        techLevel: 3,
        points: 4,
        notes: 'Choose the next patient without promising miracles.',
      },
      {
        name: 'Quarantine Stewardship',
        techLevel: 3,
        points: 2,
        notes: 'Keep clean bedding, water and visitors moving safely.',
      },
      {
        name: 'Tidepool Lore',
        points: 2,
        notes: 'Know what belonged in the garden before the water came.',
      },
      { name: 'Coastal Cooking', points: 1, notes: 'A warm pot makes a long night bearable.' },
      {
        name: 'Net Mending',
        points: 1,
        notes: 'My aunt paid for lessons with her torn fishing nets.',
      },
      {
        name: 'Storykeeping',
        points: 1,
        notes: 'Remember a patient’s own account of what happened.',
      },
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
    privateLogs: [
      {
        key: 'sable-garden-ledger',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Sable Fenwick: The page before the storm',
        location: 'Greyhaven refuge house',
        body: 'The garden ledger says the roots began turning black five days before the storm. Everyone remembers the flood because it was loud.\n\nI remember Nessa bringing me a sickly cutting in a chipped cup. I told her to change the soil and stop worrying. Now her beds are underwater and she keeps apologizing for wasting my time.\n\nI packed clean jars for samples and enough herbs for supper. Bring Nessa something that will grow. More urgently, find out what happened before recommending another cure.',
      },
      {
        key: 'sable-supper-and-rest',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Sable Fenwick: Soup for the bridge crew',
        location: 'Stonebridge crossing',
        body: 'Bram wanted a stronger draught. What he needed first was to sit down and let someone else hold the pot.\n\nMira watched the last child cross, then forgot the cup in her hand. I left bread beside her ink bottle. Some people accept care more easily if it looks like an accident.\n\nThe root sample smells of iron when warmed. The untouched jar from the upper bed does too. I will keep the samples separate and ask Orin about the lens bracket before blaming the flood or the beacon. Nessa deserves an answer that is not another guess.',
      },
      {
        key: 'sable-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Sable Fenwick: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: '> The blight began before the beacon fell silent.\n\nI need to say that aloud. I have let the others talk about storm damage because then my advice to Nessa sounds merely unlucky.\n\nThe garden ledger and the black roots disagree with our easy story. If Fen knows what was carried through the flooded jetty, I will ask him gently and listen all the way through. First I will show Mira the dates, without trying to repair her theory for her.\n\nWhen we return, Nessa gets the refuge’s dry bed for her seedlings. I will take the drafty one.',
      },
    ],
    inventory: [
      worn('Beacon rod'),
      worn('Mistquilt coat', ["Warden's Stitch"]),
      worn('Storm mantle', ["Warden's Stitch"]),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Dock leather gloves'),
      worn('Cliffgrip boots'),
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
      {
        name: "Bellkeeper's Credentials",
        points: 1,
        notes: 'Permission to inspect public signal bells and their maintenance books.',
      },
      {
        name: 'Stolen-Signal Suspicion',
        points: -5,
        notes:
          'I investigate a copied distress pattern even when the explanation would be convenient.',
      },
      {
        name: 'Rehearses in Whispers',
        points: -1,
        notes: 'I test every new call under my breath before sounding it.',
      },
    ],
    skills: [
      { name: 'Signal Weaving', points: 8 },
      { name: 'Harbor Winchcraft', techLevel: 3, points: 8 },
      { name: 'Gullcall Performance', points: 4 },
      { name: 'Salvage Fitting', specialization: 'Jetty Hardware', techLevel: 3, points: 4 },
      { name: 'Salvage Haft', points: 4 },
      { name: 'Bulwark Handling', points: 2 },
      { name: 'Archive Diving', points: 2 },
      {
        name: 'Bell Tuning',
        techLevel: 3,
        points: 4,
        notes: 'My mentor taught me to hear a cracked hanger.',
      },
      {
        name: 'Beacon Lenscraft',
        techLevel: 3,
        points: 4,
        notes: 'Align the mechanism before trusting the beam.',
      },
      { name: 'Ropework', points: 2, notes: 'Rig temporary lifts at the jetty.' },
      {
        name: 'Hull Patching',
        techLevel: 3,
        points: 1,
        notes: 'Pay Iona back in repairs rather than promises.',
      },
      {
        name: 'Dockside Etiquette',
        points: 1,
        notes: 'A mechanic needs the crew’s trust as much as the foreman’s.',
      },
      { name: 'Silent Signing', points: 2, notes: 'Pass a warning across a noisy winch room.' },
      { name: 'Storm Drill', points: 2, notes: 'Keep the bell line working during an evacuation.' },
    ],
    spells: [],
    languages: [
      motherTongue,
      { name: 'Harbor Sign', spokenFluency: 'accented', writtenFluency: 'n/a', points: 2 },
    ],
    techniques: [{ name: 'Hook the Haft', points: 3 }],
    privateLogs: [
      {
        key: 'orin-practice-pattern',
        sessionDate: '2026-09-04',
        sessionNumber: 0,
        title: 'Orin Bellstrand: Three short, one held',
        location: 'Greyhaven bell loft',
        body: 'Three short. One held. A pause too long for the public distress call.\n\nMaster Pell taught me that pattern in the loft after the harbor inspectors had gone. A practice call, he said. Something to wake a sleepy apprentice without calling the whole quay.\n\nI heard it again from the bell buoy. Iona thinks I am trying to remember a technical detail. I remember it perfectly. I am trying to decide whether telling her would accuse the man who paid for my first tools.',
      },
      {
        key: 'orin-fresh-file',
        sessionDate: '2026-09-11',
        sessionNumber: 3,
        title: 'Orin Bellstrand: A file mark I know',
        location: 'Stonebridge crossing',
        body: 'Bram’s bridge pins were poor iron. The bracket from the jetty is good iron, filed badly on purpose: two flats where one would do. Pell used that trick to stop a replacement part fitting any bell but his own.\n\nCould be copied. Could be an old part. Write down the possibilities before turning a familiar scratch into a verdict.\n\nIona asked where I learned the buoy call. I said the bell loft, which is true and insufficient. Tomorrow I will name Pell and let her be angry. Then ask Bram to check the bracket without telling him what I want it to mean.',
      },
      {
        key: 'orin-promise-unspoken',
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: 'Orin Bellstrand: a promise unspoken',
        location: 'Greyhaven lighthouse',
        body: '## The false call has a teacher\n\nThe lanterns below the cliff answer in Pell’s private pattern. Whoever hangs them knows the held note and the long pause. This is not a gull striking a bell rope.\n\nI have rehearsed the explanation in whispers three times. Enough. Tell Iona before she takes a boat toward it; tell Mira before she trusts the next light as evidence.\n\nIf Pell is captive, I owe him a rescue. If he set the trap, I owe the harbor a warning. The same first step serves both: keep this crew in the marked channel until we can see who is signaling.',
      },
    ],
    inventory: [
      worn('Bridgehook axe', ['Beacon Edge']),
      worn('Breakwater buckler'),
      worn('Salvage apron'),
      worn('Mistquilt coat'),
      worn('Tidewire coif'),
      worn('Beacon rivet cap'),
      worn('Dock leather gloves'),
      worn('Cliffgrip boots'),
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
