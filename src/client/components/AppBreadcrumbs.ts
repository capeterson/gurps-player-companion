import { useLiveQuery } from 'dexie-react-hooks';
import { getLocalDb } from '../db/dexie.ts';

export type AppEntityBreadcrumb = {
  kind: 'character' | 'campaign';
  id: string;
  name: string | undefined;
};

export type AppEntityBreadcrumbTarget = Omit<AppEntityBreadcrumb, 'name'>;

/** Resolve only the two entity levels represented in the persistent header.
 * Deeper campaign routes intentionally keep the campaign itself as level two. */
export function appEntityBreadcrumbTarget(pathname: string): AppEntityBreadcrumbTarget | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'characters' && segments[1]) {
    return { kind: 'character', id: segments[1] };
  }
  if (segments[0] === 'campaigns' && segments[1]) {
    return { kind: 'campaign', id: segments[1] };
  }
  return null;
}

/** Names come from the local-first mirror so breadcrumbs work offline and
 * immediately reflect local character renames. */
export function useAppEntityBreadcrumb(pathname: string): AppEntityBreadcrumb | null {
  const target = appEntityBreadcrumbTarget(pathname);
  const name = useLiveQuery(async () => {
    if (!target) return undefined;
    const db = getLocalDb();
    const row =
      target.kind === 'character'
        ? await db.characters.get(target.id)
        : await db.campaigns.get(target.id);
    return row?.name;
  }, [target?.kind, target?.id]);

  return target ? { ...target, name } : null;
}
