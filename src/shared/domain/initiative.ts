export interface InitiativeInput {
  id: string;
  basicSpeed: number;
  dx: number;
  tieBreak: number;
}
export function sortInitiative(inputs: readonly InitiativeInput[]): string[] {
  return [...inputs]
    .sort((a, b) => b.basicSpeed - a.basicSpeed || b.dx - a.dx || b.tieBreak - a.tieBreak)
    .map(({ id }) => id);
}
export function assignOrderKeys(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, i) => [id, (i + 1) * 10]));
}
export function midpointOrderKey(before: number | null, after: number | null): number {
  if (before === null) return after === null ? 10 : after / 2;
  return after === null ? before + 10 : before === after ? before : (before + after) / 2;
}
