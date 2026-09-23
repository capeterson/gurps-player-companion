export type SheetAnchorKind = 'inventory' | 'skill' | 'trait' | 'spell';

export function sheetAnchor(kind: SheetAnchorKind, id: string): string {
  return `${kind}-${id}`;
}

export function sheetAnchorHash(kind: SheetAnchorKind, id: string): string {
  return `#${sheetAnchor(kind, id)}`;
}

export function parseSheetAnchor(hash: string): { kind: SheetAnchorKind; id: string } | null {
  const match = /^#(inventory|skill|trait|spell)-(.+)$/.exec(hash);
  if (!match?.[1] || !match[2]) return null;
  return { kind: match[1] as SheetAnchorKind, id: match[2] };
}
