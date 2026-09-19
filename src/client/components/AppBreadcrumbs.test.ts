import { describe, expect, it } from 'vitest';
import { appEntityBreadcrumbTarget } from './AppBreadcrumbs.ts';

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

  it('does not invent a second level on collection or unrelated routes', () => {
    expect(appEntityBreadcrumbTarget('/characters')).toBeNull();
    expect(appEntityBreadcrumbTarget('/campaigns')).toBeNull();
    expect(appEntityBreadcrumbTarget('/settings')).toBeNull();
  });
});
