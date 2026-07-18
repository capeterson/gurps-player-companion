/**
 * FacetChips — the tag-style category control for inventory items.
 *
 * An item's "type" is not a single field but a set of independent
 * facets (an item can be armor AND a weapon AND a container at once),
 * each backed by its own structured data (weaponData, armor,
 * powerstoneData, magicItemData, isContainer). Rather than a column of
 * checkboxes, the editor presents these as toggleable chips: an active
 * facet reads "Weapon ✕" and reveals its fieldset; an inactive one
 * reads "+ Weapon". The chips are derived from the same facet state
 * the row badges render from, so the two never drift.
 */

export const FACETS = ['container', 'armor', 'weapon', 'powerstone', 'magicItem'] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABELS: Record<Facet, string> = {
  container: 'Container',
  armor: 'Armor',
  weapon: 'Weapon',
  powerstone: 'Powerstone',
  magicItem: 'Magic item',
};

export interface FacetChipRowProps {
  active: Record<Facet, boolean>;
  /** Which facets to offer (defaults to all five). */
  facets?: readonly Facet[];
  onToggle: (facet: Facet, next: boolean) => void;
}

export function FacetChipRow({ active, facets = FACETS, onToggle }: FacetChipRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {facets.map((facet) => {
        const on = active[facet];
        return (
          <button
            key={facet}
            type="button"
            className={`badge badge-sm ${on ? 'badge-secondary' : 'badge-ghost'} gap-1`}
            aria-pressed={on}
            onClick={() => onToggle(facet, !on)}
          >
            {on ? FACET_LABELS[facet] : `+ ${FACET_LABELS[facet]}`}
            {on && <span aria-hidden>✕</span>}
          </button>
        );
      })}
    </div>
  );
}
