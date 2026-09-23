import type { ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { sheetAnchorHash } from './sheetAnchors.ts';

export function InventoryAnchorLink({
  itemId,
  children,
  className = 'link link-hover',
}: {
  itemId: string;
  children: ReactNode;
  className?: string;
}) {
  const hash = sheetAnchorHash('inventory', itemId);
  const inRouter = useInRouterContext();
  return inRouter ? (
    <Link to={{ hash }} className={className}>
      {children}
    </Link>
  ) : (
    <a href={hash} className={className}>
      {children}
    </a>
  );
}
