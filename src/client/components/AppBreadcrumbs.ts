import { useLiveQuery } from 'dexie-react-hooks';
import { getLocalDb } from '../db/dexie.ts';

export type AppEntityBreadcrumb = {
  kind: 'character' | 'campaign';
  id: string;
  name: string | undefined;
};

export type AppEntityBreadcrumbTarget = Omit<AppEntityBreadcrumb, 'name'>;

/** Resolve the entity selected by a path or a campaign-scoped global page. */
export function appEntityBreadcrumbTarget(
  pathname: string,
  search = '',
): AppEntityBreadcrumbTarget | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'characters' && segments[1]) {
    return { kind: 'character', id: segments[1] };
  }
  if (segments[0] === 'campaigns' && segments[1]) {
    return { kind: 'campaign', id: segments[1] };
  }
  if (pathname === '/log' || pathname === '/library') {
    const id = new URLSearchParams(search).get('campaign');
    if (id) return { kind: 'campaign', id };
  }
  return null;
}

export function appBreadcrumbPage(pathname: string): string | null {
  if (/^\/log\/?$/.test(pathname) || /^\/campaigns\/[^/]+\/log\/?$/.test(pathname)) return 'Log';
  if (/^\/library\/?$/.test(pathname) || /^\/campaigns\/[^/]+\/library\/?$/.test(pathname))
    return 'Library';
  if (/^\/campaigns\/[^/]+\/gm\/?$/.test(pathname)) return 'GM View';
  if (/^\/campaigns\/[^/]+\/encounters\/[^/]+\/?$/.test(pathname)) return 'Encounter';
  return null;
}

/** Names come from the local-first mirror so breadcrumbs work offline and
 * immediately reflect local character renames. */
export function useAppEntityBreadcrumb(pathname: string, search = ''): AppEntityBreadcrumb | null {
  const target = appEntityBreadcrumbTarget(pathname, search);
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
