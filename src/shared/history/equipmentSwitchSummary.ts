/** History wording for a loadout switch, shared by event and batch summaries. */
export function equipmentSwitchSummary(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const { kind, activeLoadoutName } = record as { kind?: unknown; activeLoadoutName?: unknown };
  if (kind === 'restore') return 'Restored Last Equipped';
  if (kind !== 'loadout') return null;
  return typeof activeLoadoutName === 'string' && activeLoadoutName
    ? `Equipped loadout ${activeLoadoutName}`
    : 'Equipped a loadout';
}

export function isEquipmentSwitchSummary(summary: string): boolean {
  return (
    summary === 'Restored Last Equipped' ||
    summary === 'Equipped a loadout' ||
    summary.startsWith('Equipped loadout ')
  );
}
