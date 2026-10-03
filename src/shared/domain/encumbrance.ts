/**
 * Encumbrance calculation for the GURPS inventory tree.
 *
 * Player weight rules (matches the legacy implementation in
 * gurps-player-web/backend/app/services/encumbrance.py):
 *
 *   1. Each inventory item has weightLbs * quantity raw weight.
 *   2. Items live in a tree of containers via parentId.
 *   3. A carried root has parentId=null and the legacy worn=true location flag.
 *   4. Hideaway removes only contents weight (M61), recursively, including
 *      nested enchanted containers. Lighten reduces an equipped armor/shield's
 *      own weight (M67), never its contents or armor stowed in a pack.
 *   5. Root worn=false items are stashed and do not add to the carried load.
 */

export interface InventoryItemRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly weightLbs: number;
  readonly quantity: number;
  readonly worn: boolean;
  readonly equipped?: boolean;
  readonly isArmor?: boolean;
  readonly weaponData?: { db?: number | null | undefined } | null;
  readonly externalLocation?: string | null;
  readonly isContainer: boolean;
  readonly hideawayCapacityLbs: number;
  readonly weightReductionPercent: number;
}

export interface WeightContribution {
  /** Total carried weight (used for encumbrance level). */
  readonly playerWeightLbs: number;
  /** Per-item effective weight, keyed by item id. */
  readonly perItem: Map<string, number>;
}

interface TreeNode {
  readonly item: InventoryItemRow;
  readonly children: TreeNode[];
}

function buildTree(items: readonly InventoryItemRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const item of items) byId.set(item.id, { item, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.item.parentId;
    if (parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      // Orphan (parent missing) — treat as root.  Server validation
      // prevents this state, but we tolerate it here for resilience.
      roots.push(node);
    }
  }
  return roots;
}

export function computeWeights(items: readonly InventoryItemRow[]): WeightContribution {
  const roots = buildTree(items);
  const perItem = new Map<string, number>();
  let playerWeight = 0;
  function visit(node: TreeNode, carried: boolean, available: boolean): number {
    const item = node.item;
    const present = available && item.quantity > 0;
    const own = carried && !present ? 0 : item.weightLbs * item.quantity;
    const lighten =
      carried && present && item.equipped && (item.isArmor || item.weaponData?.db != null);
    perItem.set(item.id, own * (lighten ? 1 - item.weightReductionPercent / 100 : 1));
    let contents = 0;
    for (const child of node.children) contents += visit(child, carried, present);
    if (carried && present && item.isContainer && item.hideawayCapacityLbs > 0 && contents > 0) {
      const ratio = Math.max(0, contents - item.hideawayCapacityLbs) / contents;
      function reduce(child: TreeNode): void {
        perItem.set(child.item.id, (perItem.get(child.item.id) ?? 0) * ratio);
        for (const descendant of child.children) reduce(descendant);
      }
      for (const child of node.children) reduce(child);
      contents *= ratio;
    }
    return (perItem.get(item.id) ?? 0) + contents;
  }
  for (const root of roots) {
    const carried = root.item.worn && !root.item.externalLocation;
    const total = visit(root, carried, true);
    if (carried) playerWeight += total;
  }
  return { playerWeightLbs: playerWeight, perItem };
}

export type EncumbranceLevel = 0 | 1 | 2 | 3 | 4;

export interface EncumbranceResult {
  readonly level: EncumbranceLevel;
  readonly label: 'None' | 'Light' | 'Medium' | 'Heavy' | 'X-Heavy';
  /** GURPS Move multiplier per encumbrance level (None ×1, Light ×0.8, … X-Heavy ×0.2). */
  readonly moveMultiplier: number;
  readonly dodgePenalty: number;
  readonly playerWeightLbs: number;
  readonly basicLift: number;
  readonly ratio: number;
}

const LEVEL_TABLE = [
  { level: 0 as const, label: 'None' as const, moveMultiplier: 1.0, dodgePenalty: 0, maxRatio: 1 },
  {
    level: 1 as const,
    label: 'Light' as const,
    moveMultiplier: 0.8,
    dodgePenalty: -1,
    maxRatio: 2,
  },
  {
    level: 2 as const,
    label: 'Medium' as const,
    moveMultiplier: 0.6,
    dodgePenalty: -2,
    maxRatio: 3,
  },
  {
    level: 3 as const,
    label: 'Heavy' as const,
    moveMultiplier: 0.4,
    dodgePenalty: -3,
    maxRatio: 6,
  },
  {
    level: 4 as const,
    label: 'X-Heavy' as const,
    moveMultiplier: 0.2,
    dodgePenalty: -4,
    maxRatio: Number.POSITIVE_INFINITY,
  },
];

export function computeEncumbrance(playerWeightLbs: number, basicLift: number): EncumbranceResult {
  const ratio = basicLift <= 0 ? Number.POSITIVE_INFINITY : playerWeightLbs / basicLift;
  for (const tier of LEVEL_TABLE) {
    if (ratio <= tier.maxRatio) {
      return {
        level: tier.level,
        label: tier.label,
        moveMultiplier: tier.moveMultiplier,
        dodgePenalty: tier.dodgePenalty,
        playerWeightLbs,
        basicLift,
        ratio,
      };
    }
  }
  // Should be unreachable because the last tier has Infinity max.
  /* c8 ignore next */
  throw new Error('encumbrance: no tier matched');
}

/** Move after encumbrance (B17). A legal load preserves one yard of Move. */
export function effectiveMove(
  basicMove: number,
  encumbrance: Pick<EncumbranceResult, 'ratio' | 'moveMultiplier'>,
): number {
  if (encumbrance.ratio > 15) return 0;
  return Math.max(basicMove > 0 ? 1 : 0, Math.floor(basicMove * encumbrance.moveMultiplier));
}
