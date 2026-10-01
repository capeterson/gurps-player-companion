import { buildCharacterDetail } from '../../src/shared/domain/characterDetail.ts';
import { selectInventoryItemDetail } from '../../src/shared/domain/inventoryDetails.ts';
import { librarySkillOut } from '../../src/shared/schemas/campaignLibrary.ts';
import {
  characterCreate,
  characterDetail,
  characterMinimalOut,
} from '../../src/shared/schemas/character.ts';
import { librarySkillDetail } from '../../src/shared/schemas/details.ts';
import { inventoryItemCreate, weaponData } from '../../src/shared/schemas/inventory.ts';

const timestamp = '2026-09-30T00:00:00.000Z';
export const characterId = '0193b3c0-f1f0-7000-8000-00000000a001';
const ownerId = '0193b3c0-f1f0-7000-8000-00000000a002';
const bagId = '0193b3c0-f1f0-7000-8000-00000000a003';
export const bladeId = '0193b3c0-f1f0-7000-8000-00000000a004';
export const bladeName =
  'Broadsword with an exceptionally long ceremonial inscription and a protective travelling sheath';

/** Synthetic public fixture shared by DOM, browser, and transport tests. */
export function mcpCharacter() {
  return characterDetail.parse(
    buildCharacterDetail({
      character: {
        ...characterCreate.parse({
          name: 'MCP Test Hero',
          st: 15,
          dx: 14,
          appearance: 'A **synthetic** adventurer.',
        }),
        id: characterId,
        ownerId,
        campaignId: null,
        height: '6 ft',
        weight: null,
        age: 30,
        birthdate: null,
        appearance: 'A **synthetic** adventurer.',
        dismissedWarnings: [],
        activeConditionGroups: [],
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      campaign: null,
      combat: null,
      skills: [
        {
          id: '0193b3c0-f1f0-7000-8000-00000000a005',
          characterId,
          name: 'Broadsword',
          attribute: 'DX',
          difficulty: 'A',
          points: 8,
          techLevel: null,
          specialization: null,
          notes: 'Practice with a **blade**.',
          librarySkillId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: '0193b3c0-f1f0-7000-8000-00000000a006',
          characterId,
          name: 'Expert Skill with a long specialization involving ancient ceremonial inscriptions and regional traditions',
          attribute: 'IQ',
          difficulty: 'H',
          points: 4,
          techLevel: null,
          specialization: null,
          notes: null,
          librarySkillId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      traits: [
        {
          id: '0193b3c0-f1f0-7000-8000-00000000a007',
          characterId,
          kind: 'advantage',
          name: 'Combat Reflexes',
          points: 15,
          level: null,
          variantName: null,
          notes: 'Always **alert**.',
          libraryTraitId: null,
          modifiers: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      spells: [],
      languages: [],
      techniques: [],
      inventory: [
        {
          ...inventoryItemCreate.parse({ name: 'Travelling pack', isContainer: true, worn: true }),
          id: bagId,
          characterId,
          parentId: null,
          notes: null,
          externalLocation: null,
          armor: null,
          weaponData: null,
          powerstoneData: null,
          magicItemData: null,
          libraryItemId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          ...inventoryItemCreate.parse({
            name: bladeName,
            weightLbs: 3,
            cost: 500,
            worn: true,
            equipped: true,
            weaponData: { damage: 'sw+1 cut', reach: '1', parry: '0', skill: 'Broadsword' },
          }),
          id: bladeId,
          characterId,
          parentId: bagId,
          notes: 'A **balanced** blade.',
          weaponData: weaponData.parse({
            damage: 'sw+1 cut',
            reach: '1',
            parry: '0',
            skill: 'Broadsword',
          }),
          externalLocation: null,
          armor: null,
          powerstoneData: null,
          magicItemData: null,
          libraryItemId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
  );
}

export function mcpMinimalCharacter() {
  return characterMinimalOut.parse({
    view: 'minimal',
    id: characterId,
    ownerId,
    campaignId: null,
    name: 'MCP Test Hero',
    height: '6 ft',
    weight: null,
    age: 30,
    birthdate: null,
    appearance: 'Public description',
    techLevel: null,
    updatedAt: timestamp,
  });
}

export function mcpInventoryItem(itemId = bagId) {
  const result = selectInventoryItemDetail(mcpCharacter(), itemId);
  if (!result) throw new Error('Missing synthetic inventory item');
  return result;
}

export function mcpLibrarySkill() {
  return librarySkillDetail.parse({
    kind: 'library_skill',
    experimentalActiveEffects: true,
    skill: librarySkillOut.parse({
      id: '0193b3c0-f1f0-7000-8000-00000000a008',
      campaignId: '0193b3c0-f1f0-7000-8000-00000000a009',
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      techLevel: null,
      description:
        'Use a **balanced sword** to parry and strike. This definition belongs to the campaign library.',
      source: 'Synthetic Core p. 12',
      defaultSpecialization: null,
      specializationPolicy: { kind: 'none' },
      prerequisites: 'A suitable weapon.',
      groups: [],
      tags: [],
      effects: [
        {
          target: 'skill',
          skillName: 'Broadsword',
          value: 1,
          scaling: 'flat',
          conditionGroup: 'ready',
          conditionLabel: 'Blade in hand',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  });
}
