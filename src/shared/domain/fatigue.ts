/** B426: every FP spent below zero also injures HP. FP itself stops at -maxFP;
 * beyond that floor the loss is HP-only. Restoration has no injury cost.
 */
export function applyFatigueLoss(
  currentFp: number,
  loss: number,
  maxFp: number,
): { fp: number; hpCost: number } {
  if (loss <= 0) return { fp: currentFp, hpCost: 0 };
  const spent = Math.max(0, loss);
  return {
    fp: Math.max(-maxFp, currentFp - spent),
    hpCost: Math.max(0, spent - Math.max(0, currentFp)),
  };
}
