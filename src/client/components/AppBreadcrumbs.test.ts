import { describe, expect, it } from 'vitest';
import { appBreadcrumbPage, appEntityBreadcrumbTarget } from './AppBreadcrumbs.ts';

describe('appEntityBreadcrumbTarget', () => {
  it('resolves character detail routes as a two-level character breadcrumb', () => {
    expect(appEntityBreadcrumbTarget('/characters/char-1')).toEqual({
      kind: 'character',
      id: 'char-1',
    });
  });

  it('keeps nested campaign routes at the campaign entity level', () => {
    expect(appEntityBreadcrumbTarget('/campaigns/camp-1/library')).toEqual({
      kind: 'campaign',
      id: 'camp-1',
    });
    expect(appEntityBreadcrumbTarget('/campaigns/camp-1/encounters/enc-1')).toEqual({
      kind: 'campaign',
      id: 'camp-1',
    });
  });

  it('resolves selected campaigns on global log and library pages', () => {
    expect(appEntityBreadcrumbTarget('/log', '?campaign=camp-1')).toEqual({
      kind: 'campaign',
      id: 'camp-1',
    });
    expect(appEntityBreadcrumbTarget('/library', '?campaign=camp-2')).toEqual({
      kind: 'campaign',
      id: 'camp-2',
    });
    expect(appEntityBreadcrumbTarget('/log')).toBeNull();
  });

  it('labels every routed campaign subpage', () => {
    expect(appBreadcrumbPage('/log')).toBe('Log');
    expect(appBreadcrumbPage('/library')).toBe('Library');
    expect(appBreadcrumbPage('/campaigns/camp-1/library')).toBe('Library');
    expect(appBreadcrumbPage('/campaigns/camp-1/gm')).toBe('GM View');
    expect(appBreadcrumbPage('/campaigns/camp-1/encounters/enc-1')).toBe('Encounter');
    expect(appBreadcrumbPage('/campaigns/camp-1')).toBeNull();
  });

  it('does not invent a second level on collection or unrelated routes', () => {
    expect(appEntityBreadcrumbTarget('/characters')).toBeNull();
    expect(appEntityBreadcrumbTarget('/campaigns')).toBeNull();
    expect(appEntityBreadcrumbTarget('/settings')).toBeNull();
  });
});
