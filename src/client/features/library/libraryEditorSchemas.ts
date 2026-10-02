import { activeEffectDefinitionCreate } from '../../../shared/schemas/activeEffects.ts';
import {
  libraryEnchantmentCreate,
  libraryItemCreate,
  libraryLanguageCreate,
  librarySkillCreate,
  librarySpellCreate,
  libraryStyleCreate,
  libraryTechniqueCreate,
  libraryTraitCreate,
} from '../../../shared/schemas/campaignLibrary.ts';
import {
  libraryModifierCreate,
  librarySourceCreate,
} from '../../../shared/schemas/libraryMetadata.ts';
import { libraryRaceCreate } from '../../../shared/schemas/race.ts';

export const libraryEditorSchemas = {
  traits: libraryTraitCreate,
  skills: librarySkillCreate,
  spells: librarySpellCreate,
  items: libraryItemCreate,
  languages: libraryLanguageCreate,
  techniques: libraryTechniqueCreate,
  styles: libraryStyleCreate,
  enchantments: libraryEnchantmentCreate,
  sources: librarySourceCreate,
  modifiers: libraryModifierCreate,
  races: libraryRaceCreate,
  activeEffects: activeEffectDefinitionCreate,
} as const;
export type LibraryEditorSection = keyof typeof libraryEditorSchemas;
export const libraryEditorNouns: Record<LibraryEditorSection, string> = {
  traits: 'trait',
  skills: 'skill',
  spells: 'spell',
  items: 'item',
  languages: 'language',
  techniques: 'technique',
  styles: 'style',
  enchantments: 'enchantment',
  sources: 'sourcebook',
  modifiers: 'modifier',
  races: 'race',
  activeEffects: 'active effect',
};
