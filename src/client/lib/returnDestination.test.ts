import { describe, expect, it } from 'vitest';
import { safeReturnDestination } from './returnDestination.ts';

describe('safeReturnDestination', () => {
  it.each([
    '/characters/abc?section=inventory#inventory-item-1',
    '/campaigns/abc/library?section=traits&search=abc',
    '/campaigns/abc/log',
    '/settings',
    '/oauth/consent?client_id=abc&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&state=x%2Fy',
  ])('preserves a registered player destination exactly: %s', (path) => {
    expect(safeReturnDestination(path, 'player')).toBe(path);
  });
  it.each([
    '//evil.example/x',
    '/\\evil.example/x',
    'https://evil.example',
    '/%2f%2fevil.example',
    '/%252f%252fevil.example',
    '/characters/%2e%2e/settings',
    '/characters/%5cevil',
    '/settings/%',
    '/login',
    '/register',
    '/admin/users',
    '/unknown',
    '/settings?bad=%zz',
  ])('rejects an unsafe or unregistered player destination: %s', (path) => {
    expect(safeReturnDestination(path, 'player')).toBe('/');
  });
  it('keeps admin destinations inside the separate admin route set', () => {
    expect(safeReturnDestination('/admin/users/abc?tab=keys#details', 'admin')).toBe(
      '/admin/users/abc?tab=keys#details',
    );
    expect(safeReturnDestination('/admin/login', 'admin')).toBe('/admin/users');
    expect(safeReturnDestination('/admin/%2f%2fevil', 'admin')).toBe('/admin/users');
    expect(safeReturnDestination('/settings', 'admin')).toBe('/admin/users');
  });
});
