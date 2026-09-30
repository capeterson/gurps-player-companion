import type { ReactNode } from 'react';
import { SheetAnchorLink } from './SheetAnchorLink.tsx';

export function InventoryAnchorLink({
  itemId,
  children,
  className = 'link link-hover',
}: {
  itemId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SheetAnchorLink kind="inventory" id={itemId} className={className}>
      {children}
    </SheetAnchorLink>
  );
}
