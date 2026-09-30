import type { ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { type SheetAnchorKind, sheetAnchorHash } from './sheetAnchors.ts';

export function SheetAnchorLink({
  kind,
  id,
  children,
  className = 'link link-hover',
}: {
  kind: SheetAnchorKind;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const hash = sheetAnchorHash(kind, id);
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
