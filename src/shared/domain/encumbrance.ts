/**
 * Encumbrance calculation for the GURPS inventory tree.
 *
 * Player weight rules (matches the legacy implementation in
 * gurps-player-web/backend/app/services/encumbrance.py):
 *
 *   1. Each inventory item has weightLbs * quantity raw weight.
 *   2. Items live in a tree of containers via parentId.
 *   3. A "worn root" is a container whose parentId is null and worn=true.
 *   4. For a worn root, the *outermost* worn container's enchantments
 *      apply to the entire subtree:
 *        - hideawayCapacityLbs is deducted from the contents subtotal
 *          first (down to zero, never negative);
 *        - the remaining subtotal is multiplied by
 *          (1 - weightReductionPercent / 100).
 *      Inner-container enchantments are ignored when nested inside
 *      another worn container.
 *   5. Items at the root with parentId=null and worn=false do not
 *      contribute to encumbrance ("off-player" stash).
 *
 * Per-item "effective weight" (what the UI shows next to a row) is the
 * raw weight for non-worn items, and a proportional share of the worn
 * root's reduced weight for items inside a worn root.
 */

export interface InventoryItemRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly weightLbs: number;
  readonly quantity: number;
  readonly worn: boolean;
  readonly isContainer: boolean;
  readonly hideawayCapacityLbs: number;
  readonly weightReductionPercent: number;
}

export interface WeightContribution {
  /** Total worn weight (used for encumbrance level). */
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

function rawSubtotal(node: TreeNode): number {
  let sum = node.item.weightLbs * node.item.quantity;
  for (const child of node.children) sum += rawSubtotal(child);
  return sum;
}

function applyWornEnchantments(
  rawSubtree: number,
  hideaway: number,
  reductionPercent: number,
): number {
  const afterHideaway = Math.max(rawSubtree - hideaway, 0);
  const reductionMultiplier = 1 - reductionPercent / 100;
  return afterHideaway * reductionMultiplier;
}

function distributePerItem(
  node: TreeNode,
  effectiveTotal: number,
  rawTotal: number,
  out: Map<string, number>,
): void {
  // Distribute the worn root's reduced total proportionally to each
  // descendant's raw share so the UI's per-item weights still sum to the
  // root's effective weight.
  const ratio = rawTotal === 0 ? 0 : effectiveTotal / rawTotal;
  function visit(n: TreeNode): void {
    const raw = n.item.weightLbs * n.item.quantity;
    out.set(n.item.id, raw * ratio);
    for (const c of n.children) visit(c);
  }
  visit(node);
}

export function computeWeights(items: readonly InventoryItemRow[]): WeightContribution {
  const roots = buildTree(items);
  const perItem = new Map<string, number>();
  let playerWeight = 0;

  function visitNonWornRoot(node: TreeNode): void {
    perItem.set(node.item.id, node.item.weightLbs * node.item.quantity);
    for (const child of node.children) visitNonWornRoot(child);
  }

  for (const root of roots) {
    if (root.item.worn) {
      const raw = rawSubtotal(root);
      const effective = applyWornEnchantments(
        raw,
        root.item.hideawayCapacityLbs,
        root.item.weightReductionPercent,
      );
      distributePerItem(root, effective, raw, perItem);
      playerWeight += effective;
    } else {
      visitNonWornRoot(root);
    }
  }

  return { playerWeightLbs: playerWeight, perItem };
}

export type EncumbranceLevel = 0 | 1 | 2 | 3 | 4;

export interface EncumbranceResult {
  readonly level: EncumbranceLevel;
  readonly label: 'None' | 'Light' | 'Medium' | 'Heavy' | 'X-Heavy';
  readonly speedDivisor: number;
  readonly dodgePenalty: number;
  readonly playerWeightLbs: number;
  readonly basicLift: number;
  readonly ratio: number;
}

const LEVEL_TABLE = [
  { level: 0 as const, label: 'None' as const, speedDivisor: 1, dodgePenalty: 0, maxRatio: 1 },
  { level: 1 as const, label: 'Light' as const, speedDivisor: 1.2, dodgePenalty: -1, maxRatio: 2 },
  {
    level: 2 as const,
    label: 'Medium' as const,
    speedDivisor: 1.5,
    dodgePenalty: -2,
    maxRatio: 3,
  },
  {
    level: 3 as const,
    label: 'Heavy' as const,
    speedDivisor: 2,
    dodgePenalty: -3,
    maxRatio: 6,
  },
  {
    level: 4 as const,
    label: 'X-Heavy' as const,
    speedDivisor: 3,
    dodgePenalty: -4,
    maxRatio: Number.POSITIVE_INFINITY,
  },
];

export function computeEncumbrance(
  playerWeightLbs: number,
  basicLift: number,
): EncumbranceResult {
  const ratio = basicLift <= 0 ? Number.POSITIVE_INFINITY : playerWeightLbs / basicLift;
  for (const tier of LEVEL_TABLE) {
    if (ratio <= tier.maxRatio) {
      return {
        level: tier.level,
        label: tier.label,
        speedDivisor: tier.speedDivisor,
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
