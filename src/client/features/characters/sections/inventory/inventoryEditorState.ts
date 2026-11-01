import { writeContainerExpanded } from '../inventoryContainerState.ts';
import type { ItemSection } from './itemMutations.ts';

/**
 * Page-lifetime UI state that must survive a row remount. Moving an item
 * between On the player, Stashed and a container re-parents its table row,
 * so the open editor section and the destination's disclosure live here.
 * The new row may mount later than the old one unmounts (a collapsed
 * destination opens after the move), so entries last until the editor is
 * closed or the inventory panel unmounts.
 */
const openSections = new Map<string, ItemSection>();
const revealListeners = new Set<(containerIds: ReadonlySet<string>) => void>();

/** The panel forgets open editors when it unmounts (navigation, logout). */
export function clearOpenSections(): void {
  openSections.clear();
}

export function openSectionFor(itemId: string): ItemSection | null {
  return openSections.get(itemId) ?? null;
}

export function rememberOpenSection(itemId: string, section: ItemSection | null): void {
  if (section) openSections.set(itemId, section);
  else openSections.delete(itemId);
}

/** Expand these containers (persisted like a chevron click) and any mounted rows. */
export function revealContainers(characterId: string, containerIds: readonly string[]): void {
  for (const id of containerIds) writeContainerExpanded(characterId, id, true);
  const ids = new Set(containerIds);
  for (const listener of revealListeners) listener(ids);
}

export function onRevealContainers(
  listener: (containerIds: ReadonlySet<string>) => void,
): () => void {
  revealListeners.add(listener);
  return () => revealListeners.delete(listener);
}
